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

```bash
git clone --recurse-submodules <repo> ~/.config
~/.config/ai/scripts/bootstrap.sh   # deploys both Claude + Codex (Codex skipped if not installed)
```

For per-tool details: [`ai/`](ai/README.md), [`claude/`](claude/README.md), [`codex/`](codex/README.md).
