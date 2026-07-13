---
name: verify
description: "Goal-backward verification for completed features. TRIGGER when: a feature is finished and needs confirmation; before creating a PR; asked to verify work; user says '확인해' / 'verify'. SKIP: intermediate progress checks (use /debug if stuck); code review comments (use /code-review); pre-code planning (use /design)."
argument-hint: "[feature or goal description]"
allowed-tools: Bash, Read, Glob, Grep, Agent
model: opus
disable-model-invocation: false
---

Verify that the completed work actually achieves its goal.

Goal: $ARGUMENTS (if empty, infer from recent commits or ask)

## System — design's read-only post-step

verify is an **optional read-only step after implementation** — not a pm-* loop node (it owns no per-task artifact, so the canonical loop is unchanged). It consumes the **plan** that `design` writes and `retro` later reads: via the `{{STATE_DIR}}/current.txt` pointer it loads the active plan and uses its `## Verifiable Success Criteria` as truth conditions (Step 1). It **persists nothing** and changes no status — confirming the goal is met is verify's job; closing the loop (plan→terminal, item→`closed.md`) stays `retro`'s. With `grill` (design's read-only pre-step) it forms the two read-only satellites bracketing `design`. Outside the loop (no plan) it just verifies a goal.

## Current Context
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "N/A"`
- Changed files: !`git diff --stat HEAD~5 2>/dev/null || echo "N/A"`

## Plan delta (optional)

Find the active plan artifact via the state pointer — the same source `/design` writes and `/retro` reads (`current.txt` names the in-flight plan by repo-relative path; plan frontmatter carries no `branch` field):

```bash
state_file="{{STATE_DIR}}/current.txt"
[ -f "$state_file" ] && plan=$(awk 'NF { print; exit }' "$state_file") \
  && [ -f "$plan" ] && echo "$plan"
```

If found, compare planned vs actual:
- **Planned files**: `files_affected` from plan frontmatter
- **Actual files**: `git diff --name-only <base>..HEAD`
- Report delta as informational (files added/removed vs plan). Do NOT block on delta — plans evolve during implementation.

If no plan found (empty or missing pointer), skip this section entirely.

## When to dispatch to `verifier` agent

For broad verification that would bloat the main context with many file reads or test runs, spawn the `verifier` subagent via the Agent tool. Run the steps below inline only when the goal is narrow.

Use **inline** when:
- Goal is scoped to a single function or file
- 2–3 truth conditions expected
- Level 1–2 depth is sufficient

Dispatch to **`verifier`** when:
- Goal spans multiple modules
- 5+ truth conditions expected
- Level 3/4 requires grep across 10+ files or running a test suite

Dispatch to a separate context to isolate heavy reading:
- **Claude Code**: `Agent(subagent_type: "verifier", description: "<short>", prompt: "Goal: <...>. Depth: <1-4>. Plan path: <optional>. Changed files: <optional>.")`
- **Codex CLI**: `codex exec` with the same focused prompt (Goal / Depth / Plan path / Changed files). Codex's `multi_agent_v1.spawn_agent` is explicit-request-only (not for auto-dispatch), so spawn a `codex exec` subprocess instead.

If the Plan delta step found a plan, pass its path as **Plan path** so the verifier seeds its truth conditions from the plan's `## Verifiable Success Criteria` (same as inline Step 1).
The dispatch prompt MUST also include the fixed planned truth conditions, the `Verification Coverage` field names, terminal-classification precedence, both arithmetic invariants, and the verdict rules below.

Do NOT re-run delegated proof inline. Treat the returned checklist as a condition-evidence packet, discard any delegated legacy verdict, and mechanically map each planned condition:

- `[x]` plus required fenced evidence → `Passed`.
- Explicit failure plus required fenced evidence → `Failed`.
- Unavailable prerequisite → `Blocked` only with attempted-prerequisite output, or `Evidence: none — no safe/authorized command`, plus a reason and exact unblock condition.
- Deliberate omission → `Skipped` only with a reason and decision authority (`user`, approved plan/scope, or another explicit authority).
- Missing condition/evidence, ambiguous state, or unclassifiable reason → `Blocked` with reason `delegated_evidence_incomplete`. Emit a fenced contract-validator result naming the condition and missing/ambiguous field. The exact unblock condition is: a new verification run must return that condition's terminal state and state-appropriate evidence.

The contract-validator fence proves the delegation blockage; it is not feature-proof output. Validate both arithmetic invariants, then append the authoritative ledger and verdict below. Never retry deficient delegated evidence into a pass.

## Approach: Goal-backward

Do NOT check "were tasks completed." Instead ask:
"What must be TRUE for this goal to be achieved?" — then verify each condition.

## Steps

### 1. Derive truth conditions

If the Plan delta step found a plan with a `## Verifiable Success Criteria` section (written by `/design`), use those conditions as the truth conditions — that section is `/design`'s seed for exactly this step. Otherwise derive them: from the goal, list 3-7 concrete conditions that MUST be true.
Format:

```
Truth conditions for: [goal]
- [ ] [condition 1]
- [ ] [condition 2]
...
```

### 2. Verify each condition at appropriate depth

For each condition, apply verification levels based on scope:

**Level 1 — Exists**: file, function, route, config entry is present.
```bash
# Example: check function exists
grep -rn "function handleAuth" src/
```

**Level 2 — Substantive**: not a stub or placeholder.
Scan for stub patterns: `TODO`, `FIXME`, `NotImplementedError`,
`throw new Error('not implemented')`, empty function bodies, `pass`.
```bash
# Example: check for stubs in new files
grep -n "TODO\|FIXME\|NotImplementedError" <file>
```

**Level 3 — Wired**: connected to the rest of the codebase.
Imported, called, routed, registered — not orphaned code.
```bash
# Example: check if new module is imported anywhere
grep -rn "import.*handleAuth\|require.*handleAuth" src/
```

**Level 4 — Flowing**: actual data flows through it.
Run the code, show real output.
```bash
# Example: run the feature, show output
npm test -- --grep "auth"
```

### 3. Determine depth per condition

| Change scope | Required levels |
|---|---|
| Single function edit | 1 (Exists) + 2 (Substantive) |
| Feature complete | + 3 (Wired) |
| PR-ready / release | + 4 (Flowing) |

If unsure about scope, default to all 4 levels.

### 4. Report

Freeze the planned-condition list before executing proof. The counting unit is one planned truth condition, regardless of its number of levels, commands, or observables. Classify every condition into exactly one terminal state, in this precedence order:

1. `Failed`: any required proof conclusively disproves the condition; remaining proofs need not run.
2. `Blocked`: no proof failed, but a required proof could not run because access, environment, data, a dependency, or another prerequisite was unavailable.
3. `Skipped`: no proof failed or blocked, but a required proof was deliberately not run.
4. `Passed`: every required proof ran and satisfied the condition.

Evidence is state-specific:

- `Passed` and `Failed`: include the fenced proof command or observable output.
- Attempted `Blocked`: include fenced prerequisite failure/unavailability output, the reason, and the exact unblock condition.
- No-safe/authorized-check `Blocked`: write `Evidence: none — no safe/authorized command`, the reason, and the exact unblock condition; do not fabricate a fence.
- `Skipped`: include the reason and decision authority; do not fabricate proof output.

Update the checklist and append exactly this summary contract:

```
Truth conditions for: [goal]
- [x] [condition 1] — Level 3 verified: [evidence]
- [ ] [condition 2] — FAILED at Level 2: stub found at file:line
...

Verification Coverage
- Planned: N
- Executed: N
- Passed: N
- Failed: N
- Blocked: N
- Skipped: N
- Coverage: Executed / Planned (percentage)

Verdict: PASS | FAIL | INCOMPLETE
Summary: X/Y conditions passed
```

`Executed` is `Passed + Failed`; partially attempted blocked/skipped conditions are not executed. Enforce both invariants:

- `Planned = Executed + Blocked + Skipped`
- `Executed = Passed + Failed`

Format `Coverage` as `Executed / Planned`, rounded half-up to one decimal place (for example, `2 / 3 (66.7%)`). With zero planned conditions, report `Coverage: N/A` and `INCOMPLETE`.

Verdict precedence is deterministic: `FAIL` when `Failed > 0`; otherwise `INCOMPLETE` when `Blocked > 0`, `Skipped > 0`, or `Planned = 0`; otherwise `PASS` only when every planned condition passed. The status-bearing verdict replaces the former numeric-only verdict line; numeric progress appears only in `Summary` and the ledger.

## Rules

- Never mark a condition as verified without showing evidence
- If a condition fails, do NOT fix it silently — report the failure
- Stub detection is mandatory for Level 2 (grep for patterns above)
- This skill verifies. It does not modify code.
