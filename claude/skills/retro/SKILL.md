---
name: retro
description: "Post-work knowledge hygiene: consolidate, prune, and selectively grow memory/rules. Use after completing significant work, or when the system feels cluttered."
argument-hint: "[commit range, e.g. HEAD~3, or blank for HEAD~5]"
allowed-tools: Bash, Read, Write, Glob, Grep, Edit
model: sonnet
disable-model-invocation: false
---

Analyze the recent work and improve the system through consolidation — not accumulation.

Range: $ARGUMENTS (if empty, default to HEAD~5)

## Current Context
- Branch: !`git branch --show-current 2>/dev/null || echo "N/A"`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "N/A"`

## Core Principle

**Hygiene over growth.** The default action is consolidate or skip — not add.
Every memory and rule loaded costs tokens every session. Fewer, sharper items beat many vague ones.

## Budget Awareness

Before proposing ANY new item, count what exists:

```bash
# Count active knowledge
echo "=== Feedback memories ==="
ls -1 ~/.claude/memory/feedback_*.md 2>/dev/null | wc -l
echo "=== Project memories ==="
ls -1 ~/.claude/memory/project_*.md 2>/dev/null | wc -l
echo "=== Rules ==="
ls -1 ~/.claude/rules/*.md 2>/dev/null | wc -l
echo "=== Private memories ==="
ls -1 ~/.claude/memory/private/*.md 2>/dev/null | wc -l
```

Guidelines (not hard limits):
- feedback memories: ~10
- project memories: ~5
- rules: ~6
- private: no cap (not globally loaded)

If at or over budget, new additions MUST be paired with a consolidation or removal.

## Phases

### 1. Collect

Gather what happened in this session:

```bash
git log --oneline <range>
git diff --stat <range>
```

Also check for plan artifacts:
```bash
branch=$(git branch --show-current 2>/dev/null)
grep -li "branch: $branch" .claude/plans/*.md 2>/dev/null
```

If a plan exists, read it — the delta between plan and reality is a key input.

If `/self-review` was run in this session, reference its findings (especially violations).

### 2. Analyze

Answer these questions based on the collected data:

- What diverged from the plan (if one existed)?
- Was the same type of change repeated 3+ times in this session? (pattern signal)
- Were there false starts or wasted iterations? What would have prevented them?
- Are any existing memories/rules now outdated given this work?

Do NOT force insights. If the session was routine, say so and skip to Phase 5 (propose nothing).

### 3. Classify

For each insight, assign an action with this priority order:

| Priority | Action | When |
|----------|--------|------|
| 1 | **Consolidate** existing memory/rule (merge 2→1, sharpen wording) | Two items overlap or one is a subset of another |
| 2 | **Update** plan artifact (Post-Implementation Notes, status→implemented) | Plan exists for this branch |
| 3 | **Delete** stale memory/rule | Item is now derivable from code, or the project context changed |
| 4 | **Add** new memory/rule | Same pattern observed 3+ times THIS SESSION, not derivable from code |
| 5 | **Skip** | Derivable from code/git, or one-off occurrence |

For new additions, also classify:
- **public** — team-relevant or general pattern
- **private** — internal services, personal workflow, company-specific

### 4. Propose

Present all proposed changes in a single table:

```
| # | Action      | Target                      | Public/Private | Summary                          |
|---|-------------|-----------------------------|----------------|----------------------------------|
| 1 | Consolidate | feedback_X.md + feedback_Y.md | public        | Merge into: [preview of merged] |
| 2 | Update      | plans/2026-04-09-auth.md    | —              | Add post-implementation notes   |
| 3 | Delete      | project_old_context.md      | public         | Project phase completed         |
| 4 | Add         | feedback_new_pattern.md     | private        | [content preview]               |
| 5 | Skip        | —                           | —              | File structure (derivable)      |
```

For **Consolidate** actions: show the proposed merged content inline so 대협 can judge quality.
For **Add** actions: show the full proposed file content.

Wait for 대협 to approve by number (e.g., "1,2,3" or "all" or "none").

### 5. Apply

Only apply approved items:

- **Consolidate**: Write merged file, delete the redundant file, update MEMORY.md index
- **Update**: Edit the plan artifact (status, Post-Implementation Notes)
- **Delete**: Remove file, update MEMORY.md index
- **Add**: Write new file (to memory/ or memory/private/ based on classification), update MEMORY.md or MEMORY.private.md index

After applying, show the diff of MEMORY.md to confirm index consistency.

## Rules

- Never add without counting existing items first (Budget Awareness)
- Never force insights from a routine session — "nothing to change" is a valid outcome
- Consolidation proposals MUST show the merged content for review
- Respect the existing memory file format (frontmatter with name, description, type)
- All file content in English (per feedback_memory_english.md)
- If unsure whether something is public or private, default to private
