---
name: Rule phrasing for agent instructions
description: State agent rules as one short behavioral sentence; use exact-format wording only for output a hook, test, script, or 대협's contract consumes (A/B 2026-09-07: format-forcing added nothing).
type: feedback
---

State a rule as one short behavioral sentence. Use exact-format wording only when something other than the model consumes the output — a hook, a test, a script, or a user contract (`✓/✗/—`, the `⚠️ test framework detected…` string, the `(추천)` label).

**Why:** Early DEVGUARD.md testing needed exact strings ("show evidence" failed, "include a fenced code block" worked). Re-measured 2026-09-07 on current models (workflow wf_718d7131-a6b: 3 tickets × 2 rules × no-rule/behavioral/format arms, blind judges): all arms tied at 100% evidence, 0% unsupported claims, 0% scope creep. Format-forcing now only costs prompt space.

**How to apply:** Draft the behavior first; keep an exact format only if you can name its consumer. Before re-adding format-forcing, re-run the A/B.
