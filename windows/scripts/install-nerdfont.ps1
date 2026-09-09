# windows/scripts/install-nerdfont.ps1 - install a Nerd Font from the upstream
# release, because winget does not carry the one this repo uses.
#
# ghostty/config pins `font-family = FiraCode Nerd Font`, and winget's whole
# Nerd Font catalogue is a single package (DEVCOM.JetBrainsMonoNerdFont).
# Falling back to JetBrainsMono would silently diverge the Windows terminal from
# every other machine, so the font is fetched from ryanoasis/nerd-fonts instead.
#
# This mirrors the ghostty AppImage installer in homebrew/bootstrap.sh, down to
# the three-way checksum handling: match -> install, absent -> warn and proceed
# best-effort, mismatch -> abort.
#
# Installs per-user (%LOCALAPPDATA%\Microsoft\Windows\Fonts + HKCU), so no
# elevation is needed.

param(
    [string]$Font = 'FiraCode',
    [switch]$Force
)

. "$PSScriptRoot\..\lib\common.ps1"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$fontDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
$regPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'

Write-Step "Nerd Font: $Font"

# ── Already installed? ────────────────────────────────────────
# Checked against the registry rather than the folder: a stray .ttf that was
# never registered does not make the font usable by Windows Terminal.
$existing = @()
if (Test-Path $regPath) {
    $existing = @((Get-ItemProperty $regPath).PSObject.Properties |
        Where-Object { $_.Name -like "*$Font Nerd Font*" })
}
if ($existing.Count -gt 0 -and -not $Force) {
    Write-Ok "$Font Nerd Font already registered ($($existing.Count) faces) - skip"
    return
}

# ── Resolve the release ───────────────────────────────────────
try {
    $release = Invoke-RestMethod 'https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest' `
        -Headers @{ 'User-Agent' = 'dotfiles-bootstrap' }
} catch {
    Add-Warn "nerd-fonts: GitHub API fetch failed - font not installed ($($_.Exception.Message))"
    return
}

$zipAsset = $release.assets | Where-Object { $_.name -eq "$Font.zip" } | Select-Object -First 1
if (-not $zipAsset) {
    Add-Warn "nerd-fonts: no $Font.zip in release $($release.tag_name) - font not installed"
    return
}
$sumAsset = $release.assets | Where-Object { $_.name -eq 'SHA-256.txt' } | Select-Object -First 1

Write-Ok "release $($release.tag_name), $($zipAsset.name) ($([math]::Round($zipAsset.size/1MB,1)) MB)"

# ── Download ──────────────────────────────────────────────────
$stage = Join-Path $env:TEMP "nerdfont-$Font-$PID"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage -Force | Out-Null
$zip = Join-Path $stage "$Font.zip"

try {
    # Invoke-WebRequest's progress rendering makes a 28 MB download crawl in
    # some hosts; suppressing it is a large, well-known speedup.
    $prevProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest $zipAsset.browser_download_url -OutFile $zip -UseBasicParsing
    $ProgressPreference = $prevProgress
} catch {
    Add-Warn "nerd-fonts: download failed - font not installed ($($_.Exception.Message))"
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    return
}

# ── Checksum ──────────────────────────────────────────────────
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($sumAsset) {
    try {
        # PowerShell 5.1 hands back .Content as a Byte[] whenever it does not
        # recognise the response as text, which SHA-256.txt is served as. Left
        # undecoded it stringifies to "51 102 50 ..." and no hash ever matches,
        # so the check silently degraded to best-effort on every run.
        $raw = (Invoke-WebRequest $sumAsset.browser_download_url -UseBasicParsing).Content
        if ($raw -is [byte[]]) {
            $sums = [System.Text.Encoding]::UTF8.GetString($raw)
        } else {
            $sums = [string]$raw
        }

        # Anchored on the end of the line so a longer asset name that merely
        # ends in "<Font>.zip" cannot supply the hash.
        $needle = '\s' + [regex]::Escape("$Font.zip") + '\s*$'
        $line = ($sums -split "`n" | Where-Object { $_ -match $needle } | Select-Object -First 1)
        $expected = ''
        if ($line -match '([0-9a-fA-F]{64})') { $expected = $Matches[1].ToLower() }

        if (-not $expected) {
            Add-Warn "nerd-fonts: checksum unreadable - proceeding best-effort"
        } elseif ($expected -eq $actual) {
            Write-Ok "checksum OK"
        } else {
            Add-Warn "nerd-fonts: CHECKSUM MISMATCH - aborting install (possible tampering)"
            Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
            return
        }
    } catch {
        Add-Warn "nerd-fonts: checksum fetch failed - proceeding best-effort"
    }
} else {
    Add-Warn "nerd-fonts: no checksum asset - proceeding best-effort"
}

# ── Extract + install ─────────────────────────────────────────
Expand-Archive -Path $zip -DestinationPath $stage -Force

# The zip carries three families: the proportional-ish default, *NerdFontMono*
# and *NerdFontPropo*. ghostty asks for plain "FiraCode Nerd Font", so only that
# family is installed - the other two are ~60 more files nothing here references.
$faces = Get-ChildItem $stage -Recurse -Include *.ttf, *.otf |
    Where-Object { $_.Name -match "$Font" -and $_.Name -notmatch 'NerdFontMono|NerdFontPropo' }

if (-not $faces) {
    Add-Warn "nerd-fonts: no matching face files in $Font.zip - font not installed"
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    return
}

if (-not (Test-Path $fontDir)) { New-Item -ItemType Directory $fontDir -Force | Out-Null }
if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }

$installed = 0
$current = 0
$failed = 0
foreach ($face in $faces) {
    $dest = Join-Path $fontDir $face.Name

    # Windows keeps loaded font files open, so overwriting one that a running
    # Terminal already uses throws. That is only a real failure when the file is
    # not there yet - if it is present and identical, the lock is holding the
    # font we were about to write anyway. Hashing first avoids both the pointless
    # write and the misleading error.
    $upToDate = $false
    if (Test-Path $dest) {
        $upToDate = (Get-FileHash $dest -Algorithm SHA256).Hash -eq (Get-FileHash $face.FullName -Algorithm SHA256).Hash
    }

    if ($upToDate) {
        $current++
    } else {
        try {
            Copy-Item $face.FullName $dest -Force -ErrorAction Stop
            $installed++
        } catch {
            if (Test-Path $dest) {
                # In use and stale: the existing copy stays until a restart.
                Add-Warn "font in use, kept the installed copy: $($face.Name)"
                $current++
            } else {
                Add-Warn "font copy failed: $($face.Name) ($($_.Exception.Message))"
                $failed++
                continue
            }
        }
    }

    if ($face.Extension -eq '.otf') { $suffix = '(OpenType)' } else { $suffix = '(TrueType)' }
    # Registry value name is a display label; Windows reads the real family name
    # out of the file itself. Derived from the filename so no font parser is
    # needed: "FiraCodeNerdFont-Regular.ttf" -> "FiraCode Nerd Font Regular".
    $label = $face.BaseName -replace 'NerdFont', ' Nerd Font ' -replace '-', ' ' -replace '\s+', ' '
    New-ItemProperty -Path $regPath -Name "$($label.Trim()) $suffix" -Value $dest -PropertyType String -Force | Out-Null
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Write-Ok "$fontDir - $installed written, $current already current, $failed failed"
if ($installed -gt 0) {
    Write-Host "   Restart Windows Terminal to pick up the new font." -ForegroundColor DarkGray
}
