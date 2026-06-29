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

Quality means fitness for the user's job, not visual distinctiveness. Do not start from a fixed aesthetic taste. Classify the surface first, then derive craft rules that serve the workflow.

Examples:

- Dashboards and operational tools prioritize density, scanability, fast repeated action, resilient data states, keyboard flow, low decorative chrome, and clear recovery.
- Landing and marketing pages prioritize first-viewport signal, narrative, trust, conversion flow, brand memory, and asset quality.
- Games and expressive experiences prioritize feel, feedback, motion, pacing, and legible state.
- Content and editorial surfaces prioritize reading flow, hierarchy, rhythm, and content integrity.

## Priority Stack

Resolve design conflicts in this order:

1. Accessibility floor from `references/craft-defaults.md`. If an approved contract or captured UI falls below the floor, flag the conflict instead of copying the inaccessible value.
2. Approved `design-contract.md` or captured product system.
3. Surface-fit defaults from `references/craft-defaults.md` for dimensions the contract does not specify.
4. Aesthetic refinement that improves the user's job on the classified surface.
5. Delight only when it is low-frequency, non-blocking, and still matches the surface.

For no-reference work, a committed art-direction concept (Workflow step 3) governs how levels 4–5 are expressed, but never overrides levels 1–3.

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

Do not create or edit `design-contract.md` unless the user explicitly asks for file changes or approves the proposed contract. For greenfield work, prefer persisting the approved contract before build. If the user explicitly wants implementation before persistence, an approved in-session contract may satisfy build mode for that turn, but state that the durable `design-contract.md` artifact is still missing.

`design-contract.md` is separate from `.agents/plans/*.md`: `design-contract.md` says how the product surface should work and feel; plans say how a task will be implemented.

### 3. Art Direction (no-reference work)

When no applicable `design-contract.md`, brand guide, screenshot, or captured product system exists, commit to ONE concrete art-direction concept before producing any visual values. Do not fall back to a generic default — an undirected surface is why no-reference outputs all look alike.

The concept names a deliberate point of view, derived from the product, audience, and surface job, across:

- Personality: one line naming the character (for example "calm clinical utility", "warm editorial confidence", "high-energy arcade").
- Palette character: the role structure AND its character — not just accent plus neutral, but for example "ink-on-paper warm neutrals with one saturated signal" versus "near-black surfaces with one electric accent". Never an evenly-spread timid palette.
- Type personality: display and body intent with a point of view, not a default UI font by reflex.
- Motion character: how motion should feel here, within the surface's motion budget.
- Shape and space character: sharp versus soft, dense versus airy — within the surface's density rules.

Rules:

- Subordinate to fitness. The concept may never lower the accessibility floor or break the surface's job (density, scanability, recovery). A dashboard gets a distinct-but-restrained identity, not decoration; an expressive surface may be bold. The Priority Stack still governs.
- Commit, do not hedge. One clear direction beats "a bit of everything". If you cannot say why a choice serves the concept and the job, reconsider it.
- State it. Open build with one line — `Art direction: <concept> — <why it fits the product, audience, and surface>` — visible and overridable.
- Autonomous by default. Choose and commit without asking. Ask the user for direction first only when the request signals they want to steer (names a vibe or brand, asks for "striking", "beautiful", or "on-brand", or supplies brand assets).

The committed concept becomes the Visual System's through-line and governs how the Priority Stack's refinement and delight levels are expressed. It never overrides the accessibility floor, an approved contract, or surface-fit.

### 4. Contract Reconnaissance

Before drafting or changing a contract, inspect the existing product surface at a depth that matches the contract depth:

- **Seed Contract**: read the touched component/page, nearest style entry point, and any directly imported tokens or shared UI components.
- **Focused Delta**: read the existing `design-contract.md`, affected components/pages, relevant token/theme files, and prior decisions for the changed section.
- **Full Contract**: read the existing app structure, representative screens, theme/tokens, component conventions, CSS/Tailwind config, relevant prior UI plans, and any available screenshots or running UI evidence. Then read `references/full-contract.md`.

Read `references/craft-defaults.md` when no applicable `design-contract.md` exists, when an approved in-session contract is used for build without a durable file, or when an existing contract/delta is silent on a visual, interaction, accessibility, or component dimension the task commits to. Use only the section matching the classified surface plus the shared accessibility floor and neutral mechanics.

Capture concrete facts instead of generic references. During proposal phase, mark inherited existing values as `[captured]` and new or changed values as `[proposed]`, for example `radius: [captured] 6px from --radius-md` or `table row height: [proposed] 36px`.

Proposal annotations are temporary. Once a `design-contract.md` or delta is approved, remove `[captured]` and `[proposed]`; approved values become plain committed contract values. Preserve only meaningful provenance or rationale in Decision Log.

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

tone, palette roles, typography, spacing, radius, elevation, motion budget

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

`design-contract.md` is the source of truth and the agent reads it directly. A Google-format token `DESIGN.md` (the `@google/design.md` spec) is not part of this skill's output; generate one only on demand, as an export of the contract's Visual System tokens, when a mechanical consumer (Tailwind/DTCG export or external tooling) needs it.

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

### Render-grounded review (required)

Quality is verified by LOOKING — against the contract, the surface profile, and the user job, NOT "does this look polished?". A self-rated PASS without an inspected render is "not verified" for craft quality. Render the surface, look at the screenshots (do not just generate them as evidence), fix, and re-render.

Scope by risk, not combinatorics — bound to primary user jobs, fragile states, and changed surfaces, and mark any unrendered area out of scope:

- Seed / small UI: the touched screen with realistic data plus the states it affects. Render the relevant narrow viewport if layout, text wrapping, viewport constraints, media, nav, or touch behavior changed; otherwise mark mobile visual review out of scope.
- Focused Delta: the changed screens and states, plus one adjacent state if the change affects layout, data shape, or interaction.
- Full Contract / multi-screen: build a screen/route map, then render one representative path per primary user job — each primary screen at desktop and mobile, plus only the internal states that matter to that screen's job (empty, loading, error, selected, overflow, edge/long content, validation, destructive). For a Presentation/Deck surface, render slides at the fixed canvas, not desktop/mobile viewports.

This visual review is ADDITIVE — it does not replace the non-visual checks below (keyboard flow, focus order, semantics, contrast, reduced motion stay as their own checks). Common failure modes to look for (not exhaustive): text overflowing or clipping a container; controls in one group with inconsistent height or baseline; rendered density looser or more generic than the surface profile; hidden/empty/loading states wrong on first paint.

If rendering is not feasible in your environment, say so, list what was not rendered, and mark craft quality NOT VERIFIED — never claim a craft PASS from source alone.

### Checks

Check:

- Surface type and craft priorities: the UI optimizes for the stated job.
- UX states: empty, loading, error, partial, overflow, long text, large numbers, and realistic data volume.
- Interaction: keyboard path, focus, validation, destructive actions, undo/recovery, feedback, and disabled/loading states.
- Components: button, form, table/filter, dialog, card, nav, and data display states as relevant.
- Responsive and accessibility: breakpoints, touch target, contrast, visible focus, semantic HTML, and reduced-motion floors from `references/craft-defaults.md`.
- Motion: frequency-appropriate, specific transitions only, no `transition: all`, and `prefers-reduced-motion` support.
- Visual system: tokens, spacing, typography, radius, elevation, and asset rules match `design-contract.md`; committed values name token and value, or proposal values carry `[captured]` / `[proposed]`.
- Contract language: committed specs contain no naked adjectives such as "clean", "modern", "spacious", or "polished" without the concrete value or rule that makes them true.
- Committed direction: for no-reference work, a stated art-direction concept exists, and the type, color, hero, and spatial choices express it rather than a generic default.
- Microcopy: labels, helper text, empty states, validation, and error recovery are clear and task-specific.

For dashboards/admin surfaces, explicitly test dense data, filters, tables, repeated actions, and low-chrome scanability. For landing/marketing surfaces, verify first-viewport signal, real product/brand presence, conversion path, and asset quality.
