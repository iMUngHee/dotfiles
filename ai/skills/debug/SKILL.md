---
name: debug
description: "Systematic debugging for issues with unclear root cause. TRIGGER when: a bug's cause is not obvious; a fix attempt has failed; rules/diagnostics.md 3-strike escalation fires; user reports 'not working' / 'broken' / '왜 안 돼' without clear reason. SKIP: typos or syntax errors with explicit error messages; style/lint fixes; feature requests."
argument-hint: "[error description or reproduction steps]"
allowed-tools: Bash, Read, Glob, Grep, Agent
model: opus
effort: max
disable-model-invocation: false
---

Systematically debug the given issue.

Issue: $ARGUMENTS (if empty, ask the user for the error or symptom)

## Current Context
- Branch: !`git branch --show-current 2>/dev/null || echo "N/A"`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "N/A"`
- Uncommitted changes: !`git status --short 2>/dev/null || echo "N/A"`

## Phases

### 1. Reproduce

Establish a reliable reproduction BEFORE any investigation.

1. Get exact command/steps that trigger the error
2. Run it. Capture full output in a fenced code block
3. If not reproducible: report to 대협 with findings. Do NOT guess.

Output gate: a fenced code block showing the FAILING output.

### 2. Isolate

Narrow to root cause with evidence at each step.

1. Read stack trace / error message — identify suspect file(s)
2. Form hypothesis — state it explicitly: "Hypothesis: [X] because [evidence]"
3. Verify hypothesis with ONE of:
   - Add diagnostic output (log/print) and re-run
   - Read the suspect code and trace the data flow
   - Binary search: comment out / simplify until error changes
4. If hypothesis wrong, state why and form next hypothesis

Escalation: 3 failed hypotheses — STOP. Report findings to 대협 per 3-strike rule.

### When to spawn Explore subagent

If isolating the cause requires reading 3+ files across different modules, spawn an internal `Explore` subagent via the Agent tool to gather context. Summarize findings back into Phase 2 hypothesis. Keep the main thread focused on hypothesis tracking — do NOT outsource hypothesis judgment itself (3-strike rule requires main-thread discipline).

Output gate: "Root cause: [specific line/condition] because [evidence from step 3]"

### 3. Fix

1. State the root cause (from Phase 2) before writing any code
2. Minimal change only — fix the cause, nothing else
3. No "while I'm here" scope creep

### 4. Verify

1. Re-run the EXACT reproduction from Phase 1
2. Show PASSING output in a fenced code block
3. If test suite exists: run it, show output
4. Compare Phase 1 output (FAIL) vs Phase 4 output (PASS) explicitly

## Rules

- No fix without root cause stated first
- No "it works now" without showing Phase 1 vs Phase 4 comparison
- Each phase must produce its output gate before proceeding
- If 대협 provides reproduction steps, start at Phase 1. If 대협 provides a root cause, start at Phase 3.
