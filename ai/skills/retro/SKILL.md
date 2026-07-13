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
So retro feeds **memory** and **backlog** back into the loop. The `complete` CLI journals
plan status, backlog→closed, and Deferred harvest as one recoverable transaction. After
that commit it best-effort clears only exact matching local pointers across managed
checkouts; cleanup failure is reported and never rolls back valid terminal state. Memory
remains retro's separate durable-decision sink through `memory add`.

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
root="$(git rev-parse --show-toplevel)" || exit 1
node "$HOME/.config/ai/lib/worktree.mjs" resolve-current --root "$root"
```

If `resolve-current` returns `ok`, re-root all collection to `execution_root` and compare
from immutable `base_commit`. Capture whether `pm_loop` is true. A routing/mapping error
blocks retro; never collect or close from the caller checkout. Linked and standalone
plans both close through the CLI transaction; neither uses a direct status edit.

If `/self-review` was run in this session, reference its findings (especially violations). Likewise, if `/verify` ran, reference its truth-condition verdict — a failed or partial verdict means the plan's goal was not fully met, which the close should account for.

### 2. Analyze

Answer these questions based on the collected data:

- What diverged from the plan (if one existed)?
- Was the same type of change repeated 3+ times in this session? (pattern signal)
- Were there false starts or wasted iterations? What would have prevented them?
- Did a manual workflow repeat that no skill covers, or that an existing skill should have owned? (missed-skill signal — flag a skill candidate; do NOT author it here)
- Was there a wrong turn a memory/rule would have prevented, had it existed? (missed-memory signal)
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

For **Consolidate** actions: show the proposed merged content inline so the user can judge quality.
For **Add** actions: show the full proposed file content.
For a **skill candidate** (missed-skill signal from Phase 2): list it as a one-line proposal only — retro never authors skills. Authoring is a separate `/design` or explicit user request.

Wait for the user to approve by number (e.g., "1,2,3" or "all" or "none").

### 5. Apply

Only apply approved items:

- **Consolidate**: Write merged file, delete the redundant file, update MEMORY.md index
- **Update plan body**: Fill `## Post-Implementation Notes` with key outcomes, design pivots, and findings. A plan under `{{PLAN_DIR}}/` is a design artifact, **not** a task-store file, so edit it directly with `Edit`. If follow-up workable units emerged, add a structured `## Deferred` block to the same plan so the close transaction harvests them into the task backlog (grammar below). Do **not** hand-edit the plan's `status:` here — the close step owns it.

  CLI setup (one block; `<id>` = the plan's frontmatter `id`):
  ```bash
  repo_root="$(git rev-parse --show-toplevel)" || { echo "not in a git repo"; exit 1; }
  (cd ~/.config/ai/skills/pm-roadmap && [[ -d node_modules ]] || npm install)
  pm() { PM_ROOT="$repo_root" ~/.config/ai/skills/pm-roadmap/node_modules/.bin/tsx ~/.config/ai/skills/pm-roadmap/pm-roadmap.ts "$@"; }
  pm get <id>   # resolves the owning task KEY + confirms the item is still open (linked path)
  ```

  `## Deferred` block grammar (harvested by `complete`; ids must be fresh kebab-case — a collision aborts the whole close):
  ```markdown
  ## Deferred

  - **<new-kebab-id>** — <title>
    - Priority: P2
    - Note: <one-line follow-up description>
  ```

- **Close the loop** — pick one path:
  - **Linked to a backlog item** (the pm loop — `pm get <id>` finds the item **still open** in a task backlog; `<id>` = the plan's frontmatter `id`, aligned 1:1 with the plan slug): run the atomic close transaction
    ```bash
    pm complete <KEY> <id> --plan <plan-path> --status done       # done path
    pm complete <KEY> <id> --plan <plan-path> --status dropped --reason "<why abandoned>"   # dropped path
    ```
    `complete` journals plan status, item close, and Deferred harvest together, then
    clears exact matching pointers best-effort. **Do NOT hand-edit plan status or
    current.** Preconditions fail before the journal is prepared.
  - **Standalone (`pm_loop:false`)**: `pm complete --standalone --plan <plan-path>
    --status done` (or dropped with a reason). It journals the plan-only transition and
    performs the same exact all-worktree pointer cleanup. Never edit status/current
    directly.
- **Harvest durable decisions → memory**: for each decision/gotcha worth recalling next session, write it to the task's memory store via the CLI (a separate write, outside the close transaction):
  ```bash
  pm memory <KEY> add "<note title>" --note "<one-line decision>" --date <YYYY-MM-DD>
  ```
  This upserts (by title) `.agents/tasks/<KEY>/memory.md` through ops (lock+CAS) — **never hand-edit it**. Surfaced in `pm next` prompts and item context. (Legacy `.agents/memory/<KEY>.md` files and in-file `## Memory` sections are migrated once by `pm migrate`, not by retro.)
- **Delete**: Remove file, update MEMORY.md index
- **Add**: Write new file (to memory/ or memory/private/ based on classification), update MEMORY.md or MEMORY.private.md index

After applying, show the diff of MEMORY.md to confirm index consistency. If the close transaction ran (linked path), also run the invariant checker once (`pm validate`) and report its output — a read-only self-check of the just-written task store.

## Rules

- Never add without counting existing items first (Budget Awareness)
- Never force insights from a routine session — "nothing to change" is a valid outcome
- Consolidation proposals MUST show the merged content for review
- Respect each store's format: global memory files (`{{TOOL_HOME}}/memory/*.md`) use frontmatter (name, description, type); per-task memory notes live at `.agents/tasks/<KEY>/memory.md`, written **only** via `pm memory <KEY> add` (never hand-edited) — block grammar `- **<title>**` / `Note:` / `Date:`
- All file content in English (per feedback_memory_english.md)
- If unsure whether something is public or private, default to private
