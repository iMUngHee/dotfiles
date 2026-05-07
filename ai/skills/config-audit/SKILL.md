---
name: config-audit
description: "Claude Code dotfiles architecture and audit. TRIGGER when: creating, editing, moving, analyzing, or reviewing files in ~/.config/claude/ or ~/.claude/; working with memory files, settings.json, commands, skills, or hooks; discussing the dotfiles sync/symlink setup. SKIP: project-local .claude/ config (handled by regular skills); unrelated dotfiles (zsh, vim, etc.); runtime debugging of Claude Code binary."
allowed-tools: Bash, Read, Glob
model: sonnet
disable-model-invocation: false
paths:
  - "~/.claude/**"
  - "~/.config/claude/**"
  - ".claude/**"
---

## Architecture

Two-directory setup:

| Directory | Role |
|-----------|------|
| `~/.config/claude/` | Git-tracked dotfiles repo (source of truth) |
| `~/.claude/` | Claude Code runtime config (deployment target) |

### Deployment

- `~/.config/claude/scripts/bootstrap.sh` deploys repo → `~/.claude/`
  - Symlinks: `CLAUDE.md`, `RTK.md`, `PERSONAL.md`, `DEVGUARD.md`, `hooks/`, `commands/`, `rules/`, `agents/`, `memory/`, `statusline.sh`
  - Skills: individual symlinks per skill (public `skills/*/` + private `skills-private/*/` overlay)
  - Copies: `settings.json` (repo keys override, local keys preserved), `MEMORY.md`, `MEMORY.private.md` (deployed separately)
- `~/.config/claude/scripts/sync-back.sh` syncs `~/.claude/` → repo
  - Syncs `settings.json` (only repo-tracked keys)
  - Detects unindexed memory files, prompts to classify as public/private

### Rules

1. **Always edit at `~/.config/claude/`** (source of truth), never at `~/.claude/`
2. `~/.claude/memory/` is a symlink to `~/.config/claude/memory/` — same physical files
3. `MEMORY.md` uses markdown links (summary index, files NOT auto-loaded)
4. `MEMORY.private.md` uses `@` includes (files directly loaded into context) — no frontmatter in referenced files
5. Skills use directory structure: `skills/<name>/SKILL.md` (public) or `skills-private/<name>/SKILL.md` (private, gitignored)
6. `skills-private/` and `memory/private/` are gitignored — never committed to repo

## Audit checklist

When invoked, verify:

1. **Symlinks**: each expected item in `~/.claude/` points to `~/.config/claude/`
2. **CLAUDE.md @references**: all resolve to existing files
3. **MEMORY.md index**: every reference has a file, no orphan files
4. **Commands & skills**: list with descriptions
5. **Settings divergence**: `diff <(jq -S . ~/.config/claude/settings.json) <(jq -S . ~/.claude/settings.json)`
6. **MEMORY.md divergence**: `diff ~/.config/claude/MEMORY.md ~/.claude/MEMORY.md` and `diff ~/.config/claude/MEMORY.private.md ~/.claude/MEMORY.private.md` — deployed as separate copies
7. **Cross-file sync**: `/self-review` skill checklist matches DEVGUARD.md sections and MEMORY.md feedback entries
8. **Dead references**: all `memory/*.md` links in MEMORY.md and MEMORY.private.md resolve to existing files
9. **Scripts divergence**: `diff ~/.config/claude/scripts/<name>.sh ~/.claude/scripts/<name>.sh` for copy-deployed scripts (not symlinked)
10. **Gitignore completeness**: `MEMORY.private.md`, `.claude/`, `skills/*/node_modules/`, `hooks/.rtk-hook.sha256` are all listed in `.gitignore`
