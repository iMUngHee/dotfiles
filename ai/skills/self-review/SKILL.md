---
name: self-review
description: "Self-review rule compliance for the current session"
allowed-tools: Read, Grep, Glob
model: opus
disable-model-invocation: true
---

Review whether rules were followed in this session.

## Instructions

1. Read all rule sources fresh from disk (do not rely on memory). Walk both the shared tier and the current tool's tier:

   ```
   ~/.config/ai/PERSONAL.md
   ~/.config/ai/guardrails.md
   ~/.config/ai/rules/*.md
   ~/.config/{{TOOL_NAME_LC}}/DEVGUARD.md      (if exists — Claude carries a thin tool-specific addendum)
   ~/.config/{{TOOL_NAME_LC}}/rules/*.md       (e.g. claude-subagent-trust.md)
   ~/.config/ai/memory/*.md                    (feedback entries only)
   ~/.config/{{TOOL_NAME_LC}}/memory/*.md      (feedback entries only — claude-* / codex-* prefix)
   ~/.config/ai/memory/private/*.md            (feedback entries only)
   ```

2. For each rule, evaluate against the conversation history:
   - **✓** followed (cite evidence)
   - **✗** violated (cite the specific action/message)
   - **—** not triggered (explain why) OR `— (n/a — rule not present in this tool)` if the rule lives in a tier that does not apply to the current tool.

3. For each **✗**, analyze actionability.

4. Output in this exact format:

````
## Self-Review: Rule Compliance

### PERSONAL.md (shared)

| Rule | Result | Evidence |
|------|--------|----------|
| Address as 대협 | ✓/✗ | ... |
| Expertise level | ✓/✗ | ... |
| File Modification (explicit request only) | ✓/✗ | ... |
| Critical Analysis — Justification | ✓/✗ | ... |
| Critical Analysis — Simplification | ✓/✗ | ... |
| Critical Analysis — Side effects | ✓/✗ | ... |
| Code Style | ✓/✗ | ... |
| Interactive Decision Points | ✓/✗/— | ... |
| Citations (cite source URL or mark "일반 지식 기반") | ✓/✗/— | ... |

### guardrails.md (shared)

| Rule | Result | Evidence |
|------|--------|----------|
| Verification Before Completion (fenced code block) | ✓/✗ | ... |
| Forbidden completion words (without evidence) | ✓/✗ | ... |
| Absence Proofs (scope match + fenced evidence) | ✓/✗/— | ... |
| Scope Resolution | ✓/✗/— | ... |
| Design Gate trigger (3+ files / arch / ambiguous) | ✓/✗/— | ... |

### {{TOOL_NAME_LC}}/DEVGUARD.md (tool-only — skip if absent)

| Rule | Result | Evidence |
|------|--------|----------|
| Skill Compliance (slash invocation vs raw tool) | ✓/✗/— | ... |
| Design Gate Invocation (Claude: /design vs Plan Mode) | ✓/✗/— | ... |

### ai/rules/rationalization.md

| Rule | Result | Evidence |
|------|--------|----------|
| No rationalization phrases used | ✓/✗ | ... |

### {{TOOL_NAME_LC}}/rules/* (tool-only)

For each `claude-*.md` / `codex-*.md` rule file present, add one row per top-level rule in that file. Examples for Claude: `claude-subagent-trust.md` → "Before dispatch — scope, constraints, rules in prompt", "After results — git diff review, cross-verify claims".

### ai/rules/testing.md

| Rule | Result | Evidence |
|------|--------|----------|
| Test Awareness (⚠️ warning if no tests) | ✓/✗/— | ... |
| TDD Discipline (if required) | ✓/✗/— | ... |

### ai/rules/diagnostics.md

| Rule | Result | Evidence |
|------|--------|----------|
| Hypothesis before investigating | ✓/✗/— | ... |
| Simplest cause first | ✓/✗/— | ... |
| 3-Strike escalation | ✓/✗/— | ... |

### ai/rules/code-review.md

| Rule | Result | Evidence |
|------|--------|----------|
| Code Review Honesty (verify before accepting) | ✓/✗/— | ... |
| Parallel Dispatch Criteria | ✓/✗/— | ... |

### Memory Feedback (ai/memory + {{TOOL_NAME_LC}}/memory + ai/memory/private)

For each feedback entry across all walked memory directories, add one row. Use the entry's `name` frontmatter field as the Rule. New entries pick up automatically — no template edit needed.

| Rule | Result | Evidence |
|------|--------|----------|
| <memory entry name> | ✓/✗/— | ... |

### Actionability

**Followed**: N / **Violated**: N / **Not triggered**: N

| Violation | Fix | Feasibility |
|-----------|-----|-------------|
| ... | hook / rule change / code change | 즉시 가능 / 규모별 분기 / 불가 (구조적 한계 — reason) |

If no violations, omit the table.
````

Be brutally honest. Do not soften or omit violations.
