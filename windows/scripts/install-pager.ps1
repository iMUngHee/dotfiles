# windows/scripts/install-pager.ps1 - build pager from source.
#
# pager (github.com/iMUngHee/pager) is the cross-session message bus the Claude
# and Codex hooks call. It is not in winget and has no release binaries, so it
# is built from source the same way its Makefile does on Unix - `make build`
# there produces ~/.local/bin/pager, and this produces ~/.local/bin/pager.exe.
#
# Go is enough: the project pins a pure-Go SQLite driver specifically so it
# cross-compiles without a C toolchain.
#
# ~/.local/bin has to be on the PERSISTENT user PATH, not just this process's:
# claude/settings.json invokes a bare `pager`, and hooks inherit the environment
# of the terminal that launched Claude Code, which reads PATH from the registry.

param(
    [string]$Module = 'github.com/iMUngHee/pager/cmd/pager@latest',
    [switch]$Force
)

. "$PSScriptRoot\..\lib\common.ps1"

Write-Step "pager"

if (-not (Test-Command 'go')) {
    Add-Warn "go not on PATH - pager not built (winget install --id GoLang.Go)"
    return
}

$binDir = Join-Path $HOME '.local\bin'
$exe = Join-Path $binDir 'pager.exe'

if ((Test-Path $exe) -and -not $Force) {
    Write-Ok "pager present - skip ($exe)"
} else {
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }

    # GOBIN redirects `go install` away from the default GOPATH\bin so the
    # layout matches the Makefile's ~/.local/bin on macOS and Linux.
    $prevGobin = $env:GOBIN
    $env:GOBIN = $binDir
    Write-Host "   go install $Module"
    go install $Module
    $goExit = $LASTEXITCODE
    $env:GOBIN = $prevGobin

    if ($goExit -ne 0 -or -not (Test-Path $exe)) {
        Add-Warn "pager build failed (go install exit $goExit)"
        return
    }
    Write-Ok "built $exe"
}

if (Add-UserPath -Directory $binDir) {
    Write-Ok "added to user PATH: $binDir"
} else {
    Write-Ok "already on user PATH: $binDir"
}

# Prove the binary runs rather than trusting that the file exists: a
# cross-compiled or truncated build still leaves a plausible-looking .exe.
# `who` is used because pager has no --version flag and this is its cheapest
# read-only subcommand - it lists active sessions and exits 0 with none.
$probe = (& $exe who 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -eq 0) {
    Write-Ok "pager who -> $(($probe -split "`n")[0])"
} else {
    Add-Warn "pager built but 'who' exited $LASTEXITCODE ($probe)"
}
