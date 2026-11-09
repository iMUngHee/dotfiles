# windows/scripts/install-gaebu.ps1 - build gaebu from source.
#
# gaebu (github.com/iMUngHee/gaebu) records the command tree of agent teams;
# the Claude and Codex hooks call a bare `gaebu`, and claude/scripts/bootstrap.sh
# registers `gaebu mcp` only when it is on PATH. It has no winget package and
# no release binaries, so it is built here. lib/agent-clis.sh does the same on
# macOS and Linux.
#
# Built with the GNU toolchain, not the default MSVC one: `cargo install` with
# MSVC needs the Visual Studio Build Tools linker, which this tier does not
# install (see install-rust-tools.ps1). gaebu's dependencies (serde, serde_json,
# sha2, clap) build with the self-contained GNU toolchain, so the toolchain is
# added (minimal profile) when missing.
#
# Replacing a binary follows install-pager.ps1: live sessions run `gaebu mcp`
# from this file, so the new one is built into a stage, smoke-tested and
# swapped in by rename, keeping the last $Backups. Without -Force an installed
# gaebu is left alone; upgrading is the person's call, not a side effect.
#
# -BinDir exists so the build and swap can be exercised without touching the
# installed binary; with a non-default -BinDir the user PATH is not touched.
#
# Every failure is a warning: bootstrap.ps1 runs this under
# $ErrorActionPreference = 'Stop'. Deliberately Windows PowerShell 5.1
# compatible (see lib/common.ps1).

param(
    [string]$Git = 'https://github.com/iMUngHee/gaebu',
    [string]$Toolchain = 'stable-x86_64-pc-windows-gnu',
    [string]$BinDir = (Join-Path $HOME '.local\bin'),
    [switch]$Force,
    [ValidateRange(0, [int]::MaxValue)]
    [int]$Backups = 3
)

. "$PSScriptRoot\..\lib\common.ps1"

Write-Step "gaebu"

if (-not (Test-Command 'rustup') -or -not (Test-Command 'cargo')) {
    Add-Warn "rustup/cargo not on PATH - gaebu not built (winget install --id Rustlang.Rustup)"
    return
}

$exe = Join-Path $BinDir 'gaebu.exe'
$defaultBin = (Join-Path $HOME '.local\bin')

if ((Test-Path $exe) -and -not $Force) {
    Write-Ok "gaebu present - skip ($exe)"
} else {
    if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null }

    # rustup and cargo report progress on stderr. Windows PowerShell 5.1 wraps
    # each line captured by 2>&1 in an ErrorRecord, and Out-Host prints the
    # first as a NativeCommandError block; this turns them back into their text.
    # Exception.Message, not "$_": a blank line's record stringifies to its
    # type name. pwsh 7 wraps them too but prints plain red text, so there
    # the filter only drops the colour.
    filter ConvertTo-StderrText {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    }

    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $installed = (& rustup toolchain list 2>&1 | Out-String)
        if ($installed -notmatch [regex]::Escape($Toolchain)) {
            Write-Host "   rustup toolchain install $Toolchain --profile minimal"
            & rustup toolchain install $Toolchain --profile minimal 2>&1 | ConvertTo-StderrText | Out-Host
            if ($LASTEXITCODE -ne 0) {
                Add-Warn "rustup could not install $Toolchain - gaebu not built"
                return
            }
        }

        $stage = Join-Path ([IO.Path]::GetTempPath()) "gaebu-install-$([guid]::NewGuid())"
        New-Item -ItemType Directory -Path $stage | Out-Null
        try {
            Write-Host "   cargo +$Toolchain install --git $Git --locked gaebu"
            & cargo "+$Toolchain" install --git $Git --locked --root $stage gaebu 2>&1 | ConvertTo-StderrText | Out-Host
            $cargoExit = $LASTEXITCODE
            $new = Join-Path $stage 'bin\gaebu.exe'
            if ($cargoExit -ne 0 -or -not (Test-Path $new)) {
                Add-Warn "gaebu build failed (cargo install exit $cargoExit)"
                return
            }

            $version = (& $new --version 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0) {
                Add-Warn "gaebu candidate failed smoke ('--version': $version) - kept the installed binary"
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
                # Never leave the hooks without a gaebu: put the old one back.
                if ($backup -and -not (Test-Path $exe) -and (Test-Path $backup)) {
                    Move-Item -LiteralPath $backup -Destination $exe -ErrorAction SilentlyContinue
                }
                Add-Warn "gaebu swap failed ($($_.Exception.Message)) - kept the installed binary"
                return
            }
            Write-Ok "built $exe ($version)"

            # Keep the newest $Backups; one a live session still holds is left
            # for a later run.
            Get-ChildItem -LiteralPath $BinDir -Filter 'gaebu.exe.prev.*' |
                Sort-Object Name -Descending | Select-Object -Skip $Backups |
                ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
        } finally {
            Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        }
    } finally {
        $ErrorActionPreference = $prevPref
    }
}

if ($BinDir -eq $defaultBin) {
    if (Add-UserPath -Directory $BinDir) {
        Write-Ok "added to user PATH: $BinDir"
    } else {
        Write-Ok "already on user PATH: $BinDir"
    }
}

# Prove the binary runs rather than trusting that the file exists.
$probe = (& $exe --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -eq 0) {
    Write-Ok "gaebu --version -> $probe"

    # The gaebu mod and rule this repo deploys (claude/mods/gaebu,
    # ai/rules/gaebu.md) are copied from one gaebu release, and gaebu's tests
    # hold the mod's plugin.json at the crate version: warn when this binary is
    # a different release. Same check as ensure_gaebu in lib/agent-clis.sh.
    $plugin = Join-Path (Get-ConfigRoot) 'claude\mods\gaebu\.claude-plugin\plugin.json'
    $want = $null
    try { $want = (Get-Content -Raw -LiteralPath $plugin -ErrorAction Stop | ConvertFrom-Json).version } catch { }
    $have = ($probe -split '\s+')[1]
    if ($want -and $have -and $have -ne $want) {
        Add-Warn "gaebu $have is installed, but claude/mods/gaebu and ai/rules/gaebu.md are from $want - if older, re-run with -Force; if newer, copy both from gaebu $have"
    }
} else {
    Add-Warn "gaebu installed but '--version' exited $LASTEXITCODE ($probe)"
}
