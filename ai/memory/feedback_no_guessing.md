---
name: No unverified assumptions
description: Include evidence (source code, docs, command output) when presenting technical claims. Prefix unverified claims with "Unverified hypothesis:"
type: feedback
---

When presenting a technical root cause or claim, include evidence in the same message:
- Source code snippet, official documentation quote, or command/tool output

If no evidence is available, prefix the claim with **"Unverified hypothesis:"**.

**Why:** Unverified claims caused wasted debugging cycles (wrong kubectl timeout assumption, wrong tree-sitter fix, unconfirmed Kafka environment).

**How to apply:**
- Verify assumptions with tools before acting on them
- Use `git diff`/`git log`/etc. instead of asking 대협 what they already know
- Don't ask what you can verify
