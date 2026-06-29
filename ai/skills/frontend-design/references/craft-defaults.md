# Craft Defaults Reference

Read this file only when no applicable `design-contract.md` exists, when an approved in-session contract is used for build without a durable file, or when an existing contract/delta is silent on a committed visual, interaction, accessibility, or component dimension.

Use only the shared accessibility floor, neutral mechanics, and the one surface section selected by `SKILL.md`. Existing approved contracts and captured product systems override these defaults, except they cannot lower the accessibility floor.

## Contents

- Shared Accessibility Floor
- Neutral Mechanics
- Dashboard / Admin / Operations
- Form-heavy Flow
- Data Visualization
- Landing / Marketing
- Content / Editorial
- Game / Expressive Tool
- Product App / Workflow
- Presentation / Deck
- Optional Inspiration

## Shared Accessibility Floor

These values are the hard minimum for every surface.

- Text contrast: 4.5:1 for normal text, 3:1 for large text and non-text UI indicators.
- Focus visibility: 2px minimum visible outline or equivalent high-contrast focus ring, never color-only.
- Touch targets: 44px minimum on touch-first controls; dense desktop controls may be smaller only when keyboard focus and pointer affordance stay explicit.
- Keyboard: every interactive control is reachable and operable by keyboard; modal dialogs trap focus and restore it on close.
- Motion: `prefers-reduced-motion` disables non-essential animation; essential state changes remain understandable without motion.
- Semantics: buttons, links, tabs, dialogs, tables, form labels, errors, and status messages use semantic HTML or equivalent ARIA.
- Color meaning: color is never the only state signal; include text, icon, shape, position, or pattern.

## Neutral Mechanics

These mechanics may apply across surfaces because they protect usability rather than impose an aesthetic.

- Spacing base: use a 4px step. Common steps: 4, 8, 12, 16, 24, 32, 48, 64.
- Type baseline: default body 14-16px with 1.45-1.65 line-height; labels 11-13px; avoid viewport-scaled text.
- Radius baseline: use 4-8px for dense tools, 8-12px for product apps, and larger radii only when the surface is intentionally soft or expressive.
- Elevation: prefer border and background separation first; shadows should clarify layering, not decorate.
- Motion duration: 100-160ms for direct interaction feedback, 160-240ms for panel/dialog entrance, 240-360ms only for low-frequency expressive transitions.
- Transitions: name properties explicitly; never use `transition: all`.
- State coverage: default, hover, focus-visible, active, disabled, loading, error, empty, and selected when applicable.
- Defaults are decisions: do not ship an unexamined stack (Inter/system-ui as display type, purple-to-blue gradient on white, generic centered hero, evenly-spread timid palette) unless it traces to the surface job, the contract, or the committed art-direction concept. An unjustified default is a craft failure, like a naked adjective.
- Content variation: value and display slots tolerate non-numeric and long content (use min-width, clamp, or overflow handling), not a size tuned to short content.
- Control consistency: interactive controls in one form or toolbar group share a consistent height and baseline.

## Dashboard / Admin / Operations

Job: help an operator scan, compare, filter, recover, and repeat actions quickly.

- Density: compact by default. Table/list rows 32-40px; toolbar controls 32-36px high on desktop; panels use 16-24px padding.
- Layout: prioritize sidebars, tables, filters, segmented controls, drawers, and dialogs over hero sections or large cards.
- Typography: body 13-14px, labels 11-12px, page title 18-24px, numbers and ids may use mono/tabular figures.
- Color roles: one reserved accent for selection/focus/primary action; separate semantic colors for error, warning, success, and destructive states.
- Motion: none for repeated row/filter/keyboard actions; 100-160ms for hover/focus; no decorative entrance loops.
- Components: tables need sticky headers where useful, sortable/filterable columns, overflow handling, selected and bulk states, empty/error rows, and dense pagination or virtualized loading when volume is high.
- Aesthetic refinement: make alignment, rhythm, contrast, and information grouping precise. Why: operators trust and scan structured data faster than decorative surfaces.
- Avoid: marketing copy, oversized heroes, decorative whitespace, card-only work queues, color-only priority, and animations on high-frequency actions.

## Form-heavy Flow

Job: help a user complete data entry with confidence, recovery, and minimal rework.

- Density: moderate. Group fields into 480-720px readable columns; keep related fields within 16-24px vertical rhythm.
- Layout: explicit labels above or beside fields; progressive sections for long flows; sticky submit/review action only when it reduces loss.
- Typography: labels 13-14px, helper/error text 12-13px, section titles 16-20px.
- Color roles: neutral inputs, accent focus ring, error and warning distinct from accent, success used sparingly after save/submit.
- Motion: validation state changes may animate 100-160ms; progress or section transitions 160-240ms; avoid motion while typing.
- Components: fields need label, helper, invalid, disabled, loading, readonly, required/optional, dirty, and saved states when applicable.
- Aesthetic refinement: use calm grouping, clear label hierarchy, and predictable validation placement. Why: completion improves when users can anticipate errors and recovery.
- Avoid: placeholder-only labels, hidden errors, disabled submit without reason, irreversible dead ends, and late validation for easily checkable input.

## Data Visualization

Job: help a user compare, detect patterns, and trust the data.

- Density: match the analytic task. Preserve labels and annotations before decorative whitespace.
- Layout: chart title, timeframe, metric definition, legend, axis labels, source/updated state, and empty/error state are part of the component.
- Typography: labels 11-13px, annotation 12-14px, title 16-20px; numbers should use tabular figures.
- Color roles: categorical palettes need distinct hue and luminance; sequential palettes need ordered lightness; never rely on hue alone.
- Motion: transitions only when they preserve object constancy across filtering or time changes; 160-240ms max.
- Components: charts need loading, no-data, partial-data, error, hidden-series, tooltip/focus, keyboard exploration when feasible, and long-label handling.
- Aesthetic refinement: simplify marks, align legends with reading order, and annotate outliers. Why: good data UI reduces interpretation effort.
- Avoid: unlabelled axes, decorative gradients, 3D effects, color-only meaning, cropped legends, and unlabeled totals.

## Landing / Marketing

Job: help a visitor understand the offer, trust it, and choose the next action.

- Density: low to moderate. First viewport must show product/brand signal, value proposition, proof or product hint, and one clear primary action.
- Layout: use a strong hero, product media, social proof, benefits, feature detail, objections, pricing or next step, and footer. Keep a hint of the next section visible.
- Typography: hero 40-64px desktop, 32-44px mobile; supporting copy 16-20px; section headings 24-40px.
- Color roles: brand palette may be expressive, but reserve primary CTA color and keep semantic error/success separate.
- Motion: 160-360ms for low-frequency reveals, parallax, or media transitions only when they reinforce brand/product; reduced motion must preserve content.
- Components: CTA, nav, product media, testimonial/proof, comparison, FAQ, pricing, and contact/signup states need responsive variants.
- Aesthetic refinement: use distinctive asset quality, clear type hierarchy, and intentional contrast. Why: marketing pages must be memorable without hiding the offer. Commit to one clear aesthetic direction and execute it consistently; an indecisive "a bit of everything" surface fails the job, and the direction comes from the product/brand, not a default.
- Avoid: generic SaaS blocks, vague claims, stock-like dark blobs, hero text in a card, decorative screenshots that hide the product, and multiple competing CTAs.

## Content / Editorial

Job: help a reader consume, evaluate, and navigate content.

- Density: reading-first. Main text measure 60-80 characters; paragraph spacing 16-24px; generous line-height 1.55-1.75.
- Layout: article body, table of contents when long, inline media, captions, pull quotes only when content supports them, and related navigation.
- Typography: body 16-18px, h1 36-56px desktop, h2 24-36px, captions 12-14px.
- Color roles: neutral text contrast first; accent for links, selection, and navigational cues.
- Motion: minimal; use none for reading flow except low-frequency navigation or media reveal.
- Components: headings, links, media, code blocks, callouts, footnotes, search/filter when content collection, and empty/no-result states.
- Aesthetic refinement: tune measure, rhythm, hierarchy, and media fit. Why: reader trust comes from legibility and editorial discipline.
- Avoid: dashboard density, decorative widgets, low-contrast body text, broken text measure, and animation that interrupts reading.

## Game / Expressive Tool

Job: help a user understand state, feel feedback, and enjoy the interaction.

- Density: state-first. Keep core game/tool state visible at all times; secondary controls can collapse.
- Layout: primary play/work area dominates; HUD, inventory, score, timers, and mode controls stay predictable.
- Typography: labels and counters must remain legible under motion; expressive display type is allowed only outside high-frequency state reading.
- Color roles: reserve distinct colors for state, danger, success, active selection, and feedback. Effects must not obscure state.
- Motion: feedback can be richer, but controls must stay responsive; direct feedback 80-160ms, state transitions 160-300ms, celebratory effects low-frequency only.
- Components: start, pause, reset, mode switch, score/state display, feedback, error/invalid move, and reduced-motion variants.
- Aesthetic refinement: make feedback crisp, state readable, and motion purposeful. Why: expressive surfaces fail when users cannot read cause and effect. Commit to one clear aesthetic direction and execute it consistently; an indecisive "a bit of everything" surface fails the job, and the direction comes from the product/brand, not a default.
- Avoid: ambiguous game state, hidden controls, inaccessible key actions, excessive animation on repeated input, and effects that cover important state.

## Product App / Workflow

Job: help a user complete recurring tasks, keep context, and recover safely.

- Density: moderate. Use 36-44px rows for work lists, 16-24px panel padding, and 8-16px control gaps.
- Layout: persistent navigation, clear current object, predictable detail panels, modals for bounded decisions, and inline editing where recovery is obvious.
- Typography: body 14-16px, labels 12-13px, page title 22-32px, section title 16-20px.
- Color roles: one primary accent for action/selection; semantic colors for status and risk; muted neutrals for chrome.
- Motion: 100-200ms for navigation/detail changes; avoid animation on repeated power-user flows.
- Components: nav, toolbar, list/table, detail panel, form, dialog, toast, empty/loading/error/conflict, undo or recovery affordance when changes persist.
- Aesthetic refinement: use consistent rhythm, clear hierarchy, restrained chrome, and obvious state continuity. Why: workflow apps earn trust by making repeated tasks predictable.
- Avoid: decorative layout that slows repeated use, hidden state changes, irreversible actions without confirmation or undo, and feature cards that replace workflows.

## Presentation / Deck

Job: help a speaker present one idea per slide to a room, legibly at distance.

- Canvas: fixed aspect (16:9 default; 4:3 only if required). Design to the slide frame, not a scrolling page; no responsive breakpoints — scale the whole frame.
- Density: one primary idea per slide. Generous margins and safe-area; never pack a slide like a document or dashboard.
- Layout: title plus one supporting visual or point block; a consistent slide master (title position, margins, page number); section dividers for structure.
- Typography: large for distance — title 40-72pt-equivalent, body 24-32pt-equivalent, never below ~20pt-equivalent; strong weight contrast; few words per line.
- Color roles: high projection contrast (assume washed-out projectors and bright rooms); one reserved accent for emphasis; avoid low-contrast tints and thin text on busy backgrounds.
- Motion: slide advance is low-frequency; one consistent transition; build/reveal only to pace a single idea, never decorative per-element loops.
- Components: title slide, section divider, content slide, full-bleed media, quote/stat slide, and presenter notes when supported.
- Aesthetic refinement: commit to one clear aesthetic direction and execute it consistently across the master; an indecisive "a bit of everything" deck fails the job, and the direction comes from the topic and audience, not a default. Why: a deck must read as one authored point of view at a glance.
- Avoid: dense paragraphs, scroll/responsive web assumptions, tiny type, per-element decorative animation, low-contrast text on projection, and slides that are documents in disguise.

## Optional Inspiration

External design catalogs can help benchmark a surface after the contract is already self-sufficient. They are never required inputs and never override local contracts, captured product systems, or the accessibility floor.

- https://getdesign.md/
