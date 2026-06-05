---
name: fanout
description: "Parallel multi-agent fan-out for independent N-item work. TRIGGER when: 대협 explicitly asks for parallel/fan-out/multi-agent processing, OR a task splits into 3+ truly independent units (per-file/per-module/per-symbol) that NO specialized skill owns. SKIP (defer to the owner): PR/code review (code-review), feature verification (verify), planning/architecture (design), root-cause debugging (debug), web research (deep-research), UI building (frontend-design); single-file edits and one-response work (→ handle solo)."
argument-hint: "[task description]"
allowed-tools: Workflow, Task, TaskOutput, Read, Glob, Grep, Bash, Agent
model: opus
effort: max
disable-model-invocation: false
---

Parallel multi-agent fan-out for deep analysis and (strict opt-in) execution, orchestrated via the `Workflow` tool.

Task: $ARGUMENTS (if empty, infer from the request)

## 0. Priority — defer to specialized skills first

Fanout NEVER preempts at the top level. If the request matches another skill's trigger, that skill is the owner — stop and let it run:

- PR / code review → `code-review`
- feature verification / pre-PR check → `verify`
- planning / architecture / multi-file design → `design`
- root-cause debugging ("왜 안 돼") → `debug`
- web / multi-source research → `deep-research`
- UI / frontend building → `frontend-design`

Only proceed when NO specialized skill owns the request.

## 1. Fan-out gate (token safety valve)

Proceed ONLY if at least one holds:

- 3+ truly independent units (per-file / per-module / per-symbol), no shared mutable state
- cross-verification would change confidence in the answer (audit, security sweep, multi-subsystem root cause)
- the work is too large for a single context (broad migration / sweep)

If none hold → handle the task **solo in this turn, no Workflow**. Stop here. This gate is the cost control; do not launch a workflow for work one response can do.

## 2. Choose mode

### Analysis mode (read-only — default)

For questions, audits, root-cause, surveys with no code change. Orchestrate via `Workflow`:

- `pipeline(units, finder, verify)` — each unit analyzed, each finding adversarially verified as it lands (no barrier between stages).
- Scale adversarial-verify votes by stakes: 1 vote for light checks, 3 votes ("try to refute this; default to refuted if uncertain") for audits / "샅샅이".
- Return a synthesis report: verified findings only, each cited as `file:line`.

### Execution mode (strict opt-in)

Allowed ONLY when ALL hold: 대협 explicitly requested implementation; worker write sets are disjoint; the main agent is the integration owner; every worker diff is reviewed (no silent revert, no unrequested privilege escalation). Otherwise fall back to solo.

- `pipeline(items, implement {isolation:'worktree'}, verify)`.
- After workers finish: review each diff, integrate, run the project's verification.

## 3. Workflow conventions

- This skill is an explicit opt-in path for the `Workflow` tool — author the script inline, begin with `export const meta = {...}`.
- Default to `pipeline()` (no barrier between stages). Use `parallel()` only when a stage genuinely needs all prior-stage results at once.
- Leave concurrency to the tool default (`min(16, cores-2)`). Use the `schema` option for structured agent output instead of parsing text.
- `log()` any coverage cap (top-N, sampling) — never silently truncate.
