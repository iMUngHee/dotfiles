---
name: ui-engineering
description: "Implement approved product-surface contracts in durable frontend code and produce render-grounded contract evidence. Use for authorized UI builds and read-only accessibility, motion, implementation-baseline, or contract/code drift audits. Do not use to invent missing UX or interface decisions, review PRs, or replace completed-feature verification."
argument-hint: "[audit | authorized UI implementation request]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
model: opus
disable-model-invocation: false
---

# UI Engineering

Translate an approved experience and interface contract into the existing frontend architecture. Own durable UI code, the Implementation Bridge section, and render-grounded design-fit evidence. Never silently invent product or interface intent.

Task: $ARGUMENTS (if empty, infer the authorized implementation scope)

## Routing Precedence

1. PR, diff, or review feedback → `code-review`; stop this skill.
2. Confirmation that a completed feature meets its goal → `verify`; stop this skill. UI-engineering evidence may be an input.
3. Read-only accessibility, motion, implementation-baseline, or contract/code drift inspection → run `audit` here.
4. New or materially changed product surface → `product-craft` owns the experience and interface gates before this skill.
5. Whenever `design` independently triggers, including every expected three-or-more-file change, its technical plan must be persisted and active before durable writes.
6. Routine frontend work with no UX/UI decision and no contract need → ordinary implementation path.

Fanout may parallelize disjoint implementation units only after ownership, authorization, and write sets are explicit. It never owns design decisions.

## Modes

- `audit` — read-only evidence collection and findings. It never authorizes source or contract edits.
- Default — durable implementation, allowed only after the authorization checklist passes.

## Authorization Checklist

Before any durable product write, require all applicable items:

- An explicit user build request.
- `Experience gate: READY FOR INTERFACE` for new/material experience scope.
- `Interface gate: READY FOR BUILD` for new/material presentation scope.
- Approved changed sections for Focused Delta.
- A persisted active general `design` plan whenever its independent trigger applies.
- The applicable `design-contract.md`, or an explicitly approved in-session Seed contract with the missing durable artifact disclosed.

If any material item is missing, stop. Authorization is scoped; it does not permit unrelated cleanup or a broader design change.

## Owned Contract Section

UI engineering is the sole writer for `Implementation Bridge` after build authorization. It records existing libraries, primitives, token/code mappings, CSS conventions, asset rules, technical constraints, and verification commands. It cannot override experience- or interface-owned sections.

## Required Context

1. Applicable approved contract and gate records.
2. Affected routes/screens/components and their realistic data/states.
3. Existing component primitives, design tokens, theme/style entry points, layout conventions, accessibility helpers, and tests.
4. `../product-craft/references/quality-floor.md`, `../product-craft/references/output-formats.md`, `references/implementation-baseline.md`, and `references/verification.md`.

Read only the contract sections and implementation evidence needed for the selected scope.

## Implementation Workflow

### 1. Reconcile Contract and Code

Map each affected contract rule to an existing primitive, token, component, style convention, or explicit new implementation need. Prefer the project's current platform feature, dependency, and shared component before custom code.

If code evidence conflicts with or cannot express approved intent:

- Emit `EXPERIENCE DELTA REQUIRED` for jobs, IA, flow, visible-state meaning, interaction semantics, recovery, or microcopy.
- Emit `INTERFACE DELTA REQUIRED` for composition, art direction, visual tokens, component appearance, responsive presentation, or interface formatting.
- Emit `CONTRACT GAP` when intent is missing/contradictory or ownership is unclear.

Stop the affected path. Do not resolve a gap with an arbitrary implementation choice.

### 2. Implement the Smallest Contract-Faithful Change

- Preserve technical architecture and existing product invariants.
- Reuse existing primitives and tokens before creating variants or dependencies.
- Implement all applicable states and recovery paths, not only the happy render.
- Apply semantic HTML, keyboard/focus behavior, contrast, touch, and reduced-motion floors.
- Keep motion frequency-appropriate and performance-safe.
- Use realistic content constraints and explicit overflow behavior.
- Update Implementation Bridge only with verified mappings and commands.

### 3. Verify by Rendering

Follow `references/verification.md`. Inspect the render against user-job closure, approved contract, selected surface profile, and shared floor. Source inspection alone cannot prove craft readiness.

While implementation remains authorized, correct an applicable measured failure and re-render, up to two source-change/render cycles. Then report exact coverage and remaining failures with the shared Design-Fit Result.

### 4. Hand Off to Goal Verification

Design-fit evidence does not replace `verify`. When implementation is complete, provide the evidence and route completed-feature confirmation to `verify` against the active plan's success criteria.

## Audit

Audit is read-only.

1. Establish the applicable contract, quality floor, existing implementation baseline, and requested audit scope.
2. Inspect source and render/runtime evidence where feasible.
3. Report findings by severity with concrete observation, file/render evidence, user-job or technical impact, and one correction.
4. Separate contract drift from implementation defects and from unverified coverage.
5. Route desired contract changes to the owning stage; do not edit on the audit request alone.
