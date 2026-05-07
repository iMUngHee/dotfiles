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

## Context Discovery

Before starting, search for existing plan artifacts that may be relevant:

```bash
ls {{PLAN_DIR}}/ 2>/dev/null && grep -l "<relevant keywords>" {{PLAN_DIR}}/*.md 2>/dev/null
```

Match against the `description:` frontmatter field for highest signal-to-noise. Read related plans for context (prior decisions, lessons learned).

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
2. **Tasks**: Use `- [ ]` checkboxes. Each step includes expected output (PASS/FAIL)
3. If planned output differs from actual during implementation, investigate

### 5. Persist plan artifact (BEFORE implementation)

After 대협 approves the design (Step 3 approval = signal to persist) and **before any file writes that implement the plan**:

1. **Generate id slug** — kebab-case from title (lowercase, hyphens for spaces, ASCII only). Scan `{{PLAN_DIR}}/*.md` for existing `id:` fields. On collision, append `-2`, `-3`, etc.

2. **Check `{{STATE_DIR}}/current.txt` for conflict** — If the file exists and points to a plan with `status: draft` or `status: active`, present three options to 대협:
   - **(a)** Mark the existing plan `done` and swap to the new one
   - **(b)** Demote the existing plan to `draft` (preserved but not pointed-at) and proceed
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

## Rules

- Do NOT implement until user approves the design
- Plan artifact is saved ONLY after explicit design approval (Step 3)
- **Plan artifact MUST be persisted (Step 5) BEFORE any implementation begins.** Saving the plan after implementation breaks the verify/retro contract (they look up plans by id) and loses the pre-drift intent snapshot
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

> The `done` transition is **delegated to `/retro`**. `/retro` Phase 5 Apply marks the plan `done` together with `## Post-Implementation Notes`. Do NOT add a `완료` / `done` natural-language trigger here.

**Hard rules:**

- Trigger fires ONLY when `state/current.txt` points to a plan with status `draft` or `active`. If `current.txt` is empty or missing, treat user reply as normal conversation — do NOT modify any plan file.
- NEVER infer status changes from context (e.g., "looks done", "I think we finished"). Status changes ONLY on the explicit trigger words above (or `/retro` for the `done` path).
- NEVER change status silently. Always confirm in the response: "✅ status: draft → active".
- After `취소` (status → dropped), **truncate `{{STATE_DIR}}/current.txt` to empty** so no plan is pointed at. Same convention applies to `/retro`'s `done` transition (handled inside retro/SKILL.md). The state pointer is non-empty ONLY while a `draft` or `active` plan exists.
- Use the `Edit` tool with a precise multi-line `old_string` (e.g., the full frontmatter block around the `status:` line) to avoid mismatches when other plans share the same status value.
