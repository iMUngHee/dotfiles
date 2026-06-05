---
name: fanout
description: "Parallel multi-agent fan-out for independent N-item work. TRIGGER when: 대협 explicitly asks for parallel/fan-out/sub-agent/delegation processing (Codex spawns sub-agents ONLY on explicit request). SKIP (defer to the owner): PR/code review (code-review), feature verification (verify), planning/architecture (design), root-cause debugging (debug), web research; single-file edits and one-response work (→ handle solo)."
argument-hint: "[task description]"
disable-model-invocation: false
---

Parallel multi-agent fan-out for deep analysis and (strict opt-in) execution, via the Codex `multi_agent_v1` namespace.

Task: $ARGUMENTS (if empty, infer from the request)

## 0. Priority — defer to specialized skills first

Fanout NEVER preempts at the top level. If the request matches another skill's trigger, that skill is the owner — stop and let it run:

- PR / code review → `code-review`
- feature verification / pre-PR check → `verify`
- planning / architecture / multi-file design → `design`
- root-cause debugging ("왜 안 돼") → `debug`
- web / multi-source research → research workflow

Only proceed when NO specialized skill owns the request.

## 1. Explicit-request gate (Codex policy — hard rule)

Codex's `spawn_agent` policy: spawn sub-agents ONLY when 대협 explicitly asks for sub-agents / delegation / parallel agent work. If there is **no explicit request → do NOT spawn**. Handle the task solo, even if it looks fan-out-worthy. (This is why Codex fan-out cannot be fully automatic; it is the trigger asymmetry vs Claude's `Workflow`.)

## 2. Fan-out worthiness

Even with an explicit request, only fan out when the work splits into 3+ independent units / needs cross-verification / is too large for one context. Otherwise handle solo.

## 3. Mechanism (`multi_agent_v1`, stable in 0.137.0)

- `spawn_agent` (params: `fork_context`, `items`, `message`) launches workers; `wait_agent` collects results; `send_input` steers a running worker; `close_agent` finishes a thread.
- Do NOT set a model override — sub-agents inherit the parent model (tool policy).
- Do NOT rely on `enable_fanout` / `spawn_agents_on_csv` / `[agents]` / `max_depth` — not available in 0.137.0.

### Analysis mode (read-only — default)

Spawn one worker per dimension/unit → collect via `wait_agent` → spawn verifier workers to adversarially refute findings → synthesize. Return verified findings only, each cited as `file:line`.

### Execution mode (strict opt-in)

Allowed ONLY when ALL hold: 대협 explicitly requested implementation; worker write sets are disjoint; the main agent is the integration owner; every worker diff is reviewed (no silent revert, no unrequested privilege escalation). Use the `codex-worktree` skill for isolation. Otherwise fall back to solo.

## 4. Cost

Route heavy read-only exploration to workers and keep the main reasoning lean. Do not set per-worker model overrides — inherit the parent model.
