# windows/profile.ps1 - the zsh/.zshrc port for PowerShell.
#
# Loaded by a two-line stub at $PROFILE.CurrentUserAllHosts that this repo
# deploys (windows/scripts/deploy-shell.ps1). The stub, not this file, is what
# lives in Documents\PowerShell\ - so editing here takes effect on the next
# prompt with no redeploy.
#
# Mapping from .zshrc, feature by feature:
#   oh-my-zsh                  -> not needed; PSReadLine covers the parts used
#   zsh-autosuggestions        -> PSReadLine -PredictionSource History
#   zsh-syntax-highlighting    -> PSReadLine -Colors (Catppuccin Mocha below)
#   zsh-history-substring-search -> PSReadLine HistorySearchBackward/Forward
#   fzf-tab                    -> PSReadLine MenuComplete + PSFzf
#   custom PROMPT              -> windows/starship.toml
#   zsh/private.sh             -> windows/private.ps1 (gitignored)

$ConfigRoot = Join-Path $HOME '.config'

# -- Environment -----------------------------------------------
$env:EDITOR = 'nvim'
$env:BAT_THEME = 'Catppuccin Mocha'
$env:LANG = 'en_US.UTF-8'

# PowerShell 5.1 defaults the console to the ANSI codepage, which mangles the
# Nerd Font glyphs starship and eza emit. 7.x already does this.
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
}

# -- PATH ------------------------------------------------------
# Mason-installed LSP binaries, matching the .zshrc line for the same purpose.
$masonBin = Join-Path $env:LOCALAPPDATA 'nvim-data\mason\bin'
if ((Test-Path $masonBin) -and ($env:Path -notlike "*$masonBin*")) {
    $env:Path = "$masonBin;$env:Path"
}

# -- PSReadLine ------------------------------------------------
if (Get-Module -ListAvailable -Name PSReadLine) {
    Import-Module PSReadLine

    Set-PSReadLineOption -HistoryNoDuplicates                 # setopt HIST_FIND_NO_DUPS
    Set-PSReadLineOption -MaximumHistoryCount 100000          # HISTSIZE / SAVEHIST
    Set-PSReadLineOption -HistorySearchCursorMovesToEnd
    Set-PSReadLineOption -EditMode Windows
    Set-PSReadLineOption -BellStyle None

    # zsh-autosuggestions. ListView needs PSReadLine 2.2+, which ships with
    # PowerShell 7.2+; 5.1's bundled 2.0 has neither, hence the version guard.
    #
    # The redirection guard matters just as much: predictive suggestions require
    # a real VT-capable console, and asking for them when stdout is a pipe or a
    # file throws ("the console output doesn't support virtual terminal
    # processing"). Every `pwsh -File script.ps1` or piped one-liner loads this
    # profile, so without the guard those sessions start with two red errors.
    $prlVersion = (Get-Module PSReadLine).Version
    $interactiveConsole = $false
    try { $interactiveConsole = -not [Console]::IsOutputRedirected } catch { }
    if ($prlVersion -ge [version]'2.2.0' -and $interactiveConsole) {
        Set-PSReadLineOption -PredictionSource History
        Set-PSReadLineOption -PredictionViewStyle ListView
    }

    # bindkey '^[[A' history-substring-search-up  (and C-p / C-n)
    Set-PSReadLineKeyHandler -Key UpArrow   -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    Set-PSReadLineKeyHandler -Key Ctrl+p    -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key Ctrl+n    -Function HistorySearchForward
    Set-PSReadLineKeyHandler -Key Tab       -Function MenuComplete

    # Catppuccin Mocha, matching zsh/custom/themes/catppuccin_mocha-*.zsh
    $prlColors = @{
        Command                = "#89b4fa"   # blue
        Parameter              = "#94e2d5"   # teal
        Operator               = "#89dceb"   # sky
        Variable               = "#f38ba8"   # red
        String                 = "#a6e3a1"   # green
        Number                 = "#fab387"   # peach
        Type                   = "#f9e2af"   # yellow
        Comment                = "#6c7086"   # overlay0
        Keyword                = "#cba6f7"   # mauve
        Error                  = "#f38ba8"   # red
        Selection              = "#45475a"   # surface1
    }
    # InlinePrediction arrived with the same 2.2 that added PredictionSource.
    # Passing it to PSReadLine 2.0 (what Windows PowerShell 5.1 bundles) throws,
    # and a throw here aborts the rest of the profile - no aliases, no prompt.
    if ($prlVersion -ge [version]'2.2.0') {
        $prlColors['InlinePrediction'] = "#585b70"   # surface2
    }
    Set-PSReadLineOption -Colors $prlColors
}

# -- fzf (Catppuccin Mocha palette, copied from .zshrc) --------
$env:FZF_DEFAULT_COMMAND = 'fd --type f --hidden --follow --exclude .git'
$env:FZF_CTRL_T_COMMAND  = $env:FZF_DEFAULT_COMMAND
$env:FZF_ALT_C_COMMAND   = 'fd --type d --hidden --follow --exclude .git'
$env:FZF_DEFAULT_OPTS    = @(
    '--color=bg+:#313244,bg:#1e1e2e,spinner:#f5e0dc,hl:#f38ba8'
    '--color=fg:#cdd6f4,header:#f38ba8,info:#cba6f7,pointer:#f5e0dc'
    '--color=marker:#b4befe,fg+:#cdd6f4,prompt:#cba6f7,hl+:#f38ba8'
    '--color=selected-bg:#45475a'
) -join ' '

if (Get-Module -ListAvailable -Name PSFzf) {
    Import-Module PSFzf
    # Ctrl+T files, Alt+C cd - the same two bindings `fzf --zsh` installs.
    Set-PsFzfOption -PSReadlineChordProvider 'Ctrl+t' -PSReadlineChordSetLocation 'Alt+c'
}

# -- Tool init (the conditional_eval block in .zshrc) ----------
function Initialize-Tool {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter(Mandatory)][string[]]$InitArgs
    )
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        (& $Command @InitArgs) -join "`n" | Invoke-Expression
    }
}

Initialize-Tool -Command 'fnm'    -InitArgs @('env', '--use-on-cd', '--shell', 'powershell')
Initialize-Tool -Command 'zoxide' -InitArgs @('init', 'powershell')

# -- Prompt ----------------------------------------------------
$env:STARSHIP_CONFIG = Join-Path $ConfigRoot 'windows\starship.toml'
Initialize-Tool -Command 'starship' -InitArgs @('init', 'powershell')

# -- Aliases ---------------------------------------------------
# Defined as functions, not Set-Alias: PowerShell aliases cannot carry
# arguments, so `alias l="eza -alH ..."` has no direct equivalent.
if (Get-Command eza -ErrorAction SilentlyContinue) {
    function l { eza -alH --icons --git --color=always @args }
} else {
    function l { Get-ChildItem -Force @args }
}

if (Get-Command nvim.exe -ErrorAction SilentlyContinue) {
    if (Get-Command zig -ErrorAction SilentlyContinue) {
        # nvim-treesitter (main branch) compiles every parser by shelling out to
        # `tree-sitter build`. That CLI is built for the MSVC target, so its cc
        # crate looks for cl.exe and fails with "program not found" on a machine
        # with no Visual Studio - which is what breaks :TSInstall on Windows.
        #
        # zig ships a complete C toolchain, headers and all, in one small
        # package. The only obstacle is the triple: cc passes the four-field
        # x86_64-pc-windows-msvc, which zig rejects as UnknownOperatingSystem.
        # clang takes the LAST -target on the command line, so appending zig's
        # own three-field gnu triple through CFLAGS overrides it.
        #
        # Deliberately scoped to this wrapper rather than exported: a global
        # CFLAGS pinning a zig-specific target would be inherited by every other
        # C build on the machine (cgo, node-gyp, native npm modules).
        function nvim {
            $prevCC = $env:CC
            $prevCFLAGS = $env:CFLAGS
            $env:CC = 'zig cc'
            $env:CFLAGS = '-target x86_64-windows-gnu'
            try { nvim.exe @args } finally {
                $env:CC = $prevCC
                $env:CFLAGS = $prevCFLAGS
            }
        }
    }
    function vim { nvim @args }
    function vi  { nvim @args }
}

# alias buu="brew update;brew upgrade -y"
#
# Not just `winget upgrade --all`: brew owns nearly everything on the Mac, but
# this tier installs pager (go), tree-sitter-cli (npm), PSReadLine/PSFzf
# (PSGallery) and the Nerd Font (GitHub release) from outside winget, because
# winget has no package for any of them. update-all.ps1 covers all of it so buu
# means the same thing on both platforms.
function buu { & (Join-Path $ConfigRoot 'windows\scripts\update-all.ps1') @args }

# Windows has no `open`/`loginctl lock-session` pair; these are the equivalents.
function ulock { rundll32.exe user32.dll,LockWorkStation }
function open { param([Parameter(ValueFromRemainingArguments)]$Path) Invoke-Item @Path }

# -- Config helpers --------------------------------------------
function cfg { Set-Location $ConfigRoot }

# Re-run the Windows tier after pulling config changes.
function cfg-sync {
    & (Join-Path $ConfigRoot 'windows\bootstrap.ps1') @args
}

# Repackage skills as Cowork-uploadable zips.
function cowork-skills {
    & (Join-Path $ConfigRoot 'windows\scripts\pack-skills.ps1') @args
}

# -- Private overrides (gitignored, mirrors zsh/private.sh) ----
$privateProfile = Join-Path $ConfigRoot 'windows\private.ps1'
if (Test-Path $privateProfile) { . $privateProfile }
