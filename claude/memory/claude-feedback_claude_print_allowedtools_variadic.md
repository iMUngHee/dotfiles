---
name: claude -p --allowedTools swallows a trailing prompt
description: "claude -p --allowedTools takes a variadic list, so a prompt argument after it becomes a tool name and the run exits with no input; feed the prompt on stdin."
type: feedback
---

When scripting `claude -p` with `--allowedTools` (or `--disallowedTools`), pass the prompt on stdin, not as a trailing argument.

**Why:** On 2026-11-10 a harness ran `claude -p ... --allowedTools "Read,Edit,..." "/tidy main"`; the flag consumed `"/tidy main"` as another tool entry and Claude Code exited with "Input must be provided either through stdin or as a prompt argument when using --print", wasting a full validation pass. The tournament harness, which fed its prompt from a file on stdin, never hit it.

**How to apply:** `printf '%s' "$prompt" | claude -p --allowedTools "..." ...`, or end the variadic list with another flag before a positional prompt. Check the run's output for that error before trusting an empty result.
