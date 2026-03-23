---
name: verify
description: "Goal-backward verification for completed features. Use after finishing a feature, before creating a PR, or when asked to verify work is actually working."
argument-hint: "[feature or goal description]"
allowed-tools: Bash, Read, Glob, Grep
model: opus
---

Verify that the completed work actually achieves its goal.

Goal: $ARGUMENTS (if empty, infer from recent commits or ask)

## Approach: Goal-backward

Do NOT check "were tasks completed." Instead ask:
"What must be TRUE for this goal to be achieved?" — then verify each condition.

## Steps

### 1. Derive truth conditions

From the goal, list 3-7 concrete conditions that MUST be true.
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

Update the checklist from Step 1 with results:

```
Truth conditions for: [goal]
- [x] [condition 1] — Level 3 verified: [evidence]
- [ ] [condition 2] — FAILED at Level 2: stub found at file:line
...

Verdict: X/Y conditions verified
```

Each condition MUST have a fenced code block showing the verification output.
Failed conditions — report to 대협 with specific failure point.

## Rules

- Never mark a condition as verified without showing evidence
- If a condition fails, do NOT fix it silently — report the failure
- Stub detection is mandatory for Level 2 (grep for patterns above)
- This skill verifies. It does not modify code.
