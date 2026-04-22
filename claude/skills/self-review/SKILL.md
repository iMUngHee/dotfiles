---
name: self-review
description: "Self-review rule compliance for the current session"
allowed-tools: Read, Grep, Glob
model: opus
disable-model-invocation: true
---

Review whether rules were followed in this session.

## Instructions

1. Read all rule files fresh (do not rely on memory):
   - `~/.config/claude/PERSONAL.md`
   - `~/.config/claude/DEVGUARD.md`
   - `~/.config/claude/rules/rationalization.md`
   - `~/.config/claude/rules/subagent-trust.md`
   - `~/.config/claude/rules/testing.md`
   - `~/.config/claude/rules/diagnostics.md`
   - `~/.config/claude/rules/code-review.md`
   - `~/.config/claude/MEMORY.md` (feedback entries only)
   - `~/.config/claude/MEMORY.private.md` (if present — feedback entries only)

2. For each rule, evaluate against the conversation history:
   - **✓** followed (cite evidence)
   - **✗** violated (cite the specific action/message)
   - **—** not triggered (explain why)

3. For each **✗**, analyze actionability.

4. Output in this exact format:

````
## Self-Review: Rule Compliance

### PERSONAL.md

| Rule | Result | Evidence |
|------|--------|----------|
| Address as 대협 | ✓/✗ | ... |
| Expertise level | ✓/✗ | ... |
| File Modification (explicit request only) | ✓/✗ | ... |
| Critical Analysis — Justification | ✓/✗ | ... |
| Critical Analysis — Simplification | ✓/✗ | ... |
| Critical Analysis — Side effects | ✓/✗ | ... |
| Code Style | ✓/✗ | ... |
| Interactive Decision Points (AskUserQuestion) | ✓/✗/— | ... |
| Citations (cite source URL or mark "일반 지식 기반") | ✓/✗/— | ... |

### DEVGUARD.md

| Rule | Result | Evidence |
|------|--------|----------|
| Verification Before Completion (fenced code block) | ✓/✗ | ... |
| Forbidden completion words (without evidence) | ✓/✗ | ... |
| Absence Proofs (scope match + fenced evidence) | ✓/✗/— | ... |
| Scope Resolution | ✓/✗/— | ... |
| Skill Compliance (/design vs EnterPlanMode) | ✓/✗/— | ... |
| Design Gate trigger (3+ files / arch / ambiguous) | ✓/✗/— | ... |

### rules/rationalization.md

| Rule | Result | Evidence |
|------|--------|----------|
| No rationalization phrases used | ✓/✗ | ... |

### rules/subagent-trust.md

| Rule | Result | Evidence |
|------|--------|----------|
| Before dispatch — scope, constraints, rules in prompt | ✓/✗/— | ... |
| After results — git diff review, cross-verify claims | ✓/✗/— | ... |

### rules/testing.md

| Rule | Result | Evidence |
|------|--------|----------|
| Test Awareness (⚠️ warning if no tests) | ✓/✗/— | ... |
| TDD Discipline (if required) | ✓/✗/— | ... |

### rules/diagnostics.md

| Rule | Result | Evidence |
|------|--------|----------|
| Hypothesis before investigating | ✓/✗/— | ... |
| Simplest cause first | ✓/✗/— | ... |
| 3-Strike escalation | ✓/✗/— | ... |

### rules/code-review.md

| Rule | Result | Evidence |
|------|--------|----------|
| Code Review Honesty (verify before accepting) | ✓/✗/— | ... |
| Parallel Dispatch Criteria | ✓/✗/— | ... |

### MEMORY.md / MEMORY.private.md Feedback

For each feedback entry listed in MEMORY.md (and MEMORY.private.md if present), add one row. Use the entry title from the memory index as the Rule name so new entries are picked up automatically without editing this template.

| Rule | Result | Evidence |
|------|--------|----------|
| <memory entry title> | ✓/✗/— | ... |

### Actionability

**Followed**: N / **Violated**: N / **Not triggered**: N

| Violation | Fix | Feasibility |
|-----------|-----|-------------|
| ... | hook / rule change / code change | 즉시 가능 / 규모별 분기 / 불가 (구조적 한계 — reason) |

If no violations, omit the table.
````

Be brutally honest. Do not soften or omit violations.
