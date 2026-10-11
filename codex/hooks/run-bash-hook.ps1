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

$hookInput = [Console]::In.ReadToEnd()
$hookInput | & $bashPath $hookPath @HookArguments
exit $LASTEXITCODE
