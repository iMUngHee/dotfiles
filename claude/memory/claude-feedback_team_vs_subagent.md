---
name: Team agent vs subagent distinction
description: Do not conflate team agents (TeamCreate + teammates) with subagents (.claude/agents/ definitions). They are different mechanisms with different lifecycles.
type: feedback
---

Never mix up team agents and subagents. They are fundamentally different.

- **Subagent**: one-shot worker via Agent tool (no team), defined in `.claude/agents/`, returns result and terminates
- **Team agent (Teammate)**: persistent member via Agent tool + `team_name`, created at runtime via TeamCreate, communicates via SendMessage, shares TaskList, goes idle between turns

**Why:** During a harness engineering implementation, subagent definitions (.claude/agents/) were designed when team agent workflows (TeamCreate + teammates) were requested. The two concepts were used interchangeably in design docs, causing repeated confusion and corrections.

**How to apply:** When the context is ambiguous, ask which is intended. Key signals: "팀 에이전트" or "팀 파서" → TeamCreate + teammate. "서브 에이전트" or "에이전트 디스패치" → one-shot Agent tool call. Note that `.claude/agents/` definitions can be used by both — as subagent_type for one-shot calls, or as teammate type in a team.
