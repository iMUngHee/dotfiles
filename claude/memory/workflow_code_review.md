---
name: Code review workflow for feature branches
description: Use per-commit review (git show) instead of branch diff to avoid misattributing sync-merged changes
type: workflow
---

## Problem

When reviewing a feature branch that has sync merges from develop/main, `git diff base..HEAD` mixes the user's unique changes with sync-merged changes. This leads to misattributing other PR's changes to the user's work.

## Workflow

### Step 1: Identify unique commits

```bash
# Find commits unique to this branch (exclude merge commits)
git log --first-parent --oneline base..HEAD
```

If `--first-parent` returns only merge commits, extract non-merge commits:

```bash
git log --no-merges --oneline base..HEAD
```

Then cross-reference with `git log base --oneline` to filter out commits already in base.

### Step 2: Review per-commit

For each unique commit, use `git show`:

```bash
git show <commit-hash> --stat   # scope check
git show <commit-hash>          # full diff
```

Do NOT use `git diff base..HEAD` for line-level review. It includes sync-merged changes.

### Step 3: Branch diff for context only

`git diff base..HEAD --stat` is acceptable for understanding overall PR scope, but individual issues must trace back to a specific unique commit before flagging.

### Step 4: Cross-verify before flagging

Before reporting any issue:
1. Identify which commit introduced it
2. If the commit is NOT a unique commit (i.e., it's from a sync merge), do NOT flag it as the user's code
