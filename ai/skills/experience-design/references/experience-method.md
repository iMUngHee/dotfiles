# Experience Design Method

Use this method to make user jobs, information structure, flows, visible states, recovery, and language implementable without making interface-style decisions.

## Evidence Order

1. Explicit user/product requirements.
2. Approved local `design-contract.md`.
3. Observed product structure, code, realistic data, tests, and inspected renders.
4. Disclosed inference for the selected depth.

Never use an inference to override stronger evidence. Record conflicts as a material question or contract gap.

## User-Job Closure

For every primary workflow, capture:

- Actor and trigger.
- Requested action.
- Observable successful result and feedback.
- Failure or interruption, recovery action, and retry feedback.
- Existing invariants that remain authoritative.

Use the exact shared User-job closure format for additions and refinements.

## Information Architecture

Model the user-visible structure before layout:

- Core objects and concepts in user language.
- Grouping and hierarchy.
- Entry points and navigation relationships.
- Route intent and meaningful URL/state expectations where applicable.
- Screen inventory with each screen's primary job.
- Content priority: must see, should see, available on demand.

Use this compact screen inventory when multiple surfaces are involved:

| Screen / state | Primary user job | Entry | Must-see content | Primary action | Exit / next | Recovery |
| --- | --- | --- | --- | --- | --- | --- |

Do not choose framework routers, directory layouts, or data-fetch architecture here.

### Structural alternatives

The first arrangement that seems reasonable is usually the most conventional one, and
conventional is not the same as right for this content. Before committing, work out at least
one genuinely different organization and compare them.

Different means the grouping logic differs, or the entry points differ, or what the user
encounters first differs — not that the sections were renamed. If you can convert one
alternative into the other by editing labels, you produced one alternative.

Useful axes to vary: what the primary object is, whether browsing is by category or by
recency or by relationship, how much the surface decides for the reader versus lets them
choose, and whether depth lives in navigation or in the page.

For each alternative, say what it makes easy, what it makes harder, and which reader it
suits. Recommend one and explain why. The user chooses.

### Making alternatives reactable

Prose comparison of information architecture is hard to react to; people recognize structure
faster than they parse a description of it. A single self-contained HTML page showing the
alternatives with realistic content length lets the user see the difference and respond.

Keep it structural: labeled regions, real ordering, real navigation, real text lengths.
No palette, type choice, radius, shadow, imagery, or decorative motif — those belong to
interface design and will hijack the reaction if introduced here.

Label it `experience structure — not interface direction`.

## Flow Model

For each primary job, describe:

1. Trigger and starting context.
2. Ordered decisions/actions.
3. System feedback after each consequential action.
4. Success and next useful action.
5. Cancel, back, undo, retry, and interruption behavior.

Keep destructive actions explicit. State what is lost, whether confirmation is required, and how recovery works.

## Visible State Model

Include only applicable states, but never omit a relevant failure path:

| Context | State | What the user sees | Available action | Recovery / transition | Microcopy intent |
| --- | --- | --- | --- | --- | --- |

Consider default, first-use empty, filtered empty, loading, delayed, partial, offline, permission, validation, error, retrying, success, destructive confirmation, undo, conflict, stale/realtime, overflow, long content, and maximum realistic volume.

State meaning must remain understandable without color or animation. Interface design decides the presentation; experience design decides the required meaning and outcome.

## Interaction Intent

Specify behavior without styling it:

- Control purpose and enabled/disabled/loading semantics.
- Keyboard path and focus intent for primary jobs.
- Validation timing and error placement intent.
- Optimistic versus confirmed feedback from the user's perspective.
- Selection, bulk action, pagination/infinite loading, and saved/dirty semantics when applicable.
- Confirmation, undo, retry, and escalation paths.

## Microcopy

Write task-specific intent or concrete copy for:

- Labels and action verbs.
- Helper and constraint text.
- Empty and no-result states.
- Validation and server errors.
- Confirmation, destructive actions, success, undo, and retry.

Avoid blame, vague failure language, and messages that name no recovery action.

## Neutral Low-Fidelity Wireframe

Use only when adjacency or ordering is difficult to evaluate in prose.

- Show labeled regions, navigation relationship, content priority, actions, and state placement.
- Use neutral boxes and text; no palette, font choice, radius, shadow, imagery treatment, or decorative motif.
- Annotate responsive or state changes as behavior, not visual styling.
- Label it `low-fidelity experience structure — not interface direction`.

## Audit Method

1. Capture the current job, contract, route/screen map, and key rendered states.
2. Trace the primary job end to end, then the highest-cost recovery path.
3. Separate friction from strengths.
4. Rank findings by user-job impact: missing action or dead end → missing state/recovery → structural friction → copy/polish.
5. Write each finding as severity, observation, evidence, impact, and correction.
6. State coverage limits. No inspected evidence means no claim about that area.

For a redesign or material change to an existing surface, keep the top two to four opportunities. Put accepted opportunities into UX Model; if none are material, record `no material UX gaps found — existing model preserved` and emit `Material gaps: none`.

## Depth Completion

### Seed

- One primary user and job.
- Requested action, success, and applicable failure/retry.
- Minimal route/screen and content-priority model.
- Touched states and interaction intent.
- Disclosed inferences and no material unresolved question.

### Focused Delta

- Changed owned sections only.
- Accepted finding or reason for change.
- Preserved sections and verification impact.
- Fresh Experience gate for the affected scope.

### Full

- Users, roles, jobs, success states, and non-goals.
- IA, navigation, routes, screen inventory, and content priority.
- Primary and recovery flows.
- Complete applicable visible-state model.
- Interaction intent and microcopy.
- Known gaps stated instead of invented answers.
