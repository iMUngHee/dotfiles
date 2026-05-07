---
name: AGENTS.manifest concat order
description: ai/AGENTS.manifest controls the concat order of ai/*.md into ~/.codex/AGENTS.md. Update the manifest whenever a new ai/*.md is added.
type: feedback
---

`ai/AGENTS.manifest` is a one-file-per-line list (comments allowed via `#`) that codex bootstrap uses to concat ai/ markdown sources into a single `~/.codex/AGENTS.md`. Order matters — files higher in the manifest appear earlier in AGENTS.md.

**Why:** Codex has no @import or memory index — the body of AGENTS.md is what the model receives. The token-substitution rules memory (`feedback_token_substitution.md`) MUST appear before any ai/*.md that uses tokens, otherwise Codex sees tokens before knowing how to substitute. Order is part of correctness, not just style.

**How to apply:**
- Add a new `ai/*.md` (any tier — root, rules/, memory/, memory/private/) → also append it to `ai/AGENTS.manifest` at the appropriate location.
- `feedback_token_substitution.md` MUST be the first memory entry in the manifest.
- A file in `ai/` not in the manifest = Codex never sees that file (silent invisibility, not an error).
- `ai/scripts/sync-back.sh` warns about manifest drift (files in ai/ but not manifest); `--strict` fails the sync.
- Files NOT in ai/ (claude-only, codex-only) are NEVER in the manifest — those tiers have their own deploy mechanism.
