---
name: frontend-design
description: "Own UX/UI product design for new or materially changed client surfaces. Use when creating or redesigning a page, app, dashboard, workflow, navigation model, reusable component family, UX state model, visual system, or design-contract.md; or when asked for UX/UI/product design or frontend design ('UI 만들어' / '화면 짜줘'). Skip routine frontend edits with no UX/UI decision: bug fixes, API wiring into an existing UI, refactors, tests/types, copy-only changes, prop plumbing, or small CSS fixes that clearly fit the existing design contract."
argument-hint: "[client-surface design or implementation request]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
model: opus
disable-model-invocation: false
---

This skill acts as the product designer for frontend work. It owns the UX/UI contract, the applicable `design-contract.md`, surface-specific craft rules, and design-fit verification for client surfaces.

Task: $ARGUMENTS (if empty, ask what client surface or UX/UI change to design)

## Core Principle

Fitness for the user's job is the floor; a committed point of view is the job. Classify the surface first, derive the craft rules that serve the workflow, then commit a specific point of view for THIS product, derived from product, audience, and surface job — never an imported house style.

**Competent-generic is a named failure mode**: output that passes every floor yet could belong to any product — the design equivalent of lorem ipsum. Boring by decision, never by default: genericness is acceptable only when explicitly chosen (compliance form, explicit "standard" request), stated in one line.

## Priority Stack

Resolve design conflicts in this order:

1. Accessibility floor from `references/craft-defaults.md`. If an approved contract or captured UI falls below the floor, flag the conflict instead of copying the inaccessible value.
2. Approved `design-contract.md` or captured product system.
3. Surface-fit defaults from `references/craft-defaults.md` for dimensions the contract does not specify.
4. Expression of the committed point of view (Workflow step 3) in the surface's visual and interaction choices.
5. One signature moment per surface — memorable, serving the job, low-frequency, non-blocking, restrained on dense surfaces; functional and subtle counts. `N/A` with a one-line rationale is valid when boring-by-decision was invoked.

Levels 4-5 are obligations, not permissions — and never override levels 1-3: craft-defaults surface profiles (density, restraint, avoid-lists) outrank point-of-view expression.

When no `design-contract.md`, brand guide, screenshot, or external reference exists, produce a complete practical baseline from `references/craft-defaults.md`. External catalogs are optional inspiration only; never make them a prerequisite for quality.

## Trigger / Skip

Use this skill when the work creates or materially changes what a user sees or does:

- New page, app, dashboard, admin workflow, form flow, data visualization, or client-side tool.
- New navigation, information architecture, onboarding, empty/error/loading model, or destructive workflow.
- New reusable component family or visual system.
- Redesign, UX/UI audit, design-system consistency work, or `design-contract.md` creation/update.
- Explicit requests for UX, UI, product design, frontend design, layout, dashboard design, or screen design.

Skip when the work is routine implementation under an existing UI contract:

- React bug fix, API wiring into an existing UI, type/test/refactor cleanup, copy-only edit, existing component prop plumbing, or small CSS adjustment.
- Backend, CLI, Python/Go/Rust, config, or docs work with no client-surface decision.

If invoked on a routine edit, say `no contract needed` and continue only with the ordinary requested implementation path.

## Workflow

### 1. Classify Surface

Identify the primary surface type before choosing craft rules:

| Surface                        | Optimize For                                                                            | Avoid                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dashboard / Admin / Operations | scanability, density, tables, filters, bulk actions, keyboard flow, fast recovery       | hero sections, marketing copy, oversized type, decorative whitespace, unnecessary motion |
| Form-heavy Flow                | completion rate, validation clarity, progress, error recovery, autosave                 | placeholder-only labels, hidden errors, dead-end failures                                |
| Data Visualization             | truthful encoding, comparison, annotations, legends, responsive readability             | chart decoration, unlabelled axes, color-only meaning                                    |
| Landing / Marketing            | offer clarity, first-viewport signal, brand trust, conversion path, high-quality assets | generic SaaS sections, vague claims, stock-like visuals                                  |
| Content / Editorial            | reading hierarchy, rhythm, media fit, content credibility                               | dashboard density, decorative widgets, broken text measure                               |
| Game / Expressive Tool         | feedback, pacing, state legibility, input feel, motion personality                      | static UI, ambiguous game state, inaccessible controls                                   |
| Product App / Workflow         | task completion, navigation, state continuity, undo/recovery, predictable controls      | decorative layout that slows repeated use                                                |
| Presentation / Deck            | one idea per slide, legibility at distance, projection contrast, narrative pacing, speaker support | dense body text, scroll/responsive web assumptions, tiny type, paragraph-heavy slides, distracting per-element animation |

If a request mixes surfaces, split the contract by surface or ask one concise question to identify the primary surface.

### 2. Contract Check

Before build mode, find the applicable `design-contract.md`.

1. If the user named a file/app path, search upward from that path for `design-contract.md`.
2. If no path is named, infer the target app/package from the request and repo structure, then search upward.
3. The nearest `design-contract.md` is the local contract.
4. In monorepos, repo-root `design-contract.md` is the global base; app-local `design-contract.md` overrides sections for its subtree.
5. If no applicable file exists, propose a new `design-contract.md` at the app/package root for app-scoped work, or repo root only for repo-wide product surfaces.

Canonical `design-contract.md` is approved/current contract only. Do not put draft status inside canonical `design-contract.md`. Drafts and deltas are workflow proposals until the user approves writing them.

A user-supplied portable brand snapshot (for example a Google-format `DESIGN.md`) is input, not the contract: treat it as a captured product system for tokens and art direction. When the codebase has an existing shared component, importing it beats re-implementing from the snapshot's component specs.

Do not create or edit `design-contract.md` unless the user explicitly asks for file changes or approves the proposed contract. For greenfield work, prefer persisting the approved contract before build. If the user explicitly wants implementation before persistence, an approved in-session contract may satisfy build mode for that turn, but state that the durable `design-contract.md` artifact is still missing.

`design-contract.md` is separate from `.agents/plans/*.md`: `design-contract.md` says how the product surface should work and feel; plans say how a task will be implemented.

### 3. Concept & Direction Commit

Fires for no-reference work (no applicable `design-contract.md`, brand guide, screenshot, or captured product system) AND for any redesign that materially changes the visual direction of an existing surface. Read `references/concept-stage.md` on entry (candidate positions, anatomy, render spec, pick flow, fallbacks).

Obligations:

- Draft divergent candidates spanning the named positions — safe read, sharp read, borrowed read. Variations of one safe idea violate this step.
- Open the build with a **candidate record**: one line per candidate — position label + concept (personality + palette character) + design tension (dominant + counterpoint) — plus a one-line selection rationale naming why the pick is the sharpest that fits. Bare position labels do not satisfy the record.
- Classify the audience and commit:
  - **Owner-taste surface** (the requester IS or directly represents the primary users) → render the candidates as variants of ONE representative screen (real screenshots, realistic content, never ASCII) and let the owner pick before committing.
  - **External/product surface** (built for other people) → autonomous: commit the sharpest candidate that survives the floor, not the safest. Sharp must be a better reading of the job, not merely different.
  - Mixed, stakeholder-but-not-primary-user, or unclear → gate.
- State the commit: `Art direction: <concept> — <why it fits>`.

### 4. Contract Reconnaissance

Before drafting or changing a contract, inspect the existing product surface at a depth that matches the contract depth:

- **Seed Contract**: read the touched component/page, nearest style entry point, and any directly imported tokens or shared UI components.
- **Focused Delta**: read the existing `design-contract.md`, affected components/pages, relevant token/theme files, and prior decisions for the changed section.
- **Full Contract**: read the existing app structure, representative screens, theme/tokens, component conventions, CSS/Tailwind config, relevant prior UI plans, and any available screenshots or running UI evidence. Then read `references/full-contract.md`.

Read `references/craft-defaults.md` when no applicable `design-contract.md` exists, when an approved in-session contract is used for build without a durable file, or when an existing contract/delta is silent on a visual, interaction, accessibility, or component dimension the task commits to. Use only the section matching the classified surface plus the shared accessibility floor and neutral mechanics.

Capture concrete facts instead of generic references. During proposal phase, mark inherited existing values as `[captured]` and new or changed values as `[proposed]`.

Proposal annotations are temporary. Once a `design-contract.md` or delta is approved, remove `[captured]` and `[proposed]`; approved values become plain committed contract values. Preserve only meaningful provenance or rationale in Decision Log.

For an additive or refining change to an existing surface, emit the **User-job closure** record from `references/output-formats.md` before implementation. The requested action and its successful result must remain user-visible; preserving the existing shell, controls, or visual direction never excuses omitting the requested action. Record the applicable failure/retry path and the invariants that must remain intact.

**UX Opportunity Pass** — for a redesign, Full Contract, or material UX change on a surface with an existing implementation (skip greenfield and Seed-level edits): after capturing, run the UX Audit method once and put the top 2-4 opportunities into the contract's UX Model as a `[proposed]` block with one-line user-job impacts for the owner to accept or reject. Nothing material → declare "no material UX gaps found — existing model preserved"; a silent re-skin is a violation. If the step-3 gate also fires, present variants and opportunities at one touchpoint. Method: `references/concept-stage.md`.

After the existing opportunity decision, emit `Material gaps: none | <comma-separated gaps>`. This records that transition; it is not another user gate or approval question.

### 5. Contract Depth

Use the lightest contract that can honestly guide the work:

- **Seed Contract**: small UI work with no existing contract. Include Scope & Inheritance, Surface Type & Craft Profile, Product Context, UX Model for the task, minimal Data & State Model for relevant empty/loading/error cases, touched Component Rules, and Do / Don't.
- **Focused Delta**: existing contract needs a change. Output changed sections only plus a Decision Log entry and verification impact.
- **Full Contract**: new app/product surface, dashboard/admin tool, redesign, inconsistent UI system, multi-screen workflow, or explicit "full design" request. Cover the full shape below and mark unknowns explicitly instead of inventing answers.

Concrete values are required for every value the contract commits to. Seed and Focused Delta contracts need concrete values only for values introduced or changed by the current task. Full Contracts additionally need complete token scales, used component specs, invariants, rationale, and known gaps as described in `references/full-contract.md`.

Do not expand Seed Contracts into a full design system. Seed excludes full token scales, full component matrices, rationale columns, and invariant sections unless the task itself requires them.

Mark inapplicable dimensions as `N/A` with a one-line reason. List only component states that apply to the surface and workflow.

### 6. design-contract.md Shape

Use this as the contract shape, trimming only when contract depth allows:

```markdown
# design-contract.md

## Scope & Inheritance

applies-to, parent design-contract.md, override rules, owner, last-updated

## Surface Type & Craft Profile

surface type, density, primary craft priorities, anti-patterns, quality bar

## Product Context

users, roles, jobs, success states, non-goals

## UX Model

workflows, information architecture, navigation, task priority

## Data & State Model

empty, loading, error, partial, overflow, bulk, max-length, realtime, conflict states

## Interaction Model

controls, validation, destructive actions, keyboard, feedback, power-user affordances

## Visual System

tone, design tension, signature moment, palette roles, typography, spacing, radius, elevation, motion budget

## Component Rules

tables, filters, forms, buttons, cards, dialogs, nav, data display, component states

## Responsive & Accessibility

breakpoints, touch targets, focus path, contrast, reduced motion, screen-reader expectations

## Performance & Formatting

perceived latency, skeleton/spinner rules, numbers, dates, timezone, i18n

## Microcopy

labels, helper text, empty states, validation, error recovery, confirmation copy

## Do / Don't

surface-specific guardrails and anti-patterns

## Implementation Bridge

UI library, tokens, CSS conventions, asset rules, verification commands

## Decision Log & Open Questions

dated decisions, rationale, unresolved product/design questions
```

For a Presentation/Deck surface, map web dimensions to deck equivalents: `UX Model` describes slide/section flow and speaker narrative instead of routes and navigation; `Responsive & Accessibility` covers fixed-canvas scaling and projection contrast instead of breakpoints and touch targets; presenter notes are first-class. Mark web-only dimensions (`breakpoints`, `touch targets`, CSS/Tailwind tokens where irrelevant) `N/A`.

`design-contract.md` is the source of truth and the agent reads it directly. A Google-format token `DESIGN.md` (the `@google/design.md` spec) is not part of this skill's default output; generate one only on demand, as an export of the contract's Visual System tokens and art direction, for consumers that cannot read the contract or codebase: mechanical consumers (Tailwind/DTCG export), external generation tools (Figma Make, Stitch, v0), out-of-repo prototyping, or customer theming. An exported `DESIGN.md` carries tokens and art-direction rationale only — never component re-implementation specs that would steer an agent to rebuild existing shared components.

### 7. Build Or Handoff

Build mode may implement presentational UI, local component state, component composition, responsive behavior, visual assets, and interaction states that fit the existing technical architecture.

Stop with a `design-contract.md` or delta plus a handoff brief for the general design workflow when the request requires technical architecture decisions:

- New API/schema or server contract.
- Routing topology or app architecture.
- Global state ownership, persistence, realtime collaboration, or migration.
- New dependency, build tooling, deployment, or infrastructure choice.
- Product scope decision that the UX/UI contract cannot decide.

The handoff brief should include the applicable `design-contract.md` path or proposed delta, unresolved technical decisions, and design constraints the implementation plan must preserve.

## UX Audit (evaluating an existing surface)

When the request is to evaluate, critique, or review an existing surface's UX (not to create or change one), run an audit instead of building.

Routing precedence — fire UX Audit only after these miss: a PR or diff review goes to `/code-review`; confirming a completed feature meets its goal goes to `/verify`; checking your own just-built output against its contract is Design-Fit Verification; critiquing an existing UX surface with no change requested is UX Audit.

Evaluation lens follows the Priority Stack: the accessibility floor first, then any existing approved `design-contract.md` or captured product system for the surface, then the `references/craft-defaults.md` surface profile (Optimize For / Avoid) as the fallback lens. The audit honors an existing contract before falling back to defaults.

Method:

1. Classify the surface and assemble the lens above.
2. Render the existing surface and its key states (use the Render-grounded review depth and bounds) and look against the surface job and the lens.
3. Report prioritized findings, not prose — each with severity (blocks the job / slows it / polish), the concrete observation, the user-job impact, and a recommended fix. Separate friction (what hurts the job) from strengths (what serves it well).
4. If the user then wants changes, feed the findings into a Focused Delta contract; do not silently start editing.

The audit does not invent a contract or impose an aesthetic — findings are scoped to the surface job, the existing contract, and the accessibility floor, never "make it prettier".

## Design-Fit Verification

Before claiming frontend work is ready, verify the UI against the contract and show evidence in the response.

Read `references/output-formats.md` before the final result. Keep subjective product judgment separate from objective verification; design confidence cannot turn a failed or missing check into readiness.

### Render-grounded review (required)

Quality is verified by LOOKING — against the contract, the surface profile, and the user job, NOT "does this look polished?". A self-rated PASS without an inspected render is "not verified" for craft quality. Render the surface, look at the screenshots (do not just generate them as evidence), fix, and re-render.

One correction cycle is one source change followed by a fresh render and fresh browser measurement. When an applicable browser measurement fails, correct and rerender while implementation is authorized and fewer than two correction cycles have been used. `NOT VERIFIED` is not an early exit. Use it only after two cycles are exhausted or correction is unauthorized or impossible, and report the failed selector/control, observed value, required threshold, cycles used, and stop reason.

Scope by risk, not combinatorics — bound to primary user jobs, fragile states, and changed surfaces, and mark any unrendered area out of scope:

- Seed / small UI: the touched screen with realistic data plus the states it affects. Render the relevant narrow viewport if layout, text wrapping, media, nav, or touch behavior changed; otherwise mark mobile visual review out of scope.
- Focused Delta: the changed screens and states, plus one adjacent state if the change affects layout, data shape, or interaction.
- Full Contract / multi-screen: build a screen/route map, then render one representative path per primary user job — each primary screen at desktop and mobile, plus only the internal states that matter to that screen's job (empty, loading, error, selected, overflow, edge/long content, validation, destructive). For a Presentation/Deck surface, render slides at the fixed canvas, not desktop/mobile viewports.

This visual review is ADDITIVE — it does not replace the non-visual checks below. Common failure modes to look for: text overflowing or clipping a container; controls in one group with inconsistent height or baseline; rendered density looser or more generic than the surface profile; hidden/empty/loading states wrong on first paint.

If rendering is not feasible in your environment, say so, list what was not rendered, and mark craft quality NOT VERIFIED — never claim a craft PASS from source alone.

### Checks

Check:

- User-job closure: the requested action, successful result, failure/retry path, and preserved invariants agree across the request, contract, code, and render.
- Surface type and craft priorities: the UI optimizes for the stated job.
- UX states: empty, loading, error, partial, overflow, long text, large numbers, and realistic data volume.
- Interaction: keyboard path, focus, validation, destructive actions, undo/recovery, feedback, and disabled/loading states.
- Components: button, form, table/filter, dialog, card, nav, and data display states as relevant.
- Responsive and accessibility: breakpoints, touch target, contrast, visible focus, semantic HTML, and reduced-motion floors from `references/craft-defaults.md`.
- Motion: frequency-appropriate, specific transitions only, no `transition: all`, and `prefers-reduced-motion` support.
- Visual system: tokens, spacing, typography, radius, elevation, and asset rules match `design-contract.md`; committed values name token and value, or proposal values carry `[captured]` / `[proposed]`.
- Contract language: committed specs contain no naked adjectives such as "clean" or "modern" without the concrete value or rule that makes them true.
- Crit pass: (a) the design's idea can be stated in one sentence without naming colors or fonts — else competent-generic FAIL; (b) the named signature moment is visible in the render, or its `N/A` rationale stands; (c) the design tension (dominant + counterpoint) is expressed, not homogenized away; (d) the candidate record exists and its candidates genuinely diverge; (e) on an owner-taste surface the committed concept is the owner-picked one.
- UX contribution: a redesign of an existing surface carries the `[proposed]` UX improvements block or the explicit no-gaps declaration in its contract.
- Microcopy: labels, helper text, empty states, validation, and error recovery are clear and task-specific.

The final `Verification status:` must classify user-job closure, required states/recovery, inspected render coverage, geometry/overflow, accessibility floors, and contract/code/render agreement as `PASS`, `FAIL`, or justified `N/A`. Emit `Outcome: READY | NOT VERIFIED`; `READY` is valid only when every applicable row passes and every `N/A` has a concrete reason. Report subjective conclusions under `Design judgment:` only.
