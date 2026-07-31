---
name: claude-feedback_websearch_xhigh_regression
description: WebSearch 400s under effortLevel xhigh/max — use WebFetch or python3 urllib. WebFetch is unaffected; do not lower effortLevel for this.
metadata:
  type: feedback
---

`WebSearch` fails with `API Error: 400 output_config.effort 'xhigh' is not supported when thinking is disabled on this model` on Claude Code 2.1.220, even with `alwaysThinkingEnabled: true` — the effort level reaches WebSearch's internal sub-call, which runs without thinking. Skills declaring `effort: max` (e.g. `mcp-builder`) hit the same ceiling.

**Why:** a Claude Code regression, not a config error. WebSearch worked 2026-07-20 (4 calls) and failed 2026-07-27; `claude/settings.json` has no commit between those dates and `effortLevel` has existed since 2026-03-18. 2.1.220 is the newest cask build, so there is no upgrade to take.

**How to apply:** do not lower `effortLevel` to work around this — WebSearch saw 6 calls in 2 weeks and xhigh is worth more than that. `WebFetch` is verified unaffected, so any known URL is still reachable; `cx_fetch_and_index` works too. Only keyword discovery is lost — for that, fetch a known index/sitemap with `WebFetch` and follow links, or pull the page directly with `python3 urllib.request` (set a `User-Agent`; `curl` is sandbox-denied). Re-test `WebSearch` after any Claude Code upgrade and delete this memory once it passes.
