---
name: tidy
description: "Clean agent slop from the current diff before a code commit or PR (internal-artifact comments, restating comments, defensive code for impossible failures, type escapes, duplicated helpers) without changing behavior. Skip docs- or config-only diffs, others' PRs (code-review), and goal checks (verify)."
argument-hint: "[base ref; default: merge-base with the default branch]"
allowed-tools: Bash, Read, Edit, Grep, Glob
disable-model-invocation: false
---

Clean the lines this branch added so they meet `~/.config/ai/rules/code-quality.md`, without changing what the code does.

Base: $ARGUMENTS (if empty, the merge-base of `HEAD` with the default branch: `origin/HEAD`, else `main`, else `master`)

## Scope

1. Collect the added lines: `git diff <base>` (commits, staged and unstaged together) plus every untracked file from `git ls-files --others --exclude-standard`. Only `+` lines and untracked files are in scope.
2. Edit the working tree only. Never stage, unstage or commit; the index stays as you found it.
3. You may delete or rewrite an added line. Touch a pre-existing line only when an added line forces it inside the same hunk, such as the import of a debug print you removed.
4. Report instead of editing when the fix would change a pre-existing line, move code between files, change a public signature, or could change behavior.

## What to fix

| Added code | Fix |
| --- | --- |
| A comment citing an internal plan, session, step, task id or the change in progress ("new", "now", "previously", "as discussed") | Delete it, or rewrite it as the current code's reason. A link to a shared issue or spec that explains a constraint stays. |
| A comment that restates the code, commented-out code, a debug print | Delete it. |
| A try/catch, nil/None guard or fallback for a failure that cannot happen | Remove it only when you can name the evidence (the type, a grep of every caller, an earlier check) in your report. Without that evidence, report it. |
| A type escape without a stated reason: `any`, `as unknown as`, `# type: ignore`, `interface{}`, an ignored error, `unwrap()` on a reachable error outside tests | Use the precise type or handle the error. When the escape is unavoidable, keep it with its reason. |
| A new helper that duplicates one the repository already has | Grep for it; call the existing one. |
| New code placed in a module that owns a different concept, or a new function with two reasons to change | Split or move it when the change stays inside the added lines; otherwise report it. |

## Then

1. Re-run the project's own checks: its CONVENTIONS.md or AGENTS.md loop, or the `go` / `rust` skill's loop, or its test, lint and type-check commands. Revert any edit that turns a check red.
2. Run the scan once more over the result. A second pass must find nothing new to change.
3. Report in one to three sentences what you changed, then list each item you reported instead of fixing, with its file:line and why.
