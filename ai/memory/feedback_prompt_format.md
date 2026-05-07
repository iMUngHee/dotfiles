---
name: Format-level instructions for agent rules
description: When writing agent rules (CLAUDE.md, DEVGUARD.md, skills), use concrete output format requirements not abstract behavioral directives
type: feedback
---

When writing rules for agent behavior (CLAUDE.md, DEVGUARD.md, skills, etc.), use concrete output format requirements instead of abstract behavioral directives.

**Why:** During DEVGUARD.md testing, "always warn when skipping tests" was ignored 3 times across iterations. Changing to "append this exact string: ⚠️ test framework detected..." worked immediately. Same pattern: "show evidence" failed, "include a fenced code block" worked.

**How to apply:** When drafting a rule, ask: "Is this a behavior instruction or a format instruction?" If behavior, convert to format. Examples:
- Bad: "always warn about X" → Good: "append `⚠️ specific warning text`"
- Bad: "show verification evidence" → Good: "include a fenced code block with file content or command output"
- Bad: "be careful about Y" → Good: "your response must contain Z"
