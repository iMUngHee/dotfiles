# windows/scripts/vendor.ps1 - check or sync vendored code on Windows.
#
# Like deploy-ai.ps1 it does not reimplement anything: it runs the same
# ai/scripts/vendor.sh under Git Bash, so one script decides what gets installed
# on every platform. vendor.sh sets MSYS=winsymlinks:nativestrict itself, so a
# skill link either becomes a real NTFS symlink (Developer Mode) or fails loudly.
#
#   vendor.ps1                       # check: installed vs upstream, one row per entry
#   vendor.ps1 sync archify eli5     # install / update by name
#   vendor.ps1 sync --all
#
# The script path and arguments go to bash as argv, never inside a -c string:
# PowerShell's native argument passing mangles quoting inside one (see deploy-ai.ps1).

. "$PSScriptRoot\..\lib\common.ps1"

$bash = Get-GitBashPath
if (-not $bash) {
    Write-Host "ERROR: Git Bash not found. Install Git for Windows:" -ForegroundColor Red
    Write-Host "       winget install --id Git.Git --exact" -ForegroundColor Red
    exit 1
}

& $bash -l (Join-Path (Get-ConfigRoot) 'ai\scripts\vendor.sh') @args
exit $LASTEXITCODE
