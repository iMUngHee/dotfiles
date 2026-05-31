---
name: Code review feature branches per-commit
description: Review feature branches commit-by-commit via git show, never the branch-wide diff.
type: feedback
---

When reviewing a feature branch (not a single commit), walk the branch commit-by-commit with `git show <sha>` rather than dumping `git diff main...branch`.

**Why:** Branch-wide diffs misattribute changes that came from sync-merging main into the branch — reviewer ends up commenting on code the author never touched. Per-commit review preserves authorship boundaries.

**How to apply:** When 대협 asks to review a PR or feature branch, invoke the `/code-review` skill. If manually reviewing, enumerate commits with `git log main..branch --oneline` and apply `git show` per sha. Never substitute `git diff main...branch` for the whole review.
