# windows/scripts/pack-skills.ps1 - package skills as Cowork-uploadable zips.
#
# Claude Code reads skills straight off disk (~/.claude/skills, which the shared
# bootstrap fills with symlinks). Cowork does not: its skills live on the Claude
# account and are added by uploading a zip of the skill folder in
# Customize > + > Skills. This script produces those zips from the same
# ai/skills + claude/skills sources, so one edit still feeds both surfaces.
#
# Run it directly, or as `cowork-skills` from the PowerShell profile.
#
#   cowork-skills                     # every shared skill (no private tier)
#   cowork-skills -Only design,eli5   # just these
#   cowork-skills -List               # report only, write nothing
#   cowork-skills -IncludePrivate     # opt in to ai/skills/private as well
#
# ai/skills/private is opt-in, unlike the other tiers. It is gitignored
# (ai/.gitignore) precisely because its contents are not meant to leave this
# machine by the usual routes, and a zip whose documented next step is "upload
# to your Claude account, where it follows you to web and mobile" is exactly
# such a route. gitignore cannot help here - this script reads the working tree,
# not the index - so the switch is the only gate. Packing a skill you did not
# realise was private is not recoverable by deleting the zip.

param(
    [string[]]$Only = @(),
    [switch]$List,
    [switch]$IncludePrivate,
    [string]$OutDir
)

. "$PSScriptRoot\..\lib\common.ps1"

$Root = Get-ConfigRoot
if (-not $OutDir) { $OutDir = Join-Path $Root 'windows\dist\cowork-skills' }

# Same tier order as the skills overlay in claude/scripts/bootstrap.sh - a later
# tier with the same name wins. The private tier joins only under -IncludePrivate.
$privateDir = Join-Path $Root 'ai\skills\private'
$sourceDirs = @(Join-Path $Root 'ai\skills')
if ($IncludePrivate) { $sourceDirs += $privateDir }
$sourceDirs += (Join-Path $Root 'claude\skills')

# __pycache__: compiled bytecode is machine-specific and has no business in a
# skill zip (kafdrop-hunt ships .py, so it accumulates there).
$excludeDirs = @('node_modules', '.git', 'dist', '.next', 'target', '__pycache__')

function Get-SkillFrontmatter {
    param([Parameter(Mandatory)][string]$SkillMd)
    $result = @{ name = ''; description = ''; tools = '' }
    $lines = Get-Content $SkillMd -Encoding UTF8
    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') { return $result }
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq '---') { break }
        if ($lines[$i] -match '^name:\s*"?(.*?)"?\s*$')          { $result.name = $Matches[1] }
        elseif ($lines[$i] -match '^description:\s*"?(.*?)"?\s*$') { $result.description = $Matches[1] }
        elseif ($lines[$i] -match '^allowed-tools:\s*(.*?)\s*$')   { $result.tools = $Matches[1] }
    }
    return $result
}

# -- Discover --------------------------------------------------
$skills = @{}
foreach ($src in $sourceDirs) {
    if (-not (Test-Path $src)) { continue }
    foreach ($dir in Get-ChildItem $src -Directory -ErrorAction SilentlyContinue) {
        # ai/skills/private is itself a child of ai/skills; it is a tier, not a skill.
        if ($dir.Name -eq 'private') { continue }
        $skillMd = Join-Path $dir.FullName 'SKILL.md'
        if (-not (Test-Path $skillMd)) { continue }
        $skills[$dir.Name] = @{
            dir     = $dir.FullName
            meta    = (Get-SkillFrontmatter $skillMd)
            private = ($src -eq $privateDir)
        }
    }
}

if ($Only.Count -gt 0) {
    $filtered = @{}
    foreach ($n in $Only) {
        if ($skills.ContainsKey($n)) {
            $filtered[$n] = $skills[$n]
        } else {
            Add-Warn "no such skill: $n"
        }
    }
    $skills = $filtered
}

if ($skills.Count -eq 0) {
    Write-Host "No skills found." -ForegroundColor Yellow
    return
}

# -- Report ----------------------------------------------------
# Skills whose allowed-tools include Bash or Agent are Claude Code workflow
# skills (worktrees, per-commit review, subagents). Flagged rather than filtered:
# Cowork ignores frontmatter it does not use, so uploading one is harmless - it
# just will not do anything useful there, and only you know which you want.
Write-Step "skills discovered ($($skills.Count))"

$report = foreach ($name in ($skills.Keys | Sort-Object)) {
    $s = $skills[$name]
    $files = Get-ChildItem $s.dir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $p = $_.FullName; -not ($excludeDirs | Where-Object { $p -like "*\$_\*" }) }
    $kb = 0
    if ($files) { $kb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1KB, 1) }
    $codeOriented = ($s.meta.tools -match 'Bash|Agent')
    if ($codeOriented) { $flag = 'code' } else { $flag = '' }
    [PSCustomObject]@{
        Skill = $name
        KB    = $kb
        Files = @($files).Count
        For   = $flag
        Tier  = $(if ($s.private) { 'private' } else { '' })
        Description = $s.meta.description
    }
}
$report | Format-Table Skill, KB, Files, For, Tier -AutoSize

# Unlike the 'code' flag, this one is not cosmetic: these came from the
# gitignored tier and the next documented step uploads them off this machine.
$privateNames = @($report | Where-Object { $_.Tier -eq 'private' } | ForEach-Object { $_.Skill })
if ($privateNames.Count -gt 0) {
    Add-Warn "packing $($privateNames.Count) PRIVATE skill(s): $($privateNames -join ', ') - these leave this machine when you upload them"
}

# Cowork's uploader rejects a description containing anything that looks like an
# XML tag: "SKILL.md description cannot contain XML tags". A placeholder written
# as <branch> is enough. That check runs server-side, one zip at a time, after
# the file is already picked in a dialog - so without this the first sign of
# trouble is a red banner partway through a manual upload run.
foreach ($row in $report) {
    $desc = $row.Description
    if (-not $desc) { continue }
    $tags = [regex]::Matches($desc, '<[/a-zA-Z][^>]*>') | ForEach-Object { $_.Value } | Sort-Object -Unique
    if ($tags) {
        Add-Warn "$($row.Skill): description contains $($tags -join ' ') - Cowork will reject this zip. Rewrite the placeholder without angle brackets."
    }
}

if ($List) {
    Write-Host "(-List: nothing written)" -ForegroundColor DarkGray
    return
}

# -- Pack ------------------------------------------------------
# Staged through a temp directory because Compress-Archive has no exclude
# filter, and because the zip must contain the skill folder itself at its root
# (skill-name/SKILL.md), which is the layout the Cowork uploader expects.
Write-Step "packing to $OutDir"

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$stageRoot = Join-Path $env:TEMP "cowork-skills-$PID"
if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$packed = 0
foreach ($name in ($skills.Keys | Sort-Object)) {
    $s = $skills[$name]
    $stage = Join-Path $stageRoot $name
    Copy-Item $s.dir $stage -Recurse -Force
    foreach ($ex in $excludeDirs) {
        Get-ChildItem $stage -Recurse -Directory -Filter $ex -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    }
    $zip = Join-Path $OutDir "$name.zip"
    Compress-Archive -Path $stage -DestinationPath $zip -Force
    $packed++
}
Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue

# A manifest so the zips are self-describing months from now, when it is no
# longer obvious which ones were already uploaded.
$manifest = [PSCustomObject]@{
    generated = (Get-Date).ToString('o')
    source    = (($sourceDirs | ForEach-Object { $_.Replace("$Root\", '').Replace('\', '/') }) -join ', ')
    note      = 'Upload in Cowork: Customize > + > Skills > upload zip.'
    skills    = @($report | Select-Object Skill, KB, Files, For, Description)
}
Write-Utf8NoBom -Path (Join-Path $OutDir 'manifest.json') -Content ($manifest | ConvertTo-Json -Depth 8)

Write-Ok "$packed zip(s) + manifest.json"
Write-Host ""
Write-Host "Upload: Cowork sidebar > Customize > + > Skills > upload the zip" -ForegroundColor Green
Write-Host "Folder: $OutDir" -ForegroundColor Green
Write-Host "Skills marked 'code' are Claude Code workflow skills; they upload fine" -ForegroundColor DarkGray
Write-Host "but have little to do in Cowork." -ForegroundColor DarkGray
