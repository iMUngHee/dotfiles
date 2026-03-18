---
name: No unverified assumptions
description: Verify assumptions with tools before acting — applies to debugging, environment identification, data boundaries, and any work based on unconfirmed premises
type: feedback
---

Do not act based on unverified assumptions. If something is assumed but not confirmed, verify it first.

**Why:** (1) Made multiple wrong guesses fixing a tree-sitter parsing bug; resolved only after directly checking ERROR node positions with `nvim --headless`. (2) Ran 5 iterations of a Kafka scan script because the target environment (ad1 vs ar2) was never confirmed — a single question would have prevented all rework. Unverified assumptions waste time and erode trust.

**How to apply:** Before starting work that depends on an assumption (environment, data range, API behavior, user intent), verify it with a tool or a direct question. Examples:
- Debugging: verify actual error location before touching code
- External input (screenshots, URLs): confirm which environment/system it comes from
- Data boundaries (offsets, counts, limits): probe actual values instead of trusting UI snapshots
- API/tool behavior: test with one call before building logic around expected behavior

Never proceed with "this is probably X" reasoning when verification is available.

**Corollary — don't ask what you can verify:** If the answer is available via `git diff`, `git status`, `git log`, or any other tool, use the tool instead of asking 대협. Asking "did you change this?" when `git diff` would show it immediately is wasted effort.

**One fix at a time:** When debugging, change ONE variable per attempt. No "while I'm here" side fixes. If multiple things look wrong, fix and verify each independently. Mixing changes makes it impossible to tell what actually fixed (or broke) it.

**3-Strike Escalation:** See DEVGUARD.md "Debugging Escalation (3-Strike Rule)" section.
