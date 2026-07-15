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

Material gaps: incomplete error and pending recovery, incomplete keyboard activation and announced feedback, contrast-floor failures, contract-claimed task-create and closed-overflow paths are not reachable as described

These are accepted as current-surface gaps, not implementation scope for this contract refresh. A separate approved implementation item is required before changing `roadmap.html`, `server.ts`, or their tests to close them.

## Data & State Model

- **Reads**: `/api/roadmap` (open[] incl. additive `nextStep`, `baseBranch`, `baseCommit`, `branch`, `worktree` + `dependsOn`, `blockedBy`, recentlyClosed, focus, **`inFlight`**, project) · `/api/next` (eligible/blocked/focus/inbox count) · `/api/inbox` (items) · `/api/roadmap/:id/join` (detail: item incl. `dependsOn`, top-level `plan` PlanInfo, contextLinks/Memory, siblings) · `/api/roadmap/:id/next` (kickoff/resume text) · `/api/tasks` (list+counts) · `/api/tasks/:key` (links/memory) · `/api/roadmap/validate` (health).
- **`inFlight` (in-flight item)**: on `/api/roadmap`, the id of the backlog item whose `Plan:` equals the plan named by `.agents/state/current.txt` (the in-flight plan pointer, draft|active), resolved against `open[]`; `null` when no open item matches (standalone `pm_loop:false` plan, already-closed item, or a stale pointer). Read-only, derived, additive — no new write route. Drives the dock's **In progress** state.
- **`/api/current` (legacy, unused by the dashboard)**: returns the *current task key* derived from `focus.txt` — a separate concept from the `current.txt` in-flight-plan pointer above. The dashboard does not consume it; the in-flight item surfaces via `/api/roadmap.inFlight`. Left untouched for compatibility.
- **DependsOn / blockedBy**: `dependsOn` is a backlog item's declared dependency ids (may be cross-task). The derived `blockedBy` (single id) is the first unresolved dependency, else an earlier-Order sibling — an item is blocked while any DependsOn target is still in some active backlog.
- **empty**: name the CLI next step in mono (see Microcopy). Never a blank pane.
- **loading (current)**: skeleton rows for Home on first paint; task/item/inbox/tasks show inline loading text rather than a spinner.
- **error (current)**: Home fetch failure renders inline detail plus `retry`; item/task render inline detail plus `back`; inbox/tasks render inline detail with no recovery control. The latter two patterns do not meet the user-job recovery requirement.
- **conflict (409)**: render the server message **verbatim** (drop / archive / focus / PUT). Never parse or rewrite it.
- **partial reads (current)**: Home keeps the primary queue when task-count or validation reads fail, but task count degrades to `·` and validation keeps its default/positive presentation without an explicit unavailable state.
- **overflow / long content (current)**: queue id/title/task cells use ellipsis; detail content wraps. `/api/roadmap.recentlyClosed` is capped at 50 globally, while the task Closed tab renders its filtered rows without a continuation or `show older` control.
- **realtime**: none. Every successful mutation triggers a refetch (no optimistic state).

### Required states and recovery

| Surface/action | Current state | Required recovery contract | Baseline |
| --- | --- | --- | --- |
| Home | Skeleton → dock/queue/footer; fetch error has `retry`; empty queue names `pm add` | Retry in place and retain the Home route | PASS |
| Task | Loading text; fetch error has `back` only | Preserve the task route and offer retry plus back | FAIL |
| Item | Loading text; fetch error has `back` only | Preserve the item route and offer retry plus back | FAIL |
| Inbox | Loading text; fetch error has no control; empty state names `pm triage` | Offer retry without inventing GUI triage | FAIL |
| Tasks index | Loading text; fetch error has no control; empty state names `pm task create` | Offer retry and preserve the read-only index | FAIL |
| Mutation | Control stays enabled while pending; success refetches; errors enter the alert banner | Disable only the acting control, expose pending state, refetch on success, and keep verbatim 409/error feedback | FAIL |
| Clipboard | `/next` failure enters the alert banner; success temporarily replaces validation-pill text | Keep the copy action retryable and announce success through a dedicated status region | FAIL |
| Partial reads | Primary Home data survives auxiliary failure, but unavailable state is implicit | Mark failed auxiliary data unavailable; never present stale/default health as success | FAIL |
| Overflow | Queue ellipsis and detail wrapping prevent viewport overflow; Closed has no continuation | Keep full values accessible and expose continuation when the server cap truncates closed history | FAIL |

## Interaction Model

- **Mutations (no optimistic UI)** — each maps to a real route; on success refetch, on 409 show verbatim:
  - focus set/clear → `POST /api/focus` (`{id}` set, empty clear)
  - links/memory edit → `PUT /api/tasks/:key` (server merges `By` by id — preserved, never authored here)
  - item drop → `POST /api/roadmap/:id/drop` (confirm first)
  - task archive → `DELETE /api/tasks/:key` (confirm; 409 when open items remain)
- **Attribution**: display-only. `owner / ownerNote / mode / by` are shown, never entered. No attribution input controls exist.
- **Destructive actions**: drop and archive require confirmation; the 409 body is surfaced verbatim.
- **triage**: CLI-only (no server route). Inbox is read-only + a mono hint.
- **task create (current gap)**: the server can create an empty task implicitly on the first links/memory PUT for a new `[A-Z0-9_-]+` key, but the dashboard exposes no entry point for an unknown key. Task creation is therefore CLI-only in the current UI despite the upstream capability.
- **keyboard (current)**: native buttons/anchors and Home queue pseudo-links are operable; Tasks-index and closed-item `.row[role=link]` controls are focusable but do not activate on Enter. The required focus indicator is a visible 2px teal outline.
- **feedback (current)**: hover/focus transitions use 100–160ms; mutations do not expose acting-control pending/disabled state; copy success reuses validation-pill text rather than a dedicated announced status.

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
- **task view**: header (`key`) + segmented tabs `backlog · closed · links · memory`. backlog = open rows (≤40px). closed = the globally capped `recentlyClosed` response filtered to the task, with no continuation control (current gap). links/memory = editable list (PUT); `By` shown read-only. Archive button (DELETE; confirm + 409 verbatim).
- **item view**: detail (join `item`: id/title/priority/note/status/task/owner/mode/dependsOn — `depends on` row shown only when non-empty) + top-level `plan` (path/status/nextStep/baseBranch/baseCommit/branch/worktree) + context links/memory (read; `by` shown) + `[copy resume]` for mapped plans or `[copy kickoff]` otherwise (from `:id/next` text) + `[focus]` / `[drop]` (confirm). The `task` field is a **link** to `#/task/<KEY>`; breadcrumb shows `roadmap → task → item`. When the item is **closed**, mutation actions (kickoff/focus/drop) are hidden and a `closed · <status>` badge shows instead (closed items are read-only).
- **footer chips**: `inbox N` · `tasks N` · `validate ✓ / N errors` (errors → warn color, expandable).
- **owners chip (conditional)**: shown only when some open item has `mode:collab`; groups per owner via `/api/next`. Hidden in solo.
- **component-state requirement**: default / hover / focus-visible / active / disabled / loading / empty / error / selected, as applicable. Current acting controls do not implement pending/disabled mutation state; this remains a required gap rather than a claimed implementation state.

## Responsive & Accessibility

- **breakpoints**: desktop-first operator tool; graceful reflow ≥1024px; below → single column, dock stacks. Mobile is not a primary target.
- **touch targets**: dense desktop controls may be <44px only while keyboard focus and pointer affordance stay explicit.
- **focus path (current)**: visible 2px teal outline with 2px offset. Native header/dock/footer controls and pseudo-link rows enter the tab order; `history.back()` is used in drill views, but there is no explicit scroll-restoration implementation.
- **contrast evidence (2026-07-15)**: text/surface `15.68:1` and muted/surface `5.48:1` pass. White/accent primary CTA text is `3.74:1`, below the `4.5:1` normal-text floor. Faint/surface is `2.53:1`; faint may remain only on genuinely non-essential labels, while current breadcrumb/task/id-label uses require review.
- **reduced motion**: `prefers-reduced-motion: reduce` disables all CSS animation and transition; state remains legible without motion.
- **screen reader / semantics (current)**: native buttons/anchors/tabs are semantic; priority always carries its text label; mutation errors enter an assertive banner/`role=alert`. Fetch errors rendered directly in `main` and copy-success text in the validation pill do not have dedicated status semantics.

## Performance & Formatting

- **perceived latency**: mutation success refetches the route. Required but not yet implemented: show pending/disabled state on the acting control rather than a full-page block.
- **skeleton/spinner**: Home uses skeleton queue rows on first load; drill/index views use inline loading text, not a spinner.
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
- **render verify**: Playwright via `ai/skills/spa-fetch/node_modules` absolute import, `channel:"chrome"`. Inspect Home/Task/Item at 1440×1000, Home at 800×1000, and intercepted failure/partial/pending/clipboard/keyboard states. Every non-GET request is intercepted locally when verification uses real task data.
- **server contract**: reads listed under Data & State Model; `open[]` adds plan-derived `nextStep`, `baseBranch`, `baseCommit`, `branch`, and `worktree`; missing/unreadable plans return `nextStep: null` and empty mapping strings; no new write routes.
- **PM repo sync**: pm-context is tracked in `~/Projects/skills/pm` → run `bash scripts/sync-from-config.sh` + `--check` after changes.

## Design-Fit Verification

### Objective READY gate

`READY` is valid only when every applicable verification row passes and every `N/A` includes a concrete reason. Design judgment cannot override verification. A failed browser measurement requires source correction plus a fresh render and measurement while correction is authorized and fewer than two cycles have been used; otherwise report the exact failure appendix and `NOT VERIFIED`.

### Evidence baseline — 2026-07-15

- **render coverage**: Home `/`, Task `#/task/PM_SKILLS`, and Item `#/item/refresh-pm-context-design-contract` at 1440×1000; Home at 800×1000; route failures intercepted for Home, Item, Task, Inbox, and Tasks.
- **geometry**: queue/task rows `38px`; desktop document width `1440/1440`; narrow document width `800/800`; narrow dock width `768px`; no unexpected viewport overflow in the inspected paths. Long queue ids use intentional ellipsis.
- **focus**: `button.primary` computed outline is `2px solid #0d9488` with `2px` offset.
- **recovery**: Home error exposes retry; Item/Task expose back only; Inbox/Tasks expose no recovery control.
- **keyboard**: the first Tasks-index `.row[role=link]` retains `#/tasks` after Enter; the control does not activate.
- **contrast**: text/surface `15.68:1`; muted/surface `5.48:1`; white/accent `3.74:1`; faint/surface `2.53:1`.

Design judgment:
- User-job fit: The structural dock, rooted copy action, and bidirectional drill serve the primary daily job well, but incomplete failure/retry paths prevent full closure.
- Workflow and product specificity: The single operating view, CLI next-step hints, in-flight/focus precedence, and display-only attribution are specific to this CLI-first PM workflow.
- Hierarchy, density, and craft: The elevated teal-rail dock carries next-work priority structurally; 38px queue rows preserve operations density without horizontal overflow at the inspected sizes.
- Contract integrity: The refreshed contract separates implemented behavior, required behavior, measured failures, and deferred implementation instead of claiming absent recovery or accessibility states.

Verification status:
- User-job closure: FAIL - Requested and success paths are visible, but Item/Task/Inbox/Tasks recovery and announced copy success are incomplete.
- Required states/recovery: FAIL - Drill/index retry, acting-control pending/disabled state, explicit partial-read failure, and closed-history continuation are absent.
- Inspected render coverage: PASS - Home/Task/Item desktop, Home narrow, and the named intercepted failure paths were inspected against frozen realistic data.
- Geometry/overflow: PASS - Inspected queue/task rows are 38px and document scroll width equals client width at 1440px and 800px; observed ellipsis is intentional.
- Accessibility floors: FAIL - Tasks-index keyboard activation fails; primary CTA text is 3.74:1; faint text is 2.53:1 and appears in uses that require essential/non-essential review; copy success lacks announced status semantics.
- Contract/code/render agreement: FAIL - The current UI has no task-create entry, Closed continuation, explicit scroll restoration, or the pending/recovery behavior previously claimed by the contract.

Outcome: NOT VERIFIED

### Failure appendix — recovery controls

Failed selector/control: Item/Task error `.empty button`, Inbox/Tasks error `.empty`
Observed value: Item/Task expose `back` only; Inbox/Tasks expose no recovery control.
Required threshold: Every recoverable fetch failure exposes in-context retry without discarding the current route.
Correction cycles used: 0
Stop reason: correction unauthorized - this approved task is contract-only on the config side; UI fixes require a separate implementation item.

### Failure appendix — pending and announced feedback

Failed selector/control: acting focus/save controls and copy-success `#validate-txt`
Observed value: Acting controls remain enabled while requests are pending; copy success temporarily replaces validation text without dedicated live-status semantics.
Required threshold: Disable only the acting control with pending feedback and announce copy success in a dedicated status region.
Correction cycles used: 0
Stop reason: correction unauthorized - this approved task is contract-only on the config side; UI fixes require a separate implementation item.

### Failure appendix — keyboard activation

Failed selector/control: `#/tasks .row[role=link]` and task Closed `.row[role=link]`
Observed value: Enter does not change the route for the Tasks-index row; closed rows have no keyboard activation handler.
Required threshold: Every focusable interactive control is operable by keyboard with the same result as pointer activation.
Correction cycles used: 0
Stop reason: correction unauthorized - this approved task is contract-only on the config side; UI fixes require a separate implementation item.

### Failure appendix — contrast floors

Failed selector/control: `button.primary` text and essential uses of `--faint`
Observed value: White/accent contrast is 3.74:1; faint/surface contrast is 2.53:1.
Required threshold: Normal text is at least 4.5:1; non-text focus/UI indicators are at least 3:1; sub-floor faint color is limited to non-essential content.
Correction cycles used: 0
Stop reason: correction unauthorized - this approved task is contract-only on the config side; UI fixes require a separate implementation item.

### Failure appendix — contract agreement

Failed selector/control: task-create entry, Closed continuation, explicit scroll restoration
Observed value: No task-create or show-older control exists; drill uses `history.back()` without explicit scroll-restoration code.
Required threshold: Every committed contract action/state is reachable in code and visible in the inspected render, or is explicitly recorded as a gap.
Correction cycles used: 0
Stop reason: correction unauthorized - this approved task is contract-only on the config side; UI fixes require a separate implementation item.

## Decision Log & Open Questions

- **2026-07-09** — Rebuilt no-reference. IA = single operating view + drill (owner pick over master-detail / single-canvas). Visual (initial) = Blueprint instrument (owner pick over calm-console / departures-board render gate). next-up = structural dock (two prior type-scale attempts under-delivered). `plan.nextStep` exposed additively on `open[]` only — `/join` already exposes it via the top-level `plan` PlanInfo, and `item.plan` stays a string path. plan-review R1→R2 (cross-model) converged.
- **2026-07-09 (visual reversal)** — After seeing the dark Blueprint-instrument rendered on real data, the owner supplied a light/airy reference (a bright dashboard) and chose to switch. Visual direction is now **Bright ops console** (light). IA, components, data/state model, action×route matrix, and the 6 invariants are UNCHANGED — only visual tokens flipped: dark→light, cyan→teal, angular(2–4px)→soft(8–12px), corner-marks/grid→rail+elevation, pulse→static dot. The original dark pick is kept above as history. Lesson: a passed owner-taste gate can still reverse once rendered on real data — cheap here because IA/structure were held stable; only the tokens moved.
- **2026-07-09 (in-flight surface)** — The dock gained a third **In progress** state driven by an additive `inFlight` field on `/api/roadmap` (resolved from `.agents/state/current.txt` → the open item whose `Plan:` matches). Precedence `inFlight > focus > next-eligible`; the in-flight item is elevated into the dock **without requiring focus** (prev. it sat buried as a plain queue row). Chosen over a repurposed `/api/current` GET + separate strip (extra fetch, two competing elevated cards) and over a badge-only treatment (fails when the in-flight item is buried in the queue). No new write route; `/api/current` left untouched (its `focus.txt`-derived "current task" is a distinct legacy concept). Deferred: hardening the dock fallback to validate each candidate id against `open[]` so a stale focus can't suppress next-up (pre-existing, out of scope). Codex plan-review R1 = APPROVED. **Follow-up (same session, owner request):** because `inFlight > focus`, a focus differing from the in-flight item was demoted to an unmarked queue row — added a **secondary Focus card** (flat `.dock.secondary`, under the primary dock, shown only when `focus !== dockId`) so an explicit focus is never buried. dock render extracted to a shared `dockCard()` helper. Owner picked the full card over a slim strip.
- **2026-07-13 (worktree resume)** — Mapped plans expose immutable base, branch, and worktree in roadmap/join reads. The dock and item detail show the execution location and copy the rooted resume prompt already produced by `pm next`; incomplete or unreadable legacy mappings degrade to the existing kickoff display.
- **2026-07-15 (frontend-design v1.0.0 contract refresh)** — Preserved the approved UI direction and implementation, added exact user-job/material-gap/readiness records, corrected contract claims against code/render evidence, and recorded the current surface as objectively `NOT VERIFIED`. No config-side UI fix is authorized in this task; the four PM-repo code/test drifts belong to the previously verified worktree-resume delivery.
- **Open**: confirm exact pm CLI verbs used in empty-state hints at build time (`pm add` / `links add` / `memory add` / `triage`); close the recorded recovery, pending, keyboard, contrast, task-create, and closed-overflow gaps only through separately approved implementation items; the owners-chip trigger may need refinement if collab is actually used.
