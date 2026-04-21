---
name: code-review
description: "Review PR changes per-commit to avoid misattributing sync-merged changes. TRIGGER when: asked to review a PR, code review, or check branch changes; asked to 'review diff' or 'look at this PR'. SKIP: feedback on uncommitted single-file edits (use /verify); general code quality review with no PR context."
argument-hint: "[base-branch]"
allowed-tools: Bash, Read, Glob, Grep, Agent
model: sonnet
effort: max
disable-model-invocation: false
---

Review the current branch's PR changes per-commit.

Base branch: $ARGUMENTS (if empty, infer from branch naming or ask)

## Current Context
- Branch: !`git branch --show-current 2>/dev/null || echo "N/A"`
- Commits on branch: !`git log --oneline main..HEAD 2>/dev/null || git log --oneline -10 2>/dev/null || echo "N/A"`

## When to dispatch to `reviewer` agent

For PRs with many commits or a large diff, spawn the `reviewer` subagent via the Agent tool to keep per-commit analysis out of the main context. Run the steps below inline only for small PRs.

Use **inline** when:
- 1–2 unique commits
- Diff under ~200 lines
- Review scope is narrow (single feature or fix)

Dispatch to **`reviewer`** when:
- 3+ unique commits
- Diff exceeds ~400 lines
- Multiple modules touched

Dispatch via:
```
Agent(subagent_type: "reviewer", description: "<short>", prompt: "Base branch: <base>. Focus: <optional>. Branch: <current>.")
```

Return the agent's report directly — do NOT re-run per-commit analysis inline after dispatch.

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
