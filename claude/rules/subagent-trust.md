# Subagent Trust

Subagents do NOT inherit CLAUDE.md, PERSONAL.md, or DEVGUARD.md. They operate with only the prompt you provide.

## Before Dispatch

1. Define exact scope (files, line ranges, what to change vs flag)
2. State explicit constraints (what NOT to modify)
3. For modifications: include relevant project rules in the prompt

## After Results

1. Review `git diff` — check every removed (`-`) line's value for silent behavioral changes (optional→undefined, spread→empty, condition reordering). Grep alone is insufficient. Include fenced code block.
2. Research-only claims need cross-verification (web search, separate tool call). Subagent reports may be incomplete — especially "no issues found."
