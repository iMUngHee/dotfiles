# Product Craft Output Formats

Keep field labels and gate tokens exact so handoffs can be checked mechanically.

## Surface Obligations

One table tracks what a surface owes, across every stage.

```text
Surface Obligations:
| ID | Stage | Obligation | Derives from | Evidence | Status |
```

- `ID` — `OBL-NNN`, immutable, one namespace across all stages.
- `Stage` — `experience` | `interface` | `implementation`, produced by `experience-design`,
  `interface-design`, and `ui-engineering` respectively.
- `Derives from` — the obligations this one refines, comma-separated, or `—` when it
  originates at this stage.
- `Evidence` — `captured:<path>` | `artifact:<ART-NNN>#<state>@<viewport>` |
  `code:<path:line>` | `render:<path>` | `critique:<craft finding>` | `missing`.
- `Status` — `PASS` | `GAP` | `PENDING` | `N/A:<concrete reason>`.

**Coverage follows the ancestor chain.** A row covers everything it derives from,
transitively. Walk `Derives from` upward to decide coverage.

Any `GAP` blocks its gate. `PENDING` means a later stage has not produced its rows yet, and
never yields readiness. `N/A` needs a concrete reason and covers nothing. At Full depth a
missing material job, route, state, or recovery is itself a `GAP` — absence is not silence.

`design` turns experience and interface rows into success criteria, preserving ids and
wording. `verify` walks the chain for applicable rows no implementation row reaches.

## Approvals

Three tokens, each recorded only from explicit user evidence:

- `experience_approved` — the UX model is approved.
- `direction_selected` — the user chose one artifact. Record their own words verbatim beside
  the chosen `ART-NNN`. No skill records this on the user's behalf; choosing for them defeats
  the point of showing candidates.
- `build_authorized` — durable implementation is authorized.

Seed may skip `experience_approved`; the other two are never skipped. Approval prose explains
a token, never replaces one.

## Craft Findings

Open-critique results from `craft-review.md`, kept separate so a defect with no obligation row
stays visible.

```text
Craft findings: none | <count>
- Severity: unusable | degrades the task | polish
  Observation: <what is wrong>
  Evidence: <screenshot, selector, or measurement>
  Cost: <what it costs the reader or user>
  Correction: <one concrete fix>
Uninspected scope: none | <what was not examined>
```

`unusable` and `degrades the task` block readiness regardless of the obligation rows.

## Artifact Drift

```text
ARTIFACT DRIFT
- Artifact: <ART-NNN> at <path>
- Recorded revision: <value> | Recomputed: <value>
- Problem: revision mismatch | external reference | contradicts an approved decision
- Evidence: <what was observed>
- Owner: interface-design | ui-engineering | product-craft
- Stop scope: <what cannot continue>
```

Stop the affected path; never resolve drift by judging which side looks right.

## Experience Gate

```text
Experience gate: READY FOR INTERFACE | BLOCKED
- Depth: Seed | Focused Delta | Full
- Resolved: <jobs and success, IA and routes, flow and content priority, states and
  recovery, microcopy intent — or what remains open>
- Open material questions: none | <questions>
- Evidence: <contract, code, render, research, or disclosed inference>
```

The obligation rows carry the detail; this says whether the stage is closed. Only
`READY FOR INTERFACE` authorizes interface planning.

## Interface Gate

```text
Interface gate: READY FOR BUILD | BLOCKED
- Depth: Seed | Focused Delta | Full
- Committed: <macrostructure and direction, components, responsive behavior, accessibility
  values, display formatting — or what remains open>
- Selected artifact: <ART-NNN> | none
- Open material questions: none | <questions>
- Evidence: <contract, captured system, inspected artifact, or disclosed inference>
```

`READY FOR BUILD` authorizes the next technical step only. If `design` independently triggers,
a persisted active technical plan is still required before durable writes.

## Routed Stops

```text
EXPERIENCE DELTA REQUIRED | INTERFACE DELTA REQUIRED | CONTRACT GAP
- Producer: <skill that found it>
- Affected section: <contract section, or "owner unclear">
- Conflict or missing decision: <evidence>
- Required owner decision: <question>
- Stop scope: <work that cannot continue>
```

An experience delta routes to `experience-design`, an interface delta to `interface-design`,
a contract gap to the section's owner — `product-craft` when ownership itself is unclear.
Stop only the affected path.

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

Emit it inside the approval transition, never as a new gate.

## Durable Carrier

One repo-relative contract path, resolving inside the execution root.

- When `design` independently triggers, its active plan's
  `## Product Surface Proof Obligations` carries the same rows, ledger entries, and tokens.
- Otherwise an explicit no-plan handoff names the same contract, whose Decision Log holds them.
- A missing or escaping path, absent records, malformed table, or unexpected plan substitution
  stops the handoff; it never authorizes a write.
- After implementation, write only within `## Implementation Bridge`.

## Design-Fit Result

```text
Design judgment: <how well the built surface serves the job, and where it falls short>
Verified: <what was inspected and what it showed>
Failed or uncovered: none | <what failed, and what was never inspected>
Craft findings: none | <count and severities>
Outcome: READY | NOT VERIFIED
```

Checks live in `ui-engineering/references/verification.md`. `READY` requires every applicable
obligation to pass with inspected evidence, every `N/A` to carry a concrete reason, and no
material craft finding outstanding. When measured correction stops, append the failed
selector, observed value, required threshold, cycles used, and stop reason.
