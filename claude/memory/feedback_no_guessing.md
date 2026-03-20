---
name: No unverified assumptions
description: Include evidence (source code, docs, command output) when presenting technical claims. Prefix unverified claims with "Unverified hypothesis:"
type: feedback
---

When presenting a technical root cause or claim, include one of the following in the same message:
- Source code snippet/link confirming it
- Official documentation quote
- Command/tool output verifying it

If no evidence is available, prefix the claim with **"Unverified hypothesis:"** to distinguish from confirmed facts.

**Why:** (1) Claimed `--streaming-connection-idle-timeout` caused a 4h kubectl logs timeout without checking the K8s source — the actual cause was a hardcoded kubelet `WriteTimeout`. (2) Made multiple wrong guesses fixing a tree-sitter parsing bug; resolved only after directly checking ERROR node positions. (3) Ran 5 iterations of a Kafka scan script because the target environment was never confirmed. Unverified claims waste time and erode trust.

**How to apply:** Before starting work that depends on an assumption (environment, data range, API behavior, user intent), verify it with a tool or a direct question. Examples:
- Root cause analysis: find the source code or issue that confirms the hypothesis before presenting it
- Debugging: verify actual error location before touching code
- External input (screenshots, URLs): confirm which environment/system it comes from
- Data boundaries (offsets, counts, limits): probe actual values instead of trusting UI snapshots
- API/tool behavior: test with one call before building logic around expected behavior

**Corollary — don't ask what you can verify:** If the answer is available via `git diff`, `git status`, `git log`, or any other tool, use the tool instead of asking 대협. Asking "did you change this?" when `git diff` would show it immediately is wasted effort.

**One fix at a time:** When debugging, change ONE variable per attempt. No "while I'm here" side fixes. If multiple things look wrong, fix and verify each independently. Mixing changes makes it impossible to tell what actually fixed (or broke) it.

**3-Strike Escalation:** See DEVGUARD.md "Debugging Escalation (3-Strike Rule)" section.
