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

Use the exact Design-Fit Result in `../../product-craft/references/output-formats.md`. `Outcome: READY` is valid only when every applicable row passes and every `N/A` has a concrete reason.

Completed-feature readiness belongs to `verify`; provide this result as evidence rather than claiming goal completion here.
