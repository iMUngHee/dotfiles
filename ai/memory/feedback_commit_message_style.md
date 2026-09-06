---
name: Commit message style
description: Follow the repo's own commit convention; fallback is Conventional Commits with a ~50-char imperative subject and no AI attribution.
type: feedback
---

Follow the commit convention already visible in the repository (type prefixes, language, trailers). Without evidence, fall back to `<type>(<scope>): <imperative subject>`, about 50 characters and never over 72, a body only for non-obvious rationale, and no AI attribution or invented issue ids.

**Why:** adopted as the `caveman-commit` skill on 2026-08-11 and folded into memory in 2026-09 once the model followed the format without a skill — a preference, not a capability gap.

**How to apply:** draft in the repo's dominant commit language, keep existing trailers verbatim, and never let message drafting replace the sensitive-info scan or the commit workflow.
