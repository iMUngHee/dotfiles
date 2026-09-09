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
#   cowork-skills                     # every skill
#   cowork-skills -Only design,eli5   # just these
#   cowork-skills -List               # report only, write nothing

param(
    [string[]]$Only = @(),
    [switch]$List,
    [string]$OutDir
)

. "$PSScriptRoot\..\lib\common.ps1"

$Root = Get-ConfigRoot
if (-not $OutDir) { $OutDir = Join-Path $Root 'windows\dist\cowork-skills' }

# Same three source tiers, in the same order, as the skills overlay in
# claude/scripts/bootstrap.sh - a later tier with the same name wins.
$sourceDirs = @(
    (Join-Path $Root 'ai\skills'),
    (Join-Path $Root 'ai\skills\private'),
    (Join-Path $Root 'claude\skills')
)

$excludeDirs = @('node_modules', '.git', 'dist', '.next', 'target')

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
        $skills[$dir.Name] = @{ dir = $dir.FullName; meta = (Get-SkillFrontmatter $skillMd) }
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
        Description = $s.meta.description
    }
}
$report | Format-Table Skill, KB, Files, For -AutoSize

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
    source    = 'ai/skills, ai/skills/private, claude/skills'
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
