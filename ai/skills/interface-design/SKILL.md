---
name: interface-design
description: "Own interface planning for approved product experiences: macrostructure, screen composition, hierarchy, art direction, visual systems, component appearance, responsive presentation, and UI craft. Use directly for read-only UI audits, redesign, reference study, or focused interface deltas; product-craft routes new surfaces here after the Experience gate."
argument-hint: "[audit | redesign | study | delta | interface request]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
model: opus
disable-model-invocation: false
---

# Interface Design

Turn an approved experience model into a concrete, product-specific interface direction. Own interface decisions and non-production design specimens; never write durable product code.

Task: $ARGUMENTS (if empty, infer the desired interface outcome)

## Routing Precedence

1. PR, diff, or review feedback → `code-review`; stop this skill.
2. Confirmation of a completed feature → `verify`; stop this skill.
3. Read-only composition, visual-system, or UI-craft critique → run `audit` here.
4. New or materially changed product surface → `product-craft` owns orchestration; require `READY FOR INTERFACE` before interface planning.
5. A change limited to interface-owned sections of an approved contract → run `delta` here.
6. Whenever `design` independently triggers, finish the required surface gates before technical planning; no durable write occurs here.

Fanout may assist only below this owner after boundaries are approved. It never owns interface direction.

## Modes

Default behavior is verb-free: infer the smallest applicable path.

- `audit` — inspect the existing interface against its job, contract, captured system, and quality floor. Read-only.
- `redesign` — propose a materially different composition or art direction while preserving approved experience scope. Any job, IA, state, recovery, or microcopy change emits `EXPERIENCE DELTA REQUIRED`.
- `study` — extract structural design principles from a user-supplied screenshot or URL, diagnose what makes them work, and ask for acceptance before applying them. Borrow logic, not costume.
- `delta` — propose changes only to named interface-owned sections; preserve all unaffected contract sections.
- Default — produce the Seed or Full interface direction requested by product-craft.

## Owned Contract Sections

- Surface Type & Craft Profile
- Visual System
- Component Rules
- Responsive & Accessibility
- Performance & Formatting
- Do / Don't

Composition, macrostructure, and hierarchy are expressed through these sections and constrained by the approved UX Model. `references/interface-contract.md` explains the concreteness bar; it is not another schema.

## Required Context

1. The approved Experience gate and its affected experience-owned contract sections.
2. Nearest applicable `design-contract.md`, captured product system, representative screens, theme/tokens, and used component primitives.
3. `../product-craft/references/contract-schema.md`, `../product-craft/references/quality-floor.md`, and `../product-craft/references/output-formats.md`.
4. The one applicable profile in `references/surface-profiles.md`.
5. `references/concept-stage.md` when no reference exists, visual direction materially changes, or `redesign`/`study` runs.
6. `references/interface-contract.md` for Full work or a contract delta that changes system/component rules.

## Workflow

### 1. Confirm Experience Authority

For new/material work, require `Experience gate: READY FOR INTERFACE`. Treat jobs, IA, screen inventory, content priority, flows, states, recovery, and microcopy intent as constraints. If interface exploration exposes a needed change, emit `EXPERIENCE DELTA REQUIRED` and stop that path.

Audits may inspect an existing surface without a gate because they are read-only. Findings do not authorize edits.

### 2. Classify the Surface

Select the primary surface profile before choosing craft rules. Mixed surfaces may use multiple profiles only when scope boundaries are explicit. The quality floor outranks profiles; the approved contract outranks profile defaults.

### 3. Commit Composition and Direction

Macrostructure follows the approved information and flow model. Use the concept method to explore genuinely divergent safe, sharp, and borrowed reads when the concept gate fires. Choose structural relationships, hierarchy, density, and component voice together rather than assembling independent fashionable defaults.

For an owner-taste surface, render the candidates as variants of one representative screen with realistic content and let the owner pick. For an external product surface, commit the sharpest direction that best serves the job and survives every floor. Mixed or unclear audience requires a gate.

Disposable HTML, images, or component specimens are allowed only to make a design decision. Keep them outside durable product paths, label them non-production, and remove or archive them only with authorization. Interface design never turns a specimen into product implementation.

### 4. Make the Interface Contract Concrete

Specify only used dimensions and components. Name token/value/rule, component state, responsive behavior, accessibility value, formatting behavior, design tension, and signature moment or justified `N/A`. A naked adjective is not a contract value.

Seed covers touched presentation decisions. Focused Delta covers approved changed sections only. Full covers all used dimensions, component families mapped to workflows, invariants with rationale, and known gaps.

### 5. Hand Off

Emit the exact Interface gate record. `READY FOR BUILD` requires concrete composition, direction, component presentation, responsive behavior, accessibility values, and no open material interface question for the affected scope.

If `design` independently triggers, pass `READY FOR BUILD` to the general design workflow. UI engineering may start durable implementation only after the technical plan is persisted/active and the user has authorized build.

Do not edit the canonical contract unless the user authorized the file change and the applicable Interface gate is approved. Product-craft coordinates the canonical update and Decision Log.

## Audit

An audit is read-only and identity-preserving.

1. Establish the lens: accessibility floor → approved contract or captured product system → selected surface profile.
2. Inspect the rendered surface and key states when feasible; name uninspected scope.
3. Report findings by severity (`blocks the job`, `slows the job`, `polish`) with observation, evidence, user-job impact, and concrete correction.
4. Separate strengths from friction. Test hierarchy, density, macrostructure, component consistency, responsive behavior, and product specificity.
5. If changes are requested later, convert only accepted findings into Focused Delta or `redesign`.

## Routed Stops

Emit `EXPERIENCE DELTA REQUIRED` for changes to Product Context, UX Model, Data & State Model, Interaction Model, or Microcopy. Emit `CONTRACT GAP` when required interface intent is missing or contradictory. Stop only the affected path and return ownership through product-craft.
