---
name: Context Compression Tool Evaluation
description: Data-driven decision in progress on whether to adopt Context Mode or build an equivalent MCP server for compressing large tool responses
type: project
---

A measurement hook (`~/.claude/hooks/log-tool-sizes.sh`, registered in `settings.json` PostToolUse with matcher `""`) is logging per-tool response byte sizes to `~/.claude/tool-sizes.jsonl` from 2026-04-21. A one-shot durable cron reminder (job ID `14caeeba`) fires on **2026-04-28 10:13 local** to prompt the analysis and adoption decision.

**Why:** Context Mode (MCP server, ELv2 license) and similar tools claim 98% context savings, but the benchmarks are on extreme workloads (Playwright snapshots, bulk GitHub issues). 대협's actual tool-response distribution is unknown, and `rtk gain` only tracks Bash rewrites, not MCP/Read sizes. Adoption has real costs: ELv2 license risk for corporate use, hook collisions with existing 14-hook pipeline, and CLAUDE.md routing competition. Without data, any decision is guessing.

**How to apply:**
- On 2026-04-28 (or earlier if `wc -l ~/.claude/tool-sizes.jsonl` shows ≥ 2000 entries), run the analysis in the cron prompt.
- Decision gates:
  - 5KB-over ratio ≥ 15% AND weekly over-bytes ≥ 5 MB → build minimal MCP server (`ctx_bash`, `ctx_read_big`, `ctx_search`) via `mcp-builder` skill; skip the official Context Mode plugin to avoid ELv2
  - 5–15% → revisit Context Mode in MCP-only mode (`claude mcp add context-mode`), skipping the hook plugin
  - < 5% → reject adoption, remove `log-tool-sizes.sh` and its `settings.json` entry, delete `~/.claude/tool-sizes.jsonl`
- The measurement hook only records `{ts, tool, size}` — no response content. Safe to keep running, but remove after the decision either way.
- Related skills: `mcp-builder` for self-built path, `retro` for post-decision memory cleanup.
