---
name: pm-roadmap
description: "Manage a project's cross-plan backlog SSOT (.agents/ROADMAP.md) and generate next-task session prompts. TRIGGER when: asked for the backlog/roadmap, what to work on next, or a kickoff prompt for the next task ('다음 작업' / '백로그' / '다음 세션 프롬프트' / 'what's next' / 'roadmap'); or to add/close/focus a backlog item. Reads are model-invocable; writes also fire automatically from /design (persist, 승인, 취소) and /retro lifecycle gates. SKIP: single-file edits with no backlog; planning a specific task (use /design); closing a plan (use /retro)."
argument-hint: "init | add <id> <title> [-p P0..P3] [--task <KEY>] [-o N] | list | tree | get [id] | set <id> | link <id> <field> <value> | close <id> [--drop] | next [id] [--set] | validate | manage"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
model: sonnet
disable-model-invocation: false
---

Manage the per-project backlog SSOT at `{{ROADMAP}}` — a pointer-based join index sitting above `/pm-context`, `/design`, and `/retro`.

Arguments: $ARGUMENTS

## System — the pm-* loop

One of four skills in a single project-management system. **This skill owns *backlog*.**

```
(pm-context · context)  ┐
(retro · memory)         ├──▶  (design · plan)
(pm-roadmap · backlog)  ┘          │
        ▲__________________________│   retro closes the item, feeds memory + backlog back
```

- **pm-context** → *context*: per-task external links.
- **retro** → *memory*: durable per-task decisions/learnings (harvested when work lands).
- **pm-roadmap** → *backlog*: cross-task work items, prioritized/ordered (this skill).
- **design** → *plan*: one artifact per backlog item, reading context + memory + backlog.

`design`/`retro` are general-purpose skills; here they are the plan/memory engines of this loop. Ownership rule: each fact in the smallest file enforcing its invariant, views derived. (memory is retro-owned, stored at `.agents/memory/<KEY>.md`; legacy task-context `## Memory` sections are read as union back-compat.)

## Concept

The roadmap is a **cross-plan backlog**: dated plans (`{{PLAN_DIR}}/*.md`) close and their deferred work would otherwise be orphaned, so the roadmap is the durable home for "what is still open / what is next". It **stores only backlog items + status + pointers** — never copies plan or task-context content. A reader (the LLM via `get`/`next`, or the dashboard) assembles an item's full picture by **resolving its pointers at read time**.

**Structure: task → (context | backlog).** Each backlog item belongs to a **task** (a `/pm-context` KEY). That task carries the item's **context** — external `Links` *and* internal `Memory` (decisions/things to remember) — in its task-context file. So a task is a unit of work whose context (links+memory) and backlog (items) are joined by the `Task:` field, not merged into one file.

The roadmap is the **source** of `/design` (pick the next item, plan it) and the **sink** of `/retro` (close the landed item, harvest new defers).

## Model & storage criterion

**One rule decides where every fact lives:** *store each fact in the smallest file whose owner can enforce its strongest invariant; never store a derived view — compute views at read time.*

| Fact | Lives in | Strongest invariant (= why there) |
|---|---|---|
| Links | `task-context/<KEY>.md` (per-task) | task-**local** reference material |
| Memory | `.agents/memory/<KEY>.md` (per-task, retro-owned) | task-**local** durable decisions |
| **Backlog items** | **`{{ROADMAP}}` — one file** (each `Task:`-tagged) | **project-wide scheduling**: global priority, "what's next across all tasks", unique id, unique plan pointer — only enforceable in one ledger |
| Plan | `{{PLAN_DIR}}/*.md` (per-plan) | execution history / checklist / post-impl notes |
| in-flight pointer | `{{STATE_DIR}}/current.txt` | singleton |
| cross-task roadmap view | **not stored — derived** by filtering the ledger | a view, not a fact |

So `{{ROADMAP}}` is a **backlog ledger**, not a rendered roadmap: task-local stuff is per-task, the cross-task work queue is one ledger, plans own history, views are derived. (Legacy `Context:`/`Parent:` are read for back-compat but **never written** — new writes use `Task:` only.)

## Granularity — backlog items are *workable units*

A backlog item is **one workable unit**: a chunk of work that can be planned (`/design`) and finished in roughly one focused effort — independently shippable/testable.

- **Task = the epic/feature** (e.g. `BRAND_SERIES`); **items = the workable units inside it** (e.g. `brand-series-types`, `brand-series-datasource`, `brand-series-fe`).
- **Do NOT create an umbrella/epic item** that just restates the task — that role belongs to the Task itself. (Anti-pattern: a `brand-series` item sitting beside its own sub-units.)
- **Too big** (needs multiple plans / can't finish in one go) → split into ordered units. **Too small** (a single file tweak, no standalone value) → fold into a sibling.
- Sequence dependent units with `Order:` (1=first); independent units can share/omit order.

When `add`-ing or harvesting defers, phrase each as a workable unit; if asked to add something epic-sized, split it into units (and set `Order:`).

## File Format

`{{ROADMAP}}` is the single source of truth. One file per project, at the git root.

```markdown
---
project: <repo-basename>
focus: <item-id or empty>
updated: YYYY-MM-DD
---

# <project> — Backlog

## Open

- **<id>** — <one-line title>
  - Priority: P0
  - Status: active
  - Order: <N>            # optional; work sequence within the task (1=first). Omit/0 = file order
  - Task: <task-context KEY or _INBOX>
  - Plan: <{{PLAN_DIR}}/YYYY-MM-DD-<slug>.md or ->
  - Note: <one-line still-open hint>

## Recently Closed

- **<id>** → <{{PLAN_DIR}}/...md> (done) · Task: <KEY>
- **<id>** → <{{PLAN_DIR}}/...md> (dropped) · Task: <KEY>
- **<id>** → dropped · <Note> · Task: <KEY>
```

Two record forms: **plan-linked** (`→ <plan> (done|dropped)` — the plan is the durable record) and **planless-dropped** (`→ dropped · <Note>` — no plan exists, so the Note is the archived one-line record). Each form **optionally ends with a ` · Task: <KEY>` suffix** — the owning task at close time. **Every close writer (design 취소 mirror, /retro sink, manual `close`, GUI planless drop) MUST append it when the source item's task is non-null**; omit it for taskless items — never write `Task: _INBOX`. Parsers strip the anchored tail suffix BEFORE matching the two forms (a Note may itself contain `·`); legacy suffix-less records read as task-unknown (null). Closed Task gets the same V9 warn-only validation as open.

### Field rules

- **id**: required, unique within file. Kebab-case (lowercase ASCII, hyphens). The roadmap's **own** namespace. When an item is planned, set the item id equal to the plan's `id` slug so the two line up — but the id is NOT assumed equal to any task-context KEY.
- **Priority**: `P0` | `P1` | `P2` | `P3`. Default `P2` on `add`.
- **Status**: `open` | `draft` | `active` | `done` | `dropped`. See Status model.
- **Order**: optional integer = the **work sequence within the task** (1 = do first). The dashboard renders a task's backlog as a numbered timeline sorted by `Order`; items without it fall back to file order. It is **sequence, not a timestamp** — registration time is not tracked. Set via `link <id> Order <n>` or in the file.
- **Task**: the owning task-context KEY (uppercase, its own grammar — `<git-root>/.agents/task-context/<KEY>.md`), or the virtual **`_INBOX`** for untriaged items (no task-context file; **not designable** until reassigned via `link <id> Task <KEY>`). Legacy `-` is read as an `_INBOX` alias but never written. **This is the grouping**: a backlog item belongs to one task, and that task's `Links` + `Memory` (task-context) are the item's context. Items with the same `Task` are siblings (computed, never stored). The model is **task → (context | backlog)**.
- **Plan**: pointer to a plan file path, or `-`. **At most one item may point to a given plan** (1:1). Set automatically by `/design` persist.
- **Note**: one-line "why this is still open" re-eval hint. **Three distinct note kinds, one owner each** — `Note` = the item's open hint (roadmap); **task `Memory`** = durable per-task decisions/gotchas (task-context); **plan `## Post-Implementation Notes`** = historical outcome of one plan (plan file). Don't duplicate across them.

A backlog item's **context = its task's Links + Memory** — Links from `<git-root>/.agents/task-context/<Task>.md`, Memory from the retro-owned `<git-root>/.agents/memory/<Task>.md` (a legacy task-context `## Memory` section is read as union back-compat, never written). "What we learned" also flows through `Plan` → the plan's `## Post-Implementation Notes`. Never point the roadmap at global `{{TOOL_HOME}}/memory`.

### Parser

- Same block grammar as `/pm-context` (`- **id**` opens an entry, `  - Key: Value` sub-bullets), but a **separate parser** (`roadmap.ts`, not task-context's `parseTaskMd`, which is URL-only and would drop these fields).
- Unknown sub-bullet keys are ignored (forward compatibility).
- `## Open` holds items with Status ∈ {open, draft, active}. `## Recently Closed` holds {done, dropped} in the two record forms above (plan-linked `(done|dropped)` / planless-dropped), trimmed to the most recent 10. Full history lives in git + the linked plans.

## Status model

- **Single owner.** When `Plan:` is set, the item Status **mirrors the plan's frontmatter status verbatim** (draft→draft, active→active, done→done, dropped→dropped). Only a **planless** item (no `Plan:`) owns its own `open` status directly.
- A planless item cannot become `done` (no work artifact exists). It may only be `dropped` (abandoned idea), or acquire a `Plan:` via `/design` and then reach `done`.
- This is what eliminates status dual-ownership: the plan frontmatter and the roadmap never independently assert the same fact.

## Lifecycle (automatic — implemented in /design and /retro)

The roadmap is written automatically at four deterministic moments so 대협 never types the mutating subcommands. These hooks live in `/design` and `/retro`; this skill documents the contract.

| Moment (in /design or /retro) | Roadmap write |
|---|---|
| design **persist** (Step 5, after design approval) | create item (or update the existing item already linked to this plan — idempotent) + set `Plan:`; item Status mirrors plan = `draft` |
| **`승인`** trigger | plan draft→active → item Status `active` |
| **`취소`** trigger (plan→dropped) | item Status `dropped` → move to `## Recently Closed` |
| **`/retro`** apply (plan→done or dropped) | item Status mirrors → move to `## Recently Closed`; on `done`, harvest the plan's Post-Impl Notes defers into `## Open` as new items |

`focus` (frontmatter) is distinct from `{{STATE_DIR}}/current.txt`: `current.txt` names the in-flight **plan**; `focus` names the intended-next **backlog item** (which may be planless). They answer different questions and never conflict.

**Focus-clear rule**: any write that moves an item out of `## Open` (design `취소` mirror, /retro sink, manual `close`, GUI planless drop) MUST also clear frontmatter `focus` if it names that item — `focus` never dangles on a closed item.

## Subcommands

### init
Create `{{ROADMAP}}` at the git root if absent: frontmatter (`project`=repo basename, `focus` empty, `updated`=today) + empty `## Open` + `## Recently Closed`. Refuse outside a git repo.

### add `<id> <title> [-p P0..P3] [--task <KEY>] [-o N]`
Append a planless **workable unit** to `## Open` (Status `open`, Priority default `P2`). Reject duplicate id. With `--task`, set the owning task; without it, the item lands in the virtual `_INBOX` (untriaged); with `-o`, the work `Order`. **Granularity gate**: if the request is epic-sized or just restates the task, split it into ordered workable units instead of adding one umbrella item (see Granularity).

### list / tree
`list`: print `## Open` grouped by Priority (P0→P3), `focus` marked. `tree`: group items under their `Task`.

### get `[id]`
Inject an item's **join view** into the current session: resolve `Plan` (Goal + next unchecked step), the **task's `Links` + `Memory`** (its context), same-task done-sibling Post-Impl Notes (inherited decisions), and `Note`. id from arg, else `focus`. Read-only.

### set `<id>`
Set frontmatter `focus` to `<id>` (intended-next backlog item). Read of the item must succeed first.

### link `<id> <field> <value>`
Manually set one pointer/field (`Plan`/`Task`/`Priority`/`Order`/`Note`). Escape hatch — the lifecycle normally sets `Plan`/`Status` automatically. Use `link <id> Order <n>` to sequence a task's backlog.

### close `<id> [--drop]`
Move an item to `## Recently Closed`. Normally `/retro` does this; manual is the escape hatch. Guards:

- **Planless item**: may only close with `--drop` (dropped). `done` is impossible — no work artifact exists.
- **Plan-linked item**: closeable ONLY when its plan's frontmatter status is already terminal (`done`/`dropped`) — the close records that same status. If the plan is still `draft`/`active`, refuse and point to `/retro` (or `취소` via /design). Manual close never writes a status the plan does not hold (single-owner mirror, see Status model).

The closed record keeps the item's `Task:` as the ` · Task: <KEY>` suffix (File Format) when non-null. Apply the Focus-clear rule (Lifecycle) when moving the item.

### next `[id] [--set]`
The read-side flagship — generate a **paste-ready session kickoff prompt** for the next task.

1. **Select target**: `id` arg → `focus` → else eligible item. **Eligibility respects per-task sequence**: an item is blocked while an earlier-`Order` item in the **same task** is still open; **`_INBOX` items are never auto-selected** (not designable until triaged — when any exist, append `inbox: N items awaiting triage` to the output). Among eligible, sort by Priority (P0→P3), then `Order`, then file order. Edge branches:
   - **No eligible item**: emit no kickoff block — report why ("backlog empty — add items via `add`" or "all open items blocked by earlier-Order siblings") and stop.
   - **Invalid explicit `id`**: if the `id` arg names a missing/closed item, report it and STOP — an explicit argument is a user assertion; never silently substitute another item.
   - **Dangling `focus`**: if `focus` names a missing/closed item, report it and fall back to normal eligibility selection. `next` stays read-only — it never clears `focus` itself (cleanup belongs to the Focus-clear rule's lifecycle writes); `next --set` may overwrite the dangling value with the new target.
2. **Resolve pointers** (read-time, never copied): target `Plan` → Goal + next unchecked step (or "no plan yet"); the **task's `Memory`** (decisions to remember) and **`Links`**; same-task **done siblings' plans → Post-Impl Notes**; `Note`.
3. **Emit** a fenced kickoff block and copy it to the clipboard (reuse the `/copy` mechanism). Shape:

   ```
   # Next: <id> — <title>  (Px)

   ## What
   <Note / one-line goal>

   ## Task memory (decisions / things to remember)
   - <memory title>: <note>

   ## Inherited (done siblings)
   - <sibling outcome / Post-Impl Notes excerpt>

   ## External refs (task-context: <Task>)
   - <Label>: <URL> — <Summary>   (or: /pm-context get <Task>)

   ## Prior plan state
   - <plan path> (status) → next step: <…>   (or: no plan — start with /design <id>)

   ## Start here
   <if no plan> /design <id>
   <if active plan> resume at the next unchecked step above
   ```
4. Default **read-only** (generates a prompt; mutates nothing). `--set` also writes `focus = <id>`. The prompt is regenerated fresh each call — never stored.

### validate
Run the read-only invariant checker over `{{ROADMAP}}` and its joins (plans, `{{STATE_DIR}}/current.txt`, task-context):

```bash
repo_root="$(git rev-parse --show-toplevel)" || { echo "not in a git repo"; exit 1; }
(cd ~/.config/ai/skills/pm-roadmap && [[ -d node_modules ]] || npm install)
~/.config/ai/skills/pm-roadmap/node_modules/.bin/tsx ~/.config/ai/skills/pm-roadmap/validate.ts "$repo_root"
```

Checks (error): V1 `Plan:` 1:1 · V2 plan path exists · V3 status verbatim mirror · V4 section membership · V5 planless-only-`open` · V6 focus names an `## Open` item · V7 `current.txt` points to a draft|active plan · V8 id unique+kebab. Warns: V9 Task KEY grammar / task-context file missing · V10 Recently-Closed trim>10. Exit 1 on any error. **Never mutates** — fix violations via the owning paths (/retro, design triggers, manual `close`). `/retro` runs this once automatically after its Roadmap sink.

### manage
Open the dashboard GUI (the `/pm-context` server extended with a roadmap Editorial Ledger view). Capture the git root **before** changing directories. **Always kill an already-running server first** (never reuse it — it may serve another repo root or stale code), then launch:

```bash
repo_root="$(git rev-parse --show-toplevel)" || { echo "not in a git repo"; exit 1; }
kill $(lsof -ti:8484 2>/dev/null) 2>/dev/null; sleep 1   # always restart; never reuse a running server
cd ~/.config/ai/skills/pm-context && [[ -d node_modules ]] || npm install
TASK_CONTEXT_ROOT="$repo_root" ./node_modules/.bin/tsx server.ts   # run_in_background
```

> A background server from an earlier session exiting (code 0 / SIGTERM) after a newer `manage` launch is **expected replacement, not a crash**. Never auto-relaunch on that notification — check the port first (`lsof -ti:8484`); a live listener means the replacement is already serving.

Then open `http://localhost:8484`. The dashboard renders the join + a `▸next` button (same `next` logic) and **drops planless items** (`POST /api/roadmap/:id/drop`, atomic temp+rename; the server also applies the Focus-clear rule when dropping the focused item). It refuses to close **plan-linked** items (those go through `/retro` to stay in sync). All other roadmap mutations stay on the skill / design / retro markdown path.

## Rules

- All file content English; quoted triggers may stay Korean.
- **Writers**: this skill + `/design` + `/retro` mutate `{{ROADMAP}}` via markdown (temp+rename atomicity). The GUI writes the roadmap **only to drop a planless item** (same atomic write); plan-linked closes always route to `/retro` (no GUI desync). The exception is planless-only because a planless item carries no plan-mirror fact to desync — do NOT widen it to plan-linked items.
- Never copy plan/task-context/memory content into the roadmap — pointers only.
- Reads (`list`/`tree`/`get`/`next`) are safe to auto-invoke. Mutations come from the lifecycle gates or explicit subcommands, never from fuzzy NL.
- Item id is kebab-case and its own namespace; `Task` is the owning task-context KEY (differently-formatted), and that task's Links+Memory are the item's context.
