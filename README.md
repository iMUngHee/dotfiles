# dotfiles

Personal configuration files managed via `~/.config/` and synced with git.

## What's tracked

| Directory | Tool | Key files |
|-----------|------|-----------|
| `claude/` | [Claude Code](https://claude.ai/code) | `settings.json`, hooks, skills, memory, rules, agents |
| `ghostty/` | [Ghostty](https://ghostty.org/) | `config`, `shaders/` (cursor animation) |
| `nvim/` | Neovim | `init.lua`, `lua/plugins/` |
| `tmux/` | tmux | `tmux.conf`, `scripts/`, `status/` |
| `zsh/` | Zsh | `.zshrc`, `custom/plugins/` |
| `.ideavimrc` | IdeaVim (JetBrains) | Standalone file |

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
```

For Claude Code specifically, see [`claude/README.md`](claude/README.md).
