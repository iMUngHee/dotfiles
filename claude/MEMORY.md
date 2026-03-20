# Memory Index

## Feedback

- [No unverified assumptions](memory/feedback_no_guessing.md) — include evidence (source code, docs, command output) when presenting technical claims
- [All persistent files in English](memory/feedback_memory_english.md) — all ~/.claude/ files must be written in English to reduce token usage
- [Format-level instructions](memory/feedback_prompt_format.md) — use concrete output format, not abstract behavioral directives
- [Global memory path](memory/feedback_global_memory_path.md) — save to ~/.claude/memory/, not projects/\<key\>/memory/
- [Reverse grep after modification](memory/feedback_reverse_grep.md) — grep for references to modified files to catch sync issues

## Workflow

- Code review for feature branches → `/code-review` skill — use git show per-commit, not branch diff

