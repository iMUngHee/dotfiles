# Claude Code Dotfiles

Portable [Claude Code](https://claude.ai/code) configuration synced via git.

## Structure

```
claude/
├── scripts/
│   ├── bootstrap.sh          # Deploy config to ~/.claude/
│   └── sync-back.sh          # Sync local changes back to repo
├── notifier/
│   ├── notifier.swift         # macOS notification daemon source
│   ├── build.sh               # Build + launchd registration
│   ├── Info.plist
│   └── AppIcon.icns
├── extensions/
│   └── statusline.sh          # Claude Code status line (model, context, cost, usage)
├── hooks/                     # Claude Code hooks (RTK rewrite, file protection, notifications)
├── commands/                  # Slash commands (/diagram, /clean-permissions)
├── memory/                    # Global long-term memory files
│   └── private/               # Work-only memories (gitignored)
├── CLAUDE.md                  # Entry point — loads all other configs
├── PERSONAL.md                # Collaboration rules
├── DEVGUARD.md                # Development guardrails
├── RTK.md                     # RTK (Rust Token Killer) reference
├── MEMORY.md                  # Memory index (public)
├── MEMORY.private.md          # Memory index (work-only, gitignored)
└── settings.json              # Claude Code settings (permissions, hooks, plugins)
```

## Prerequisites

- `jq` — required by bootstrap, RTK hook, statusline
- `python3` — required by notification hook
- `swiftc` — optional, for ClaudeNotifier build (Xcode CLI tools)

## Setup

```bash
# New machine (this repo is part of a multi-tool dotfiles repo at ~/.config)
git clone <repo> ~/.config
cd ~/.config/claude
./scripts/bootstrap.sh
```

Bootstrap will:

1. Symlink config files and directories to `~/.claude/`
2. Merge `settings.json` (repo keys override, local-only keys like `model` preserved)
3. Merge `MEMORY.md` + `MEMORY.private.md` (if exists) into `~/.claude/MEMORY.md`
4. Symlink `memory/` to `~/.claude/memory/`
5. Build ClaudeNotifier (optional, skipped if `swiftc` not found)

## Sync

Git hooks handle sync automatically:

- **`pre-commit`** — runs `sync-back.sh` before committing, stages changed `settings.json` and `memory/`
- **`post-merge`** — runs `bootstrap.sh` after pulling, if `claude/` files changed

### Manual sync

```bash
# Local → repo (after Claude Code modifies settings.json)
./scripts/sync-back.sh

# Repo → local (after pulling changes)
./scripts/bootstrap.sh
```

## What's synced vs local-only

| Synced (git) | Local-only |
|---|---|
| Config files (md, json) | `model` in settings.json |
| Hooks, commands, extensions | `policy-limits.json` |
| Public memory files | `memory/private/` |
| Notifier source | `MEMORY.private.md` |
| settings.json (base permissions) | Locally-added permissions |

## Private memory

Work-specific memory files live in `memory/private/` and are gitignored. `MEMORY.private.md` holds their index (also gitignored). Bootstrap merges both indexes at deploy time.

When `sync-back.sh` detects new memory files not referenced in either index, it prompts to classify them as public or private.
