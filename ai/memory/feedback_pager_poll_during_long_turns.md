---
name: Poll pager during long turns
description: pager hooks only deliver at turn boundaries, so call msg_list yourself mid-task instead of waiting for mail to arrive.
type: feedback
---

pager delivers through hook output, and its hooks are registered on turn boundaries only — `SessionStart`, `UserPromptSubmit`, `Stop` for Claude; `SessionStart`, `UserPromptSubmit` for Codex. There is no timer. Nothing arrives while a turn is in progress, however long it runs. **Call `msg_list` directly at natural pauses in a long task** — after finishing a phase, before starting the next one, and before reporting completion.

**Why:** 대협 had to interrupt twice in one session to say mail had arrived ("편지옴", "답장 왔대") while a 20-minute work stretch was underway, and asked "왜 이걸 내가 일일이 알려줘야하냐?". Being told by the operator is the failure. The `config` session hit the same boundary from the other side: a Claude statusline badge reads the waiting count at the same turn boundary the `Stop` hook delivers on, so the count it shows is already zero. That badge was moved to the tmux status bar (`389b76f` → `b548b93`), which redraws on `status-interval` rather than on turns; the statusline kept only the session name. **That fix is for the operator's eyes, not yours** — nothing about it makes mail reach an agent mid-turn. Polling is still the only path that works from inside a running turn, and it costs nothing because the agent-facing MCP tool is already there.

**How to apply:**
- Long or multi-phase work: `msg_list` between phases, not only at the end.
- Never announce completion without one final check — a reply that arrived during the work changes what should be reported.
- A message quoted into the prompt by the operator is a signal the polling cadence was too slow, not just information.
- Sending is unaffected; this is about receiving. `msg_send` works whenever.
