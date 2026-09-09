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
| `nvim/` | Neovim | `init.lua`, `lua/plugins/` |
| `tmux/` | tmux | `tmux.conf`, `scripts/`, `status/` |
| `zsh/` | Zsh | `.zshrc`, `custom/plugins/` |
| `homebrew/` | [Homebrew Bundle](https://docs.brew.sh/Brew-Bundle-and-Brewfile) | `Brewfile`, `bootstrap.sh` (cross-platform packages + shell env; `OS.mac?`/`OS.linux?` guarded) |
| `windows/` | Native Windows | `bootstrap.ps1`, `packages.ps1` (winget), `profile.ps1`, `starship.toml`, `terminal/`, `notifier/`, Cowork skill packaging |
| `.ideavimrc` | IdeaVim (JetBrains) | Standalone file |

### AI assistant 3-tier layout

`ai/` is the single source of truth for tool-agnostic content (rules, memory, most skills). `claude/` and `codex/` hold per-tool deploy logic and tool-only files. `notifier/` is shared runtime infrastructure for Claude/Codex desktop notifications. The orchestrator at `ai/scripts/bootstrap.sh` calls each tool's bootstrap. See [`ai/README.md`](ai/README.md), [`claude/README.md`](claude/README.md), [`codex/README.md`](codex/README.md).

> Everything else under `~/.config/` is gitignored. See `.gitignore` for the allowlist.

## Submodules

| Path | Repo |
|------|------|
| `zsh/custom/plugins/zsh-autosuggestions` | zsh-users/zsh-autosuggestions |
| `zsh/custom/plugins/zsh-syntax-highlighting` | zsh-users/zsh-syntax-highlighting |
| `ghostty/shaders` | sahaj-b/ghostty-cursor-shaders |

## Setup

### macOS / Linux

```bash
git clone --recurse-submodules <repo> ~/.config
~/.config/bootstrap.sh   # installs packages (brew bundle + ghostty/claude-code + oh-my-zsh), then deploys Claude + Codex config
```

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
