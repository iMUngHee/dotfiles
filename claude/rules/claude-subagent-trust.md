# Subagent Trust

Two kinds of subagent, two trust models:

- **Fresh** (`Explore`, `general-purpose`, `pre-commit-verifier`, `reviewer`, `verifier`, any `.claude/agents/*` type): no CLAUDE.md/PERSONAL.md/DEVGUARD.md, no session history — only the prompt you give.
- **Fork** (`subagent_type: "fork"`): inherits this conversation and runs on the session model; `model` overrides are ignored. Use it when the task needs what was decided here; use a fresh agent when it needs a clean or cheaper context.

## When to Dispatch

Only for a specialized agent — `pre-commit-verifier` (pre-commit scan), `reviewer` (/code-review), `verifier` (/verify), `Explore` (read-only codebase mapping) — or to fan out 3+ genuinely independent items.

**Read-only investigation** → `Explore` (no Edit/Write tools). Any other type can edit files even when told not to — run `git status` after and revert unrequested changes before trusting the result.

## Parallelize

Only with 3+ independent failures in different subsystems, no shared state. Not when failures may be related or agents would edit the same files.

## Before

Define exact scope (files, lines, change-vs-flag); state what NOT to modify; for edits, include relevant project rules in the prompt.

**Context sufficiency** — a fresh agent starts from zero, and its single biggest failure mode is missing context. Package into the prompt: the goal, the relevant files/paths, the facts it cannot observe (decisions made this session and why), constraints/rules, the expected output shape, and how deep to verify. Err toward over-including — an under-briefed subagent makes confident wrong moves. A fork already has all of this; give it only the delta.

## After

Cross-verify research-only claims (separate tool/web). Subagent reports may be incomplete — especially "no issues found."
