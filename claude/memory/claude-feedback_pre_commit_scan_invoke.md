---
name: Pre-commit scan invocation (Claude)
description: Claude pre-commit scan mechanism: dispatch the pre-commit-verifier subagent.
type: feedback
---

Claude-specific implementation for the shared pre-commit sensitive-info scan rule (`memory/private/feedback_pre_commit_sensitive_scan.md`).

**Mechanism:** dispatch the `pre-commit-verifier` agent via the `Agent` tool with `subagent_type: "pre-commit-verifier"`. Pass `git diff --cached --name-only` output and a brief context summary as the prompt.

**Why this is split out:** the scan rule itself is tool-agnostic (the *what* and *why*). The *how* differs per tool — Claude has subagents, Codex CLI does not (at time of writing). Keeping the invocation mechanism in a Claude-only memory lets the shared rule stay clean while preserving the concrete instruction Claude needs.

**How to apply:**
- Triggered by the same phrases as the shared rule: "커밋 ㄱㄱ", "push 해줘", "PR 올려", explicit commit/PR requests.
- The `pre-commit-verifier` agent runs read-only, returns FAIL/WARN/PASS per check (security/test/architecture/change-size/scope-creep/convention/correctness).
- Surface its findings in your response before running `git commit`. If FAIL on the sensitive-info check, pause and ask 대협 for direction.
- If WARN appears on any non-security check, mention it but do not block (대협's call).
