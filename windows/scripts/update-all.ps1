# windows/scripts/update-all.ps1 - the `buu` implementation for Windows.
#
# On macOS `buu` is `brew update; brew upgrade`, and brew genuinely owns almost
# everything. winget does not: this tier deliberately installs four things from
# outside it, because winget has no package for them.
#
#   winget / msstore : every CLI, runtime, and app in packages.ps1
#   go install       : pager        (no winget package, no release binaries)
#   npm -g           : tree-sitter-cli, plus the real .exe copied ahead of
#                      npm's sh shim on PATH - that copy goes stale on upgrade
#   PSGallery        : PSReadLine, PSFzf (the oh-my-zsh plugin equivalents)
#   GitHub release   : FiraCode Nerd Font
#
# Running `winget upgrade --all` alone silently leaves all four behind, so this
# exists to make `buu` mean the same thing on both platforms.
#
# The font is opt-in with -Font: it is a 27 MB download whose content changes a
# few times a year, so paying for it on every routine update is not worth it.

param(
    [switch]$Font,
    [switch]$SkipWinget
)

. "$PSScriptRoot\..\lib\common.ps1"

# ── 1. winget + Microsoft Store ───────────────────────────────
if ($SkipWinget) {
    Write-Step "winget (skipped)"
} else {
    Write-Step "winget upgrade"
    # --include-unknown covers packages whose installed version winget cannot
    # parse, which is most portable-zip installs (the Codex CLI among them).
    winget upgrade --all --include-unknown --disable-interactivity `
        --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        # winget returns non-zero when nothing is upgradable, which is not a
        # failure. Anything real shows in the output above.
        Write-Ok "winget finished with exit $LASTEXITCODE (often just 'nothing to upgrade')"
    }
    Update-PathFromRegistry
}

# ── 2. npm globals ────────────────────────────────────────────
Write-Step "npm globals"
if (-not (Test-Command 'npm')) {
    Add-Warn "npm not on PATH - skipped"
} else {
    npm update -g tree-sitter-cli
    if ($LASTEXITCODE -ne 0) { Add-Warn "npm update -g exited $LASTEXITCODE" }

    # Re-copy the real binary. npm's global bin holds an extensionless sh shim
    # that Neovim's uv.spawn resolves and then cannot execute, so packages.ps1
    # puts the actual .exe earlier on PATH - and an upgrade leaves that copy
    # pointing at the previous version until it is refreshed.
    $realExe = Join-Path $env:APPDATA 'npm\node_modules\tree-sitter-cli\tree-sitter.exe'
    $localBin = Join-Path $HOME '.local\bin'
    if ((Test-Path $realExe) -and (Test-Path $localBin)) {
        Copy-Item $realExe (Join-Path $localBin 'tree-sitter.exe') -Force
        Write-Ok "refreshed tree-sitter.exe in $localBin"
    }
}

# ── 3. PSGallery modules ──────────────────────────────────────
Write-Step "PowerShell modules"
foreach ($m in @('PSReadLine', 'PSFzf')) {
    $before = Get-InstalledModule -Name $m -ErrorAction SilentlyContinue
    if (-not $before) {
        # PSReadLine ships with PowerShell itself; only a PSGallery copy is ours
        # to update.
        Write-Ok "$m - not PSGallery-managed, skip"
        continue
    }
    # Check the gallery BEFORE calling Update-Module. `Update-Module -Force`
    # reinstalls even when the installed version is already the newest, and on
    # Windows that reinstall fails loudly - "currently in use" - for any module
    # loaded by another shell. Comparing first keeps that warning for the case
    # where it actually means something.
    $latest = Find-Module -Name $m -ErrorAction SilentlyContinue
    if (-not $latest) {
        Add-Warn "could not reach PSGallery to check $m"
        continue
    }
    if ($before.Version -ge $latest.Version) {
        Write-Ok "$m $($before.Version) - already current"
        continue
    }

    # try/catch, not `if ($?)`: with -ErrorAction SilentlyContinue a failed
    # Update-Module still leaves $? true, so an earlier version of this script
    # reported "updated" for a module that had not moved.
    try {
        Update-Module -Name $m -Force -ErrorAction Stop
        $after = Get-InstalledModule -Name $m -ErrorAction SilentlyContinue
        Write-Ok "$m $($before.Version) -> $($after.Version)"
    } catch {
        # A loaded module cannot be replaced. Worth naming, because the fix is
        # "close the other shells", not "run it again".
        Add-Warn "$m $($before.Version) -> $($latest.Version) failed: $($_.Exception.Message)"
    }
}

# ── 4. pager ──────────────────────────────────────────────────
# Rebuilt rather than version-checked: pager publishes no release binaries, so
# `go install @latest` IS the update mechanism.
& (Join-Path $PSScriptRoot 'install-pager.ps1') -Force

# ── 5. Nerd Font (opt-in) ─────────────────────────────────────
if ($Font) {
    & (Join-Path $PSScriptRoot 'install-nerdfont.ps1') -Force
} else {
    Write-Step "Nerd Font (skipped)"
    Write-Ok "re-run with -Font to check ryanoasis/nerd-fonts for a newer release"
}

Show-WarnSummary
Write-Step "update done"
Write-Host "Neovim plugins and mason tools update inside nvim: :Lazy sync, :MasonUpdate" -ForegroundColor DarkGray
