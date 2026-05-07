---
name: 3-tier config layout (ai / claude / codex)
description: ~/.config/ uses ai/ for shared content, claude/ and codex/ for tool-native content. New files go where their dependency lives.
type: feedback
---

`~/.config/` is split into three tiers:
- `ai/`: shared single source — rules, memory, skills usable from any AI assistant
- `claude/`: Claude Code-only — content that depends on Claude-specific systems (subagents, slash commands, plan/state artifacts, hooks, EnterPlanMode/EnterWorktree tools, settings.json permissions)
- `codex/`: Codex CLI-only — content that depends on codex-specific systems (sandbox modes, codex exec, ~/.agents/skills discovery, codex MCP)

**Why:** Tool-agnostic rules drift if duplicated; tool-specific rules confuse the wrong tool if shared. Drift-zero only happens with a single source for shared content + clean per-tool boundaries.

**How to apply:** When adding a new rule, memory, or skill, ask: "does this depend on a tool-specific system?"
- No → `ai/` (shared)
- Yes, Claude only → `claude/` with `claude-` prefix
- Yes, Codex only → `codex/` with `codex-` prefix

If unsure, default to `ai/` and tokenize tool-specific paths/names. Move to a tool directory only after concrete tool-specific dependency is confirmed.
