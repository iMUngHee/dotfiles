# Full Contract Reference

Read this file only for Full Contract work: new app/product surfaces, dashboard/admin tools, redesigns, inconsistent UI systems, multi-screen workflows, or explicit full design requests.

## Deep Reconnaissance

Inspect enough existing evidence to make the contract concrete:

- Product structure: target app/package root, routes, representative screens, shell/layout, navigation, and modal/drawer patterns.
- Design tokens: CSS variables, Tailwind or theme config, typography scales, spacing scales, radius, shadow/elevation, z-index, motion durations, and color roles.
- Component conventions: existing table, filter, form, button, card, dialog, nav, data display, empty/loading/error, and toast patterns that are actually used.
- Workflow evidence: prior plans, screenshots, browser inspection, realistic sample data, logs, or tests that reveal state volume and user tasks.
- Accessibility and responsive evidence: breakpoints, touch targets, focus styles, contrast tokens, reduced-motion handling, and screen-reader patterns.

For a Presentation/Deck surface, substitute deck dimensions for web ones: slide/section structure and speaker narrative instead of routes and screens; fixed-canvas scaling and projection contrast instead of breakpoints and touch targets; presenter notes and build/advance pacing as first-class. Mark web-only reconnaissance items `N/A`.

Use `[captured]` for existing values and `[proposed]` for new or changed values while proposing. Do not write "use existing tokens" when committing to a value; name the token and the value.

## Full Contract Concreteness Bar

A Full Contract should include concrete values for the dimensions it uses:

- Palette roles with token names and values.
- Typography scale with token names, values, and usage.
- Spacing scale with token names, values, and usage.
- Radius, elevation, border, and divider rules with values.
- Motion budget with duration/easing values and reduced-motion behavior.
- Density rules for repeated surfaces such as tables, lists, sidebars, filters, and toolbars.

Mark unused dimensions as `N/A` with one reason. Do not create a speculative system for components or states that the surface will not use.

## Component Spec Matrix

Include only component families used by the surface. Anchor every row with `Used In` so the matrix stays practical.

| Component / Variant | Size | Padding | Radius | Type | States | Used In | Notes |
| ------------------- | ---- | ------- | ------ | ---- | ------ | ------- | ----- |
| Example: data table row | 36px height | 8px 12px cells | 0 | 13px / 18px | hover, selected, disabled | Task list table | Keep dense scanning above decorative spacing. |

State names should be specific and applicable: default, hover, focus-visible, active, selected, disabled, loading, empty, invalid, destructive, success, warning, error.

## Invariants And Rationale

Add 3-6 non-negotiable invariants for the surface. Each invariant must include a one-line why tied to the user job.

Good invariant format:

- Tables stay denser than cards for primary work queues. Why: operators compare many rows repeatedly and lose speed when each record becomes a large panel.
- Destructive actions require an explicit confirmation affordance. Why: the workflow changes persistent task state and recovery cost is high.

Do / Don't rules and reserved color/type rules should also include a short why when the choice is not self-evident.

## Known Gaps

Record concrete unknowns instead of inventing answers:

- Data volume not verified: list the assumed max row count or string length and the verification needed.
- Accessibility not verified: list the missing contrast, keyboard, screen-reader, or reduced-motion check.
- Workflow not verified: list the user role, task, or edge case that needs product confirmation.
- Implementation bridge not verified: list the token, component, library, or routing detail that needs technical planning.

## Iteration Guide

After drafting a Full Contract, evaluate it with these questions:

- Can another agent implement the first screen without guessing spacing, type, radius, color roles, or component states?
- Does every component spec map to an actual workflow location?
- Are dashboard/admin surfaces dense and resilient enough for real data, repeated action, and recovery?
- Are landing/marketing surfaces anchored in concrete product, brand, conversion, and asset decisions?
- Are adjectives backed by values, rules, examples, or explicit rationale?
- Are unknowns visible as gaps instead of hidden in vague language?
