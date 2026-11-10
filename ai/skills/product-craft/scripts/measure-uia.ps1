<#
.SYNOPSIS
Summarize a Windows window's UI Automation row deltas and off-window elements as JSON.
.EXAMPLE
pwsh -NoProfile -File measure-uia.ps1 -ProcessId 1234
.EXAMPLE
pwsh -NoProfile -File measure-uia.ps1 -WindowTitle '*Notepad*'
.EXAMPLE
pwsh -NoProfile -File measure-uia.ps1 -ProcessId 1234 -Full
.NOTES
Coordinates are physical screen pixels reported by UI Automation. Rows are inferred from
vertical overlap among siblings; a delta is a review hint, not proof of incorrect layout.
Custom-drawn content and virtualized items may be absent from the automation tree.
#>
[CmdletBinding(DefaultParameterSetName = 'Title')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Process')]
    [ValidateRange(1, 2147483647)][int] $ProcessId,
    [Parameter(Mandatory, ParameterSetName = 'Title')][ValidateNotNullOrEmpty()][string] $WindowTitle,
    [ValidateRange(0, 100)][double] $AlignmentTolerance = 2,
    [ValidateRange(1, 100000)][int] $MaxElements = 5000,
    [switch] $Full
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
$windowMatches = @($windows | Where-Object {
    if ($PSCmdlet.ParameterSetName -eq 'Process') { $_.Current.ProcessId -eq $ProcessId }
    else { $_.Current.Name -like $WindowTitle }
})
if ($windowMatches.Count -ne 1) { throw "Expected one window, found $($windowMatches.Count). Specify -ProcessId or a more precise -WindowTitle." }
$window = $windowMatches[0]
$bounds = $window.Current.BoundingRectangle
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$queue = [System.Collections.Generic.Queue[object]]::new()
$queue.Enqueue(@{ Element = $window; Parent = -1; Depth = 0 })
$elements = [System.Collections.Generic.List[object]]::new()
while ($queue.Count -gt 0 -and $elements.Count -lt $MaxElements) {
    $entry = $queue.Dequeue()
    $current = $entry.Element.Current
    $rect = $current.BoundingRectangle
    $index = $elements.Count
    $hasBounds = -not $rect.IsEmpty -and $rect.Width -gt 0 -and $rect.Height -gt 0
    $elements.Add([pscustomobject]@{
        Index = $index; Parent = $entry.Parent; Depth = $entry.Depth
        Name = $current.Name; AutomationId = $current.AutomationId
        ControlType = $current.ControlType.ProgrammaticName
        X = $(if ($hasBounds) { $rect.X } else { $null })
        Y = $(if ($hasBounds) { $rect.Y } else { $null })
        Width = $(if ($hasBounds) { $rect.Width } else { $null })
        Height = $(if ($hasBounds) { $rect.Height } else { $null })
        CenterY = $(if ($hasBounds) { $rect.Y + $rect.Height / 2 } else { $null })
        Offscreen = $current.IsOffscreen
        OutsideWindow = $hasBounds -and ($rect.Left -lt $bounds.Left -or $rect.Right -gt $bounds.Right -or
            $rect.Top -lt $bounds.Top -or $rect.Bottom -gt $bounds.Bottom)
    })
    for ($child = $walker.GetFirstChild($entry.Element); $null -ne $child; $child = $walker.GetNextSibling($child)) {
        $queue.Enqueue(@{ Element = $child; Parent = $index; Depth = $entry.Depth + 1 })
        if ($queue.Count + $elements.Count -ge $MaxElements) { break }
    }
}
$rows = [System.Collections.Generic.List[object]]::new()
foreach ($group in ($elements | Where-Object { $null -ne $_.CenterY -and -not $_.Offscreen } | Group-Object Parent)) {
    $siblings = @($group.Group | Sort-Object Y, X)
    $assigned = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($anchor in $siblings) {
        if (-not $assigned.Add($anchor.Index)) { continue }
        $members = [System.Collections.Generic.List[object]]::new()
        $members.Add($anchor)
        foreach ($other in $siblings) {
            if ($assigned.Contains($other.Index)) { continue }
            $overlap = [Math]::Min($anchor.Y + $anchor.Height, $other.Y + $other.Height) - [Math]::Max($anchor.Y, $other.Y)
            # Rows are runs of similar-height controls; a pane beside a list is layout, not a row.
            $similar = [Math]::Max($anchor.Height, $other.Height) -le 3 * [Math]::Min($anchor.Height, $other.Height)
            if ($similar -and $overlap -ge [Math]::Min($anchor.Height, $other.Height) / 2) {
                $members.Add($other)
                [void]$assigned.Add($other.Index)
            }
        }
        if ($members.Count -lt 2) { continue }
        $centres = $members | Measure-Object CenterY -Minimum -Maximum
        $delta = [Math]::Round($centres.Maximum - $centres.Minimum, 2)
        $rows.Add([pscustomobject]@{
            Parent = [int]$group.Name; Elements = @($members | ForEach-Object { $_.Index })
            Members = @($members | Select-Object Index, Name, X, Y, Width, Height)
            CenterYs = @($members | ForEach-Object { $_.CenterY })
            Delta = $delta; AboveTolerance = $delta -gt $AlignmentTolerance
        })
    }
}
$report = [ordered]@{
    Window = $window.Current.Name; ProcessId = $window.Current.ProcessId; Units = 'screen px'
    Bounds = @{ X = $bounds.X; Y = $bounds.Y; Width = $bounds.Width; Height = $bounds.Height }
    ElementCount = $elements.Count; RowCount = $rows.Count; AlignmentTolerance = $AlignmentTolerance
    Truncated = $queue.Count -gt 0 -or $elements.Count -ge $MaxElements
    Rows = @($rows | Where-Object AboveTolerance)
    OutsideWindow = @($elements | Where-Object OutsideWindow | Select-Object Index, Name, X, Y, Width, Height, Offscreen)
    Limits = 'UIA control view only; virtualized and custom-drawn content may be absent. Row deltas require intent review.'
}
if ($Full) { $report.Elements = @($elements.ToArray()); $report.Rows = @($rows.ToArray()) }
[pscustomobject]$report | ConvertTo-Json -Depth 8
