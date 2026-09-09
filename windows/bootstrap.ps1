# windows/bootstrap.ps1 - ~/.config entrypoint for a fresh Windows machine.
#
# The Windows counterpart of the repo root bootstrap.sh. It cannot BE
# bootstrap.sh, because step 1 there is Homebrew, which does not exist here. So
# the split is:
#
#   bootstrap.sh (macOS/Linux)          bootstrap.ps1 (Windows)
#   ------------------------------      ---------------------------------
#   1 homebrew/bootstrap.sh             1 windows/packages.ps1      (winget)
#     - brew bundle                       - the Brewfile mapping
#     - ~/.zshenv ZDOTDIR               2 Update-PathFromRegistry
#     - oh-my-zsh                       3 windows/scripts/install-nerdfont.ps1
#   2 brew shellenv into this scope     4 windows/scripts/deploy-shell.ps1
#   3 ai/scripts/bootstrap.sh           5 windows/scripts/deploy-ai.ps1
#                                           -> runs the SAME ai/scripts/bootstrap.sh
#                                              under Git Bash
#                                       6 windows/scripts/deploy-notifier.ps1
#                                       7 windows/scripts/deploy-cowork.ps1
#
# Step 2 matters for the same reason it does on Unix: winget writes its shims to
# the registry PATH, but this already-running process keeps the environment
# block it started with. Without the refresh, jq and yq installed in step 1 are
# still "not found" when step 5 checks for them.
#
# Usage:
#   pwsh -File ~/.config/windows/bootstrap.ps1
#   pwsh -File ~/.config/windows/bootstrap.ps1 -SkipPackages
#   pwsh -File ~/.config/windows/bootstrap.ps1 -NoBackup
#
# Idempotent: re-running is safe. Optional-step failures are collected and
# printed as a summary; only a missing winget or Git Bash aborts.

[CmdletBinding()]
param(
    [switch]$SkipPackages,   # skip winget entirely
    [switch]$SkipOptional,   # CLI + shell only; no desktop apps or fonts
    [switch]$SkipCowork,     # skip Claude Desktop check + skill packaging
    [switch]$NoBackup,       # forwarded to ai/scripts/bootstrap.sh
    [switch]$DryRun          # forwarded to packages.ps1
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib\common.ps1"

$Root = Get-ConfigRoot
$Scripts = Join-Path $PSScriptRoot 'scripts'

Write-Host ""
Write-Host "=== ~/.config windows bootstrap ===" -ForegroundColor Green
Write-Host "Root:  $Root"
Write-Host "Shell: PowerShell $($PSVersionTable.PSVersion)"

# -- 1. Packages -----------------------------------------------
if ($SkipPackages) {
    Write-Step "winget (skipped)"
} else {
    $pkgArgs = @{}
    if ($SkipOptional) { $pkgArgs['SkipOptional'] = $true }
    if ($DryRun)       { $pkgArgs['DryRun'] = $true }
    & (Join-Path $PSScriptRoot 'packages.ps1') @pkgArgs
}

# -- 2. PATH refresh (see header) ------------------------------
Update-PathFromRegistry
Write-Step "PATH refreshed from registry"
foreach ($probe in @('git', 'jq', 'yq', 'pwsh', 'starship', 'nvim')) {
    $c = Get-Command $probe -ErrorAction SilentlyContinue
    if ($c) { Write-Ok "$probe -> $($c.Source)" } else { Write-Ok "$probe -> not found" }
}

# -- 3. Nerd Font (not in winget; see packages.ps1) -------------
if (-not $SkipPackages -and -not $SkipOptional) {
    & (Join-Path $Scripts 'install-nerdfont.ps1')
}

# -- 4. Shell + terminal + editor ------------------------------
& (Join-Path $Scripts 'deploy-shell.ps1')

# -- 5. Claude / Codex config (delegates to the POSIX bootstrap) -
$aiArgs = @()
if ($NoBackup) { $aiArgs += '--no-backup' }
& (Join-Path $Scripts 'deploy-ai.ps1') -BootstrapArgs $aiArgs

# -- 6. Notifier -----------------------------------------------
& (Join-Path $Scripts 'deploy-notifier.ps1')

# -- 7. Cowork -------------------------------------------------
if ($SkipCowork) {
    Write-Step "Cowork (skipped)"
} else {
    & (Join-Path $Scripts 'deploy-cowork.ps1')
}

# -- 8. Summary ------------------------------------------------
Show-WarnSummary

Write-Host ""
Write-Host "=== windows bootstrap complete ===" -ForegroundColor Green
Write-Host @"
Edit source files under ~/.config/ai/, claude/, codex/, windows/ - NOT the
deployed copies.
- Most ~/.claude/* are native NTFS symlinks; editing those mutates ai/ originals.
- ~/.claude/CLAUDE.md and ~/.claude/MEMORY.md are generated. Direct edits are lost.
- The PowerShell profile in Documents\ is a stub; the real one is
  ~/.config/windows/profile.ps1 and takes effect on the next prompt.
- Windows Terminal settings.json was merged, not replaced (backup: .bak).
- Cowork holds its own copy of each skill. Re-run 'cowork-skills' and re-upload
  after editing a SKILL.md.
- Re-run this script any time with 'cfg-sync'.
Open a NEW terminal to pick up the profile and PATH.
"@ -ForegroundColor DarkGray
