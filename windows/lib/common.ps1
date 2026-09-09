# windows/lib/common.ps1 - shared helpers for the Windows tier.
#
# Dot-source this from any windows/ script:
#     . "$PSScriptRoot\..\lib\common.ps1"
#
# Deliberately Windows PowerShell 5.1 compatible: bootstrap runs BEFORE
# PowerShell 7 is installed, so no `&&`, no ternary, no `??`, no $IsWindows.

Set-StrictMode -Version 2.0

# -- Warning collection ----------------------------------------
# Same contract as homebrew/bootstrap.sh: optional-step failures are collected
# and printed as a summary at the end, so a non-fatal failure is not buried in
# a successful exit code. Only critical failures abort.
# Guarded: every windows/ script dot-sources this file, and bootstrap.ps1 invokes
# them in sequence. A bare assignment would wipe the earlier steps' warnings, so
# the summary at the end of a full run would only ever show the last step's.
if (-not (Test-Path variable:global:CfgWarnings)) {
    $global:CfgWarnings = @()
}

function Add-Warn {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "WARN $Message" -ForegroundColor Yellow
    $global:CfgWarnings += $Message
}

function Show-WarnSummary {
    if ($global:CfgWarnings.Count -gt 0) {
        Write-Host ""
        Write-Host "=== $($global:CfgWarnings.Count) warning(s) ===" -ForegroundColor Yellow
        foreach ($w in $global:CfgWarnings) { Write-Host "  - $w" -ForegroundColor Yellow }
    }
}

function Write-Step {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host ""
    Write-Host "-- $Message --" -ForegroundColor Cyan
}

function Write-Ok {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "   $Message" -ForegroundColor DarkGray
}

function Test-Command {
    param([Parameter(Mandatory)][string]$Name)
    $c = Get-Command $Name -ErrorAction SilentlyContinue
    return [bool]$c
}

# -- Repo root -------------------------------------------------
# Resolved from this file's location so the tier works from any cwd and from a
# clone that is not at ~/.config (worktrees, CI).
function Get-ConfigRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

# -- PATH refresh ----------------------------------------------
# winget writes shims to Machine/User PATH, but the *running* process keeps the
# environment block it started with. Without this, a package installed in step 1
# is still "not found" in step 3 of the same bootstrap run - the exact trap
# bootstrap.sh documents for `brew shellenv`.
function Update-PathFromRegistry {
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $parts = @()
    foreach ($p in ("$machine;$user" -split ';')) {
        $t = $p.Trim()
        if ($t -ne '' -and ($parts -notcontains $t)) { $parts += $t }
    }
    $env:Path = ($parts -join ';')
}

# Append a directory to the persistent per-user PATH.
#
# Session-only ($env:Path) is not enough for anything a hook has to find: hooks
# inherit the environment of whatever terminal launched Claude Code, and that
# terminal reads PATH from the registry at start. A tool installed here but only
# added to $env:Path is invisible to every hook.
function Add-UserPath {
    param(
        [Parameter(Mandatory)][string]$Directory,
        # Order matters when two directories provide the same command name. npm
        # installs three shims per package - an extensionless sh script, a .cmd
        # and a .ps1 - and Neovim's uv.spawn picks the extensionless one and
        # then cannot execute it. Prepending a directory holding the real .exe
        # is what makes the right file win.
        [switch]$Prepend
    )

    $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @()
    if ($user) { $entries = @($user -split ';' | Where-Object { $_.Trim() -ne '' }) }

    # Compare case-insensitively and without a trailing slash so re-running does
    # not append a second, cosmetically different copy.
    $normalized = $Directory.TrimEnd('\')
    $existingIndex = -1
    for ($i = 0; $i -lt $entries.Count; $i++) {
        if ($entries[$i].TrimEnd('\') -ieq $normalized) { $existingIndex = $i; break }
    }

    if ($existingIndex -ge 0) {
        # Already present and already early enough - nothing to do.
        if (-not $Prepend -or $existingIndex -eq 0) { return $false }
        $entries = @($entries | Where-Object { $_.TrimEnd('\') -ine $normalized })
    }

    if ($Prepend) {
        $entries = @($Directory) + $entries
    } else {
        $entries += $Directory
    }
    [System.Environment]::SetEnvironmentVariable("Path", ($entries -join ';'), "User")
    Update-PathFromRegistry
    return $true
}

# -- Git for Windows / Git Bash --------------------------------
# The AI-config deploy reuses the POSIX bootstrap under Git Bash rather than
# reimplementing it in PowerShell, so bash stays the single source of truth for
# what lands in ~/.claude and ~/.codex. See windows/scripts/deploy-ai.ps1.
function Get-GitBashPath {
    $candidates = @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
        "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git) {
        # ...\Git\cmd\git.exe -> ...\Git\bin\bash.exe
        $guess = Join-Path (Split-Path (Split-Path $git.Source)) "bin\bash.exe"
        if (Test-Path $guess) { return $guess }
    }
    return $null
}

# Convert C:\Users\x\.config to /c/Users/x/.config for handing paths to bash.
function ConvertTo-BashPath {
    param([Parameter(Mandatory)][string]$Path)
    $full = (Resolve-Path $Path).Path
    $drive = $full.Substring(0, 1).ToLower()
    $rest = $full.Substring(2) -replace '\\', '/'
    return "/$drive$rest"
}

# -- Symlinks --------------------------------------------------
# `New-Item -ItemType SymbolicLink` on PowerShell 5.1 does not pass
# SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE, so it demands Administrator even
# with Developer Mode on. cmd's mklink does pass it. Junctions are the fallback
# for directories because they never need a privilege at all.
function New-ConfigLink {
    param(
        [Parameter(Mandatory)][string]$Link,
        [Parameter(Mandatory)][string]$Target
    )
    if (-not (Test-Path $Target)) {
        Add-Warn "link target missing, skipped: $Target"
        return $false
    }
    $parent = Split-Path $Link -Parent
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    # Remove-Item on a link removes the link, not the target - but only when the
    # link is addressed without a trailing separator. Use .NET for directories so
    # a stale junction is never followed into the source tree.
    if (Test-Path $Link) {
        $existing = Get-Item $Link -Force
        if ($existing.PSIsContainer -and -not $existing.LinkType) {
            Remove-Item $Link -Recurse -Force
        } elseif ($existing.PSIsContainer) {
            [System.IO.Directory]::Delete($existing.FullName)
        } else {
            Remove-Item $Link -Force
        }
    }
    $isDir = (Get-Item $Target -Force).PSIsContainer
    # Built as an explicit argument list rather than interpolating a possibly
    # empty $flag: Windows PowerShell drops an empty-string native argument, but
    # PowerShell 7.3+ changed native argument passing and does not promise to,
    # which would hand cmd a stray empty arg before the link name.
    $mklinkArgs = @('/c', 'mklink')
    if ($isDir) { $mklinkArgs += '/D' }
    $mklinkArgs += @($Link, $Target)

    $out = & cmd @mklinkArgs
    if ($LASTEXITCODE -ne 0 -and $isDir) {
        # Developer Mode off - junction still works for directories.
        $out = & cmd /c mklink /J $Link $Target
    }
    if ($LASTEXITCODE -ne 0) {
        Add-Warn "failed to link $Link -> $Target ($out)"
        return $false
    }
    return $true
}

# -- Developer Mode --------------------------------------------
function Test-DeveloperMode {
    $key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock"
    $v = Get-ItemProperty -Path $key -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue
    if ($null -eq $v) { return $false }
    return ($v.AllowDevelopmentWithoutDevLicense -eq 1)
}

# Property names of a PSCustomObject, safe under Set-StrictMode.
#
# `$obj.PSObject.Properties.Name` looks equivalent but is member enumeration
# over a collection, and StrictMode 2.0 throws "cannot find 'Name' property"
# when that collection is EMPTY. Windows Terminal ships `"profiles": {}` and an
# empty `defaults` in a stock settings.json, so the merge hit exactly that.
function Get-PropertyNames {
    param([Parameter(Mandatory)][AllowNull()]$Object)
    $names = @()
    if ($null -eq $Object) { return $names }
    if (-not $Object.PSObject) { return $names }
    foreach ($p in $Object.PSObject.Properties) { $names += $p.Name }
    return $names
}

# -- JSON deep merge -------------------------------------------
# Mirrors the `jq -s '$local * $repo'` contract in claude/scripts/bootstrap.sh:
# repo keys win, local-only keys survive. Used for Windows Terminal settings,
# which carry machine-generated profile GUIDs we must not clobber.
function Merge-JsonObject {
    param(
        [Parameter(Mandatory)][AllowNull()]$Local,
        [Parameter(Mandatory)][AllowNull()]$Repo
    )
    if ($null -eq $Local) { return $Repo }
    if ($null -eq $Repo) { return $Local }
    if ($Repo -isnot [System.Management.Automation.PSCustomObject]) { return $Repo }
    if ($Local -isnot [System.Management.Automation.PSCustomObject]) { return $Repo }

    $merged = $Local
    $existing = Get-PropertyNames -Object $merged
    foreach ($prop in $Repo.PSObject.Properties) {
        $name = $prop.Name
        # Keys the fragments use for inline documentation never reach a
        # deployed file.
        if ($name -like '//*') { continue }
        if ($existing -contains $name) {
            $merged.$name = Merge-JsonObject -Local $merged.$name -Repo $prop.Value
        } else {
            $merged | Add-Member -MemberType NoteProperty -Name $name -Value $prop.Value
        }
    }
    return $merged
}

# Write UTF-8 without BOM. Set-Content -Encoding utf8 on PowerShell 5.1 emits a
# BOM, which breaks JSON parsers and anything read back by bash.
function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content
    )
    $parent = Split-Path $Path -Parent
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $enc)
}
