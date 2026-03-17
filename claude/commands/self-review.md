---
description: "Self-review CLAUDE.md rule compliance for the current session"
allowed-tools: Read, Grep, Glob
---

Review whether CLAUDE.md rules were followed in this session.

<!-- Keep checklist in sync with PERSONAL.md, DEVGUARD.md, and MEMORY.md -->

## Instructions

1. Read all linked files: `~/.claude/CLAUDE.md` → `RTK.md`, `PERSONAL.md`, `DEVGUARD.md`, `MEMORY.md`

2. For each rule, evaluate against the conversation history. Fill the table with:
   - **✓** followed (cite evidence)
   - **✗** violated (cite the specific action/message)
   - **—** not triggered (explain why)

3. Output in this exact format:

````
## Self-Review: CLAUDE.md Compliance

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

### DEVGUARD.md

| Rule | Result | Evidence |
|------|--------|----------|
| Verification Before Completion | ✓/✗ | ... |
| Forbidden completion words | ✓/✗ | ... |
| Design Gate trigger | ✓/✗ | ... |
| Design Gate — Approach Proposal | ✓/✗ | ... |
| Design Gate — Incremental Approval | ✓/✗ | ... |
| Implementation Planning | ✓/✗ | ... |
| Subagent Trust — Before dispatch (scope, constraints, rules) | ✓/✗ | ... |
| Subagent Trust — After results (verify key claims) | ✓/✗ | ... |
| Debugging Escalation (3-Strike) | ✓/✗/— | ... |
| Code Review Honesty | ✓/✗/— | ... |

### MEMORY.md Feedback Rules

| Rule | Result | Evidence |
|------|--------|----------|
| No guessing in debugging | ✓/✗/— | ... |
| All persistent files in English | ✓/✗ | ... |
| Format-level instructions | ✓/✗/— | ... |
| Global memory path | ✓/✗/— | ... |

### Verdict

**Followed**: N / **Violated**: N / **Not triggered**: N

[Key lesson from this session — one sentence]
````

Be brutally honest. Do not soften or omit violations.
