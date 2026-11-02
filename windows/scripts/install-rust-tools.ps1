# windows/scripts/install-rust-tools.ps1 - the Rust tooling the rust skill and
# Claude's rust-analyzer-lsp plugin expect, matching what the Mac and the VM get.
#
#   - the rust-analyzer rustup component (lib/rust-analyzer.sh on Unix): the
#     plugin runs `rust-analyzer` from PATH, and without the component rustup's
#     proxy only says it is unavailable.
#   - cargo-nextest and cargo-mutants (the skill's test and mutation loop).
#     Neither is in winget, and `cargo install` would need the MSVC linker from
#     Visual Studio Build Tools, which this tier does not install, so the
#     official x86_64-pc-windows-msvc release zips are used instead, pinned by
#     version and sha256. ARM64 Windows 11 runs them under x64 emulation.
#
# Both binaries go to ~/.local/bin, which install-pager.ps1 already puts on the
# persistent user PATH; `cargo nextest` and `cargo mutants` find cargo-*.exe there.
#
# Every failure here is a warning: bootstrap.ps1 runs this under
# $ErrorActionPreference = 'Stop', so each step that can throw is caught.
#
# -BinDir exists so the download / checksum / extract path can be exercised on a
# machine that is not Windows. Off Windows the binaries cannot run, so their
# version is not probed and the user PATH is not touched.
#
# Deliberately Windows PowerShell 5.1 compatible (see lib/common.ps1).

param(
    [string]$BinDir = (Join-Path $HOME '.local\bin')
)

. "$PSScriptRoot\..\lib\common.ps1"

# Windows PowerShell 5.1 does not offer TLS 1.2 by default; GitHub requires it.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Step "Rust tools"

$onWindows = ($env:OS -eq 'Windows_NT')

# -- rust-analyzer component -----------------------------------
if (-not (Test-Command 'rustup')) {
    Write-Ok "rustup not installed - skipped (winget install --id Rustlang.Rustup)"
    return
}
# RUSTUP_AUTO_INSTALL=0: with no toolchain yet this has to warn, not download
# a whole toolchain as a side effect of the bootstrap.
# Continue, not the caller's Stop: rustup prints its info lines on stderr, and
# under Windows PowerShell 5.1 a stderr line captured by 2>&1 would otherwise
# throw (same as install-pager.ps1's smoke test).
$prevAutoInstall = $env:RUSTUP_AUTO_INSTALL
$prevPref = $ErrorActionPreference
$componentExit = 1
try {
    $ErrorActionPreference = 'Continue'
    $env:RUSTUP_AUTO_INSTALL = '0'
    & rustup component add rust-analyzer 2>&1 | Out-Null
    $componentExit = $LASTEXITCODE
} catch {
    $componentExit = 1
} finally {
    $env:RUSTUP_AUTO_INSTALL = $prevAutoInstall
    $ErrorActionPreference = $prevPref
}
if ($componentExit -eq 0) {
    Write-Ok "rust-analyzer component present"
} else {
    Add-Warn "rustup component add rust-analyzer failed - no toolchain yet? run 'rustup default stable', then bootstrap again"
}

# -- cargo-nextest, cargo-mutants ------------------------------
# A version bump changes Url and Sha256 together; the hash is of the zip asset.
$tools = @(
    @{ Name = 'cargo-nextest'; Sub = 'nextest'; Version = '0.9.150'
       Url = 'https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-0.9.150/cargo-nextest-0.9.150-x86_64-pc-windows-msvc.zip'
       Sha256 = '6fd8f9ba48c946a79a5bcdd35bf4f922447b149f7ca6c3ff7f39e12f32ef78db' },
    @{ Name = 'cargo-mutants'; Sub = 'mutants'; Version = '27.1.0'
       Url = 'https://github.com/sourcefrog/cargo-mutants/releases/download/v27.1.0/cargo-mutants-x86_64-pc-windows-msvc.zip'
       Sha256 = '2a2f00e47d4b458262a41501b0820aa26015fd35779903d2c8b30b2993f36791' }
)

if ($onWindows -and $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    Write-Ok "ARM64: installing the x64 builds, which Windows 11 runs under emulation"
}

try {
    New-Item -ItemType Directory $BinDir -Force | Out-Null
} catch {
    Add-Warn "cannot create $BinDir - cargo-nextest and cargo-mutants not installed ($($_.Exception.Message))"
    return
}

foreach ($t in $tools) {
    $exe = Join-Path $BinDir "$($t.Name).exe"

    # Present at the pinned version -> nothing to do. cargo runs a subcommand as
    # `cargo-<name> <name> ...`, so the version probe uses the same form.
    if (Test-Path $exe) {
        if (-not $onWindows) {
            Write-Ok "$($t.Name) present - skip (version not probed off Windows)"
            continue
        }
        $ver = $null
        $prevPref = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $ver = (& $exe $t.Sub --version 2>$null | Select-Object -First 1)
        } catch {
            $ver = $null
        } finally {
            $ErrorActionPreference = $prevPref
        }
        if ($ver -and ($ver -match [regex]::Escape($t.Version))) {
            Write-Ok "$($t.Name) $($t.Version) present - skip"
            continue
        }
    }

    $stage = Join-Path ([System.IO.Path]::GetTempPath()) "$($t.Name)-$PID"
    $prevProgress = $ProgressPreference
    try {
        if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
        New-Item -ItemType Directory $stage -Force | Out-Null
        $zip = Join-Path $stage "$($t.Name).zip"

        # Progress rendering makes Invoke-WebRequest crawl (install-nerdfont.ps1).
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest $t.Url -OutFile $zip -UseBasicParsing
        $ProgressPreference = $prevProgress

        $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $t.Sha256) {
            Add-Warn "$($t.Name): CHECKSUM MISMATCH - not installed (expected $($t.Sha256), got $actual)"
            continue
        }
        Write-Ok "$($t.Name) $($t.Version): sha256 verified"

        Expand-Archive -Path $zip -DestinationPath $stage -Force
        $found = Get-ChildItem $stage -Recurse -Filter "$($t.Name).exe" | Select-Object -First 1
        if (-not $found) {
            Add-Warn "$($t.Name): $($t.Name).exe not in the archive - not installed"
            continue
        }
        # A running cargo-nextest.exe holds its file locked on Windows; that
        # lands here as an error and only warns, leaving the old binary.
        Copy-Item $found.FullName $exe -Force
        Write-Ok "installed $exe"
    } catch {
        Add-Warn "$($t.Name): not installed ($($_.Exception.Message))"
    } finally {
        $ProgressPreference = $prevProgress
        Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($onWindows) {
    try {
        if (Add-UserPath -Directory $BinDir) {
            Write-Ok "added to user PATH: $BinDir"
        } else {
            Write-Ok "already on user PATH: $BinDir"
        }
    } catch {
        Add-Warn "could not add $BinDir to the user PATH ($($_.Exception.Message))"
    }
}
