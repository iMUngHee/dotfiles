# Render-Grounded UI Verification

Verify fitness against the approved contract, surface job, and quality floor. Do not substitute a general impression of polish.

## Evidence Order

1. User-job closure and active plan success criteria.
2. Approved `design-contract.md` and gate records.
3. Code/tests/browser measurements.
4. Inspected renders of realistic content and relevant states.

Subjective design confidence cannot turn a failed or missing objective check into readiness.

## Render Scope

Bound coverage by risk rather than every combination:

- Seed: touched screen with realistic data and affected states. Add the relevant narrow viewport when layout, wrapping, media, navigation, or touch behavior changed.
- Focused Delta: changed screens/states plus one adjacent state when layout, data shape, or interaction may propagate.
- Full/multi-screen: map routes/screens, then inspect one representative path per primary user job; render primary screens at desktop and mobile plus only job-relevant internal states.
- Presentation/Deck: render the fixed canvas instead of desktop/mobile breakpoints.

Name every unrendered area as out of scope. If rendering is infeasible, state why and report craft quality `NOT VERIFIED`.

## Correction Loop

One correction cycle is one authorized source change followed by a fresh render and fresh measurement.

1. Inspect and measure.
2. If an applicable check fails and implementation remains authorized, correct and re-render.
3. Use at most two cycles for the same measured issue.
4. After the budget or authorization ends, report the failed selector/control, observed value, required threshold, cycles used, and stop reason.

`NOT VERIFIED` is not an early exit when an authorized correction remains available.

## Material-Row Proof

Use exact Implementation Proof from the shared output formats. For every applicable
EXP/INT obligation, verify transitive coverage by at least one applicable IMP row and
compare the same material requirement across:

1. Concrete code evidence.
2. An affirmative test or browser assertion.
3. A directly inspected render or measurement.

Page-level substitutes do not prove a more specific contracted transformation. For
example, document-level no-overflow does not prove a required mobile navigation drawer,
and inner table scroll does not prove a contracted non-scrolling mobile evidence list.
Reject a generic test summary, screenshot path without inspection, unrelated selector,
or technical-plan prose as substitute evidence.

Use the shared classification truth table with this precedence:

1. `contract gap` when approved intent is missing, contradictory, or owner-unclear.
   `missing intent` and `contradictory intent` route to the established contract-section
   owner; `owner unclear` routes to `product-craft`. Status is FAIL and aggregate is
   BLOCKED, regardless of missing implementation evidence.
2. `contract drift` when code or a test intentionally encodes behavior contrary to clear
   approved intent. A passing contradictory assertion is still FAIL.
3. `implementation defect` when approved intent is clear but behavior or its assertion
   fails.
4. `unverified` when required code, affirmative test, or inspected render/measurement is
   missing.
5. `aligned` only when all required evidence agrees.

`not applicable` is outside precedence. It requires one repeated concrete reason in
Applicability and Status, N/A code/test/render evidence, `Gap reason: N/A`, and covers no
applicable source. Interface specimen N/A remains an Interface PASS observation rather
than an Implementation N/A row.

Duplicate IDs, unknown or absent sources, uncovered applicable rows, inconsistent
classification/status, incomplete PASS evidence, unjustified N/A, or a row in two packet
buckets yields `Design-Fit Outcome: NOT VERIFIED`.

For structured closure reports, `applicable_rows` and `covered_rows` contain EXP/INT
source obligations only, sorted EXP before INT; IMP IDs belong in proof and implementation
buckets. Once proof rows exist, `failed_rows` contains only failed or unverified IMP IDs.
Copy only explicitly named substitute identifiers into `rejected_substitutes`; do not
invent one for invalid N/A or missing evidence.

## Checks

- User-job closure: requested action, success, failure/retry, and preserved invariants agree across request, contract, code, and render.
- Required states: empty, loading, error, partial, overflow, validation, long text, realistic volume, destructive, conflict, and recovery as applicable.
- Interaction: keyboard path, focus, validation, feedback, disabled/loading semantics, confirmation, undo, and retry.
- Components: used button, form, table/filter, dialog, card, navigation, and data-display variants/states.
- Geometry: clipping, overflow, wrapping, control alignment, content order, and narrow/fixed-canvas behavior.
- Accessibility: semantics, accessible names, contrast, visible focus, touch target, focus management, status/error announcements, and reduced motion.
- Motion/performance: frequency, duration, explicit properties, layout/paint cost, scroll behavior, and offscreen work.
- Visual system: tokens, spacing, type, radius, elevation, density, formatting, asset rules, design tension, and signature moment match the contract.
- Contract integrity: no naked adjectives, silent substitutions, missing Implementation Bridge mapping, or implementation-authored product decision.
- Product specificity: the rendered hierarchy and component voice express the selected direction rather than interchangeable defaults.

Inspect screenshots or live renders directly; generating an artifact without looking at it is not evidence.

## Audit Findings

For read-only audits, report:

```text
- Severity: blocks the job | slows the job | polish
- Observation: <specific source or rendered behavior>
- Evidence: <file:line, selector/measurement, screenshot/state, or missing coverage>
- Impact: <user-job or technical consequence>
- Correction: <one bounded recommendation>
- Classification: implementation defect | contract drift | contract gap | unverified
```

Do not convert a finding into a source edit without a separate build request and all applicable gates.

## Final Result

Use the exact Surface Proof Packet, Implementation Proof, and Design-Fit Result in
`../../product-craft/references/output-formats.md`. Always retain PASS, FAIL, CONTRACT
GAP, NOT VERIFIED, PENDING, and N/A buckets even when empty. Aggregate BLOCKED before
NOT VERIFIED, then READY. `Outcome: READY` is valid only when every applicable row is
transitively covered by aligned PASS proof, every `N/A` has a concrete repeated reason,
no pending or malformed row remains, and Required approvals are present in Recorded
approvals.

Completed-feature readiness belongs to `verify`; provide this result as evidence rather than claiming goal completion here.
