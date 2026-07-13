# design-contract.md — pm dashboard (`roadmap.html`)

The UI source of truth for the pm dashboard. The agent reads this directly before touching `roadmap.html`. Rebuilt no-reference on 2026-07-09 (the prior Quiet-ops-console contract was deleted 2026-07-02); do not resurrect the old visual system.

## Scope & Inheritance

- **applies-to**: `ai/skills/pm-context/roadmap.html` — a single self-contained HTML dashboard served by `server.ts`.
- **parent**: none (leaf surface; no repo-root `design-contract.md`).
- **override rules**: sole UI contract for this surface; server.ts's API contract is a fixed upstream input, not owned here.
- **owner**: 대협 — the primary and only user (owner-taste surface).
- **last-updated**: 2026-07-09.

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

## UX Model

- **Information architecture — single operating view + drill** (owner pick over master-detail cockpit and single-canvas+palette):
  - **Home `/`** (operating view): focus/next **dock** → **queue** (≤40px rows) → footer chips (inbox · tasks · validate).
  - **Task view** (drill, hash route): tabs `backlog · closed · links · memory`.
  - **Item view** (drill, hash route): detail + plan + kickoff copy + focus/drop.
- **Navigation**: drilling = a view switch via hash route with back/breadcrumb. Drill is **bidirectional** — an item links back to its task (breadcrumb + the detail `task` field), a task lists its items. Breadcrumb hierarchy = `roadmap → task → item`. Closed items are reachable only from a task's Closed tab and are read-only. **No persistent sidebar. No ⌘K command palette** (A-drill chosen over C-canvas). Keyboard covers basic nav only.
- **Task priority**: jobs (a)+(c) are daily/highest → the home dock nails next+kickoff; (b) is a drill; (d) is inline actions on each surface.
- **next-up = structural affordance** (not type scale — two prior type-scale attempts failed): the dock is a bracketed "primary readout cell" (diagonal corner marks + live dot + reserved kickoff CTA + a `plan.nextStep` readout line). Position, container, and reserved actions carry the signal.
- **UX improvements (accepted by owner):** (1) structural next-up dock; (2) `plan.nextStep` line in the dock; (3) cool palette replacing muted warm; (4) collapse the old 5-screen sidebar into operating-view + drill.

## Data & State Model

- **Reads**: `/api/roadmap` (open[] incl. additive `nextStep`, `baseBranch`, `baseCommit`, `branch`, `worktree` + `dependsOn`, `blockedBy`, recentlyClosed, focus, **`inFlight`**, project) · `/api/next` (eligible/blocked/focus/inbox count) · `/api/inbox` (items) · `/api/roadmap/:id/join` (detail: item incl. `dependsOn`, top-level `plan` PlanInfo, contextLinks/Memory, siblings) · `/api/roadmap/:id/next` (kickoff/resume text) · `/api/tasks` (list+counts) · `/api/tasks/:key` (links/memory) · `/api/roadmap/validate` (health).
- **`inFlight` (in-flight item)**: on `/api/roadmap`, the id of the backlog item whose `Plan:` equals the plan named by `.agents/state/current.txt` (the in-flight plan pointer, draft|active), resolved against `open[]`; `null` when no open item matches (standalone `pm_loop:false` plan, already-closed item, or a stale pointer). Read-only, derived, additive — no new write route. Drives the dock's **In progress** state.
- **`/api/current` (legacy, unused by the dashboard)**: returns the *current task key* derived from `focus.txt` — a separate concept from the `current.txt` in-flight-plan pointer above. The dashboard does not consume it; the in-flight item surfaces via `/api/roadmap.inFlight`. Left untouched for compatibility.
- **DependsOn / blockedBy**: `dependsOn` is a backlog item's declared dependency ids (may be cross-task). The derived `blockedBy` (single id) is the first unresolved dependency, else an earlier-Order sibling — an item is blocked while any DependsOn target is still in some active backlog.
- **empty**: name the CLI next step in mono (see Microcopy). Never a blank pane.
- **loading**: subtle — skeleton rows for the queue on first paint, inline spinner on the drill fetch.
- **error**: fetch failure → inline error + retry affordance; never a blank screen.
- **conflict (409)**: render the server message **verbatim** (drop / archive / focus / PUT). Never parse or rewrite it.
- **overflow / long content**: title ellipsis; mono ids may wrap with min-width; recentlyClosed capped with show-older.
- **realtime**: none. Every successful mutation triggers a refetch (no optimistic state).

## Interaction Model

- **Mutations (no optimistic UI)** — each maps to a real route; on success refetch, on 409 show verbatim:
  - focus set/clear → `POST /api/focus` (`{id}` set, empty clear)
  - links/memory edit → `PUT /api/tasks/:key` (server merges `By` by id — preserved, never authored here)
  - item drop → `POST /api/roadmap/:id/drop` (confirm first)
  - task archive → `DELETE /api/tasks/:key` (confirm; 409 when open items remain)
- **Attribution**: display-only. `owner / ownerNote / mode / by` are shown, never entered. No attribution input controls exist.
- **Destructive actions**: drop and archive require confirmation; the 409 body is surfaced verbatim.
- **triage**: CLI-only (no server route). Inbox is read-only + a mono hint.
- **task create**: key-only. A new key (`[A-Z0-9_-]+`, client-validated) creates an empty task implicitly via the first links/memory PUT (`ops.taskCreate`). Richer task creation is CLI-only.
- **keyboard**: every control reachable/operable via semantic HTML (`button`, `a`, tablist, dialog). Visible 2px cyan focus ring.
- **feedback**: 100–160ms on hover/focus only.

## Visual System

- **tone / concept**: **Bright ops console** — a light, airy operations surface: white cards on a soft neutral field, one calm teal signal for focus/action. (Owner reversed the earlier dark "Blueprint instrument" pick after seeing it rendered on real data — see Decision Log 2026-07-09 visual reversal.)
- **design tension**: light, calm, airy chrome (dominant) + one saturated teal signal reserved to focus/CTA (counterpoint). Airiness is toned to ops density — not a marketing dashboard; rows stay ≤40px.
- **signature moment**: the focus/next **dock** as an elevated white card with a 3px teal left rail — the "this one next" cue is carried structurally by the rail + elevation + a reserved primary CTA, never by type size.
- **palette roles**:
  - surfaces: bg `#f6f8fa` · surface `#ffffff` · surface-2 `#f0f4f8` · border `#e4e9ef` · border-strong `#d3dbe3`
  - text: `#1a2430` · muted `#5b6b7a` · faint `#98a4b2` (faint = secondary labels only, never essential info)
  - **accent teal `#0d9488`** (strong `#0f766e` · weak-tint `#e6f4f2` · line `#a7ddd6`): **focus ring / primary CTA / selection / live signal ONLY** — never bleeds into priority.
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
- **task view**: header (`key`) + segmented tabs `backlog · closed · links · memory`. backlog = open rows (≤40px). closed = recentlyClosed filtered (cap + show-older). links/memory = editable list (PUT); `By` shown read-only. Archive button (DELETE; confirm + 409 verbatim).
- **item view**: detail (join `item`: id/title/priority/note/status/task/owner/mode/dependsOn — `depends on` row shown only when non-empty) + top-level `plan` (path/status/nextStep/baseBranch/baseCommit/branch/worktree) + context links/memory (read; `by` shown) + `[copy resume]` for mapped plans or `[copy kickoff]` otherwise (from `:id/next` text) + `[focus]` / `[drop]` (confirm). The `task` field is a **link** to `#/task/<KEY>`; breadcrumb shows `roadmap → task → item`. When the item is **closed**, mutation actions (kickoff/focus/drop) are hidden and a `closed · <status>` badge shows instead (closed items are read-only).
- **footer chips**: `inbox N` · `tasks N` · `validate ✓ / N errors` (errors → warn color, expandable).
- **owners chip (conditional)**: shown only when some open item has `mode:collab`; groups per owner via `/api/next`. Hidden in solo.
- **component states**: default / hover / focus-visible / active / disabled / loading / empty / error / selected, as applicable per component.

## Responsive & Accessibility

- **breakpoints**: desktop-first operator tool; graceful reflow ≥1024px; below → single column, dock stacks. Mobile is not a primary target.
- **touch targets**: dense desktop controls may be <44px only while keyboard focus and pointer affordance stay explicit.
- **focus path**: visible 2px cyan outline (shape, never color-only). Tab order header → dock → queue → footer; drill views restore scroll on back.
- **contrast**: text and muted meet 4.5:1 on the bg surfaces; faint is reserved for non-essential labels.
- **reduced motion**: disable dock glow/transitions; all state remains legible without motion.
- **screen reader / semantics**: semantic `button`/`a`/tablist/dialog; 409 and fetch errors announced via a status region; priority always carries its text label (color is additive).

## Performance & Formatting

- **perceived latency**: refetch after a mutation; show pending state on the acting control, not a full-page block.
- **skeleton/spinner**: skeleton queue rows on first load; inline spinner on drill fetch.
- **numbers / ids**: mono / tabular. Dates pass through from the server as-is; no client timezone math.
- **i18n**: N/A — personal tool; mixed ko/en content passes through unaltered.

## Microcopy

- empty inbox: `inbox clear · triage new items with `pm triage <id> <KEY>`` (mono).
- empty queue: `no eligible items · `pm add <KEY> <id> -p P2 --title …`` (mono; confirm exact verb against pm-roadmap at build).
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
- **render verify**: playwright via `ai/skills/spa-fetch/node_modules` absolute import, `channel:"chrome"`; screenshot home / task / item + key states.
- **server contract**: reads listed under Data & State Model; `open[]` adds plan-derived `nextStep`, `baseBranch`, `baseCommit`, `branch`, and `worktree`; missing/unreadable plans return `nextStep: null` and empty mapping strings; no new write routes.
- **PM repo sync**: pm-context is tracked in `~/Projects/skills/pm` → run `bash scripts/sync-from-config.sh` + `--check` after changes.

## Decision Log & Open Questions

- **2026-07-09** — Rebuilt no-reference. IA = single operating view + drill (owner pick over master-detail / single-canvas). Visual (initial) = Blueprint instrument (owner pick over calm-console / departures-board render gate). next-up = structural dock (two prior type-scale attempts under-delivered). `plan.nextStep` exposed additively on `open[]` only — `/join` already exposes it via the top-level `plan` PlanInfo, and `item.plan` stays a string path. plan-review R1→R2 (cross-model) converged.
- **2026-07-09 (visual reversal)** — After seeing the dark Blueprint-instrument rendered on real data, the owner supplied a light/airy reference (a bright dashboard) and chose to switch. Visual direction is now **Bright ops console** (light). IA, components, data/state model, action×route matrix, and the 6 invariants are UNCHANGED — only visual tokens flipped: dark→light, cyan→teal, angular(2–4px)→soft(8–12px), corner-marks/grid→rail+elevation, pulse→static dot. The original dark pick is kept above as history. Lesson: a passed owner-taste gate can still reverse once rendered on real data — cheap here because IA/structure were held stable; only the tokens moved.
- **2026-07-09 (in-flight surface)** — The dock gained a third **In progress** state driven by an additive `inFlight` field on `/api/roadmap` (resolved from `.agents/state/current.txt` → the open item whose `Plan:` matches). Precedence `inFlight > focus > next-eligible`; the in-flight item is elevated into the dock **without requiring focus** (prev. it sat buried as a plain queue row). Chosen over a repurposed `/api/current` GET + separate strip (extra fetch, two competing elevated cards) and over a badge-only treatment (fails when the in-flight item is buried in the queue). No new write route; `/api/current` left untouched (its `focus.txt`-derived "current task" is a distinct legacy concept). Deferred: hardening the dock fallback to validate each candidate id against `open[]` so a stale focus can't suppress next-up (pre-existing, out of scope). Codex plan-review R1 = APPROVED. **Follow-up (same session, owner request):** because `inFlight > focus`, a focus differing from the in-flight item was demoted to an unmarked queue row — added a **secondary Focus card** (flat `.dock.secondary`, under the primary dock, shown only when `focus !== dockId`) so an explicit focus is never buried. dock render extracted to a shared `dockCard()` helper. Owner picked the full card over a slim strip.
- **2026-07-13 (worktree resume)** — Mapped plans expose immutable base, branch, and worktree in roadmap/join reads. The dock and item detail show the execution location and copy the rooted resume prompt already produced by `pm next`; incomplete or unreadable legacy mappings degrade to the existing kickoff display.
- **Open**: confirm exact pm CLI verbs used in empty-state hints at build time (`pm add` / `links add` / `memory add` / `triage`); the owners-chip trigger (any collab item) may need refinement if collab is actually used.
