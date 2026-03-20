---
name: design
description: "Design and plan implementation for multi-file changes or architecture decisions. Use when asked to design, plan, or architect a solution."
argument-hint: "[task description]"
allowed-tools: Bash, Read, Glob, Grep, Agent
model: opus
---

Design and plan implementation for the given task.

Task: $ARGUMENTS (if empty, ask the user)

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

## Rules

- Do NOT implement until user approves the design
- Do NOT save design to files unless explicitly requested
- Present as response text only — no file writes during design phase
