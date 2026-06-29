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
When invoked on a `pm-roadmap` backlog item, read that task's **context** (`/pm-context`: links) + **memory** (`/retro`: per-task decisions) + the item, then write the plan and link it back through the **`pm-roadmap.ts persist`** CLI — one transaction that creates/links the backlog item and points `current.txt` together. Outside the loop it just plans: a standalone plan carries `pm_loop: false` and is tracked in no backlog. (Plan storage: `{{PLAN_DIR}}/`; pointer: `{{STATE_DIR}}/current.txt`; per-task backlog: `.agents/tasks/<KEY>/`, written only via the CLI.)

## Context Discovery

Before starting, search for existing plan artifacts that may be relevant:

```bash
ls {{PLAN_DIR}}/ 2>/dev/null && grep -l "<relevant keywords>" {{PLAN_DIR}}/*.md 2>/dev/null
```

Match against the `description:` frontmatter field for highest signal-to-noise. Read related plans for context (prior decisions, lessons learned).

**Also consult the backlog** via the CLI — `pm-roadmap.ts list` (eligible items) or `pm-roadmap.ts get <id>` — to see whether this work is already a backlog item (pull its Priority/Note/owning task and any sibling decisions). If so, this design links back to that item at persist time. (CLI setup in Step 5; on a legacy repo the read prints a migrate hint instead.)

## Steps

### 1. Decompose

If 2+ independent subsystems exist, list them and ask which to start with.

For large, irreversible, or under-specified work, mention `/grill` before proposing approaches when intent alignment is the main risk; invoke it only if the user explicitly asks.

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
2. **Verifiable Success Criteria**: List the goal-level conditions that must hold for the work to count as done. Use a checkable table with these fields:

   | Condition | Proof command or observable | PASS condition |
   | --- | --- | --- |

   Each row must be specific enough for `/verify` to run or observe directly; generic prose or a command that can pass before the implementation exists is not sufficient. These seed `/verify`'s truth conditions — without them verify must re-derive the goal from scratch.
3. **Risks**: List what could break, what contract might be misread, and how each risk is bounded or mitigated.
4. **Tasks**: Use `- [ ]` checkboxes. Each step includes expected output (PASS/FAIL). During implementation, flip `- [ ]` → `- [x]` in the plan artifact the moment each step meets its PASS output — unconditionally, one step at a time.
5. If planned output differs from actual during implementation, investigate

### 5. Persist plan artifact (BEFORE implementation)

After the user approves the design (Step 3 approval = signal to persist) and **before any file writes that implement the plan**:

1. **Generate id slug** — kebab-case from title (lowercase, hyphens for spaces, ASCII only). Scan `{{PLAN_DIR}}/*.md` for existing `id:` fields. On collision, append `-2`, `-3`, etc.

2. **Check `{{STATE_DIR}}/current.txt` for conflict** — If it names a plan with `status: draft` or `status: active`, present three options to the user:
   - **(a)** Run `/retro` on the in-flight plan first — it closes the plan + its backlog item via the `complete` transaction (Post-Impl Notes, deferred harvest, pointer clear) — then persist the new one. (design never writes `done` directly; that transition is /retro-exclusive.)
   - **(b)** Park the in-flight plan and proceed: persisting the new plan repoints `current.txt`, so the previous plan + its backlog item become a parked draft/active (re-activate later by re-pointing `current.txt` at it). The "exactly one backlog item" invariant applies only to the *in-flight* plan, so a parked plan keeps its item without error.
   - **(c)** Cancel the new plan creation.

   If the existing plan is `done`/`dropped`, just proceed (persist overwrites the pointer).

   > **Note**: `current.txt` is a *pointer* naming the in-flight plan, unrelated to the `status:` value — a plan can be pointed-at while still `draft`. Do not conflate "pointing `current.txt`" with "promoting status to active". The `persist` CLI does the pointing for pm-loop plans.

3. **Create `{{PLAN_DIR}}/` directory** if it does not exist.

4. **Save plan as `{{PLAN_DIR}}/YYYY-MM-DD-<id>.md`** with this English frontmatter:

```yaml
---
id: <english-kebab-slug>
title: <English title, ~80 chars>
description: <English 1-2 sentence summary, ~150 chars — used for grep/search>
date: YYYY-MM-DD
status: draft
pm_loop: true
files_affected:
  - <file paths from implementation plan>
---
```

`pm_loop: true` = this plan is tracked in a `pm-roadmap` backlog (persisted in 5.5). Set `pm_loop: false` for a **standalone** plan (general /design, no backlog item) — it is then exempt from the "linked to exactly one backlog item" in-flight invariant, and 5.5 writes `current.txt` directly instead of calling `persist`.

Followed by the approved design content (Goal, Approach, Decisions, Verifiable Success Criteria, Risks, Implementation Steps).

5. **Link the plan to the backlog + point `current.txt` via the CLI.** The `id` slug doubles as the backlog item id (1:1 with the plan). Setup:

   ```bash
   repo_root="$(git rev-parse --show-toplevel)" || { echo "not in a git repo"; exit 1; }
   (cd ~/.config/ai/skills/pm-roadmap && [[ -d node_modules ]] || npm install)
   pm() { PM_ROOT="$repo_root" ~/.config/ai/skills/pm-roadmap/node_modules/.bin/tsx ~/.config/ai/skills/pm-roadmap/pm-roadmap.ts "$@"; }
   ```

   Pick the path that matches the backlog:
   - **The work is already a backlog item** (the canonical loop — you designed *for* an open item, e.g. one from `pm next`): link the plan, then point the pointer. Link first so the in-flight plan is never an orphan:
     ```bash
     pm plan <KEY> <id> "<plan-repo-rel-path>"                 # sets Plan + Status → draft
     printf '%s\n' "<plan-repo-rel-path>" > "$repo_root/.agents/state/current.txt"
     ```
   - **No backlog item yet** (ad-hoc design): one transaction creates + links + points. The owning task `<KEY>` is required — ask the user which; create it first if none exists:
     ```bash
     pm task create <KEY> --title "<task title>"              # only if the task does not exist yet
     pm persist <KEY> <id> "<plan-repo-rel-path>" --title "<plan title>"
     ```
     `persist` (→ `createPlanAndBacklogItem`) creates the item (Status `draft`, mirroring the plan) **and** points `current.txt`, atomically — no orphan mid-write. (`persist` rejects an id that is already a backlog item; relink an existing item with `plan` above.)

   **Never hand-edit any `tasks/*` file** — `plan`/`persist` are the only writers. The plan `status` stays `draft`; promotion to `active` is the `승인` trigger.

   **Standalone plan (`pm_loop: false`):** skip both — there is no backlog item. Point the pointer directly (`current.txt` is a state pointer, not a `tasks/*` file):
   ```bash
   mkdir -p "$repo_root/.agents/state" && printf '%s\n' "<plan-repo-rel-path>" > "$repo_root/.agents/state/current.txt"
   ```

6. **Append empty Post-Implementation section** to the plan:

```markdown
## Post-Implementation Notes

<!-- Filled by /retro if run after implementation -->
```

7. **Confirm to the user:** "saved as `<path>` — review and reply with **승인** (active 전환), **취소** (dropped), or further edits. Run `/retro` after implementation to mark the plan `done`." For high-risk, multi-file, architecture, irreversible, or unclear-scope plans, recommend `/plan-review` before `승인`; if review is intentionally skipped for cost, latency, auth, or low-risk reasons, record an explicit `SKIP` in the plan review loop instead of treating the skip as approval.

**Status values & lifecycle**: `draft` (just saved) → `active` (in progress) → `done` | `dropped` (terminal).

### 6. Backlog linkage invariants

Step 5.5 already wrote the linkage; these are the rules it satisfies — all enforced by ops (a violation throws, it is never silently written):

- **id == plan slug**, and **one item per plan path** (`Plan:` 1:1 across every task's backlog + closed). `persist`/`plan` reject a duplicate plan link or a reused id.
- The backlog item **Status mirrors the plan** (`draft` at persist; `active` after `승인`).
- A **real task `<KEY>` is required** — an inbox item is untriaged and cannot carry a plan or be made in-flight. Triage it first (`pm triage <id> <KEY>`); `persist`/`plan`/`focus` reject inbox items.

Skip for a standalone (`pm_loop: false`) plan — it has no backlog item.

### 7. Archive aged plans

**After** linkage (the new plan is current + linked and won't be touched), run the deterministic archiver to keep `{{PLAN_DIR}}/` small. It moves **terminal** (`done`/`dropped`) plans **≥ 30 days old** that are **unreferenced** (not named by `current.txt`, not any backlog item's `Plan:`) into `{{PLAN_DIR}}/archive/`, and rewrites each task's `closed.md` `Plan:` pointer so closed-join / GUI still resolve. Reference-protected and idempotent (safe to re-run; recovers a crash between move and pointer rewrite). The just-saved `draft` plan is never archived (it is current + non-terminal). No-ops on a repo with no task store.

```bash
repo_root="$(git rev-parse --show-toplevel)" || { echo "not in a git repo"; exit 1; }
(cd ~/.config/ai/skills/pm-roadmap && [[ -d node_modules ]] || npm install)
~/.config/ai/skills/pm-roadmap/node_modules/.bin/tsx ~/.config/ai/skills/pm-roadmap/archive.ts "$repo_root"
```

Report the archiver's output (moved / skipped). Add `--dry-run` to preview without moving, or `--today=YYYY-MM-DD` to pin the age cutoff.

## Rules

- Do NOT implement until user approves the design
- **Implement only against an `active` plan.** An explicit build instruction (`승인`/"구현해"/"최대한 작업해"/"ㄱㄱ") IS the `승인` trigger: promote `status: draft → active` (+ `pm approve <KEY> <id>`) first, then implement. A terse go-ahead is no excuse to skip section-by-section approval or a warranted `/grill`.
- Plan artifact is saved ONLY after explicit design approval (Step 3)
- **Plan artifact MUST be persisted (Step 5) BEFORE any implementation begins.** Saving the plan after implementation breaks the verify/retro contract (they read the in-flight plan via `current.txt`; the plan id is used for backlog linkage) and loses the pre-drift intent snapshot
- **ALWAYS check off implementation steps as you go.** The instant a step in `## Implementation Steps` lands (meets its PASS output), edit the plan to flip its `- [ ]` → `- [x]` — unconditionally, never batched at the end. The checkbox state is the live progress record `/verify` and `/retro` trust; stale checkboxes break that contract.
- The plan MUST carry a `## Verifiable Success Criteria` section (goal-level PASS/FAIL conditions). It is the seed `/verify` checks against — a plan whose goal isn't expressed as checkable conditions weakens the design→verify contract.
- The plan MUST carry a `## Risks` section before `## Implementation Steps`, so known breakage modes and mitigations are visible before implementation starts.
- No file writes during design exploration (Steps 1-3)
- If the user declines to save, skip Step 5 — the plan remains conversation-only
- Frontmatter MUST be English. Body content can be Korean.
- The `branch` field is NOT in the schema. Git tracks branch separately.
- Inline `#` comments in frontmatter are NOT used (natural-language triggers replace them).

## Status Update Triggers (post-creation)

After `current.txt` points to a `draft` plan, watch for explicit user replies that promote or conclude it:

| User trigger       | Action                                         |
| ------------------ | ---------------------------------------------- |
| `승인` / `approve` | Edit plan frontmatter `status: draft → active`, then mirror the item: `pm approve <KEY> <id>` (item Status → `active`). |
| `취소` / `cancel`  | Edit plan frontmatter `status: → dropped`, then `pm close <KEY> <id> --status dropped --reason "<why>"` (moves the item to `closed.md`; the op clears `focus`), then truncate `current.txt`. |

**Backlog mirror (pm-loop plans):** the backlog item Status must mirror the plan, so each trigger pairs the plan-frontmatter edit with a CLI op (reuse the `pm` helper from Step 5.5). On `승인` → `pm approve <KEY> <id>`. On `취소` → `pm close <KEY> <id> --status dropped --reason "<why>"` then truncate `current.txt`. The ops take the lock; the plan-frontmatter edit is a direct write (a plan file is a design artifact, not a `tasks/*` file). For a **standalone** (`pm_loop: false`) plan there is no item — edit only the plan frontmatter (+ truncate `current.txt` on 취소).

> The `done` transition is **delegated to `/retro`**. `/retro` Phase 5 closes the plan + item via the `complete` transaction together with `## Post-Implementation Notes`. Do NOT add a `완료` / `done` natural-language trigger here.

> Only the `current.txt`-pointed plan is trigger-eligible. A parked plan (Step 5 option (b)) becomes eligible again by re-pointing `current.txt` at its repo-relative path — a direct one-line write; no new plan artifact is created.

**Hard rules:**

- Trigger fires ONLY when `state/current.txt` points to a plan with status `draft` or `active`. If `current.txt` is empty or missing, treat user reply as normal conversation — do NOT modify any plan file.
- NEVER infer status changes from context (e.g., "looks done", "I think we finished"). Status changes ONLY on the explicit trigger words above (or `/retro` for the `done` path).
- NEVER change status silently. Always confirm in the response: "✅ status: draft → active".
- After `취소` (status → dropped), **truncate `{{STATE_DIR}}/current.txt` to empty** so no plan is pointed at. Same convention applies to `/retro`'s `done` transition (handled inside retro/SKILL.md). The state pointer is non-empty ONLY while a `draft` or `active` plan exists.
- Use the `Edit` tool with a precise multi-line `old_string` (e.g., the full frontmatter block around the `status:` line) to avoid mismatches when other plans share the same status value.
