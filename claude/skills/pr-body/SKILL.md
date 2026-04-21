---
name: pr-body
description: "Generate PR body from branch changes and copy to clipboard. TRIGGER when: asked to write a PR body, PR description, merge request description, or prepare a pull request; asked to 'describe this PR'. SKIP: commit message authoring; release notes spanning multiple PRs."
argument-hint: "[base-branch]"
allowed-tools: Bash, Read, Glob
model: sonnet
disable-model-invocation: false
---

Generate the PR body for the current branch.

Base branch: $ARGUMENTS (if empty, infer from branch naming or ask)

## Current Context
- Branch: !`git branch --show-current 2>/dev/null || echo "N/A"`
- PR template: !`cat .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || echo "No template found"`

## Steps

### 1. Determine base branch

Infer from branch naming:
- `feature/<parent>/...` or `fix/<parent>/...` → use `<parent>` as base
- If unclear, ask the user

### 2. Identify unique commits

```bash
git log --first-parent --oneline <base>..HEAD
```

These are the ONLY commits to consider. Ignore sync-merged commits.

### 3. Review per-commit changes

For each unique commit:

```bash
git show <commit> --stat
git show <commit>
```

Do NOT use `git diff <base>..HEAD` for content review — it includes sync-merged changes.

### 4. Check PR template

Read `.github/PULL_REQUEST_TEMPLATE.md` if it exists. Follow the template structure.

### 5. Generate and copy

1. Write the PR body as markdown
2. Copy to clipboard with `dangerouslyDisableSandbox: true` (pbcopy requires it):
   ```bash
   pbcopy << 'EOF'
   <body>
   EOF
   ```
3. Confirm to the user that it's on the clipboard

## Style

- Start 변경 내용 section with bullets directly — no plain-text preamble or summary sentence
- Concise bullets only — do not enumerate every function/type added; focus on key changes
- Use `→` for before/after descriptions
- Include concrete values (constants, positions) but keep it terse
- Flat bullet list — no sub-headings like server/client/cleanup
- Read 2-3 recently merged PRs on the same base branch to match the author's style

## Rules

- Only describe changes from unique commits (Step 2)
- Match the project's existing PR style and language
- Keep bullet points concise
- NEVER render the markdown inline — always pbcopy
