---
name: claude-feedback_codex_headless_bash_timeout
description: Running codex exec (via /ask-codex, /plan-review) through the Bash tool needs the Bash timeout raised above the command's own gtimeout cap, or Bash kills it first.
metadata:
  type: feedback
---

When a skill runs a long headless subprocess through the Bash tool — e.g. `gtimeout 600 codex exec --sandbox read-only ...` from /ask-codex or /plan-review — the Bash tool's own default 5-minute timeout fires BEFORE the command's 600s `gtimeout` cap, killing it at 5:00 (exit 143, "Command timed out after 5m 0s").

**Why:** the two timeouts are independent; the outer Bash-tool default (300000ms) is shorter than the inner `gtimeout` cap, so the wrapped command never gets its full budget.

**How to apply:** on the Bash call, pass an explicit `timeout` greater than the inner cap (e.g. `720000` for `gtimeout 600`). Persist the prompt to a temp file first so a retry reuses it instead of regenerating; on retry just re-run the `codex exec` line with the larger Bash timeout.
