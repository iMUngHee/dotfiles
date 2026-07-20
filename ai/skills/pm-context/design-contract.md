# design-contract.md

## Scope & Inheritance

- **Applies to:** `ai/skills/pm-context/roadmap.html` and the dashboard-facing HTTP contract in `ai/skills/pm-context/server.ts`.
- **Parent contract:** none. This is the leaf and canonical product-surface contract for the PM dashboard.
- **Override rules:** this contract owns the visible experience and interface. The task store, plan lifecycle, and CLI invariants remain authoritative upstream inputs. UI engineering may update only Implementation Bridge after build authorization.
- **Owner:** 대협.
- **Depth:** Full.
- **Last updated:** 2026-07-20.

## Surface Type & Craft Profile

- **Surface:** task-centric operations dashboard for a CLI-first PM system.
- **Concept:** **Task Desk** — a calm, comfortable workspace that keeps Task navigation, current execution, work, and task-wide context visible together.
- **Density:** moderate operations density, not an ultra-compact queue. Standard work rows are `44px`; two-line rows grow to at least `52px`; desktop navigation rows are `36px`; controls are `36px`, primary controls `38px`, and narrow touch controls `44px`.
- **Craft priorities:** resume or choose work without ambiguity; inspect a Task as a coherent workspace; manage common backlog and collaboration operations without leaving the dashboard; retain truthful recovery and CLI boundaries.
- **Anti-patterns:** tiny rows used to simulate efficiency, a card for every datum, a marketing hero, a command palette, decorative gradients, color-only status, hidden hover-only actions, and a persisted task/item selection that competes with current-plan selection.
- **Quality bar:** the primary user can understand current execution, choose the next candidate explicitly, make common safe changes, and recover from partial or conflicting state without reading implementation details.

## Product Context

- **Primary user:** 대협 working solo across multiple Tasks.
- **Secondary user:** a collaborator participating in a Task whose mode is `collab`; collaboration controls stay conditional when the project is entirely solo.
- **Primary object:** Task. A Task owns its status, mode, collaborators, open Items, closed history, links, and memory.
- **Work unit:** Item. An Item owns title, priority, order, dependency ids, lifecycle status, optional plan, and collaboration ownership.
- **Execution state:** Plan and worktree mapping. Current execution is derived from the selected current plan, never from a second task/item pointer.

### Jobs and success

1. **Resume current work or explicitly select what is next.** Success is a rooted resume/kickoff prompt and visible mapping to plan, branch, and worktree.
2. **Explore a Task.** Success is one Task Workspace with Overview, Work, History, and Context without losing Task identity.
3. **Create and organize work.** Success is Task/Item creation plus priority, order, and dependency editing with validation and authoritative refetch.
4. **Coordinate lightweight collaboration.** Success is visible actor source, claim, release, and handoff with conflict protection.
5. **Manage context and lifecycle safely.** Success is link/memory editing, archive/drop confirmation, visible recovery, and clear CLI handoff for intentionally unsupported operations.

### Non-goals

- Changing Task mode or collaborator roster in the GUI.
- Inbox triage, Task restore, terminal reclassification, worktree/plan administration, bulk editing, or forced owner overwrite in the GUI.
- Item-specific relevance metadata for Task links or memory.
- Automatic candidate selection or any persistent server-side navigation selection.
- Replacing the CLI as the authoritative lifecycle and recovery tool.

### User-job closure

User-job closure:
- Requested action: Resume current execution, explicitly choose eligible work when no current plan exists, inspect its Task, and perform common safe management actions.
- Success: The dashboard shows a linked or standalone current plan when present; otherwise it shows the eligible candidate set and waits for an explicit choice. Successful mutations refetch authoritative state and successful copy provides visible confirmation.
- Failure/retry: Read failures stay local to the affected panel; mutation failures retain entered data; owner conflicts show the authoritative owner and offer reload/retry; clipboard failure preserves the prompt for manual copying; server failure exposes reconnect/retry.
- Preserved invariants: Task remains the primary object; current-plan selection is the only cross-task execution selector; GUI ownership changes never force overwrite; Task-scoped context is labelled as task-wide; CLI-only boundaries remain visible.

## UX Model

### Information architecture and routes

The dashboard uses query-based routes on `/` so refresh and browser history work without additional server routing:

| Screen | Query route | Intent |
| --- | --- | --- |
| Now | `?view=now` or default | Resume current execution or explicitly choose an eligible candidate. |
| Tasks | `?view=tasks` | Search, scan, and create Tasks. |
| Task Workspace | `?view=task&task=<KEY>&tab=<overview|work|history|context>` | Operate within one Task. |
| Item detail | `?view=item&item=<id>` | Inspect and manage one Item nested under its Task. |
| People | `?view=people` | Conditional owner board for projects with collaboration data. |
| Inbox / Health | `?view=health` | Inspect inbox, validation, actor, and server health; triage remains CLI-only. |

Unknown views or missing identifiers render Route not found with a route back to Now. Search and filter state are retained in query parameters.

### Macrostructure and navigation

- Desktop uses a `58px` top bar, `220–240px` Task rail, fluid main workspace, `300–340px` Context rail, and `32–38px` footer/status bar.
- The Task rail is persistent on wide screens and shows search, Task list, creation entry, and navigation destinations.
- The main workspace owns current execution, Task header/tabs, work table, forms, and item detail.
- The Context rail shows task-wide links and the newest three task memories, with a route to full Context.
- People appears only when at least one active Task or Item contains collaboration data.
- Narrow layouts replace the persistent rail with a menu drawer while preserving Now and the current primary action.

### Screen inventory and content priority

- **Now:** current-plan panel first; eligible candidates second; blocked work third; health summary last.
- **Tasks:** search/create controls, active Task list, counts, then archived/CLI guidance.
- **Task Workspace / Overview:** Task identity, status/mode/collaborators, current/open summary, recent history, task-wide context preview.
- **Task Workspace / Work:** creation controls, filters, open Item table, priority/order/dependency editing, ownership actions.
- **Task Workspace / History:** newest-first closed history with explicit expansion.
- **Task Workspace / Context:** all Task links and memory with edit controls and attribution display.
- **Item detail:** identity/status, plan mapping and next step, organization fields, owner/handoff, Task-wide context preview, destructive action.
- **People:** actor identity/source, owners and unassigned groups, handoff notes, Task links.
- **Inbox / Health:** inbox items, roadmap validation, actor status, server/retry status, exact CLI next steps.

### Primary workflows

1. **Resume/select next:** load Now → inspect current plan → copy resume; or, if none, filter eligible candidates → open Item → copy kickoff.
2. **Task exploration:** choose Task in rail → inspect Overview → move between Work, History, and Context → open Item → return to the same Task/tab.
3. **Create/organize:** create Task or Item → validate → submit → refetch → edit priority/order/dependencies → preserve query/filter state.
4. **Lightweight collaboration:** inspect actor source → claim unassigned Item → release or hand off using expected owner → refetch; conflict shows authoritative owner.
5. **Context/lifecycle:** edit Task links/memory → confirm drop/archive → recover from validation/conflict → use named CLI command for unsupported administration.

Material gaps: none.

## Data & State Model

### Read model

- `GET /api/roadmap` returns project summary, structured `currentPlan`, open Items, recently closed Items, and Task projections.
- `currentPlan` has one of these visible states:
  - `linked`: selected draft/active plan linked to an open Item and Task, with plan mapping and resume data.
  - `standalone`: selected draft/active `pm_loop:false` plan, with plan mapping but no Task/Item.
  - `stale`: pointer missing, unreadable, terminal, or inconsistent; display the reason and recovery command.
  - `empty`: no current selection; show eligible candidates without choosing one.
- `GET /api/next` returns `eligible`, `blocked`, and inbox count. It does not choose a candidate.
- `GET /api/current-plan/next` returns rooted resume text for a resumable current plan or a typed conflict/not-found response.
- `GET /api/roadmap/:id/join` returns Item, Task, plan, task-wide context, and recent sibling evidence.
- `GET /api/roadmap/:id/next` returns rooted kickoff/resume text for an explicit Item.
- `GET /api/tasks` returns Task key, title, status, mode, collaborators, open/closed counts, and context counts.
- `GET /api/tasks/:key?closed=N` returns Task metadata, open Items, context, and an optional newest-first closed projection.
- `GET /api/actor` returns resolved actor and source: explicit environment, checkout-local actor file, git email fallback, or unavailable.
- `GET /api/inbox` and `GET /api/roadmap/validate` provide Inbox / Health data.

### Mutation model

| Action | HTTP route | Authoritative operation |
| --- | --- | --- |
| Create Task | `POST /api/tasks` | `taskCreate` |
| Add Item | `POST /api/tasks/:key/items` | `itemAdd` |
| Set priority | `POST /api/roadmap/:id/reprioritize` | `itemSetPriority` |
| Set order | `POST /api/roadmap/:id/reorder` | `itemSetOrder` |
| Set dependencies | `POST /api/roadmap/:id/depend` | `itemSetDeps` |
| Claim | `POST /api/roadmap/:id/claim` | `itemSetOwner`, resolved actor, no force |
| Release | `POST /api/roadmap/:id/release` | expected-owner guarded owner clear |
| Handoff | `POST /api/roadmap/:id/handoff` | expected-owner guarded target owner plus note |
| Edit Task context | `PUT /api/tasks/:key` | full Task link/memory update preserving attribution |
| Drop Item | `POST /api/roadmap/:id/drop` | planless drop with confirmation |
| Archive Task | `DELETE /api/tasks/:key` | archive with open-item guard |

### Search and context

- Global search covers Task key/title, Item id/title/note, and owner.
- Task Context search covers link label/summary/triggers and memory title/note.
- Query and filter values remain in the URL across refetch and browser navigation.
- Item detail shows all Task links and the newest three Task memories. Both groups are labelled `Task-wide`; no heuristic relevance claim is made.

### Required states and recovery

| State | Visible outcome | Recovery |
| --- | --- | --- |
| Linked active/draft current | Current-plan panel with Task/Item mapping and resume action | Open Task/Item or copy resume |
| Standalone current | Current-plan panel without Task assumptions | Copy resume or open plan path |
| Stale/terminal current | Warning with exact reason | Named select/cleanup CLI command and refresh |
| Candidates | Eligible set with filters, no preselected row | Explicitly open one candidate |
| Blocked-only | Blocker id and dependency/ordering reason | Open blocker or edit dependencies |
| First-use empty | Exact Task/Item creation action | Create in GUI or use shown CLI command |
| Search empty | Query and active filters remain visible | Clear one filter or search term |
| Loading/delayed | Skeleton only on initial Now load; panel-level loading elsewhere | Continue using unaffected panels |
| Partial read failure | Failed panel shows unavailable/error; successful panels remain | Retry only the failed panel |
| Server unavailable | Full-page connection status | Retry connection without losing URL state |
| Long content/volume | Wrapping, clamping, or panel scrolling; no viewport overflow | Open full value/context where truncated |
| Validation failure | Persistent field error associated with its label | Correct input and resubmit |
| Mutation pending | Acting control disabled and relabelled; status announced | Wait or continue using unaffected controls |
| Mutation conflict | Authoritative current owner/state shown | Reload affected data, then retry intentionally |
| Actor unavailable | Collaboration actions disabled with setup guidance | Set actor through the named CLI/env path |
| Git fallback actor | Actor and `git user.email` source visibly identified | Confirm identity before claiming |
| Clipboard failure | Prompt remains visible/selectable | Copy manually or retry |
| Destructive confirmation | Native modal names object and consequence | Cancel or confirm; focus returns to trigger |
| Route not found | Unknown route and supplied identifier shown | Return to Now or Tasks |

## Interaction Model

- **Mutation policy:** pessimistic. Disable only the acting control, announce pending state, submit, then refetch the smallest authoritative read model. Do not invent client-side success.
- **Conflict policy:** `409` retains user input and displays the authoritative server message. Release and handoff require `expectedOwner`; GUI calls never set force.
- **Validation:** use native required/pattern/min constraints plus persistent field-level messages. Task keys accept `[A-Z0-9_-]+`; Item ids accept kebab-case; priority is P0–P3; order is a positive integer; dependencies are comma-separated existing ids validated by ops.
- **Keyboard:** semantic links, buttons, inputs, selects, tables, and tabs follow document order. Tabs use buttons with `aria-selected`; menu drawer and modal use native dialog behavior. Escape closes overlays, and close restores focus to the opener.
- **Destructive actions:** drop and archive open a confirmation dialog naming the Item/Task and the irreversible lifecycle effect. Archive conflicts preserve the Task.
- **Feedback:** assertive `role=alert` for failures, polite `role=status` for copy/success, inline conflict content for ownership, and no toast-only critical information.
- **Navigation:** query changes are client-side `history.pushState`; `popstate` restores route, filter, and Task/tab. Navigation state is never written to PM state files.
- **Clipboard:** use `navigator.clipboard.writeText`. If unavailable or rejected, keep the generated text in a selectable region and expose Retry copy.
- **Collaboration:** show actor source before mutation. Claim uses the resolved actor. Release/handoff send the owner value last rendered by the authoritative read.
- **CLI boundaries:** unsupported operations show the exact command family but never fabricate a server route.

## Visual System

- **Art direction:** Task Desk — quiet institutional workspace rather than terminal cosplay or consumer productivity chrome.
- **Design tension:** comfortable paper-like panels and stable navigation, countered by a precise teal current-execution panel. The work table remains denser than supporting context.
- **Signature moment:** the current-plan panel is the single elevated surface. Its plan/item mapping and primary resume action form one unmistakable execution readout without oversized typography.
- **Color tokens:**
  - page `#f4f7f9`; surface `#ffffff`; secondary surface `#edf3f5`
  - border `#d9e2e7`; strong border `#aebcc5`
  - ink `#17232d`; muted `#61717d`
  - accent `#0f766e`; hover `#0b5f59`; pressed `#084b47`; tint `#e3f3f1`
  - success `#166534`; warning `#a16207`; danger `#b42318`
  - P0 `#b42318` on `#feeceb`; P1 `#b54708` on `#fff1e8`; P2 `#8a5800` on `#fff8e4`; P3 `#475467` on `#eef1f5`
- **Verified contrast targets:** ink/surface `15.97:1`; muted/page `4.68:1`; white/accent `5.47:1`; warning `4.92:1`; danger `6.57:1`; accent focus indicator/page `5.09:1`; all priority foreground/background pairs exceed `4.9:1`.
- **Typography:** system sans for interface text; `ui-monospace` for Task keys, Item ids, paths, and technical mappings. Body/table `14px`; labels `11px`; page title `22px`; panel title `15px`; current Item id `16px`.
- **Spacing:** 4px base scale: 4, 8, 12, 16, 20, 24, 32. Primary panel padding `16–20px`; table cells `10–12px` horizontal.
- **Radius:** panels `10px`; controls `7px`; priority marks `5px`; only compact status indicators use a full pill.
- **Elevation:** standard panels are flat with borders. The current-plan panel alone uses a restrained shadow and stronger boundary.
- **Motion:** direct feedback `120ms`; drawer `180ms`; dialog `200ms`; explicit opacity/transform/background/border properties only. No row entrance animation, pulse, or `transition: all`. Reduced motion removes non-essential transitions.

## Component Rules

| Component / variant | Size and density | Appearance | Required states | Used in |
| --- | --- | --- | --- | --- |
| Top bar | `58px` | page title, global search, actor/status actions | default, search active, server warning | All screens |
| Task rail | `220–240px`; row `36px` | secondary surface, Task key/title/count, teal active edge | hover, focus-visible, current route, empty | Desktop navigation |
| Current-plan panel | min `128px` | surface, strong border, restrained shadow, teal mapping accent | linked, standalone, stale, empty, loading | Now |
| Task header/tabs | header `64–76px`; tabs `36px` | Task identity first, compact metadata, underline selection | default, selected, focus-visible, disabled | Task Workspace |
| Work row | `44px`; `52px+` for two lines | flat table row, priority token, mono id, title, owner and blocker | hover, focus-visible, blocked, pending, conflict | Now and Work |
| Context card | flexible | bordered surface with task-wide label | populated, empty, loading, error, long content | Context rail and Context tab |
| Field/control | desktop `36px`; primary `38px`; narrow `44px` | `7px` radius, persistent label, accent focus ring | default, hover, focus-visible, invalid, disabled, pending | Forms and toolbars |
| Status/priority mark | content-sized | semantic text plus color; priority radius `5px` | P0–P3, success, warning, danger | Rows and summaries |
| Drawer | width `min(88vw, 320px)` | surface over scrim | opening, open, closing, reduced motion | Tablet/mobile Task navigation |
| Dialog | width `min(92vw, 480px)` | bordered surface, explicit object/consequence | open, invalid, pending, conflict | Destructive and handoff actions |
| Footer/status bar | `32–38px` | compact project, inbox, validation, server indicators | healthy, partial, warning, unavailable | Wide screens; wraps on narrow |

### Interface invariants

1. **Task identity stays visible while operating on an Item.** Why: every Item inherits Task context and lifecycle meaning.
2. **Current execution has one elevated presentation.** Why: competing selected/current cards recreate ambiguity.
3. **Work rows are denser than context panels but never below the approved readable height.** Why: comparison needs density without sacrificing convenient interaction.
4. **Ownership and blockers use text in addition to color.** Why: collaboration decisions must remain legible without color perception.
5. **Danger actions never share the primary accent treatment.** Why: irreversible lifecycle actions must be distinct from routine progress.
6. **Task-wide context is labelled wherever it appears beside an Item.** Why: the model does not claim Item relevance.

## Responsive & Accessibility

- **`>=1280px`:** `232px` Task rail + fluid workspace + `320px` Context rail. Footer remains one row.
- **`960–1279px`:** `200px` Task rail + workspace. Context moves below the main work area in a three-column card grid.
- **`640–959px`:** one workspace column. Task rail becomes a menu drawer; Context uses two columns; table toolbars wrap but retain primary actions.
- **`<640px`:** one column. Work rows become stacked records, Context becomes one column, and interactive targets are at least `44px`.
- **Overflow:** no viewport horizontal scrolling. Long ids/paths wrap or use a scrollable value region with an accessible full value. Tables become stacked records below `640px` rather than shrinking columns illegibly.
- **Focus indicator:** `2px solid #0f766e` with `2px` offset. It remains visible against page and surface tokens.
- **Semantics:** landmark header/nav/main/aside/footer; labelled tables and forms; native dialog; status and alert live regions; tab state exposed through `aria-selected` and panel relationships.
- **Touch:** all controls are at least `44px` below `640px`. Dense desktop controls remain keyboard reachable and retain explicit pointer/focus affordance.
- **Reduced motion:** drawer/dialog transitions are removed while visibility and state changes remain immediate and understandable.
- **Color:** text meets `4.5:1`; non-text focus and state indicators meet `3:1`; every semantic color is paired with text or shape.

## Performance & Formatting

- First Now load may use four skeleton work rows; subsequent route/panel reads use inline loading without replacing stable navigation.
- Search and filters derive client-side from already loaded roadmap/Task data. No request is issued per keystroke.
- Mutations refetch only the affected Task, Item, roadmap summary, or actor view; do not reload the entire document.
- Dates are displayed as server-provided ISO dates. Numbers use tabular figures. Ids, keys, paths, branches, and owner sources use mono text.
- Row titles may clamp to two lines only where the full value is available in Item detail. Notes and context wrap without fixed-height clipping.
- The application has no continuous animation, polling loop, scroll listener, webfont, icon package, or image dependency.
- Large Task histories render the server-provided initial slice and expand on demand.

## Microcopy

- Primary navigation: `Now`, `Tasks`, `People`, `Inbox / Health`.
- Current linked plan: `Current work`; primary action `Copy resume`; secondary actions `Open item`, `Open task`.
- No current plan: `Choose the next item`; helper `Nothing is selected automatically.`
- Standalone plan: `Standalone current plan`; helper `This plan is not linked to a Task or Item.`
- Stale current: `Current plan needs attention`; recovery names the exact select or cleanup command supplied by the server.
- Empty eligible list: `No eligible work`; helper distinguishes blocked work from an empty backlog.
- Task-wide context label: `Task-wide context`; helper `Shown for this Task; not ranked for this Item.`
- Actor fallback: `Using git identity`; helper shows the resolved value and asks the user to confirm before claiming.
- Actor unavailable: `Collaboration actions unavailable`; helper names `PM_ACTOR` and `pm whoami <name>`.
- Ownership conflict: `Owner changed`; body shows expected and current owner; actions `Reload item` and `Cancel`.
- Clipboard failure: `Copy failed`; actions `Retry copy` and `Select prompt manually`.
- Destructive confirmation: `Drop <item>?` or `Archive <task>?`; confirm button repeats the destructive verb.
- Inbox guidance: `Triage stays in the CLI` followed by the exact command family.
- Generic recovery: `Retry`; never `Something went wrong` without naming the failed panel/action.

## Do / Don't

- **Do** keep Task identity, current execution, and task-wide context structurally distinct; this preserves the model while supporting fast scanning.
- **Do** provide practical creation, organization, context, and safe collaboration controls; convenience is part of the approved job, not optional polish.
- **Do** keep unsupported lifecycle operations visible as exact CLI handoffs.
- **Do** pair every pending, empty, partial, validation, conflict, and destructive state with a recovery action.
- **Do** reserve elevation for current execution and use borders/backgrounds elsewhere.
- **Don't** compress rows or controls below the approved density merely to fit more records.
- **Don't** create a server-side task/item navigation selector or silently choose the first candidate.
- **Don't** infer link/memory relevance to an Item.
- **Don't** expose forced owner overwrite, Task mode/roster changes, triage, restore, reclassification, or worktree administration in the GUI.
- **Don't** use accent teal for priority, warning, or destructive actions.
- **Don't** hide required information or actions exclusively in hover, tooltip, animation, or color.

## Implementation Bridge

- **Architecture:** retain the existing self-contained `roadmap.html` with inline `<style>` and `<script type="module">`, served by `server.ts`; no framework, build step, font, icon family, animation library, or design-system dependency.
- **Platform primitives:** native landmarks, anchors/buttons/forms, `<dialog>`, `history.pushState`/`popstate`, `URLSearchParams`, `navigator.clipboard`, `fetch`, CSS Grid/Flexbox, media queries, and `prefers-reduced-motion`.
- **State structure:** one application state object for reads, pending operations, errors, and copy feedback; pure derived selectors for route, search/filter, current-plan presentation, Task lists, People groups, and context previews; render functions write semantic DOM; event handlers own side effects and authoritative refetch.
- **Route mapping:** query parameters `view`, `task`, `tab`, `item`, `q`, `priority`, `owner`, and `status`. Route state is browser state only.
- **Token mapping:** define the Visual System values as CSS custom properties on `:root`. Component CSS consumes role tokens rather than raw near-match colors.
- **CSS conventions:** 4px spacing step; flat bordered panels by default; current-plan shadow only; explicit transition properties; desktop table rows and sub-640 stacked records share the same semantic content order.
- **API adapter:** `server.ts` maps HTTP requests to existing `ops.ts` functions. Shared actor resolution lives in `pm-roadmap/actor.ts`. Release/handoff pass `expectedOwner`; errors preserve status and authoritative messages.
- **Testing:** `roadmap.test.ts` checks canonical contract shape, required routes/components, inline module syntax, and removed legacy surface tokens. `server.test.ts` covers every dashboard read/write route, validation, actor states, and conflicts. pm-roadmap tests cover current-plan resolution, CLI compatibility, migration, validation, and owner CAS.
- **Syntax command:** extract the inline module and run `node --check --input-type=module -`.
- **Config commands:** run the pm-context and pm-roadmap test matrices, `git diff --check`, scoped reverse-reference searches, roadmap validation, and the config-audit checklist.
- **Render command:** run Playwright from the installed `spa-fetch` dependency against a copied task fixture with every non-GET intercepted; inspect primary routes at `1440`, `800`, and `560` pixel widths plus required error, pending, conflict, clipboard, actor, form, and dialog states.
- **Mirror command:** stage only authorized PM groups, apply required markdown token transforms, compare bytes, run external PM tests, then run the broad sync check read-only to prove unrelated drift remains untouched.

## Decision Log & Open Questions

- **2026-07-20 — Full contract re-author approved by 대협.** The prior dashboard contract remains historical evidence only because the Product Craft skill and canonical schema changed materially.
- **2026-07-20 — Task-centric IA approved.** Task is the primary navigation and context object; Item detail is nested under Task; current execution derives only from the selected plan.
- **2026-07-20 — Explicit candidate choice approved.** When there is no current plan, the dashboard presents candidates and does not auto-select or persist a replacement selection.
- **2026-07-20 — Practical GUI management approved.** Creation, organization, context editing, and lightweight collaboration belong in the dashboard; administrative and force operations remain CLI-only.
- **2026-07-20 — Safe Task Desk selected.** 대협 chose the calm, comfortable operations workspace over sharper high-contrast and borrowed-dashboard concepts, and explicitly rejected over-compression.
- **2026-07-20 — Responsive contract approved.** Wide three-region composition collapses to below-workspace Context, then drawer navigation, then stacked mobile records at the named breakpoints.
- **Rejected:** preserving the old single operating view, introducing a persistent replacement selector, adding a framework/bundler, heuristic Item relevance for Task context, and broad PM repository synchronization.
- **Open questions:** none.
