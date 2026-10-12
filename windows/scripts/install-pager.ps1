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
# Replacing it follows the Makefile's `reinstall` rather than `build`: live
# sessions keep `pager mcp` running from this very file, so the new binary is
# staged, smoke-tested, and swapped in by rename, keeping the last $Backups.
#
# ~/.local/bin has to be on the PERSISTENT user PATH, not just this process's:
# claude/settings.json invokes a bare `pager`, and hooks inherit the environment
# of the terminal that launched Claude Code, which reads PATH from the registry.

param(
    [string]$Module = 'github.com/iMUngHee/pager/cmd/pager@latest',
    [switch]$Force,
    [ValidateRange(0, [int]::MaxValue)]
    [int]$Backups = 3
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

    # Build into a scratch GOBIN, not straight over $exe. `go install` moves a
    # running binary aside as pager.exe~, so once an older session still runs
    # from that ~ file the next install cannot move pager.exe and fails with
    # "being used by another process". Renaming the live exe to a unique backup
    # name always succeeds, so the swap is done here instead.
    $stage = Join-Path ([IO.Path]::GetTempPath()) "pager-install-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        $prevGobin = $env:GOBIN
        $env:GOBIN = $stage
        Write-Host "   go install $Module"
        go install $Module
        $goExit = $LASTEXITCODE
        $env:GOBIN = $prevGobin

        $new = Join-Path $stage 'pager.exe'
        if ($goExit -ne 0 -or -not (Test-Path $new)) {
            Add-Warn "pager build failed (go install exit $goExit)"
            return
        }

        # Smoke the candidate against a throwaway store before it replaces
        # anything: `who` opens, migrates and queries the database, which a
        # store-handling regression would fail and `--help` never touches.
        # Continue, not the caller's Stop: under Windows PowerShell 5.1 a stderr
        # line captured by 2>&1 would otherwise throw past the warning below.
        $prevDb = $env:PAGER_DB
        $prevPref = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $env:PAGER_DB = Join-Path $stage 'smoke.db'
            $smoke = (& $new who 2>&1 | Out-String).Trim()
            $smokeExit = $LASTEXITCODE
        } finally {
            $env:PAGER_DB = $prevDb
            $ErrorActionPreference = $prevPref
        }
        if ($smokeExit -ne 0) {
            Add-Warn "pager candidate failed smoke ('who' exited ${smokeExit}: $smoke) - kept the installed binary"
            return
        }

        $backup = $null
        try {
            if (Test-Path $exe) {
                $backup = "$exe.prev.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
                Move-Item -LiteralPath $exe -Destination $backup -ErrorAction Stop
            }
            Move-Item -LiteralPath $new -Destination $exe -ErrorAction Stop
        } catch {
            # Never leave the hooks without a pager: put the old one back.
            if ($backup -and -not (Test-Path $exe) -and (Test-Path $backup)) {
                Move-Item -LiteralPath $backup -Destination $exe -ErrorAction SilentlyContinue
            }
            Add-Warn "pager swap failed ($($_.Exception.Message)) - kept the installed binary"
            return
        }
        Write-Ok "built $exe"

        # Keep the newest $Backups. One still held by a live session cannot be
        # deleted yet and is left for a later run; so is a pager.exe~ left by
        # the old in-place `go install`.
        Get-ChildItem -LiteralPath $binDir -Filter 'pager.exe.prev.*' |
            Sort-Object Name -Descending | Select-Object -Skip $Backups |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath "$exe~" -Force -ErrorAction SilentlyContinue
    } finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
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
