# design-contract.md — pm dashboard (`roadmap.html`)

The UI source of truth for the pm dashboard. The agent reads this directly before touching `roadmap.html`. Rebuilt no-reference on 2026-07-09 (the prior Quiet-ops-console contract was deleted 2026-07-02); do not resurrect the old visual system.

## Scope & Inheritance

- **applies-to**: `ai/skills/pm-context/roadmap.html` — a single self-contained HTML dashboard served by `server.ts`.
- **parent**: none (leaf surface; no repo-root `design-contract.md`).
- **override rules**: sole UI contract for this surface; server.ts's API contract is a fixed upstream input, not owned here.
- **owner**: 대협 — the primary and only user (owner-taste surface).
- **last-updated**: 2026-07-15.

## Surface Type & Craft Profile

- **surface**: Dashboard / Operations — a read-heavy GUI satellite of a CLI-first system.
- **density**: compact. List/queue rows ≤ 40px; panels 16–24px padding; toolbar controls 32–36px.
- **primary craft priorities**: scanability; the cross-task "what next" decision; fast `/design` kickoff; keyboard reachability; fast recovery from conflicts.
- **anti-patterns**: hero sections, oversized type, decorative whitespace, card-only work queues, color-only meaning, animation on repeated actions, marketing polish.
- **quality bar**: an operator trusts and scans the structured data at a glance; the "work on this next" signal reads **structurally**, not by type size.

## Product Context

- **users**: 대협 (solo). Collab mode is possible in the model but currently unused; collab surfaces stay conditional.
- **jobs**: (a) cross-task next-work decision; (b) task inspection (backlog / closed / links / memory); (c) `/design` kickoff for a chosen item; (d) housekeeping (focus, drop, archive, links/memory edit, task create).
- **success states**: open dashboard → see the next item → copy its kickoff → drill into a task when inspecting.
- **non-goals**: authoring attribution; optimistic mutation; triage inside the GUI; an all-tasks closed screen; visual marketing.

### User-job closure

User-job closure:
- Requested action: Identify the active or next eligible PM item, copy a rooted kickoff/resume prompt, and drill into its task/item context.
- Success: Dock precedence `inFlight > focus > next-eligible` surfaces the correct item; mapped plans show branch/worktree; copy returns the server-generated prompt with visible confirmation; drill preserves task/item context.
- Failure/retry: Fetch, clipboard, and mutation failures remain visible in context; every recoverable failure offers retry; 409 bodies remain verbatim; retry does not discard the current view.
- Preserved invariants: Attribution is display-only; mutations are non-optimistic and refetch on success; triage is CLI-only; every action maps to an existing route or is marked CLI-only; queue rows remain ≤40px; teal remains reserved for focus, primary action, selection, and live signal.

## UX Model

- **Information architecture — single operating view + drill** (owner pick over master-detail cockpit and single-canvas+palette):
  - **Home `/`** (operating view): focus/next **dock** → **queue** (≤40px rows) → footer chips (inbox · tasks · validate).
  - **Task view** (drill, hash route): tabs `backlog · closed · links · memory`.
  - **Item view** (drill, hash route): detail + plan + kickoff copy + focus/drop.
- **Navigation**: drilling = a view switch via hash route with back/breadcrumb. Drill is **bidirectional** — an item links back to its task (breadcrumb + the detail `task` field), a task lists its items. Breadcrumb hierarchy = `roadmap → task → item`. Closed items are reachable only from a task's Closed tab and are read-only. **No persistent sidebar. No ⌘K command palette** (A-drill chosen over C-canvas). Keyboard covers basic nav only.
- **Task priority**: jobs (a)+(c) are daily/highest → the home dock nails next+kickoff; (b) is a drill; (d) is inline actions on each surface.
- **next-up = structural affordance** (not type scale — two prior type-scale attempts failed): the dock is a bracketed "primary readout cell" (diagonal corner marks + live dot + reserved kickoff CTA + a `plan.nextStep` readout line). Position, container, and reserved actions carry the signal.
- **UX improvements (accepted by owner):** (1) structural next-up dock; (2) `plan.nextStep` line in the dock; (3) cool palette replacing muted warm; (4) collapse the old 5-screen sidebar into operating-view + drill.

### Material gaps

Material gaps: none in the accepted `pm-dashboard-ready-gaps` scope

The accepted recovery, pending, feedback, keyboard, contrast, task-create, Closed-overflow, scroll, and microcopy gaps are implemented and covered by the fresh objective evidence below. Richer task creation and inbox triage remain intentional CLI-only non-goals.

## Data & State Model

- **Reads**: `/api/roadmap` (open[] incl. additive `nextStep`, `baseBranch`, `baseCommit`, `branch`, `worktree` + `dependsOn`, `blockedBy`, recentlyClosed, focus, **`inFlight`**, project) · `/api/next` (eligible/blocked/focus/inbox count) · `/api/inbox` (items) · `/api/roadmap/:id/join` (detail: item incl. `dependsOn`, top-level `plan` PlanInfo, contextLinks/Memory, siblings) · `/api/roadmap/:id/next` (kickoff/resume text) · `/api/tasks` (list+counts) · `/api/tasks/:key` (links/memory; optional task-scoped Closed projection below) · `/api/roadmap/validate` (health).
- **`inFlight` (in-flight item)**: on `/api/roadmap`, the id of the backlog item whose `Plan:` equals the plan named by `.agents/state/current.txt` (the in-flight plan pointer, draft|active), resolved against `open[]`; `null` when no open item matches (standalone `pm_loop:false` plan, already-closed item, or a stale pointer). Read-only, derived, additive — no new write route. Drives the dock's **In progress** state.
- **`/api/current` (legacy, unused by the dashboard)**: returns the *current task key* derived from `focus.txt` — a separate concept from the `current.txt` in-flight-plan pointer above. The dashboard does not consume it; the in-flight item surfaces via `/api/roadmap.inFlight`. Left untouched for compatibility.
- **DependsOn / blockedBy**: `dependsOn` is a backlog item's declared dependency ids (may be cross-task). The derived `blockedBy` (single id) is the first unresolved dependency, else an earlier-Order sibling — an item is blocked while any DependsOn target is still in some active backlog.
- **empty**: name the CLI next step in mono (see Microcopy). Never a blank pane.
- **loading**: skeleton rows for Home on first paint; task/item/inbox/tasks show inline loading text rather than a spinner.
- **error**: Home, Task, Item, Inbox, and Tasks render in-route detail plus native `retry`; Task and Item also retain `back`. A route-generation guard prevents a late async response from overwriting the active hash route.
- **conflict (409)**: render the server message **verbatim** (drop / archive / focus / PUT). Never parse or rewrite it.
- **partial reads**: Home keeps the primary queue when task-count or validation reads fail; both auxiliary reads expose explicit loading, success, and `unavailable` states without presenting stale/default success.
- **overflow / long content**: queue id/title/task cells use ellipsis; detail content wraps. Task Closed uses the task-scoped five-row projection and exposes `show older` when `closedTotal` exceeds the initial slice.
- **realtime**: none. Every successful mutation triggers a refetch (no optimistic state).
- **approved task-scoped Closed projection**: `GET /api/tasks/:key?closed=5` additively returns newest-first `closed` plus `closedTotal`; `closed=0` returns all rows on explicit `show older`. Omitting `closed` preserves the existing links/memory response shape; malformed caps are rejected.
- **approved auxiliary truth**: task count and validation health each expose loading, success, and `unavailable`. Their failure never removes primary Home data and never leaves a default green/success mark.

### Required states and recovery

| Surface/action | Current state | Required recovery contract | Baseline |
| --- | --- | --- | --- |
| Home | Skeleton → dock/queue/footer; fetch error has `retry`; empty queue names the exact installed `pm add` syntax | Retry in place and retain the Home route | PASS |
| Task | Loading text; fetch error has `retry` plus `back` | Preserve the task route and offer retry plus back | PASS |
| Item | Loading text; fetch error has `retry` plus `back` | Preserve the item route and offer retry plus back | PASS |
| Inbox | Loading text; fetch error has `retry`; empty state names `pm triage` | Offer retry without inventing GUI triage | PASS |
| Tasks index | Loading text; fetch error has `retry`; key-only creation is reachable | Offer retry and preserve the index | PASS |
| Mutation | Only the acting control is disabled, `aria-busy`, and relabelled; success refetches; errors enter the alert banner | Keep non-optimistic refetch and verbatim 409/error feedback | PASS |
| Clipboard | `/next` failure enters the alert banner; success enters persistent polite `role=status` | Keep copy retryable without replacing validation health | PASS |
| Partial reads | Primary Home data survives; task count and validation show loading/success/`unavailable` | Never present stale/default health as success | PASS |
| Overflow | Queue ellipsis and detail wrapping prevent viewport overflow; Closed exposes five plus `show older` | Continue on the same task/Closed route when expanded | PASS |

## Interaction Model

- **Mutations (no optimistic UI)** — each maps to a real route; on success refetch, on 409 show verbatim:
  - focus set/clear → `POST /api/focus` (`{id}` set, empty clear)
  - links/memory edit → `PUT /api/tasks/:key` (server merges `By` by id — preserved, never authored here)
  - item drop → `POST /api/roadmap/:id/drop` (confirm first)
  - task archive → `DELETE /api/tasks/:key` (confirm; 409 when open items remain)
- **Attribution**: display-only. `owner / ownerNote / mode / by` are shown, never entered. No attribution input controls exist.
- **Destructive actions**: drop and archive require confirmation; the 409 body is surfaced verbatim.
- **triage**: CLI-only (no server route). Inbox is read-only + a mono hint.
- **task create (approved target)**: Tasks index exposes a labelled key-only form constrained to `[A-Z0-9_-]+`. Submit reuses `PUT /api/tasks/:key` with empty links/memory, disables only the submit control while pending, and opens the authoritative Task route after success. Richer title/mode/collaborator creation remains CLI-only.
- **keyboard (approved target)**: queue, Tasks-index, and Closed navigation rows are native anchors, so Enter activation and browser link semantics require no custom pseudo-link handler. Buttons and the task-create form remain native; the required focus indicator is a visible 2px teal outline.
- **feedback (approved target)**: every async action disables only its acting control, sets `aria-busy=true`, and carries an action-specific pending label. Errors restore the control and enter the assertive banner; copy success is visible and announced through a dedicated polite `role=status` region without replacing validation health.
- **scroll restoration (approved target)**: hash navigation records the current route's scroll position before drill/back transitions, uses `history.scrollRestoration="manual"`, and restores only when the rendered route still matches the active hash.

## Visual System

- **tone / concept**: **Bright ops console** — a light, airy operations surface: white cards on a soft neutral field, one calm teal signal for focus/action. (Owner reversed the earlier dark "Blueprint instrument" pick after seeing it rendered on real data — see Decision Log 2026-07-09 visual reversal.)
- **design tension**: light, calm, airy chrome (dominant) + one saturated teal signal reserved to focus/CTA (counterpoint). Airiness is toned to ops density — not a marketing dashboard; rows stay ≤40px.
- **signature moment**: the focus/next **dock** as an elevated white card with a 3px teal left rail — the "this one next" cue is carried structurally by the rail + elevation + a reserved primary CTA, never by type size.
- **palette roles**:
  - surfaces: bg `#f6f8fa` · surface `#ffffff` · surface-2 `#f0f4f8` · border `#e4e9ef` · border-strong `#d3dbe3`
  - text: `#1a2430` · muted `#5b6b7a` · faint `#647484` (minimum `4.5:1` on both white and page background for essential compact labels)
  - **accent teal `#0d9488`** (strong/action `#0f766e` · action-hover `#115e59` · weak-tint `#e6f4f2` · line `#a7ddd6`): `#0d9488` serves focus/selection/live indicators; primary CTA uses the stronger action token so white text passes `4.5:1`. Teal never bleeds into priority.
  - priority (semantic, always paired with the "Px" text, on a soft tinted chip): P0 `#b42318` · P1 `#b54708` · P2 `#92600a` · P3 `#475467`.
  - status: ok/success `#16a34a` · error `#b42318` · warn (validate errors) `#b54708`.
- **typography**: `system-ui` for titles/prose/body (body 13.5px); `ui-monospace` for ids/labels/readouts/paths; labels 10–11px uppercase with tracking; dock id 16px; no page hero.
- **spacing**: 4px step (4 / 8 / 12 / 16 / 24 / 32); airier padding than a dense grid, but list/queue rows stay ≤40px.
- **radius**: 8–12px (soft); inputs/buttons 7–8px.
- **elevation**: soft shadows over heavy borders — `shadow-sm` (rows/chips/pills) and `shadow-md` (dock); shadows lift the operating surfaces, they are not decorative.
- **motion budget**: 100–160ms hover/focus; none on repeated row/filter actions; `prefers-reduced-motion` disables non-essential motion; the dock live dot is **static** (no pulse).

## Component Rules

- **dock (elevated focus card)**: eyebrow + static teal dot + 3px teal left rail + soft elevation; P chip + id (mono) + title + `task`; mapped plans add a mono `branch · … · worktree · …` line and use `copy resume →`; a `plan.nextStep` readout line in a teal-tint box (`→ next …`); **right-column actions stacked** to use the card width. **Precedence: `inFlight > focus > next-eligible`** (`dockId = inFlight || focus || eligible[0]`) — three states, one dock:
  - **In progress** (`inFlight` set, dockId = inFlight): eyebrow `In progress`; primary CTA `copy resume →` (the item has a plan, so kickoff text is a resume prompt). Surfaces current work without setting focus.
  - **Focus** (no inFlight, focus set): eyebrow `Focus`; primary CTA `copy kickoff →` + `clear focus`.
  - **Next up** (neither): eyebrow `Next up`; the top eligible candidate + `copy kickoff →`.
  The focus-toggle button is keyed on **actual focus identity** (`focus === dockId ? clear : focus`), not the dock state, so an in-flight item that isn't the focus still shows `focus`. nextStep fallbacks: has open step → show it; plan set but no open step → `plan set · no open step — /verify or /retro`; no plan → `no plan · /design <id>`.
- **secondary Focus card**: when `focus` is set AND `focus !== dockId` (i.e. the dock is showing an in-flight item, so the focus would otherwise be buried in the queue), a **second, flat Focus card** (`.dock.secondary` — no elevation, no live dot) renders directly under the primary dock. Same structure as the dock (built by a shared `dockCard(item, opts)` helper): eyebrow `Focus`, `copy kickoff →` + `clear focus` + `open`. Skipped when `focus === dockId` (already shown) or when the focus id isn't an open item. The queue excludes **both** docked ids so nothing double-renders. Keeps one *primary* signature (In progress) while never hiding an explicit focus.
- **queue**: rows ≤38px, grid `tick | P chip | id(mono) | title | task(right)`; hover background; ordered by server `order`. **Blocked** subsection (blocker = a dependency or an earlier-Order sibling) dimmed with `by <blocker>`. Empty → mono CLI hint.
- **task view**: header (`key`) + segmented tabs `backlog · closed · links · memory`. backlog = open rows (≤40px). Closed initially renders the newest five task-scoped rows and shows `show older` when `closedTotal` exceeds the slice; expansion stays on the same task/Closed route. links/memory = editable list (PUT); `By` shown read-only. Archive button (DELETE; confirm + 409 verbatim).
- **item view**: detail (join `item`: id/title/priority/note/status/task/owner/mode/dependsOn — `depends on` row shown only when non-empty) + top-level `plan` (path/status/nextStep/baseBranch/baseCommit/branch/worktree) + context links/memory (read; `by` shown) + `[copy resume]` for mapped plans or `[copy kickoff]` otherwise (from `:id/next` text) + `[focus]` / `[drop]` (confirm). The `task` field is a **link** to `#/task/<KEY>`; breadcrumb shows `roadmap → task → item`. When the item is **closed**, mutation actions (kickoff/focus/drop) are hidden and a `closed · <status>` badge shows instead (closed items are read-only).
- **footer chips**: `inbox N` · `tasks N` · `validate ✓ / N errors` (errors → warn color, expandable).
- **owners chip (conditional)**: shown only when some open item has `mode:collab`; groups per owner via `/api/next`. Hidden in solo.
- **component-state requirement**: default / hover / focus-visible / active / disabled / loading / empty / error / selected, as applicable. Async controls use explicit disabled text/surface tokens rather than blanket opacity, keeping pending labels above the contrast floor.

## Responsive & Accessibility

- **breakpoints**: desktop-first operator tool; graceful reflow ≥1024px; below → single column, dock stacks. Mobile is not a primary target.
- **touch targets**: dense desktop controls may be <44px only while keyboard focus and pointer affordance stay explicit.
- **focus path (approved target)**: visible 2px `#0d9488` outline with 2px offset. Native header/dock/footer controls and navigation anchors enter the tab order; explicit route-keyed restoration returns drill/back navigation to the originating list position.
- **contrast target**: text/surface remains `15.68:1` and muted/surface `5.48:1`; white/action `#0f766e` is `5.47:1`; faint `#647484` is `4.80:1` on white and `4.51:1` on page background. Focus/live `#0d9488` remains above the `3:1` non-text indicator floor.
- **reduced motion**: `prefers-reduced-motion: reduce` disables all CSS animation and transition; state remains legible without motion.
- **screen reader / semantics (approved target)**: buttons, links, forms, and tabs are native; priority always carries its text label; mutation errors enter an assertive banner/`role=alert`; copy success enters a dedicated persistent polite `role=status`; fetch failures name the affected surface and expose semantic retry controls.

## Performance & Formatting

- **perceived latency**: mutation success refetches the route. During every async action, only the acting control is disabled and labelled pending; the rest of the route remains available.
- **skeleton/spinner**: Home uses skeleton queue rows on first load; drill/index views use inline loading text, not a spinner.
- **numbers / ids**: mono / tabular. Dates pass through from the server as-is; no client timezone math.
- **i18n**: N/A — personal tool; mixed ko/en content passes through unaltered.

## Microcopy

- empty inbox: `inbox clear · triage new items with `pm triage <id> <KEY>`` (mono).
- empty queue: `no eligible items · `pm add <id> --task <KEY> -p P2 --title …`` (mono; matches the installed CLI parser).
- no links: `no links · `pm links add <KEY> …`` · no memory: `no memory · `pm memory add <KEY> …``.
- dock, no plan: `no plan · kickoff to start `/design <id>``.
- 409 / archive-blocked: server message verbatim.

## Do / Don't

- **Do**: reserve teal for focus/CTA/selection only; keep priority semantic; rows ≤40px; refetch on every mutation; render 409 verbatim; name the CLI next step in mono on empty states; carry next-up structurally (rail + elevation + CTA).
- **Don't**: author attribution; use optimistic UI; expose triage / restore / richer task-create in the GUI (no route); use type scale as the next-up signal; use the warm `#141210` palette; let teal bleed into priority; use a card-only queue; encode priority by color alone; add a ⌘K palette; animate repeated actions.

## Implementation Bridge

- single self-contained `roadmap.html` (inline `<style>` + `<script type="module">`), served by `server.ts` at `/`.
- vanilla DOM + `fetch`; no framework, no build step.
- **syntax gate**: extract the inline module script → `node --check --input-type=module -`.
- **render verify**: Playwright via `ai/skills/spa-fetch/node_modules` absolute import, `channel:"chrome"`. Inspect Home/Task/Item at 1440×1000, Home at 800×1000, and intercepted failure/partial/pending/clipboard/keyboard states. Every non-GET request is intercepted locally when verification uses real task data.
- **server contract**: reads listed under Data & State Model; `open[]` adds plan-derived `nextStep`, `baseBranch`, `baseCommit`, `branch`, and `worktree`; missing/unreadable plans return `nextStep: null` and empty mapping strings; task GET accepts the optional Closed cap without changing its default response; no new write routes.
- **PM repo sync**: pm-context is tracked in `~/Projects/skills/pm` → run `bash scripts/sync-from-config.sh` + `--check` after changes.

## Design-Fit Verification

### Objective READY gate

`READY` is valid only when every applicable verification row passes and every `N/A` includes a concrete reason. Design judgment cannot override verification. A failed browser measurement requires source correction plus a fresh render and measurement while correction is authorized and fewer than two cycles have been used; otherwise report the exact failure appendix and `NOT VERIFIED`.

### Fresh implementation evidence — 2026-07-15

- **frozen fixture and safety**: copied the mapped task store to a temporary root; every browser non-GET was intercepted. The observed writes were two focus `POST`s and one key-only task `PUT`; no fixture write reached the server. The intercepted task-create PUT was followed by one fulfilled authoritative task GET.
- **render coverage**: visually inspected Home, Task, and Item at 1440×1000, Home at 800×1000, and a long-content Home fixture. Exercised intercepted failure/retry for Home, Item, Task, Inbox, and Tasks.
- **geometry and overflow**: desktop and narrow queue rows measured `38px`; document scroll width equalled client width in every inspected path. The long queue id produced intentional ellipsis without viewport overflow.
- **recovery and state**: all five read surfaces recovered through in-route retry. The acting focus control alone became disabled with `aria-busy=true` and `focusing…`; its sibling stayed enabled. The exact intercepted 409 body remained visible. Copy success entered the dedicated polite status while validation health remained separate. Task count and validation both rendered explicit `unavailable` without removing the dock.
- **navigation and workflow**: native Tasks and Closed anchors activated with Enter. Invalid task keys were blocked; `BROWSER_TASK` sent exactly `{links:[],memory:[]}` and opened the authoritative task route. Task Closed rendered five rows, then seven after `show older`. Dismissed drop confirmation emitted no write.
- **scroll and focus**: manual hash restoration measured `230px → 230px`. The focused primary action measured a `2px` `#0d9488` outline with `2px` offset.
- **contrast**: white/action `5.47:1`; faint/white `4.80:1`; faint/page `4.51:1`; focus/white `3.74:1`. All applicable text and non-text thresholds pass.
- **automated gates**: `server.test.ts`, inline-module `node --check`, and `git diff --check` passed after the fresh render.
- **correction cycles**: 2 of 2 authorized source cycles used. Cycle 1 added a route-generation guard after the full matrix exposed a late Task render overwriting `#/tasks`; the fresh route sequence passed. Cycle 2 cleared custom validity on task-key input after invalid→valid evidence exposed a persistent validation message; the isolated flow and final full matrix passed.

Design judgment:
- User-job fit: The dock, rooted copy action, bidirectional drill, complete retry paths, and truthful pending/feedback states close the primary daily workflow.
- Workflow and product specificity: The single operating view, exact CLI hints, task-scoped Closed continuation, in-flight/focus precedence, and display-only attribution remain specific to this CLI-first PM system.
- Hierarchy, density, and craft: The elevated teal-rail dock carries next-work priority structurally; 38px rows retain operations density across desktop and narrow renders.
- Contract integrity: Server, client, rendered states, measurements, and declared non-goals agree; no applicable verification row requires `N/A`.

Verification status:
- User-job closure: PASS - next-work selection, copy feedback, task/item drill, and recoverable failures are complete.
- Required states/recovery: PASS - loading, error/retry, pending, conflict, partial-read, empty, and overflow states match the contract.
- Inspected render coverage: PASS - normal, failure, pending, clipboard, auxiliary, keyboard, task-create, Closed, scroll, narrow, and long-content paths were exercised against the frozen fixture.
- Geometry/overflow: PASS - rows remain 38px and no inspected route has unintended horizontal overflow.
- Accessibility floors: PASS - native anchors activate by keyboard, polite/assertive feedback is separated, focus is visible, and all measured contrast floors pass.
- Contract/code/render agreement: PASS - every committed action and state is reachable in code and visible in fresh evidence with no invented route or dependency.

Outcome: READY

## Decision Log & Open Questions

- **2026-07-09** — Rebuilt no-reference. IA = single operating view + drill (owner pick over master-detail / single-canvas). Visual (initial) = Blueprint instrument (owner pick over calm-console / departures-board render gate). next-up = structural dock (two prior type-scale attempts under-delivered). `plan.nextStep` exposed additively on `open[]` only — `/join` already exposes it via the top-level `plan` PlanInfo, and `item.plan` stays a string path. plan-review R1→R2 (cross-model) converged.
- **2026-07-09 (visual reversal)** — After seeing the dark Blueprint-instrument rendered on real data, the owner supplied a light/airy reference (a bright dashboard) and chose to switch. Visual direction is now **Bright ops console** (light). IA, components, data/state model, action×route matrix, and the 6 invariants are UNCHANGED — only visual tokens flipped: dark→light, cyan→teal, angular(2–4px)→soft(8–12px), corner-marks/grid→rail+elevation, pulse→static dot. The original dark pick is kept above as history. Lesson: a passed owner-taste gate can still reverse once rendered on real data — cheap here because IA/structure were held stable; only the tokens moved.
- **2026-07-09 (in-flight surface)** — The dock gained a third **In progress** state driven by an additive `inFlight` field on `/api/roadmap` (resolved from `.agents/state/current.txt` → the open item whose `Plan:` matches). Precedence `inFlight > focus > next-eligible`; the in-flight item is elevated into the dock **without requiring focus** (prev. it sat buried as a plain queue row). Chosen over a repurposed `/api/current` GET + separate strip (extra fetch, two competing elevated cards) and over a badge-only treatment (fails when the in-flight item is buried in the queue). No new write route; `/api/current` left untouched (its `focus.txt`-derived "current task" is a distinct legacy concept). Deferred: hardening the dock fallback to validate each candidate id against `open[]` so a stale focus can't suppress next-up (pre-existing, out of scope). Codex plan-review R1 = APPROVED. **Follow-up (same session, owner request):** because `inFlight > focus`, a focus differing from the in-flight item was demoted to an unmarked queue row — added a **secondary Focus card** (flat `.dock.secondary`, under the primary dock, shown only when `focus !== dockId`) so an explicit focus is never buried. dock render extracted to a shared `dockCard()` helper. Owner picked the full card over a slim strip.
- **2026-07-13 (worktree resume)** — Mapped plans expose immutable base, branch, and worktree in roadmap/join reads. The dock and item detail show the execution location and copy the rooted resume prompt already produced by `pm next`; incomplete or unreadable legacy mappings degrade to the existing kickoff display.
- **2026-07-15 (frontend-design v1.0.0 contract refresh)** — Preserved the approved UI direction and implementation, added exact user-job/material-gap/readiness records, corrected contract claims against code/render evidence, and recorded the current surface as objectively `NOT VERIFIED`. No config-side UI fix is authorized in this task; the four PM-repo code/test drifts belong to the previously verified worktree-resume delivery.
- **2026-07-15 (READY-gap implementation approved)** — Chose complete closure over N/A: in-route retry, acting-control pending state, dedicated clipboard status, explicit auxiliary-unavailable state, native navigation anchors, passing contrast tokens, key-only task creation through the existing PUT, task-scoped Closed five-plus-show-older, explicit scroll restoration, and exact `pm add` microcopy. The measured baseline stays `NOT VERIFIED` until fresh browser evidence passes every objective row.
- **2026-07-15 (READY-gap implementation verified)** — Fresh frozen-fixture evidence passed all objective rows after two source correction cycles: a route-generation guard for late async renders and input-level custom-validity reset for invalid→valid task creation. Every non-GET was intercepted; server tests, syntax, geometry, recovery, pending, keyboard, task-create, Closed expansion, scroll, long-content, contrast, and visual inspection passed. Outcome moved to `READY`.
- **Open**: the owners-chip trigger may need refinement if collab is actually used.
