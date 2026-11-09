---
name: Codex read-only sandbox cannot read files on Windows
description: "On Windows, codex exec --sandbox read-only fails every file read with UnauthorizedAccessException; inline the plan and files into the stdin prompt instead of pointing at paths."
type: feedback
---

When delegating to Codex with `codex exec --sandbox read-only` on Windows (the `ask-codex` skill, plan-review rounds, blind judging), put everything Codex must read into the stdin prompt itself.

**Why:** On 2026-11-10 a plan-review round pointed Codex at the plan path and repository files; every read failed with `UnauthorizedAccessException` and Codex returned `BLOCKED: insufficient_context`. The same review with the plan and relevant files concatenated into the prompt worked, as did judging packets fed on stdin.

**How to apply:** Build a packet (plan text, file excerpts, command output) and pipe it to `codex exec ... -`; tell Codex not to read files. Keep packets under the 10-minute call budget by excerpting, not dumping whole trees.
