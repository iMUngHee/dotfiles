---
name: Token substitution rules
description: ai/ files use double-mustache placeholders for tool-varying paths/names. Replace with actual values whenever you reference, write, or execute commands containing them.
type: feedback
---

Whenever you reference, write, or execute commands containing the following tokens, **you MUST replace them with the actual values for the current tool's environment.** Do not emit the literal token in tool calls or in your final answer to the user.

| Token | Claude Code | Codex CLI |
| --- | --- | --- |
| `{{TOOL_HOME}}` | `~/.claude` | `~/.codex` |
| `{{TOOL_NAME}}` | `Claude Code` | `Codex CLI` |
| `{{TOOL_NAME_LC}}` | `claude` | `codex` |
| `{{INSTRUCTIONS_FILE}}` | `CLAUDE.md` | `AGENTS.md` |
| `{{CONFIG_FILE}}` | `settings.json` | `config.toml` |
| `{{PLAN_DIR}}` | `.claude/plans` | `.codex/plans` |
| `{{STATE_DIR}}` | `.claude/state` | `.codex/state` |

**Why:** ai/ files are deployed to both tools (Claude via symlink, Codex via concat into AGENTS.md). A single body must work for both. Tokens express tool-varying paths/names without forking the source.

**How to apply:**
- Reading ai/* content → mentally substitute the token with the value for whichever tool you are.
- Writing tool calls (Bash, Edit, Write) → substitute first; literal placeholders must NOT appear in any command or path.
- Quoting rules verbatim → the token may appear in QUOTE only; any ACTUAL action you take expands it.
- Adding a new token → update both Claude and Codex bootstrap's expand_tokens function (Codex uses sed for AGENTS.md build; Claude relies on this in-context substitution).
- System dependency (slash commands, subagent dispatch, EnterWorktree, etc.) is NOT a token candidate — generalize the body or split tool-specific detail into the tool's directory.
