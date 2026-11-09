---
name: Code-quality rule wording tournament
description: "rules/code-quality.md is candidate C4 (principles plus Bad/Good examples), chosen 2026-11-10 by a pre-registered tournament: 0.457 vs no-rule 0.399; re-run it before rewording the rule."
type: feedback
---

`ai/rules/code-quality.md` is the winner of a pre-registered tournament, not a hand-picked draft. Reword it only after re-running the comparison.

**Why:** 대협 asked that the rule be chosen from candidates rather than written once. On 2026-11-10 five wordings were ranked by Claude and Codex (Borda) into three finalists: C1 principle sentences, C4 the same with Bad/Good examples, C5 an end-of-work checklist. Each finalist and a no-rule baseline then ran three slop-inducing tasks (Go, TypeScript, Python) twice through `claude -p --setting-sources project` (Opus 5.5, user config isolated and verified by a sentinel probe). Every run passed its hidden tests. Scores combined blind Claude and Codex judging with mechanical counts: baseline 0.399, C1 0.443, C5 0.442, C4 0.457. Only C4 cleared the fixed bar of baseline + 0.05, so it was adopted despite costing the most always-on bytes.

**Limits:** six runs per condition and a single executor model. Internal-artifact comments never appeared in any run, the baseline included, so the comment line went unmeasured. In Python every candidate scored below the baseline; the gain came from module separation and placement in Go and TypeScript.

**How to apply:** Before rewording or shortening the rule, re-run the comparison and keep a new wording only if it beats the current one by the same margin. The setup to rebuild: three tasks in different languages, each with a step-numbered work order, a crowded main file, external input, an existing helper and an input-size hint, plus hidden tests; each wording and a no-rule baseline run twice per task in a fresh repo through `claude -p --setting-sources project --append-system-prompt`; a run that fails its hidden tests scores 0; score = half blind judging (Claude and Codex, 1-5 on modules, types, comments, performance, placement) and half artifact-comment, type-escape and main-file-share counts normalized to the baseline; adopt only at baseline + 0.05, shortest within 0.03 of the top. Enforcement does not rest on the rule alone: the `tidy` skill cleans a diff, and on Claude pre-commit-verifier Check 8 flags artifact comments; Codex has the rule and `tidy` but no commit-time check.
