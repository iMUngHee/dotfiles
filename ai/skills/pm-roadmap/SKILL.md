---
name: pm-roadmap
description: "Manage a project's per-task backlog (task-first model under .agents/tasks/) and generate next-task session prompts. TRIGGER when: asked for the backlog/roadmap, what to work on next, or a kickoff prompt for the next task ('다음 작업' / '백로그' / '다음 세션 프롬프트' / 'what's next' / 'roadmap'); or to add/close/focus a backlog item. Reads are model-invocable; writes also fire automatically from /design (persist, 승인, 취소) and /retro lifecycle gates. SKIP: single-file edits with no backlog; planning a specific task (use /design); closing a plan (use /retro)."
argument-hint: "list | tree | get <id> | next [id] | recent | validate | migrate [--apply] | task <create|done|archive|restore> <KEY> | add <id> <title> (--task KEY | --inbox) [-p P0..P3] [-o N] [--note T] | plan <KEY> <id> <path> | reprioritize <KEY> <id> <P0..P3> | reorder <KEY> <id> <N> | approve <KEY> <id> | close <KEY> <id> --status done|dropped [--reason R] | drop <KEY> <id> --reason R | triage <id> <KEY> | focus <id>|--clear | memory <KEY> add <title> [--note T] [--date YYYY-MM-DD] | links <KEY> add <label> --url U [--triggers C] [--summary S] | links <KEY> remove <match> | current-task | manage"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
model: sonnet
disable-model-invocation: false
---

Manage the per-project backlog in the **task-first model**: each task owns its backlog,
its unbounded closed history, its links and memory, under `<git-root>/.agents/tasks/<KEY>/`.

Arguments: $ARGUMENTS

## System — the pm-* loop

One of four skills. **This skill owns *backlog* + the shared task store.**

```
(pm-context · links)  ┐
(retro · memory)       ├──▶  (design · plan)
(pm-roadmap · backlog) ┘          │
        ▲__________________________│   retro closes the item, feeds memory + backlog back
```

A **task** (`<KEY>`) is a first-class record — an epic/feature with a lifecycle. Its
**items** are the workable units inside it. A task owns: `task.md` (status), `backlog.md`
(open items), `closed.md` (done/dropped history, **unbounded**), `links.md` (pm-context),
`memory.md` (retro). The cross-task roadmap is **derived at read time** by scanning
`tasks/*` — there is no single roadmap file.

## Model & storage

```
.agents/
  tasks/
    <KEY>/  task.md  backlog.md  closed.md  links.md  memory.md
    _INBOX → inbox.md           # untriaged items (not designable, excluded from next)
    archive/<KEY>/              # torn-down tasks (writes refused; ids stay reserved)
    .lock                       # advisory transaction lock
  plans/*.md                    # design plans (frontmatter `pm_loop: true|false`)
  state/  current.txt  focus.txt
```

- **task.md**: `status: active | done | archived`. `done` when all items closed; auto-reopens
  to `active` when a new item is added. `archived` = torn down (dir moved to `archive/`).
- **backlog item** (`backlog.md`, block grammar `- **id**` + `Key: Value`): `Priority`,
  `Status` (open|draft|active), `Order` (per-task sequence), `Plan`, `Note`.
- **closed item** (`closed.md`): `Status` (done|dropped), `Plan`, `Reason` (required for
  dropped), `Closed` (date), `ClosedSource`. **Unbounded — never trimmed.**
- **id**: globally unique across all tasks' backlog+closed, **never reused** (closed ids stay
  reserved, incl. archived tasks), aligned 1:1 with the plan slug. Kebab-case.
- **Plan**: 1:1 — at most one item (backlog or closed, any task) per plan path.
- **pointers**: `current.txt` = in-flight plan; `focus.txt` = intended-next item. The
  "current task" is derived from the focus item's directory (no separate pointer).

## Single write path

**All mutations go through `pm-roadmap.ts` (CLI) → `ops.ts` (atomic, lock-guarded) → `store.ts`.**
Skills/design/retro/GUI never hand-edit the markdown. Run the CLI:

```bash
repo_root="$(git rev-parse --show-toplevel)" || { echo "not in a git repo"; exit 1; }
(cd ~/.config/ai/skills/pm-roadmap && [[ -d node_modules ]] || npm install)
PM_ROOT="$repo_root" ~/.config/ai/skills/pm-roadmap/node_modules/.bin/tsx ~/.config/ai/skills/pm-roadmap/pm-roadmap.ts <subcmd> [args]
```

(Read subcmds on a legacy repo — `tasks/` absent but old `ROADMAP.md` present — print
`⚠ legacy roadmap detected — run /pm-roadmap migrate`.)

## Subcommands

- **list** / **tree** — eligible next candidates (sorted `priority, taskKey, order, id`) + blocked + inbox count / per-task backlog.
- **get `<id>`** — an item's join view (plan goal + next step, task links + memory, recent done-sibling notes, note).
- **next `[id]`** — paste-ready kickoff prompt. Target: explicit id, else focus, else the candidate list (`Choose a candidate` — never auto-picks an eligible item; `_INBOX` excluded). After emitting, ask whether to run it **here** (no copy — proceed into `/design <id>`, or resume the plan's next unchecked step) or **hand off** to a fresh session (copy via `/copy`, then stop).
- **recent** — derived recent-closed view (all `closed.md` merged by date, capped).
- **validate** — full-scan invariant check (C1..C11; see below). Exit 1 on errors. `/retro` runs it after its sink.
- **migrate `[--apply]`** — convert a legacy repo's `.agents/` to the task-first model. Default dry-run (prints the mapping). `--apply` after review. See Migration.
- **task `create|done|archive|restore` `<KEY>`** — task lifecycle. `archive` refuses if open items remain; `restore` re-activates an archived task.
- **add `<id> <title>` (`--task KEY` | `--inbox`) [-p] [-o] [--note]** — append a workable unit (or an untriaged inbox item). `-o` takes a positive-integer order; `--note` attaches a note.
- **plan / reprioritize / reorder / approve / close / drop / triage / focus** — item transitions (normally driven by /design + /retro; manual is the escape hatch). `reprioritize <KEY> <id> <P0..P3>` and `reorder <KEY> <id> <N>` change an item's Priority/Order in place (N = positive integer). `triage <id> <KEY>` moves an inbox item to a task. `focus` rejects inbox items.
- **memory `<KEY> add <title>` [`--note T`] [`--date D`]** — upsert a durable-decision note into `tasks/<KEY>/memory.md` (upsert by title; lock+CAS via ops). The non-GUI memory write path — **/retro's durable-decision sink** (the GUI `manage` is the other writer). Date defaults to today.
- **links `<KEY> add <label>` `--url U` [`--triggers C`] [`--summary S`]** / **links `<KEY> remove <match>`** — upsert/remove a task's external link in `tasks/<KEY>/links.md` (case-insensitive label upsert; URL unique per task; lock+CAS via ops). The **/pm-context** write path (the GUI `manage` is the other writer); pm-context does fetch + trigger/summary extraction, then persists via this CLI.
- **current-task** — read-only: prints the KEY of the task owning the `focus` item (empty if no focus). pm-context's default-`KEY` resolver for `get`.
- **manage** — open the dashboard GUI (see below).

## Lifecycle (automatic — implemented in /design and /retro)

| Moment | Write (via ops) |
|---|---|
| design **persist** | `createPlanAndBacklogItem` — create/link item + point `current.txt`, one transaction; item Status mirrors plan = `draft` |
| **`승인`** | plan draft→active → item `approve` (Status active) |
| **`취소`** | plan→dropped → item `close --status dropped` (Reason required) + clear pointers |
| **`/retro`** done/dropped | `completePlanFromRetro` — plan→terminal + item backlog→closed + structured `## Deferred` harvest + clear pointers, all-or-nothing |
| **`/retro`** memory harvest | `addTaskMemory` (CLI `memory add`) — durable decisions → `tasks/<KEY>/memory.md`; a separate write, OUTSIDE the close transaction's lock |

## Invariants (validate)

Errors: **C1** id global-unique + kebab + no-reuse (scans active+inbox+archive) · **C2** Plan 1:1 global · **C3** in-flight plan (current.txt) linked by exactly one backlog item **unless `pm_loop:false`** · **C4** backlog item status mirrors plan · **C5** section membership · **C6** planless-only-open / planless-never-done · **C7** closed plan path exists · **C8** focus names a backlog item, not inbox · **C9** current.txt → draft|active plan. Warn: **C10** duplicate Order in a task. Never mutates — fix via ops.

## Plan archiving

`/design` persist runs `archive.ts`: terminal plans **≥30 days** old and **unreferenced** (not `current.txt`, not any backlog item's Plan) move to `plans/archive/`, and each task's `closed.md` `Plan:` pointer is rewritten. Idempotent recovery on crash.

## Migration

`/pm-roadmap migrate` converts a legacy repo (old `ROADMAP.md` + `task-context/` + `memory/`)
to the task-first model: per-task dirs, taskless→`inbox.md`, legacy `## Memory` sections split
out, `Context:`/`Parent:`→`Task`. **Default dry-run** (prints mapping, writes nothing);
`--apply` backs up `.agents/` → converts → validates → removes legacy only on a clean validate
(else rolls back). Idempotent (`tasks/` exists → no-op). **Never auto-runs.**

## manage (dashboard)

Capture the git root **before** cd; always restart the server (never reuse):

```bash
repo_root="$(git rev-parse --show-toplevel)" || { echo "not in a git repo"; exit 1; }
kill $(lsof -ti:8484 2>/dev/null) 2>/dev/null; sleep 1
cd ~/.config/ai/skills/pm-context && [[ -d node_modules ]] || npm install
TASK_CONTEXT_ROOT="$repo_root" ./node_modules/.bin/tsx server.ts   # run_in_background
```

Then open `http://localhost:8484`. The dashboard derives its view from `tasks/*`; all its
writes route through ops (planless drop, task links/memory edit, delete=archive). A
task-centric UI redesign is tracked separately (backlog `pm-dashboard-task-centric`).

## Worktrees

In a git worktree set up by the **`worktree`** skill, `.agents/{tasks,plans,inbox.md}` are symlinks to the **main checkout** (shared backlog + plans + the single `tasks/.lock`, so writes across worktrees serialize), while `.agents/state/` is a **real local dir** — so each worktree has its own `current.txt`/`focus.txt` (a different in-flight plan per worktree). pm resolves its root via `git rev-parse --show-toplevel` unchanged; the symlinks do the sharing (no pm-core special-casing). `list`/`tree`/`next` in a worktree show the shared backlog; `focus`/`current-task` are worktree-local.

## Rules

- All file content English; quoted triggers may stay Korean.
- **Never hand-edit `tasks/*` markdown — always go through the CLI/ops.** That is the single write path (lock + CAS + lossless serialize).
- Reads (`list`/`tree`/`get`/`next`/`recent`/`validate`) are safe to auto-invoke; mutations come from lifecycle gates or explicit subcommands.
- `tasks/` is gitignored (durability is the files themselves, not git).
