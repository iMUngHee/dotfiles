---
name: Workflow skills intentionally auto-invokable
description: design/verify/debug/code-review/pr-body/retro keep disable-model-invocation false by design
type: feedback
---

All workflow skills — `design`, `verify`, `debug`, `code-review`, `pr-body`, `retro` — have `disable-model-invocation: false` on purpose. Do NOT propose flipping them to `true`.

**Why:** 대협 explicitly confirmed this is the intended state. Claude should be free to auto-invoke these skills when their trigger conditions match, not only on explicit user command. The trigger descriptions themselves are the gate.

**How to apply:**
- When auditing skills or recommending frontmatter changes, treat `disable-model-invocation: false` on workflow skills as load-bearing, not a default miss.
- For a new workflow skill, default to `false` unless a strong reason exists (e.g., the skill rewrites settings files or performs irreversible ops requiring explicit user initiation — see `clean-permissions` which is correctly `true`).
- The natural gate is the `description` field's specificity + DEVGUARD routing, not the invocation flag.
