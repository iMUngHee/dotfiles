---
name: Native file prefix convention
description: Files inside claude/ or codex/ get claude- / codex- prefix; ai/ files have no prefix.
type: feedback
---

All files and skill directories inside a tool-specific tier (`claude/`, `codex/`) carry the corresponding prefix:
- `claude/memory/claude-<name>.md`
- `claude/rules/claude-<name>.md`
- `claude/skills/claude-<name>/`
- `codex/memory/codex-<name>.md`
- `codex/skills/codex-<name>/`

`ai/` files (shared) have no prefix.

**Why:** Same logical name can have a tool-specific counterpart (e.g. `worktree` skill has Claude version `claude-worktree` using `EnterWorktree` and Codex version `codex-worktree` using sandbox-aware bash). Prefix prevents name collision and makes invocation self-explanatory (`/claude-worktree` vs `/codex-worktree`).

**How to apply:**
- Any new file moved or created under `claude/` or `codex/` → rename to add the prefix.
- Skill directory names also get the prefix (invocation name follows the directory name).
- Memory index entries reflect the prefixed filename.
- ai/ files NEVER get a prefix.
