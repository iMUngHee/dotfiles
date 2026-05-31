---
name: worktree
description: "Worktree creation with dependency setup for Codex CLI workflows. Creates .codex/worktrees/<branch> with deps installed. TRIGGER 'create worktree' / 'worktree 만들어'. SKIP in-place edits where isolation isn't needed."
argument-hint: "<target-branch> [base-branch]"
disable-model-invocation: true
---

Create and set up a git worktree under `.codex/worktrees/<target-branch>` for isolated Codex CLI sessions.

Arguments: $ARGUMENTS
- `<target-branch>`: new branch name (required)
- `[base-branch]`: branch to base from (default: current branch). Always pulled to latest before branching.

## Steps

### 1. Validate

- Confirm inside a git repository
- Abort if `.codex/worktrees/<target-branch>` already exists
- Abort if `<target-branch>` branch already exists (`git rev-parse --verify <target-branch>`)

### 2. Fetch and create worktree

Chain with `&&` so a failed fetch (e.g. network offline) does NOT fall through to creating a worktree from a stale ref:

```
git fetch origin && \
  git worktree add -b <target-branch> .codex/worktrees/<target-branch> origin/<base-branch>
```

If `origin/<base-branch>` does not exist (no remote or local-only branch), fall back to local ref:

```
git worktree add -b <target-branch> .codex/worktrees/<target-branch> <base-branch>
```

Then `cd` into `.codex/worktrees/<target-branch>`.

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

When the worktree is no longer needed (e.g. PR submitted, review pending):

```
cd <main-worktree>
git worktree remove --force .codex/worktrees/<target-branch>
```

The branch is kept for later checkout (review feedback, etc.).

## Rules

- Do NOT create worktrees outside `.codex/worktrees/`.
- Always pull base branch to latest before creating the worktree.
- If dependency install fails, do not silently continue. Report the error.
- **Sandbox**: this skill writes to `.git/config`, `.env` files, and `node_modules/`. Invoke codex with `-s workspace-write --add-dir .codex/worktrees` (or run from a workspace-write session) so the writes are permitted.
