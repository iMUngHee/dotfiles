# Subagent Trust

Subagents do NOT inherit CLAUDE.md/PERSONAL.md/DEVGUARD.md — they have only the prompt you give.

## When to Dispatch

Only for a specialized agent — `pre-commit-verifier` (pre-commit scan), `Explore` (read-only codebase mapping) — or to fan out 3+ genuinely independent items.

**Read-only investigation** → use the **Explore** agent (no Edit/Write tools). `general-purpose` and Codex (even with `--sandbox read-only`) have edited files despite explicit read-only instructions — if you must use them for research, run `git status` after and revert unrequested changes before trusting the result.

## Parallelize

Only with 3+ independent failures in different subsystems, no shared state. Not when failures may be related or agents would edit the same files.

## Before

Define exact scope (files, lines, change-vs-flag); state what NOT to modify; for edits, include relevant project rules in the prompt.

**Context sufficiency** — a subagent starts from zero (no CLAUDE.md, no session history), and its single biggest failure mode is missing context. Before dispatching, package into the prompt: the goal, the relevant files/paths, the facts it cannot observe (decisions made this session and why), constraints/rules, the expected output shape, and how deep to verify. Err toward over-including — an under-briefed subagent makes confident wrong moves.

## After

Cross-verify research-only claims (separate tool/web). Subagent reports may be incomplete — especially "no issues found."
