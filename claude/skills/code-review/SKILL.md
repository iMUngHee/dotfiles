---
name: code-review
description: "Review PR changes per-commit to avoid misattributing sync-merged changes. Use when asked to review a PR, code review, or check branch changes."
argument-hint: "[base-branch]"
allowed-tools: Bash, Read, Glob, Grep
model: sonnet
effort: max
disable-model-invocation: false
---

Review the current branch's PR changes per-commit.

Base branch: $ARGUMENTS (if empty, infer from branch naming or ask)

## Current Context
- Branch: !`git branch --show-current 2>/dev/null || echo "N/A"`
- Commits on branch: !`git log --oneline main..HEAD 2>/dev/null || git log --oneline -10 2>/dev/null || echo "N/A"`

## Steps

### 1. Identify unique commits

```bash
git log --first-parent --oneline <base>..HEAD
```

If only merge commits, extract non-merge commits:

```bash
git log --no-merges --oneline <base>..HEAD
```

Cross-reference with `git log <base> --oneline` to filter commits already in base.

These are the ONLY commits to review. Ignore sync-merged changes.

### 2. Review per-commit

For each unique commit:

```bash
git show <commit> --stat   # scope check
git show <commit>          # full diff
```

Do NOT use `git diff <base>..HEAD` for line-level review — it includes sync-merged changes.

### 3. Branch diff for context only

`git diff <base>..HEAD --stat` is acceptable for overall scope, but flag issues only if they trace back to a unique commit.

### 4. Cross-verify before flagging

Before reporting any issue:
1. Identify which commit introduced it
2. If the commit is NOT unique (i.e., from a sync merge), do NOT flag it

### 5. Next step (optional)

After fixes are committed, suggest running `/pr-body` to generate the PR description.

## Rules

- Only review changes from unique commits (Step 1)
- Match the project's language and conventions
- Keep feedback actionable and concise
