# windows/scripts/deploy-cowork.ps1 - the Cowork surface.
#
# Cowork runs inside the Claude Desktop app, which on Windows is the only way to
# reach it. Unlike Claude Code, Cowork keeps its skills, plugins and connectors
# on the Claude account rather than on disk - so there is nothing here to
# symlink. What this repo can do for Cowork is:
#
#   1. make sure the Desktop app is installed (winget, via packages.ps1)
#   2. turn ai/skills + claude/skills into the zips its uploader takes
#   3. say where to put them, since that part is manual by design
#
# Anything claiming to write Cowork config into a local folder would be made up:
# the account is the store.

. "$PSScriptRoot\..\lib\common.ps1"

$Root = Get-ConfigRoot

# -- 1. Claude Desktop -----------------------------------------
Write-Step "Claude Desktop (Cowork host)"

$installed = $false
if (Test-Command 'winget') {
    $listed = winget list --id Anthropic.Claude --exact --source winget --disable-interactivity | Out-String
    if ($listed -match 'Anthropic\.Claude') { $installed = $true }
}

# winget's registry view can lag a fresh install; a shortcut or install dir is
# the second opinion.
if (-not $installed) {
    $paths = @(
        (Join-Path $env:LOCALAPPDATA 'AnthropicClaude'),
        (Join-Path $env:LOCALAPPDATA 'Programs\claude'),
        (Join-Path $env:APPDATA 'Claude')
    )
    foreach ($p in $paths) { if (Test-Path $p) { $installed = $true; break } }
}

if ($installed) {
    Write-Ok "Claude Desktop present"
} else {
    Add-Warn "Claude Desktop not installed - Cowork needs it. Run: winget install --id Anthropic.Claude --exact"
}

# -- 2. Skill zips ---------------------------------------------
& (Join-Path $PSScriptRoot 'pack-skills.ps1')

# -- 3. What is manual, and why --------------------------------
Write-Step "Cowork: remaining manual steps"
Write-Host @"
   1. Open Claude Desktop and sign in (Cowork needs a paid plan).
   2. Cowork sidebar > Customize > + > Skills, upload the zips from
      windows/dist/cowork-skills/. They then follow your account to web
      and mobile, so this is a one-time step per skill, not per machine.
   3. Grant Cowork the folder you want it working in. It reads and writes
      real files there while the app is open.

   Re-run 'cowork-skills' after editing any SKILL.md, then re-upload the
   ones you changed - Cowork holds a copy, so a repo edit alone does not
   reach it. This is the one place Windows loses the symlink guarantee
   that ~/.claude/skills gives Claude Code.
"@ -ForegroundColor DarkGray
