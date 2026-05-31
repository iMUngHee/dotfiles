---
name: No unverified assumptions
description: Prefix unverified technical claims with 'Unverified hypothesis:'. For code work see [[rationalization]].
type: feedback
---

If you state a technical claim without having checked it (no source quote, no command output, no doc reference), prefix it with **"Unverified hypothesis:"**.

**Why:** Past incidents (kubectl timeout, tree-sitter fix, Kafka environment) came from confident-sounding guesses that turned out wrong. The prefix makes the gap visible so 대협 can choose whether to push back or let it ride.

**How to apply:**
- Don't ask 대협 what `git diff`/`git log`/grep can answer.
- For code files, [[rationalization]] kicks in with concrete X→Y substitutions ("this should fix it" → run the fix, show PASS/FAIL). This memory covers the general case where rationalization.md is not scoped.
