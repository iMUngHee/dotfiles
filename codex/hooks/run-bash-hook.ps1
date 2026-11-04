param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^[a-z0-9-]+\.sh$')]
    [string]$HookName,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$HookArguments
)

$ErrorActionPreference = 'Stop'

$bashPath = $env:CLAUDE_CODE_GIT_BASH_PATH
if (-not $bashPath) {
    $bashPath = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
}
if (-not (Test-Path -LiteralPath $bashPath)) {
    Write-Error "Git Bash not found: $bashPath"
    exit 127
}

$configRoot = if ($env:AI_CONFIG_ROOT) { $env:AI_CONFIG_ROOT } else { Join-Path $HOME '.config' }
$hookPath = Join-Path $configRoot "codex\hooks\$HookName"
if (-not (Test-Path -LiteralPath $hookPath)) {
    Write-Error "Codex hook not found: $hookPath"
    exit 127
}

# Codex sends hook input as UTF-8, but [Console]::In decodes with the console
# input code page (CP949 on a Korean Windows), which turned every non-ASCII
# prompt into mojibake before the hook saw it. Read it as UTF-8 and pipe it
# on as UTF-8 without a BOM. Windows-only: this runner exists for Windows.
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
$OutputEncoding = $utf8
$hookInput = [Console]::In.ReadToEnd()
$hookInput | & $bashPath $hookPath @HookArguments
exit $LASTEXITCODE
