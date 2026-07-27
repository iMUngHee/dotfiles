# Interface Contract Guidance

This file defines the concreteness bar for interface-owned sections. It does not add or replace sections in the canonical schema.

## Reconnaissance

Capture only evidence relevant to the selected depth:

- Representative screens, shell/layout, navigation placement, modals/drawers, and responsive transformations.
- Existing tokens: color roles, typography, spacing, radius, border/elevation, z-index, and motion.
- Used primitives and component families with their actual variants and states.
- Realistic content volume, screenshots, browser evidence, and prior accepted design decisions.
- Accessibility evidence: focus, contrast, touch sizing, reduced motion, semantics, and error/status presentation.

Mark existing values `[captured]` and new values `[proposed]` while proposing. An approved contract names plain committed values and keeps only useful provenance in Decision Log.

## Concreteness Bar

The test is a question, not a list: **can the next agent build this screen without inventing
anything aesthetic?** Anything they would otherwise have to guess needs a token, value, rule,
example, or rationale here.

Where a selected artifact exists, it already answers most of this — the artifact is the
authority for what the screen looks like, and the contract records the decisions, the reasons,
and what the artifact did not cover. Do not transcribe an artifact into prose; that is how
detail leaks out.

Palette, type, spacing, radius, elevation, motion, density, breakpoint behavior, and display
formatting are the dimensions that usually need pinning down. Treat that as where to look
first, not as the full extent of the question — this surface may turn on something not on any
such list. Korean line breaking, optical alignment in a specific component, or how one long
label behaves can matter more than a radius value, and a checklist will never name them.

Ask what would make a competent implementer stop and guess, and answer that.

Do not create speculative systems for components the surface does not use.

## Component Spec Matrix

Include only component families used by the approved workflows. `Used In` ties every row to experience scope.

| Component / variant | Size | Padding | Radius | Type | States | Used In | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Example: task-table row | 36px height | 8px 12px cells | 0 | 13px / 18px | hover, selected, disabled | Task list | Preserve dense comparison. |

Applicable states may include default, hover, focus-visible, active, selected, disabled, loading, empty, invalid, destructive, success, warning, and error. State meaning comes from the experience contract; this matrix defines its presentation.

## Invariants and Rationale

Full work records three to six non-negotiable interface rules, each tied to a user job. Example:

- Primary work queues remain denser than supporting cards. Why: operators repeatedly compare many records.
- Destructive actions keep an explicit confirmation presentation. Why: persistent state has a high recovery cost.

Do / Don't rules and reserved color/type rules also include a short why when not self-evident.

## Known Gaps

Record concrete unknowns rather than inventing them:

- Unverified content volume or string length.
- Missing contrast, keyboard, screen-reader, touch, or reduced-motion evidence.
- Unconfirmed responsive transformation.
- Missing primitive, token, asset, or implementation mapping.
- An experience-owned uncertainty requiring `EXPERIENCE DELTA REQUIRED`.

Emit the shared Material gaps record inside the current approval transition.

## Interface Audit Lens

Check evidence, not taste in isolation:

- Macrostructure and hierarchy reflect approved content priority.
- Density fits frequency and volume.
- Components sharing a group align in height, baseline, and state language.
- Responsive behavior preserves primary jobs and recovery.
- Accessibility values meet the shared floor.
- Perceived latency and formatting communicate state and meaning accurately.
- Tokens and component rules follow the captured product identity.
- Long content, realistic data, empty/error/loading, and overflow states remain coherent.

Each finding includes severity, concrete observation, evidence location, user-job impact, and one correction. Separate strengths from friction.

## Anti-Generic Check

- State the design idea without naming colors or fonts.
- Verify the selected macrostructure is a consequence of IA, content priority, and surface job.
- Confirm the candidate record contains genuinely divergent structural readings.
- Confirm design tension is visible rather than homogenized away.
- Confirm the signature moment serves the job and appears in the specimen, or its `N/A` rationale is concrete.
- Reject interchangeable defaults that would survive a logo-and-copy swap into an unrelated product.
- Back every adjective such as `clean`, `modern`, or `premium` with a value, rule, example, or rationale.

## Iteration Questions

- Can UI engineering implement the affected screen without guessing composition, spacing, type, radius, color roles, component states, or responsive behavior?
- Does every component map to an approved workflow location?
- Are dense surfaces resilient to real data and repeated action?
- Are expressive surfaces anchored in product, audience, content, and asset decisions?
- Are unknowns visible as routed gaps rather than hidden in vague language?
