---
name: worktree
description: "Create and set up a git worktree under .agents/worktrees/<branch> — pm store wired in (shared backlog/plans/inbox + lock, local state/) and dependencies installed. TRIGGER: 'create worktree' / 'worktree 만들어' / requests for an isolated parallel checkout. SKIP: in-place edits where isolation isn't needed."
argument-hint: "<target-branch> [base-branch]"
allowed-tools: Bash, Read, Glob, Grep
model: opus
disable-model-invocation: true
---

Create and set up a git worktree under `.agents/worktrees/<target-branch>` for isolated development. Shared across Claude Code and Codex CLI (tool-specific bits — sandbox invocation — are noted per platform in Rules).

Arguments: $ARGUMENTS
- `<target-branch>`: new branch name (required)
- `[base-branch]`: branch to base from (default: current branch). Always pulled to latest before branching.

## Steps

### 1. Validate

- Confirm inside a git repository
- Abort if `.agents/worktrees/<target-branch>` already exists
- Abort if `<target-branch>` branch already exists (`git rev-parse --verify <target-branch>`)

### 2. Fetch and create worktree

Chain with `&&` so a failed fetch (e.g., network offline) does NOT fall through to creating a worktree from a stale ref:

```
git fetch origin && \
  git worktree add -b <target-branch> .agents/worktrees/<target-branch> origin/<base-branch>
```

If `origin/<base-branch>` does not exist (no remote or local-only branch), fall back to local ref:

```
git worktree add -b <target-branch> .agents/worktrees/<target-branch> <base-branch>
```

Then `cd` into `.agents/worktrees/<target-branch>`.

### 2.5. Wire the pm store (share main's `.agents`, keep state local)

So pm tooling (`/pm-roadmap`, `/pm-context`, `/design`, `/retro`) in the worktree sees the **same** project backlog/plans/inbox (and the same `tasks/.lock`, so writes across worktrees serialize), while each worktree keeps its **own** in-flight plan + focus. Symlink the shared data; make `state/` a real local dir:

```bash
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
mkdir -p .agents/state                       # local: current.txt / focus.txt start empty
for d in tasks plans inbox.md; do
  [ -e "$main/.agents/$d" ] || continue       # only share what main actually has
  if [ -L ".agents/$d" ]; then ln -sfn "$main/.agents/$d" ".agents/$d"        # idempotent re-point
  elif [ -e ".agents/$d" ]; then echo "WARN: worktree .agents/$d is a real path — skipping (resolve manually)"
  else ln -s "$main/.agents/$d" ".agents/$d"; fi
done
# keep main from surfacing the worktree checkout as untracked (creates the file if absent)
[ -d "$main/.agents" ] && { grep -qxF 'worktrees/' "$main/.agents/.gitignore" 2>/dev/null || echo 'worktrees/' >> "$main/.agents/.gitignore"; }
```

`<main>` is the main checkout (`git rev-parse --git-common-dir` resolves to `<main>/.git` from any linked worktree). If main has no `.agents/` (repo never used pm), this no-ops. Skip on a repo you don't want sharing pm state.

### 3. Install dependencies

Detect build/dependency files at project root (lock files, manifests) and run the ecosystem's standard install command. If multiple apply (e.g. monorepo), install all. If none found, skip.

Prefer lock-file-based clean installs when available (e.g. `npm ci` over `npm install`, wrapper scripts like `./gradlew` over global `gradle`).

### 4. Copy untracked files

If `.worktreeinclude` exists at project root, copy matching files from the main worktree:

```
git ls-files --others --ignored --exclude-from=<main-root>/.worktreeinclude | while read f; do
  cp <main-root>/$f ./$f
done
```

If `.worktreeinclude` does not exist but local-only env files are found in the main worktree, suggest creating `.worktreeinclude`.

### 5. Baseline check

If a test/build script exists in `package.json` or equivalent, run it. Report result. If it fails, warn and ask whether to continue.

### 6. Report

Print summary:
- Worktree path
- Branch: `<target-branch>` based on `<base-branch>`
- pm store wired (symlinks + local state) or no-op (repo without `.agents/`)
- Dependencies installed (or skipped)
- Untracked files copied (or none)
- Baseline result (or skipped)

## Cleanup (manual)

When the worktree is no longer needed (e.g. PR submitted, review pending):

```
cd <main-worktree>
git worktree remove --force .agents/worktrees/<target-branch>
```

The branch is kept for later checkout (review feedback, etc.). The worktree's local `state/` is discarded with it; the shared `tasks/`/`plans/` (symlink targets in main) are untouched.

## Rules

- Do NOT create worktrees outside `.agents/worktrees/`.
- Always pull base branch to latest before creating the worktree.
- If dependency install fails, do not silently continue. Report the error.
- **Sandbox** — the skill writes to `.git/config`, `node_modules/`, local env files, and `.agents/worktrees/`, outside the default write-allow set:
  - **Claude Code**: run its Bash commands with `dangerouslyDisableSandbox: true`.
  - **Codex CLI**: invoke with `-s workspace-write --add-dir .agents/worktrees` (or run from a workspace-write session).
