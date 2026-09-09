# windows/scripts/deploy-ai.ps1 - deploy the Claude/Codex config on Windows.
#
# This script deliberately does NOT reimplement the deploy. It runs the existing
# ai/scripts/bootstrap.sh under Git Bash, so bash stays the single source of
# truth for what lands in ~/.claude and ~/.codex on every platform. A PowerShell
# port would be a second implementation to keep in sync, and the 3-tier merge
# rules (rules/ and memory/ per-file symlinks, the skills overlay, the generated
# MEMORY.md, the jq settings merge) are exactly the kind of logic that drifts.
#
# What makes that work on Windows:
#   MSYS=winsymlinks:nativestrict  ->  `ln -s` creates REAL NTFS symlinks
#     instead of MSYS's default copy. Without it every symlink in ~/.claude
#     becomes a stale copy and editing the source stops taking effect.
#     "nativestrict" (not "native") makes a failed symlink an error rather than
#     a silent fallback to copying, so a broken deploy is loud.
#   Developer Mode  ->  lets an unelevated process create those symlinks.
#
# Afterwards it merges windows/claude-settings.windows.json, which carries the
# keys that only mean something on Windows.

param([string[]]$BootstrapArgs = @())

. "$PSScriptRoot\..\lib\common.ps1"

$Root = Get-ConfigRoot
$WinDir = Join-Path $Root 'windows'

# -- 1. Preconditions ------------------------------------------
Write-Step "checking prerequisites"

$bash = Get-GitBashPath
if (-not $bash) {
    Write-Host "ERROR: Git Bash not found. Install Git for Windows:" -ForegroundColor Red
    Write-Host "       winget install --id Git.Git --exact" -ForegroundColor Red
    exit 1
}
Write-Ok "git bash: $bash"

if (-not (Test-DeveloperMode)) {
    Add-Warn "Developer Mode is OFF - symlink creation will fail. Enable it at Settings > System > For developers, then re-run."
} else {
    Write-Ok "Developer Mode: on"
}

# jq and yq are hard requirements of claude/ and codex/ bootstrap respectively.
# Checked here rather than letting bash fail halfway through a deploy.
foreach ($dep in @('jq', 'yq')) {
    if (Test-Command $dep) {
        Write-Ok "${dep}: present"
    } else {
        Add-Warn "$dep not on PATH - the deploy step that needs it will fail"
    }
}

# -- 2. Run the shared POSIX bootstrap under Git Bash ----------
Write-Step "ai/scripts/bootstrap.sh (via Git Bash)"

$prevMsys = $env:MSYS
$env:MSYS = 'winsymlinks:nativestrict'

$bootstrapScript = Join-Path $Root 'ai\scripts\bootstrap.sh'

# `bash -l <file> <args>`, not `bash -lc "<command string>"`. PowerShell's native
# argument passing mangles the quoting inside a -c string, which silently
# truncated the command; handing bash the script path and letting it forward
# argv avoids the whole quoting layer. -l keeps a login shell so /usr/bin (awk,
# sed, find, wc) is on PATH, and the Windows PATH carrying jq/yq/git survives it.
& $bash -l $bootstrapScript @BootstrapArgs
$bootstrapExit = $LASTEXITCODE

$env:MSYS = $prevMsys

if ($bootstrapExit -ne 0) {
    Add-Warn "ai/scripts/bootstrap.sh exited $bootstrapExit"
} else {
    Write-Ok "shared deploy completed"
}

# -- 3. Verify the symlinks are real ---------------------------
# MSYS silently degrading to copies is the failure this tier exists to prevent,
# and a copy looks identical to a symlink until an edit to the source quietly
# stops propagating. Check a known-symlinked target rather than trusting exit 0.
Write-Step "verifying symlink deploy"

$probe = Join-Path $HOME '.claude\PERSONAL.md'
if (Test-Path $probe) {
    $item = Get-Item $probe -Force
    if ($item.LinkType -eq 'SymbolicLink') {
        Write-Ok "~/.claude/PERSONAL.md is a symlink -> $($item.Target)"
    } else {
        Add-Warn "~/.claude/PERSONAL.md is a COPY, not a symlink - edits to ai/ will not propagate. Check Developer Mode and MSYS=winsymlinks:nativestrict."
    }
} else {
    Add-Warn "~/.claude/PERSONAL.md missing - the claude deploy did not complete"
}

# -- 4. Windows-only settings merge ----------------------------
Write-Step "merging Windows-only Claude settings"

$settingsPath = Join-Path $HOME '.claude\settings.json'
$fragmentPath = Join-Path $WinDir 'claude-settings.windows.json'

if (-not (Test-Path $settingsPath)) {
    Add-Warn "~/.claude/settings.json not found - skipped the Windows settings merge"
} else {
    $fragmentRaw = Get-Content $fragmentPath -Raw -Encoding UTF8
    $fragmentRaw = $fragmentRaw.Replace('__GIT_BASH_PATH__', $bash.Replace('\', '\\'))
    # The "//" documentation keys are dropped by Merge-JsonObject itself, so
    # both fragments get the same treatment from one place.
    $fragment = $fragmentRaw | ConvertFrom-Json

    $local = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $merged = Merge-JsonObject -Local $local -Repo $fragment
    Write-Utf8NoBom -Path $settingsPath -Content ($merged | ConvertTo-Json -Depth 32)
    Write-Ok "CLAUDE_CODE_GIT_BASH_PATH -> $bash"
}

Write-Step "ai deploy done"
