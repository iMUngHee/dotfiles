---
name: config-audit
description: "Claude Code dotfiles architecture and audit. Use when creating, editing, or moving files in ~/.config/claude/ or ~/.claude/, when working with memory files, settings.json, commands, skills, or hooks, or when discussing the dotfiles sync setup."
user-invocable: false
allowed-tools: Bash, Read, Glob
---

## Architecture

Two-directory setup:

| Directory | Role |
|-----------|------|
| `~/.config/claude/` | Git-tracked dotfiles repo (source of truth) |
| `~/.claude/` | Claude Code runtime config (deployment target) |

### Deployment

- `~/.config/claude/scripts/bootstrap.sh` deploys repo → `~/.claude/`
  - Symlinks: `CLAUDE.md`, `RTK.md`, `PERSONAL.md`, `DEVGUARD.md`, `hooks/`, `commands/`, `skills/`, `memory/`, `statusline.sh`
  - Merges: `settings.json` (repo keys override, local keys preserved), `MEMORY.md` + `MEMORY.private.md` concatenated
- `~/.config/claude/scripts/sync-back.sh` syncs `~/.claude/` → repo
  - Syncs `settings.json` (only repo-tracked keys)
  - Detects unindexed memory files, prompts to classify as public/private

### Rules

1. **Always edit at `~/.config/claude/`** (source of truth), never at `~/.claude/`
2. `~/.claude/memory/` is a symlink to `~/.config/claude/memory/` — same physical files
3. `~/.claude/MEMORY.md` is merged output (public + private) — edit `~/.config/claude/MEMORY.md` instead
4. Skills use directory structure: `skills/<name>/SKILL.md`
5. Commands use flat files: `commands/<name>.md`

## Audit checklist

When invoked, verify:

1. **Symlinks**: each expected item in `~/.claude/` points to `~/.config/claude/`
2. **CLAUDE.md @references**: all resolve to existing files
3. **MEMORY.md index**: every reference has a file, no orphan files
4. **Commands & skills**: list with descriptions
5. **Settings divergence**: `diff <(jq -S . ~/.config/claude/settings.json) <(jq -S . ~/.claude/settings.json)`
