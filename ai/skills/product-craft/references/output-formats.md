# Product Craft Output Formats

Keep field labels and gate tokens exact so handoffs can be checked mechanically.

## Experience Gate

```text
Experience gate: READY FOR INTERFACE | BLOCKED
- Depth: Seed | Focused Delta | Full
- User jobs and success: <approved facts or unresolved item>
- IA, routes, and screen inventory: <approved facts or justified N/A>
- Flow and content priority: <approved facts>
- States and recovery: <approved facts or justified N/A>
- Microcopy intent: <approved facts or justified N/A>
- Open material questions: none | <questions>
- Evidence: <contract, code, render, research, or disclosed inference>
```

Only `READY FOR INTERFACE` authorizes interface planning for the affected scope.

## Interface Gate

```text
Interface gate: READY FOR BUILD | BLOCKED
- Depth: Seed | Focused Delta | Full
- Surface and macrostructure: <approved decisions>
- Art direction and hierarchy: <approved decisions>
- Visual system and components: <approved decisions or justified N/A>
- Responsive and accessibility values: <approved decisions>
- Performance presentation and formatting: <approved decisions or justified N/A>
- Open material questions: none | <questions>
- Evidence: <contract, captured system, specimen, or disclosed inference>
```

`READY FOR BUILD` authorizes the next technical step only. If `design` independently triggers, a persisted active technical plan is still required before durable writes.

## Routed Stops

```text
EXPERIENCE DELTA REQUIRED
- Producer: interface-design | ui-engineering
- Affected section: Product Context | UX Model | Data & State Model | Interaction Model | Microcopy
- Conflict or missing decision: <evidence>
- Required owner decision: <question>
- Stop scope: <work that cannot continue>
```

```text
INTERFACE DELTA REQUIRED
- Producer: ui-engineering
- Affected section: Surface Type & Craft Profile | Visual System | Component Rules | Responsive & Accessibility | Performance & Formatting | Do / Don't
- Conflict or missing decision: <evidence>
- Required owner decision: <question>
- Stop scope: <work that cannot continue>
```

```text
CONTRACT GAP
- Producer: experience-design | interface-design | ui-engineering
- Evidence: <missing, contradictory, or unimplementable contract fact>
- Candidate owner: product-craft | experience-design | interface-design | ui-engineering
- Required decision: <question>
- Stop scope: <work that cannot continue>
```

## User-Job Closure

```text
User-job closure:
- Requested action: <user-visible action>
- Success: <observable result and feedback>
- Failure/retry: <failure, recovery, and retry feedback, or justified N/A>
- Preserved invariants: <authoritative routes, controls, data, states, and visual rules>
```

## Material Gaps

```text
Material gaps: none | <comma-separated gaps>
```

Emit this inside the existing approval transition, never as a new gate.

## Design-Fit Result

```text
Design judgment:
- User-job fit: <assessment>
- Workflow and product specificity: <assessment>
- Hierarchy, density, and craft: <assessment>
- Contract integrity: <assessment>

Verification status:
- User-job closure: PASS | FAIL | N/A - <evidence or concrete reason>
- Required states/recovery: PASS | FAIL | N/A - <evidence or concrete reason>
- Inspected render coverage: PASS | FAIL | N/A - <paths or concrete reason>
- Geometry/overflow: PASS | FAIL | N/A - <measurements or concrete reason>
- Accessibility floors: PASS | FAIL | N/A - <evidence or concrete reason>
- Contract/code/render agreement: PASS | FAIL | N/A - <evidence or concrete reason>

Outcome: READY | NOT VERIFIED
```

`READY` requires every applicable verification row to pass and every `N/A` to carry a concrete reason. If measured correction stops, append the failed selector/control, observed value, required threshold, correction cycles used, and stop reason.
