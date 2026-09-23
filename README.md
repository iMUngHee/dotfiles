# dotfiles

Personal configuration files managed via `~/.config/` and synced with git.

## What's tracked

| Directory | Tool | Key files |
|-----------|------|-----------|
| `ai/` | Shared (Claude + Codex) | `PERSONAL.md`, `guardrails.md`, `rules/`, `memory/`, `skills/`, `AGENTS.manifest` |
| `claude/` | [Claude Code](https://claude.ai/code) | `CLAUDE.md`, `DEVGUARD.md`, `settings.json`, `hooks/`, `agents/`, `commands/`, `skills/` (Claude-only) |
| `codex/` | [Codex CLI](https://developers.openai.com/codex/) | `config.toml.template`, `skills/` (Codex-only), `scripts/` |
| `notifier/` | Shared AI notifier | macOS Swift app, Linux Go daemon, Go sender, shared icon |
| `ghostty/` | [Ghostty](https://ghostty.org/) | `config`, `shaders/` (cursor animation) |
| `aerospace/` | [AeroSpace](https://github.com/nikitabobko/AeroSpace) (macOS) | `aerospace.toml` (shipped default trimmed to digit workspaces so Option stays free for terminal Meta keys; float rules, Omarchy gaps) |
| `brave/` | Brave Origin | `vimium-options.json` (Vimium export; restore by hand from its Options page when Brave Sync has not carried it over) |
| `nvim/` | Neovim | `init.lua`, `lua/plugins/` |
| `tmux/` | tmux | `tmux.conf`, `scripts/`, `status/` |
| `zsh/` | Zsh | `.zshrc`, `custom/plugins/` |
| `homebrew/` | [Homebrew Bundle](https://docs.brew.sh/Brew-Bundle-and-Brewfile) | `Brewfile`, `bootstrap.sh` (macOS package set + shell env) |
| `arch/` | Arch Linux / [Omarchy](https://omarchy.org/) | `packages.sh` (pacman + AUR, the Brewfile mapping), `bootstrap.sh` (packages + mise + shell env) |
| `lib/` | Shared bootstrap | `shell-env.sh` (`~/.zshenv` ZDOTDIR + oh-my-zsh, used by both Unix package layers) |
| `windows/` | Native Windows | `bootstrap.ps1`, `packages.ps1` (winget), `profile.ps1`, `starship.toml`, `terminal/`, `notifier/`, Cowork skill packaging |
| `.ideavimrc` | IdeaVim (JetBrains) | Standalone file |

### AI assistant 3-tier layout

`ai/` is the single source of truth for tool-agnostic content (rules, memory, most skills). `claude/` and `codex/` hold per-tool deploy logic and tool-only files. `notifier/` is shared runtime infrastructure for Claude/Codex desktop notifications. The orchestrator at `ai/scripts/bootstrap.sh` calls each tool's bootstrap. See [`ai/README.md`](ai/README.md), [`claude/README.md`](claude/README.md), [`codex/README.md`](codex/README.md).

> Everything else under `~/.config/` is gitignored. See `.gitignore` for the allowlist.

### Machine-local settings

Anything true of one machine and not another stays out of the tracked files.
Each config loads an optional private file last, so it overrides without being
edited into the shared one:

| Config | Hook in the tracked file | Machine-local file |
|---|---|---|
| zsh | `source $ZDOTDIR/private.sh` | `zsh/private.sh` |
| ghostty | `config-file = ?"…/private.conf"` | `ghostty/private.conf` |
| tmux | `if-shell '[ -r … ]' 'source-file …'` | `tmux/private.conf` |
| nvim | `plugins/99_private.lua` → `require("private.plugins")` | `nvim/lua/private/plugins.lua` |

All four are absent by default and silent when missing, so a fresh clone works
with none of them. On Omarchy they are where the theme wiring lives, which is
why macOS keeps Catppuccin while that machine follows the system theme.

One case the seam cannot cover: Omarchy's display text size slider rewrites
`font-size` in `ghostty/config` at a path it hardcodes, so moving the line out
would make the slider silently do nothing. That one line is normalized on its
way into the index by the clean filter in `lib/git-filter-machine-local.sh`
(wired in `.gitattributes`, registered by `ai/scripts/bootstrap.sh`) — the
working tree keeps this monitor's size and git never sees it.
The same filter drops a `# >>> machine-local` … `# <<< machine-local` block
whole; `aerospace/aerospace.toml` keeps its work-machine float rules there,
since AeroSpace has no include to put them in a private file.

## Submodules

| Path | Repo |
|------|------|
| `zsh/custom/plugins/zsh-autosuggestions` | zsh-users/zsh-autosuggestions |
| `zsh/custom/plugins/zsh-history-substring-search` | zsh-users/zsh-history-substring-search |
| `zsh/custom/plugins/zsh-syntax-highlighting` | zsh-users/zsh-syntax-highlighting |
| `zsh/custom/plugins/fzf-tab` | aloxaf/fzf-tab |
| `ghostty/shaders` | sahaj-b/ghostty-cursor-shaders |

## Setup

### macOS / Linux

```bash
git clone --recurse-submodules <repo> ~/.config
~/.config/bootstrap.sh   # packages + shell env, then deploys Claude + Codex config
```

`bootstrap.sh` picks the package layer from the machine, then hands off to the
same `ai/scripts/bootstrap.sh` in every case:

| Machine | Package layer | Source of `claude` / `codex` |
|---|---|---|
| macOS | `homebrew/bootstrap.sh` → `brew bundle` | Homebrew casks |
| Arch / Omarchy | `arch/bootstrap.sh` → pacman + AUR | [mise](https://mise.jdx.dev) (`~/.config/mise/config.toml`, machine-local) |
| Linux with Homebrew, no pacman | `homebrew/bootstrap.sh` | Homebrew |

On Omarchy the package step uses `omarchy-pkg-add` / `omarchy-pkg-aur-add` when
they exist, so packages installed here look the same as ones added through the
Omarchy menu. `arch/packages.sh --dry-run` prints the plan without installing;
`--skip-optional` leaves out desktop apps and AUR.

> `~/.config` is usually not empty on a fresh Omarchy install — `ghostty/`,
> `nvim/` and `tmux/` already exist. The tracked versions here replace them;
> move the originals aside first if you want them back.

### Windows

```powershell
winget install --id Git.Git --exact
git clone --recurse-submodules <repo> $HOME\.config
pwsh -File $HOME\.config\windows\bootstrap.ps1   # winget packages + shell/terminal, then the SAME ai/scripts/bootstrap.sh under Git Bash
```

Requires Developer Mode (**Settings > System > For developers**) so the deploy can
create symlinks unelevated. `windows/bootstrap.ps1` replaces `bootstrap.sh` only
at the package layer — the Claude/Codex deploy is delegated to
`ai/scripts/bootstrap.sh` verbatim, so there is one implementation of the 3-tier
merge, not two. See [`windows/README.md`](windows/README.md).

For per-tool details: [`ai/`](ai/README.md), [`claude/`](claude/README.md), [`codex/`](codex/README.md), [`windows/`](windows/README.md).
