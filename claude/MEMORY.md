# Memory Index

## Feedback

- [No unverified assumptions](memory/feedback_no_guessing.md) — include evidence (source code, docs, command output) when presenting technical claims
- [All persistent files in English](memory/feedback_memory_english.md) — all ~/.claude/ and CLAUDE.md files must be written in English to reduce token usage
- [Format-level instructions](memory/feedback_prompt_format.md) — use concrete output format, not abstract behavioral directives
- [Global memory path](memory/feedback_global_memory_path.md) — save to ~/.claude/memory/, not projects/<key>/memory/
- [Reverse grep after modification](memory/feedback_reverse_grep.md) — grep for references to modified files to catch sync issues
- [PR body formatting](memory/feedback_pr_body_format.md) — no numbered sub-headings in PR bodies, use flat bullet lists
- [Team vs subagent](memory/feedback_team_vs_subagent.md) — never conflate team agents (TeamCreate+teammates) with subagents (.claude/agents/)
- [Auto memory intentionally disabled](memory/feedback_auto_memory_disabled.md) — off by design to prevent context bloat; do not recommend enabling
- [Workflow skills auto-invokable by design](memory/feedback_workflow_skills_auto_invokable.md) — design/verify/debug/code-review/pr-body/retro keep disable-model-invocation false; do not propose flipping
- [Code review per-commit](memory/feedback_code_review_per_commit.md) — feature-branch reviews walk commit-by-commit via git show, never branch-wide diff

## Project

- [Context compression eval](memory/project_context_compression_eval.md) — measuring tool response sizes until 2026-04-28, then deciding Context Mode vs self-built MCP vs reject
