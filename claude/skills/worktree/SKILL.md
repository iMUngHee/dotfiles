---
name: worktree
description: "Worktree creation with dependency setup. Use when asked to create a worktree or when EnterWorktree tool is about to be used."
argument-hint: "<target-branch> [base-branch]"
allowed-tools: Bash, Read, Glob, Grep
model: opus
disable-model-invocation: true
---

Create and set up a git worktree for isolated development.

Arguments: $ARGUMENTS
- `<target-branch>`: new branch name (required)
- `[base-branch]`: branch to base from (default: current branch). Always pulled to latest before branching.

## Steps

### 1. Validate

- Confirm inside a git repository
- Abort if `.claude/worktrees/<target-branch>` already exists
- Abort if `<target-branch>` branch already exists (`git rev-parse --verify <target-branch>`)

### 2. Fetch and create worktree

```
git fetch origin
git worktree add -b <target-branch> .claude/worktrees/<target-branch> origin/<base-branch>
```

If `origin/<base-branch>` does not exist (no remote or local-only branch), fall back to local ref:
```
git worktree add -b <target-branch> .claude/worktrees/<target-branch> <base-branch>
```

Then `cd` into `.claude/worktrees/<target-branch>`.

### 3. Install dependencies

Detect build/dependency files at project root (lock files, manifests) and run the ecosystem's standard install command. If multiple apply (e.g. monorepo), install all. If none found, skip.

Prefer lock-file-based clean installs when available (e.g. `npm ci` over `npm install`, wrapper scripts like `./gradlew` over global `gradle`).

### 4. Copy untracked files

If `.worktreeinclude` exists at project root, copy matching files from main worktree:

```
git ls-files --others --ignored --exclude-from=<main-root>/.worktreeinclude | while read f; do
  cp <main-root>/$f ./$f
done
```

If `.worktreeinclude` does not exist but `.env*` files are found in main worktree, suggest creating `.worktreeinclude`.

### 5. Baseline check

If a test/build script exists in `package.json` or equivalent, run it. Report result. If it fails, warn and ask whether to continue.

### 6. Report

Print summary:
- Worktree path
- Branch: `<target-branch>` based on `<base-branch>`
- Dependencies installed (or skipped)
- Env files copied (or none)
- Baseline result (or skipped)

## Cleanup (manual)

When worktree is no longer needed (e.g. PR submitted, review pending):
```
cd <main-worktree>
git worktree remove --force .claude/worktrees/<target-branch>
```

Branch is kept for later checkout (review feedback, etc.).

## Rules

- Do NOT use `EnterWorktree` tool. This skill replaces it.
- Do NOT create worktrees outside `.claude/worktrees/`.
- Always pull base branch to latest before creating the worktree.
- If dependency install fails, do not silently continue. Report the error.
- **Sandbox**: All Bash commands in this skill (git fetch, git worktree add, pnpm install, cp .env, build) require `dangerouslyDisableSandbox: true` because they write to `.git/config`, `.env` files, and `node_modules/` which are outside the default sandbox write-allow list.
