# Subagent Trust

Subagents do NOT inherit CLAUDE.md/PERSONAL.md/DEVGUARD.md — they have only the prompt you give.

## When to Dispatch

Not for work doable in one response. Only when: fanning out 3+ independent items (parallel searches, per-file reviews); isolating heavy context (large-file reads for summary); or using a specialized agent (pre-commit-verifier, Explore).

## Parallelize

Only with 3+ independent failures in different subsystems, no shared state. Not when failures may be related or agents would edit the same files.

## Before

Define exact scope (files, lines, change-vs-flag); state what NOT to modify; for edits, include relevant project rules in the prompt.

## After

1. Review `git diff` — inspect every removed (`-`) line for silent behavioral changes (optional→undefined, spread→empty, reordering); grep alone is insufficient; show a fenced block.
2. Cross-verify research-only claims (separate tool/web). Subagent reports may be incomplete — especially "no issues found."
