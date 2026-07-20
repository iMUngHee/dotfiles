# Product Craft Contract Schema

This is the only normative shape for canonical `design-contract.md`. Trim sections only as allowed by the selected Seed or Focused Delta depth; a Full contract covers every section and marks inapplicable dimensions `N/A` with one reason.

## Section Ownership

| Section | Sole writer | Required content |
| --- | --- | --- |
| Scope & Inheritance | `product-craft` | Applies-to path, parent contract, override rules, owner, last updated. |
| Surface Type & Craft Profile | `interface-design` | Surface classification, density, craft priorities, anti-patterns, quality bar. |
| Product Context | `experience-design` | Users, roles, jobs, success states, non-goals. |
| UX Model | `experience-design` | IA, routes, navigation, screen inventory, content priority, workflows. |
| Data & State Model | `experience-design` | User-visible empty, loading, error, partial, overflow, conflict, and recovery outcomes. |
| Interaction Model | `experience-design` | Behavior, validation, keyboard intent, destructive actions, feedback, recovery semantics. |
| Visual System | `interface-design` | Art direction, design tension, signature moment, tokens, type, spacing, radius, elevation, motion budget. |
| Component Rules | `interface-design` | Composition, appearance, variants, and visible/interactive states constrained by the UX model. |
| Responsive & Accessibility | `interface-design` | Concrete responsive presentation and accessibility values satisfying the quality floor and experience requirements. |
| Performance & Formatting | `interface-design` | Perceived-latency presentation and display formatting; business-meaning changes require an experience delta. |
| Microcopy | `experience-design` | Labels, helper text, validation, recovery, confirmation, and state language. |
| Do / Don't | `interface-design` | Surface-specific visual and component guardrails. |
| Implementation Bridge | `ui-engineering` | Existing libraries, primitives, token/code mappings, CSS conventions, asset rules, verification commands. |
| Decision Log & Open Questions | `product-craft` | Approved decisions, rejected proposals, owner, rationale, and unresolved routed questions. |

## Canonical Shape

```markdown
# design-contract.md

## Scope & Inheritance

## Surface Type & Craft Profile

## Product Context

## UX Model

## Data & State Model

## Interaction Model

## Visual System

## Component Rules

## Responsive & Accessibility

## Performance & Formatting

## Microcopy

## Do / Don't

## Implementation Bridge

## Decision Log & Open Questions
```

For Presentation/Deck surfaces, UX Model describes slide and speaker flow; Responsive & Accessibility describes fixed-canvas scaling and projection contrast. Mark irrelevant web dimensions `N/A`.

## Depth Rules

- Seed includes Scope & Inheritance, Surface Type & Craft Profile, Product Context, task-scoped UX Model, applicable Data & State Model, touched Component Rules, and Do / Don't. Add other sections only when the task commits to them.
- Focused Delta contains only changed sections, their verification impact, and a Decision Log entry. Unlisted sections remain authoritative.
- Full includes concrete values for every used dimension, component families mapped to real workflow locations, invariants with user-job rationale, and known gaps.

## Mutation Protocol

1. Keep proposals outside the canonical contract until their adaptive gate is satisfied.
2. A leaf changes only its owned sections. Cross-owner discoveries emit the applicable delta-required or contract-gap record and stop the affected path.
3. Product-craft writes Scope & Inheritance when needed, coordinates the approved canonical update, and appends Decision Log. It never authors leaf decisions.
4. The shared accessibility floor outranks the contract. Approved contract values outrank stage defaults. Implementation baselines constrain code without overriding product intent.
5. UI engineering may update Implementation Bridge only after build authorization. Code discoveries never silently rewrite experience or interface sections.
6. Seed persists a disclosed compact inferred baseline; Focused Delta persists only approved changed sections; Full persists Experience and Interface approvals separately before build.

Every committed value must name the concrete token, value, rule, example, or rationale that makes it implementable. Unknowns remain explicit gaps; never hide them behind adjectives.
