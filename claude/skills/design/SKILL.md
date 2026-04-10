---
name: design
description: "Design and plan implementation for multi-file changes or architecture decisions. Use when asked to design, plan, or architect a solution."
argument-hint: "[task description]"
allowed-tools: Bash, Read, Write, Glob, Grep, Agent
model: opus
effort: max
disable-model-invocation: false
---

Design and plan implementation for the given task.

Task: $ARGUMENTS (if empty, ask the user)

## Context Discovery

Before starting, search for existing plan artifacts that may be relevant:

```bash
ls .claude/plans/ 2>/dev/null && grep -li "<relevant keywords>" .claude/plans/*.md 2>/dev/null
```

If related plans exist, read them for context (prior decisions, lessons learned).

## Steps

### 1. Decompose

If 2+ independent subsystems exist, list them and ask which to start with.

### 2. Propose approaches

Propose 2-3 approaches with:
- **How**: concrete implementation description
- **Trade-off**: pros and cons

Mark one as recommended.

### 3. Present incrementally

Present design section by section with confirmation. Do NOT dump all sections at once. Wait for approval before moving to the next section.

### 4. Implementation plan

After design approval, present the implementation plan as response text:

1. **File Structure**: Map Create/Modify/Test files with responsibilities
2. **Tasks**: Use `- [ ]` checkboxes. Each step includes expected output (PASS/FAIL)
3. If planned output differs from actual during implementation, investigate

### 5. Persist plan artifact

After 대협 approves the design (Step 3 approval = signal to persist):

1. Create `.claude/plans/` directory if it does not exist
2. Save as `.claude/plans/YYYY-MM-DD-<slug>.md` with this format:

```yaml
---
title: <plan title>
date: YYYY-MM-DD
status: approved
branch: <current git branch>
files_affected:
  - <file paths from implementation plan>
---
```

Followed by the approved design content (Goal, Approach, Implementation Steps, Decisions).

Include an empty section at the end:

```markdown
## Post-Implementation Notes
<!-- Filled by /retro if run after implementation -->
```

3. Confirm the saved path to 대협.

**Status values**: `approved` (just saved) → `implemented` (updated by /retro) → `abandoned` (if plan was dropped)

## Rules

- Do NOT implement until user approves the design
- Plan artifact is saved ONLY after explicit design approval (Step 3)
- No file writes during design exploration (Steps 1-3)
- If 대협 declines to save, skip Step 5 — the plan remains conversation-only
