---
name: No guessing in debugging
description: Verify root cause with tools before fixing unknown bugs — includes checking git diff/status before asking the user
type: feedback
---

Do not modify code based on guesses. If the cause is unknown, use tools to confirm it first.

**Why:** Made multiple wrong guesses fixing a tree-sitter parsing bug; it was only resolved after directly checking ERROR node positions with `nvim --headless`. Guesswork wastes time and erodes trust.

**How to apply:** When encountering unclear bugs (parsing errors, rendering issues, unexpected runtime behavior), verify the actual error location and cause using relevant tools (tree-sitter CLI, nvim headless, logs, debugger, etc.) before touching the code. Never modify code with "this might be the issue" reasoning.

**Corollary — don't ask what you can verify:** If the answer is available via `git diff`, `git status`, `git log`, or any other tool, use the tool instead of asking 대협. Asking "did you change this?" when `git diff` would show it immediately is wasted effort.

**One fix at a time:** When debugging, change ONE variable per attempt. No "while I'm here" side fixes. If multiple things look wrong, fix and verify each independently. Mixing changes makes it impossible to tell what actually fixed (or broke) it.

**3-Strike Escalation:** See DEVGUARD.md "Debugging Escalation (3-Strike Rule)" section.
