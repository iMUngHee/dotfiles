---
name: Auto memory intentionally disabled
description: Auto memory is off by design; do not recommend enabling it
type: feedback
---

Auto memory (`autoMemoryEnabled` / project-level `~/.claude/projects/<project>/memory/MEMORY.md`) is intentionally disabled. Do not suggest turning it on during audits or recommendations.

**Why:** 대협 explicitly opted out to prevent context bloat. Automatic project memory grows unboundedly and conflicts with the existing aggressive context discipline: 70% autocompact override, context-monitor hook at 50/65%, RTK token reduction, and the ongoing tool-response-size measurement (project_context_compression_eval).

**How to apply:**
- Treat auto memory as a deliberate opt-out, not a gap.
- Curate the manual system by hand: MEMORY.md index + memory/*.md files, plus MEMORY.private.md for @-imported loads.
- If a future Claude Code release changes auto-memory defaults or semantics, surface the change but keep the default off unless 대협 reverses the decision.
