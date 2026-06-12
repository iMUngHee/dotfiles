---
name: retro
description: "Post-work knowledge hygiene: consolidate, prune, and selectively grow memory/rules. TRIGGER when: user asks for retrospective or knowledge cleanup ('회고해' / '기억 정리'); after completing significant work; system feels cluttered. SKIP: mid-task context — use only during idle or end-of-session; do NOT auto-invoke while actively coding."
argument-hint: "[commit range, e.g. HEAD~3, or blank for HEAD~5]"
allowed-tools: Bash, Read, Write, Glob, Grep, Edit
model: sonnet
disable-model-invocation: false
---

Analyze the recent work and improve the system through consolidation — not accumulation.

Range: $ARGUMENTS (if empty, default to HEAD~5)

## System — role in the pm-* loop

`retro` is a **general-purpose** knowledge-hygiene skill. It is also the **memory** owner + loop-closer of the project-management system:

```
(pm-context · context | retro · memory | pm-roadmap · backlog)  ──▶  design · plan
        ▲___________________________________________________________________│
        retro: on a landed plan → close the pm-roadmap item, harvest follow-up workable units → backlog, harvest durable decisions → that task's MEMORY
```
So retro feeds **memory** and **backlog** back into the loop. Memory is **retro-owned** (durable per-task decisions/learnings), distinct from `pm-context`'s links and from a plan's Post-Impl Notes. Stored in the retro-owned `.agents/memory/<KEY>.md`; a legacy `## Memory` section in a task-context file is still read (union) but never written. (Global memory/rules hygiene is retro's other, non-pm job.)

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
ls -1 {{TOOL_HOME}}/memory/feedback_*.md 2>/dev/null | wc -l
echo "=== Project memories ==="
ls -1 {{TOOL_HOME}}/memory/project_*.md 2>/dev/null | wc -l
echo "=== Rules ==="
ls -1 {{TOOL_HOME}}/rules/*.md 2>/dev/null | wc -l
echo "=== Private memories ==="
ls -1 {{TOOL_HOME}}/memory/private/*.md 2>/dev/null | wc -l
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

Also check for the active plan artifact via the state pointer:
```bash
state_file="{{STATE_DIR}}/current.txt"
[ -f "$state_file" ] && plan=$(awk 'NF { print; exit }' "$state_file") \
  && [ -f "$plan" ] && echo "$plan"
```

If a plan exists, read it — the delta between plan and reality is a key input. **Also capture its current frontmatter `status:`** (a pointed-at plan may still be `draft`, not only `active`) — Phase 5 builds its status edit from this captured value.

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
| 2 | **Update** plan artifact (Post-Implementation Notes, status→done) | Plan exists for this branch |
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
- **Update**: Edit the plan artifact — set `status: <current> → <terminal>` where `<current>` is the status captured in Phase 1 (∈ {draft, active}) and `<terminal>` is `done` (or `dropped` if explicitly abandoned by 대협); build the Edit old_string from the captured status. Guard: if the plan is already terminal (`done`/`dropped`), skip the status edit and report. AND fill `## Post-Implementation Notes` with key outcomes, design pivots, and findings. **Then truncate `{{STATE_DIR}}/current.txt` to empty** so the active-task pointer reflects reality (no plan is currently active). This is the canonical path to mark a plan `done` (the `design` skill does NOT carry a `완료` natural-language trigger).
- **Roadmap sink** (only if `{{ROADMAP}}` exists and a `## Open` item has `Plan:` == this plan): mirror the item Status to the plan's terminal status, then move it from `## Open` to `## Recently Closed` (`- **id** → <plan> (done|dropped) · Task: <KEY>` — keep the item's Task as the trailing suffix when non-null, omit when taskless; trim to the most recent 10); clear the roadmap frontmatter `focus` if it names this item (Focus-clear rule — see /pm-roadmap Lifecycle). On `done`, also **harvest** each deferred item named in `## Post-Implementation Notes` into `## Open` as a new planless item (Status `open`, Priority `P2` or as noted, `Note` = the defer description, **`Task:` = the closed item's Task** so the follow-up stays grouped). A durable decision/gotcha worth recalling next session → add it as a **Memory note** to the retro-owned store `.agents/memory/<KEY>.md` (create with H1 `# <KEY>` if missing; ensure `.agents/.gitignore` has a `memory/` line first), bullet grammar: `- **<title>**` / `  - Note: <one-line>` / `  - Date: <YYYY-MM-DD>` — not the roadmap. If the task-context file still carries a legacy `## Memory` section, migrate it in the same pass (copy notes into the memory file → verify → delete the section). Markdown write only — never copy plan content into the roadmap.
- **Delete**: Remove file, update MEMORY.md index
- **Add**: Write new file (to memory/ or memory/private/ based on classification), update MEMORY.md or MEMORY.private.md index

After applying, show the diff of MEMORY.md to confirm index consistency. If a Roadmap sink ran, also run the invariant checker once (`/pm-roadmap validate`) and report its output — a read-only self-check of the just-written state.

## Rules

- Never add without counting existing items first (Budget Awareness)
- Never force insights from a routine session — "nothing to change" is a valid outcome
- Consolidation proposals MUST show the merged content for review
- Respect each store's format: global memory files (`{{TOOL_HOME}}/memory/*.md`) use frontmatter (name, description, type); per-task memory notes (`.agents/memory/<KEY>.md`) use the bullet grammar (`- **<title>**` / `Note:` / `Date:`)
- All file content in English (per feedback_memory_english.md)
- If unsure whether something is public or private, default to private
