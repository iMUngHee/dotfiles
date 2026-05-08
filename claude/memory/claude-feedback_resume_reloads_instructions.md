---
name: Claude Code resume reloads instructions
description: Resuming a Claude Code session reloads CLAUDE.md imports and SKILL.md files — a new session is not required to pick up instruction changes.
type: feedback
---

`claude --resume` (or continuing a session from the TUI) **reloads instructions** at the start of the resumed session. CLAUDE.md @imports, SKILL.md bodies, and rules are re-read from disk.

**Why:** Confirmed live during the ai-config-tier-refactor deploy (2026-05-08). After editing config-audit/SKILL.md with a new description, the resumed session showed the new description in the skill list — proving the reload happened without starting a fresh session.

**How to apply:** No need to quit and start a brand-new session when ~/.claude/* files are changed by bootstrap or manual edit. Resume is sufficient to pick up the latest instruction state. This matters when you want to verify instruction changes while keeping a rich conversation context alive.
