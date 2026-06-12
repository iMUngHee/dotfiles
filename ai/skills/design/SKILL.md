---
name: design
description: "Design and plan implementation for multi-file changes or architecture decisions. TRIGGER when: asked to design, plan, or architect a solution; change expected across 3+ files; new architecture decision; scope ambiguous; user says '설계해' / 'design this'. SKIP: single-file bug fixes; renames or typos; small refactors with clear scope."
argument-hint: "[task description]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
model: opus
effort: max
disable-model-invocation: false
---

Design and plan implementation for the given task.

Task: $ARGUMENTS (if empty, ask the user)

## System — role in the pm-* loop

`design` is a **general-purpose** planning skill (any multi-file change). It is also the **plan** node of the project-management loop:

```
(pm-context · context | retro · memory | pm-roadmap · backlog)  ──▶  design · plan
```
When invoked on a `pm-roadmap` backlog item, read that task's **context** (`/pm-context`: links) + **memory** (`/retro`: per-task decisions) + the item, then write the plan and link it back (`Task:`/`Plan:`). Outside the loop it just plans. (Plan storage: `{{PLAN_DIR}}/`; pointer: `{{STATE_DIR}}/current.txt`.)

## Context Discovery

Before starting, search for existing plan artifacts that may be relevant:

```bash
ls {{PLAN_DIR}}/ 2>/dev/null && grep -l "<relevant keywords>" {{PLAN_DIR}}/*.md 2>/dev/null
```

Match against the `description:` frontmatter field for highest signal-to-noise. Read related plans for context (prior decisions, lessons learned).

**Also consult the backlog** if `{{ROADMAP}}` exists: read it to see whether this task is already a `## Open` item (pull its Priority/Note/Task and any sibling decisions). If so, this design will link back to that item at persist time.

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

### 4. Implementation plan (presentation only — no execution yet)

After design approval, present the implementation plan as response text. **Do NOT begin executing edits in this step.**

1. **File Structure**: Map Create/Modify/Test files with responsibilities
2. **Tasks**: Use `- [ ]` checkboxes. Each step includes expected output (PASS/FAIL). During implementation, flip `- [ ]` → `- [x]` in the plan artifact the moment each step meets its PASS output — unconditionally, one step at a time.
3. If planned output differs from actual during implementation, investigate

### 5. Persist plan artifact (BEFORE implementation)

After 대협 approves the design (Step 3 approval = signal to persist) and **before any file writes that implement the plan**:

1. **Generate id slug** — kebab-case from title (lowercase, hyphens for spaces, ASCII only). Scan `{{PLAN_DIR}}/*.md` for existing `id:` fields. On collision, append `-2`, `-3`, etc.

2. **Check `{{STATE_DIR}}/current.txt` for conflict** — If the file exists and points to a plan with `status: draft` or `status: active`, present three options to 대협:
   - **(a)** Run `/retro` on the existing plan first — it closes the plan `done` with Post-Impl Notes, roadmap sink, and defer harvest — then swap the pointer to the new one. (design never writes `done` directly; that transition is /retro-exclusive.)
   - **(b)** Demote the existing plan to `draft` (preserved but not pointed-at) and proceed. If `{{ROADMAP}}` exists and an item has `Plan:` == the existing plan, mirror its Status `active → draft` (it stays in `## Open`).
   - **(c)** Cancel the new plan creation

   If existing plan is `done` or `dropped`, just overwrite the state pointer.

   > **Note**: `current.txt` is a *pointer* file naming the in-flight plan. It is unrelated to the `status: active` value — a plan can be pointed-at while still in `draft`. Do not conflate "writing to `current.txt`" with "promoting status to active".

3. **Create `{{PLAN_DIR}}/` directory** if it does not exist.

4. **Save plan as `{{PLAN_DIR}}/YYYY-MM-DD-<id>.md`** with this English frontmatter:

```yaml
---
id: <english-kebab-slug>
title: <English title, ~80 chars>
description: <English 1-2 sentence summary, ~150 chars — used for grep/search>
date: YYYY-MM-DD
status: draft
files_affected:
  - <file paths from implementation plan>
---
```

Followed by the approved design content (Goal, Approach, Decisions, Implementation Steps).

5. **Create `{{STATE_DIR}}/` directory if needed and update `{{STATE_DIR}}/current.txt`** with the new plan's repo-relative path on a single line. **The plan's `status` stays `draft` — this step only points at it; promotion to `active` happens later via the `승인` trigger.**

   ```
   {{PLAN_DIR}}/2026-05-07-<id>.md
   ```

6. **Append empty Post-Implementation section** to the plan:

```markdown
## Post-Implementation Notes

<!-- Filled by /retro if run after implementation -->
```

7. **Confirm to 대협:** "saved as `<path>` — review and reply with **승인** (active 전환), **취소** (dropped), or further edits. Run `/retro` after implementation to mark the plan `done`."

**Status values & lifecycle**: `draft` (just saved) → `active` (in progress) → `done` | `dropped` (terminal).

### 6. Roadmap linkage (only if `{{ROADMAP}}` exists)

Right after persisting the plan and pointing `current.txt`, link the plan to the backlog (markdown write only — single-writer discipline):

- If a `## Open` item already has `Plan:` == this plan path → do nothing (idempotent).
- Else if an item matches this work (id == plan id slug, or 대협 names one) → set its `Plan:` to the new path. Its Status now mirrors the plan = `draft`.
- Else create a new `## Open` item: id = plan id slug, title from the plan title, Priority asked-or-`P2`, `Plan:` = path, **`Task:` = the owning task-context KEY** — a **real KEY is required** (ask 대협 which; if none exists, create the task first). Never persist a plan-linked item into `_INBOX`: inbox items are untriaged ideas and must be reassigned (`link <id> Task <KEY>`) before design. Status mirrors = `draft`.

Each plan path appears as `Plan:` in **at most one** item. Skip this step entirely when `{{ROADMAP}}` does not exist.

## Rules

- Do NOT implement until user approves the design
- Plan artifact is saved ONLY after explicit design approval (Step 3)
- **Plan artifact MUST be persisted (Step 5) BEFORE any implementation begins.** Saving the plan after implementation breaks the verify/retro contract (they look up plans by id) and loses the pre-drift intent snapshot
- **ALWAYS check off implementation steps as you go.** The instant a step in `## Implementation Steps` lands (meets its PASS output), edit the plan to flip its `- [ ]` → `- [x]` — unconditionally, never batched at the end. The checkbox state is the live progress record `/verify` and `/retro` trust; stale checkboxes break that contract.
- No file writes during design exploration (Steps 1-3)
- If 대협 declines to save, skip Step 5 — the plan remains conversation-only
- Frontmatter MUST be English. Body content can be Korean.
- The `branch` field is NOT in the schema. Git tracks branch separately.
- Inline `#` comments in frontmatter are NOT used (natural-language triggers replace them).

## Status Update Triggers (post-creation)

After `current.txt` points to a `draft` plan, watch for explicit user replies that promote or conclude it:

| User trigger       | Action                                         |
| ------------------ | ---------------------------------------------- |
| `승인` / `approve` | Edit plan frontmatter `status: draft → active` |
| `취소` / `cancel`  | Edit plan frontmatter to `status: dropped`     |

**Roadmap mirror (only if `{{ROADMAP}}` exists and an item has `Plan:` == this plan):** on `승인`, set that item Status `active`. On `취소`, set Status `dropped` and move it from `## Open` to `## Recently Closed` (`- **id** → <plan> (dropped) · Task: <KEY>` — keep the item's Task as the trailing suffix when non-null, omit when taskless); clear the roadmap frontmatter `focus` if it names this item (focus-clear rule — see /pm-roadmap Lifecycle). Markdown write only; never copy plan content.

> The `done` transition is **delegated to `/retro`**. `/retro` Phase 5 Apply marks the plan `done` together with `## Post-Implementation Notes`. Do NOT add a `완료` / `done` natural-language trigger here.

> Only the `current.txt`-pointed plan is trigger-eligible. A parked `draft` plan (e.g. demoted via Step 5 option (b)) becomes eligible again by re-pointing `current.txt` at its repo-relative path — a direct one-line write; no new plan artifact is created.

**Hard rules:**

- Trigger fires ONLY when `state/current.txt` points to a plan with status `draft` or `active`. If `current.txt` is empty or missing, treat user reply as normal conversation — do NOT modify any plan file.
- NEVER infer status changes from context (e.g., "looks done", "I think we finished"). Status changes ONLY on the explicit trigger words above (or `/retro` for the `done` path).
- NEVER change status silently. Always confirm in the response: "✅ status: draft → active".
- After `취소` (status → dropped), **truncate `{{STATE_DIR}}/current.txt` to empty** so no plan is pointed at. Same convention applies to `/retro`'s `done` transition (handled inside retro/SKILL.md). The state pointer is non-empty ONLY while a `draft` or `active` plan exists.
- Use the `Edit` tool with a precise multi-line `old_string` (e.g., the full frontmatter block around the `status:` line) to avoid mismatches when other plans share the same status value.
