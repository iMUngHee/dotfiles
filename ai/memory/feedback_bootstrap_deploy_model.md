---
name: Bootstrap deploy model (cp / symlink / generated)
description: Claude reads ai/ via symlink overlay (with in-context token substitution); Codex receives ai/ as concat+sed expand into AGENTS.md. MEMORY.md is auto-generated. Edit ai/ originals only.
type: feedback
---

Bootstrap deploys ai/ content to each tool with a different mechanism:

- **Claude Code**: `ai/*.md` and `ai/skills/*` are **symlinked** into `~/.claude/`. Tokens are NOT pre-expanded; the model substitutes them per `feedback_token_substitution.md`. ai/ originals and `~/.claude/` are the same file via symlink.
- **Codex CLI**: `ai/*.md` (manifest order) is **concat'd through sed token expansion** into a single `~/.codex/AGENTS.md`. Skills (`ai/skills/*`, `codex/skills/*`) are symlinked into `~/.agents/skills/`.
- **Memory index** (`~/.claude/MEMORY.md`): **auto-generated** by claude bootstrap from ai/memory + claude/memory + ai/memory/private walks. Carries an `AUTO-GENERATED — edit source files in ai/memory/ or claude/memory/` header. Direct edits are lost on next bootstrap.

**Why:** Single source of truth in ai/ + per-tool deploy that respects each tool's instruction-loading model. Codex's AGENTS.md is a single file (no @import), so concat+expand is unavoidable. Claude's import resolver follows symlinks, and the model handles token substitution reliably (live-validated 5/5 on Codex; Claude's behavior is equivalent or stronger).

**How to apply:**
- Edit `~/.config/ai/<file>` originals only. ~/.claude/<file> editing immediately mutates ai/ via symlink (intentional, but keep awareness).
- Never hand-edit `~/.claude/MEMORY.md` or `~/.codex/AGENTS.md` — they are generated. Run `ai/scripts/bootstrap.sh` after editing source files.
- New token introduction: update `expand_tokens_codex` in `codex/scripts/bootstrap.sh` AND ensure model substitution rules in `feedback_token_substitution.md` cover it (so Claude knows to substitute too).
- `claude/skills/<sub>` directly symlinks into `~/.claude/skills/<claude-sub>` overlay; user-added skills in `~/.claude/skills/` that are not symlinks are preserved (bootstrap does not touch them).
