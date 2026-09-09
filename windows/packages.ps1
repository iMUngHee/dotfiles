# windows/packages.ps1 - the Brewfile analog for native Windows.
#
# Apply:  pwsh -File ~/.config/windows/packages.ps1
# Called by windows/bootstrap.ps1 as step 1.
#
# Every id below was verified against `winget show --id <id> --exact`. Ids are
# pinned by *name* only, never version: winget resolves the current release, the
# same way `brew "foo"` does. Entries the Brewfile carries but Windows has no
# sane equivalent for (tmux, ghostty, coreutils, kotlin/gradle, rtk) are listed
# at the bottom with the reason, so the mapping stays auditable rather than
# silently lossy.

param(
    [switch]$SkipOptional,   # CLI + shell only; no desktop apps, no fonts
    [switch]$DryRun
)

. "$PSScriptRoot\lib\common.ps1"

# -- Shell + terminal (no Brewfile counterpart: zsh/ghostty do this on Unix) --
$Shell = @(
    @{ id = 'Microsoft.PowerShell';           note = 'PowerShell 7 - the interactive shell this tier targets' },
    @{ id = 'Microsoft.WindowsTerminal';      note = 'terminal emulator (ghostty has no Windows build)' },
    @{ id = 'Starship.Starship';              note = 'prompt - ports the zsh PROMPT in zsh/.zshrc' }
)

# -- Shared CLI / TUI - mirrors the Brewfile "Shared CLI / TUI" block ---------
$Cli = @(
    @{ id = 'Git.Git';                        note = 'brew git + Git Bash, which the AI deploy and hooks run under' },
    @{ id = 'sharkdp.bat';                    note = 'brew "bat"' },
    @{ id = 'eza-community.eza';              note = 'brew "eza" - backs the `l` alias' },
    @{ id = 'sharkdp.fd';                     note = 'brew "fd" - backs FZF_DEFAULT_COMMAND' },
    @{ id = 'junegunn.fzf';                   note = 'brew "fzf"' },
    @{ id = 'BurntSushi.ripgrep.MSVC';        note = 'ripgrep - bundled with Claude Code on Unix, not on PATH here' },
    @{ id = 'GitHub.cli';                     note = 'brew "gh"' },
    @{ id = 'dandavison.delta';               note = 'brew "git-delta"' },
    @{ id = 'GitHub.GitLFS';                  note = 'brew "git-lfs"' },
    @{ id = 'Neovim.Neovim';                  note = 'brew "neovim" - $EDITOR, and nvim/ deploys as-is' },
    @{ id = 'jqlang.jq';                      note = 'REQUIRED by claude/scripts/bootstrap.sh (settings.json merge)' },
    @{ id = 'MikeFarah.yq';                   note = 'REQUIRED by codex/scripts/bootstrap.sh (config.toml merge)' },
    @{ id = 'ajeetdsouza.zoxide';             note = 'brew "zoxide"' },
    @{ id = 'Schniz.fnm';                     note = 'brew "fnm"' },
    @{ id = 'astral-sh.uv';                   note = 'brew "uv"' },
    @{ id = 'JernejSimoncic.Wget';            note = 'brew "wget"' }
)

# -- Languages / runtimes - mirrors the Brewfile runtimes block --------------
$Runtimes = @(
    @{ id = 'GoLang.Go';                      note = 'brew "go" - also builds notifier/send.go' },
    @{ id = 'Rustlang.Rustup';                note = 'brew "rustup"' },
    @{ id = 'Python.Python.3.13';             note = 'brew "python" - the WindowsApps python is a Store stub' },
    @{ id = 'OpenJS.NodeJS';                  note = 'node - ai/lib/*.mjs tests and skill tooling need it' },
    # nvim-treesitter compiles every parser from C. macOS has clang from the
    # Command Line Tools and Linux has gcc, so the Brewfile never had to name a
    # compiler; Windows ships none, and the tree-sitter CLI is built for the
    # MSVC target so it demands cl.exe. zig supplies a full C toolchain
    # (compiler + headers + libc) in one small package instead of several GB of
    # Visual Studio Build Tools. windows/profile.ps1 points CC at it and
    # rewrites the target triple for the nvim call only.
    @{ id = 'zig.zig';                        note = 'C toolchain for nvim-treesitter parser builds' },
    # nvim/after/lsp/jdtls.lua needs a JDK, and mason installs groovyls/jdtls
    # which both refuse to start without java on PATH.
    @{ id = 'EclipseAdoptium.Temurin.21.JDK';  note = 'JDK for jdtls + groovyls (mason)' },
    # mason installs fsautocomplete and fantomas from nuget, so the SDK has to
    # be on PATH before either can be fetched. The Mac already has it; Omarchy
    # gets it from pacman dotnet-sdk.
    @{ id = 'Microsoft.DotNet.SDK.8';         note = 'dotnet SDK for fsautocomplete + fantomas (mason)' }
)

# ── npm globals - the packages winget has no entry for ──────────────────────
# Kept to the minimum: anything winget carries belongs above.
$NpmGlobals = @(
    # brew "tree-sitter-cli". nvim-treesitter's `main` branch calls the
    # tree-sitter CLI to generate a parser before compiling it, so without this
    # every :TSInstall fails with ENOENT: 'tree-sitter'.
    # --allow-scripts is required: the package's postinstall is what downloads
    # the actual binary, and npm now blocks install scripts by default, which
    # leaves a package that installs "successfully" but provides no executable.
    @{ id = 'tree-sitter-cli'; note = 'brew "tree-sitter-cli" - nvim-treesitter parser builds' }
)

# -- Optional: desktop apps + fonts -----------------------------------------
# Anthropic.Claude is the Claude Desktop app. On Windows it is the only way to
# run Cowork, so it is not really optional for this machine's stated use - it
# sits here because it is a GUI install and -SkipOptional exists for servers.
$Optional = @(
    @{ id = 'Anthropic.Claude';               note = 'Claude Desktop - hosts Cowork on Windows' },
    @{ id = 'Anthropic.ClaudeCode';           note = 'cask "claude-code@latest"' },
    @{ id = 'OpenAI.Codex';                   note = 'cask "codex" / brew "codex" - gates the codex/ deploy' },
    @{ id = 'Obsidian.Obsidian';              note = 'cask "obsidian" / flatpak md.obsidian.Obsidian' }
)

# -- Intentionally absent (documented, not forgotten) -----------------------
# tmux              no native Windows port; Windows Terminal panes cover it
# ghostty           no Windows build; Windows Terminal + our theme instead
# coreutils         Git Bash already ships the GNU userland used by the hooks
# kotlin / gradle   JVM toolchain not used on this machine
# tree-sitter-cli   not in winget; installed from npm below
# rtk / ccusage     no winget package; install per their own docs if wanted
# pager             no winget package and no public installer. claude/settings.json
#                   guards its hook invocation on uname, so its absence is silent
#                   rather than an error on every hook event.
# pipx / pipenv     superseded by uv here
# luajit            bundled with the Neovim Windows build
# FiraCode Nerd Font  winget's entire Nerd Font catalogue is one package
#                   (DEVCOM.JetBrainsMonoNerdFont); the font ghostty/config
#                   pins is not in it. windows/scripts/install-nerdfont.ps1
#                   fetches it from ryanoasis/nerd-fonts instead.

# ── Microsoft Store ────────────────────────────────────────────────────────
# The Codex desktop app is not in the winget community repo - the only
# OpenAI-published entry there is the CLI. OpenAI folded Codex into the ChatGPT
# desktop app, which ships through the Store; the Appx it installs is literally
# named OpenAI.Codex. The winget repo's "ChatGPT" hits (j178, lencx, sonnylab)
# are third-party wrappers, not this.
$StoreApps = @(
    @{ id = '9PLM9XGG6VKS';                   note = 'ChatGPT desktop = the Codex app (Publisher: OpenAI)' }
)

$groups = @(
    @{ name = 'shell + terminal'; items = $Shell },
    @{ name = 'cli';              items = $Cli },
    @{ name = 'runtimes';         items = $Runtimes }
)
if (-not $SkipOptional) {
    $groups += @{ name = 'apps + fonts';  items = $Optional }
    $groups += @{ name = 'store apps';    items = $StoreApps; source = 'msstore' }
}

if (-not (Test-Command 'winget')) {
    Write-Host "ERROR: winget not found. Install 'App Installer' from the Microsoft Store." -ForegroundColor Red
    exit 1
}

# One `winget list` up front beats one `winget list --id X` per package: the
# latter is a network round trip each time and turned this step into minutes.
Write-Step "resolving installed packages"
$installedRaw = winget list --disable-interactivity | Out-String
Write-Ok "queried winget"

function Test-PackageInstalled {
    param([Parameter(Mandatory)][string]$Id)
    # Anchored on whitespace, not a bare substring: 'Anthropic.Claude' is a
    # prefix of 'Anthropic.ClaudeCode', so a substring test reports Claude
    # Desktop as installed whenever Claude Code is - which would silently skip
    # the one package Cowork actually needs.
    return ($installedRaw -match ('(?m)(^|\s)' + [regex]::Escape($Id) + '(\s|$)'))
}

foreach ($group in $groups) {
    # Groups default to the winget community repo; only the Store group differs.
    $source = 'winget'
    if ($group.ContainsKey('source')) { $source = $group.source }

    Write-Step "winget[$source]: $($group.name)"
    foreach ($pkg in $group.items) {
        $id = $pkg.id
        if (Test-PackageInstalled -Id $id) {
            Write-Ok "$id - present, skip"
            continue
        }
        if ($DryRun) {
            Write-Host "   would install $id  ($($pkg.note))"
            continue
        }
        Write-Host "   installing $id  ($($pkg.note))"
        winget install --id $id --exact --source $source `
            --accept-source-agreements --accept-package-agreements `
            --disable-interactivity --silent | Out-Null
        if ($LASTEXITCODE -ne 0) {
            # winget uses 0x8A150061 / -1978335135 for "no applicable upgrade",
            # which reaches here only when the package is in fact already there.
            if ($LASTEXITCODE -eq -1978335135) {
                Write-Ok "$id - already current"
            } else {
                Add-Warn "winget install failed for $id (exit $LASTEXITCODE)"
            }
        }
    }
}

# Refresh before the npm step: node may have been installed moments ago in this
# same run, and this process still carries the environment block it started with.
Update-PathFromRegistry

Write-Step "npm globals"
if (-not (Test-Command 'npm')) {
    Add-Warn "npm not on PATH - skipped: $(($NpmGlobals | ForEach-Object { $_.id }) -join ', ')"
} else {
    foreach ($pkg in $NpmGlobals) {
        $id = $pkg.id
        npm ls -g --depth=0 $id *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "$id - present, skip"
            continue
        }
        if ($DryRun) {
            Write-Host "   would install $id  ($($pkg.note))"
            continue
        }
        Write-Host "   installing $id  ($($pkg.note))"
        npm install -g --allow-scripts=$id $id *> $null
        if ($LASTEXITCODE -ne 0) {
            Add-Warn "npm install failed for $id (exit $LASTEXITCODE)"
        }
    }
    Update-PathFromRegistry

    # npm's global bin holds three shims per executable: `tree-sitter` (an sh
    # script, for Git Bash), `tree-sitter.cmd` and `tree-sitter.ps1`. Neovim
    # resolves the bare, extensionless one and then libuv cannot spawn it, so
    # every parser build dies with a bare "ENOENT: no such file or directory"
    # that never names the file. Copying the real binary somewhere earlier on
    # PATH is what makes vim.system reach an actual executable.
    $realExe = Join-Path $env:APPDATA 'npm\node_modules\tree-sitter-cli\tree-sitter.exe'
    if (Test-Path $realExe) {
        $localBin = Join-Path $HOME '.local\bin'
        if (-not (Test-Path $localBin)) { New-Item -ItemType Directory -Path $localBin -Force | Out-Null }
        Copy-Item $realExe (Join-Path $localBin 'tree-sitter.exe') -Force
        Add-UserPath -Directory $localBin -Prepend | Out-Null
        Write-Ok "tree-sitter.exe -> $localBin (ahead of npm's sh shim)"
    }
}

Write-Step "packages done"
