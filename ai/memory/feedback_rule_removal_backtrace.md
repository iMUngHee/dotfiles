---
name: feedback_rule_removal_backtrace
description: Before deleting a rule as unused or duplicated, backtrace it to tests and plans — absence of transcript signal is not absence of reason.
metadata:
  type: feedback
---

Before removing any always-loaded rule, run two checks that transcript evidence cannot substitute for:

1. **Does a test assert this text?** `grep -rn "<a distinctive phrase from the rule>" ai/lib/*.test.mjs` — several rules are contract-tested by exact string match, and the suite is not wired into any hook.
2. **Which plan created it?** Search `.agents/plans/` and `claude/.claude/plans/` for the rule's keywords, then read that plan's Decisions and Risks. A rule that looks redundant is often one leg of a deliberate multi-part contract.

**Why:** on 2026-07-31 an audit deleted the `Restored Context Authority` block from `ai/guardrails.md` because `claude/hooks/inject-context.sh` emits the same sentences verbatim. The duplication WAS the design — `9bbe422` (2026-07-23) shipped it as hook injection + always-loaded rule + a 528-line acceptance harness + audit rows in `config-audit` and `self-review`, because the hook reports per-turn state while the rule states the behavior and survives compaction independently. `ai/lib/session-routing-consumers.test.mjs` asserts the exact wording in `guardrails.md` and its mirror in `self-review`. The deletion shipped in `0f60dc8`, broke that test, and nothing caught it: the Stop hook type-checks but never runs the suite, and the pre-commit agent reads the diff without executing tests.

**How to apply:** "no transcript signal in N weeks" justifies deletion only after both checks come back empty. When a rule survives because of a plan, copy the one-line reason into the rule itself — the next audit sees only the text, not the plan. The same gap explains crux: `2026-05-07-tool-response-compression.md` measured 5,297 responses, designed head/tail truncation, then dropped it because truncating an Edit diff hides what changed; crux (`context-mode-go`) is that decision's replacement, and none of that rationale lives in the injected text.
