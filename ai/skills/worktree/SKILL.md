---
name: worktree
description: "Create and set up a git worktree under .agents/worktrees/<branch> — pm store wired in (shared backlog/plans/inbox + lock, local state/) and dependencies installed. TRIGGER: 'create worktree' / 'worktree 만들어' / requests for an isolated parallel checkout. SKIP: in-place edits where isolation isn't needed."
argument-hint: "<target-branch> [base-branch]"
allowed-tools: Bash, Read, Glob, Grep
model: opus
disable-model-invocation: true
---

Create, reuse, validate, or safely prune a managed worktree through the shared engine.
Never reproduce Git-path, symlink, pointer, reservation, or cleanup logic in the skill.

Arguments: $ARGUMENTS
- `<id>`: stable kebab-case plan/item id (required)
- `[base-ref]`: explicit base branch/ref (required when intent is ambiguous)

## Setup

Resolve the repository root and use the shared engine:

```bash
root="$(git rev-parse --show-toplevel)" || exit 1
engine="$HOME/.config/ai/lib/worktree.mjs"
```

Fetch an explicitly remote base before `ensure`; do not silently fall back after a
failed fetch. Local-only refs may be passed directly.

```bash
git fetch origin <base-ref>
node "$engine" ensure --root "$root" --id <id> --base <base-ref>
```

The JSON result is authoritative and contains `base_branch`, immutable `base_commit`,
`branch`, `worktree`, and `execution_root`. `ensure` reuses an exact branch/path match,
creates a reservation before Git mutation, initializes the main `tasks/` and `plans/`
stores, wires only those directories into the worktree, creates a real local `state/`,
and updates Git-common excludes. A legacy `ROADMAP.md` returns `migration_required`
before creating PM directories.

## Finish setup

Run dependency installation, `.worktreeinclude` copying, and the project baseline from
the returned `execution_root`. Prefer lockfile-based installs. A failed install or
baseline is reported; never hide it.

Report:
- execution root and branch;
- base ref and 40-character base commit;
- created versus reused;
- shared `tasks/plans` and local `state` status;
- copied files, dependency result, and baseline result.

## Existing plan operations

```bash
node "$engine" resolve-current --root "$root"       # read-only routing
node "$engine" assert-root --root "$root" --plan <plan-path>
node "$engine" sync-state --root "$root" --plan <plan-path>
node "$engine" validate --root "$root"
node "$engine" validate --root "$root" --all  # repository-wide ownership audit
```

Adoption always creates or selects a dedicated worktree; the main checkout is never a
plan execution target. A dirty main checkout blocks automatic legacy adoption.

```bash
node "$engine" adopt --root "$root" --plan <plan-path> --base <base-ref> [--select]
```

## Cleanup

Use explicit lifecycle commands. Cancellation removes only a clean, commit-free,
unowned provisional worktree. Terminal prune refuses a dirty/current/mismatched target
and keeps the branch.

```bash
node "$engine" cancel-provisional --root "$root" --id <id>
node "$engine" prune --root "$root" --provisional --id <id>
node "$engine" prune --root "$root" --plan <terminal-plan-path>
```

`validate` lists clean provisional reservations separately and fails on abandoned
dirty/committed/current/missing worktrees, incomplete ownership handoffs, invalid
mappings, and orphan reservation stage/temp artifacts. Provisional prune is the same
safe operation as cancellation; it never removes a current, dirty, committed, or
plan-owned worktree. Terminal prune derives the branch/worktree from a `done` or
`dropped` plan under the PM lock; a caller-supplied terminal flag is never trusted.

Never call `git worktree remove --force` by default. `--force` is explicit-user-only.

## Rules

- Do not create managed worktrees outside `.agents/worktrees/`.
- Do not hand-edit `.agents/tasks`, plan mappings, reservations, or current pointers.
- Hooks use `resolve-current` only; they never invoke a mutating command.
- **Sandbox**: Claude uses `dangerouslyDisableSandbox`; Codex uses a workspace-write
  session that includes `.agents/worktrees`.
