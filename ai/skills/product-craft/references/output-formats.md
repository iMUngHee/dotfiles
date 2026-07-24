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

## Product-Surface Proof Records

These records are transition evidence, not a second product contract. Row identifiers are
local to one Surface Proof Packet and immutable after approval. Use `EXP-001`, `INT-001`,
and `IMP-001` forms.

Before approval, emit records in the current gate response. After approval,
`product-craft` persists the exact Experience and Interface rows plus the Surface Proof
Packet under the applicable contract's existing `## Decision Log & Open Questions`.
After authorized implementation and render inspection, `ui-engineering` writes the exact
Implementation Proof only as `### Implementation Proof` under that same contract's
`## Implementation Bridge`. Records never authorize their own stage.

### Experience Coverage

```text
Experience Coverage:
| EXP ID | Job / route | Required state / recovery | Navigation / URL intent | Depth scope | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
```

- Producer: `experience-design`.
- Consumers: `product-craft`, `interface-design`, and `design` when independently
  triggered.
- `Depth scope`: `Full` | `Seed:touched` | `Focused Delta:touched`.
- `Evidence`: `captured:<path, render, command, or approved contract>` |
  `approved:<decision summary>` | `inferred:<disclosed compact assumption>` | `missing`.
- `Status`: `PASS` | `GAP`.
- Full includes every material job, route, state/recovery outcome, and navigation/URL
  intent. Seed and Focused Delta include touched obligations only; the packet names
  unaffected authority.
- `GAP`, `missing`, a duplicate EXP ID, or an applicable material obligation with no row
  blocks `READY FOR INTERFACE`.

### Interface Coverage

```text
Interface Coverage:
| INT ID | Source EXP IDs | Contract requirement | Wide specimen | Narrow specimen | Status |
| --- | --- | --- | --- | --- | --- |
```

- Producer: `interface-design`.
- Consumers: `product-craft`, then `design` or `ui-engineering`.
- Every applicable EXP row maps to at least one INT row. An interface-only obligation
  uses `Source EXP IDs: N/A:interface-only`.
- Specimen evidence is
  `<artifact-or-render>#<state>@<viewport>:<inspected observation>`,
  `N/A:<concrete reason>`, or `missing`.
- `Status`: `PASS` | `GAP`.
- Full and any delta changing macrostructure or responsive behavior require inspected
  wide and narrow evidence for each changed macrostructure. Fixed-canvas or genuinely
  unaffected presentation may use a concrete `N/A`.
- `GAP`, `missing`, a duplicate INT ID, an unmapped applicable EXP row, an unknown source
  EXP ID, or an uninspected required specimen blocks `READY FOR BUILD`.
- `N/A:interface-only` without a concrete interface-owned requirement also blocks.
  Interface non-applicability stays specimen evidence; a valid row remains Interface
  `PASS`.

### Implementation Proof

```text
Implementation Proof:
| IMP ID | Source EXP / INT IDs | Applicability | Contract requirement | Code evidence | Test evidence | Inspected render / measurement | Classification | Gap reason | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
```

- Producer: `ui-engineering`.
- Consumer: `verify`; `product-craft` routes design-owned gaps.
- Evidence syntax is `<path>:<line, selector, assertion, state, or measurement>`.
  `missing` is explicit and never coerced to PASS.
- `Applicability`: `applicable` | `not applicable:<concrete reason>`.
- `Classification`: `aligned` | `implementation defect` | `contract drift` |
  `contract gap` | `unverified` | `not applicable`.
- `Gap reason`: `N/A` for non-gap rows; otherwise `missing intent` |
  `contradictory intent` | `owner unclear`.
- `Status`: `PASS` | `FAIL` | `NOT VERIFIED` | `N/A:<concrete reason>`.
- Coverage is transitive: an IMP row referencing an INT row covers that INT row and each
  EXP row named by the INT row. Reference an experience-only obligation directly and an
  interface-only obligation by INT ID. Every applicable EXP/INT row must be reachable
  from at least one applicable IMP row.
- `N/A` requires `not applicable:<same concrete reason>`, `not applicable`
  classification, `Gap reason: N/A`, `N/A` code/test/render evidence, and
  `Status: N/A:<same concrete reason>`. It covers no applicable source.
- PASS requires `aligned` plus code evidence, an affirmative assertion, and an inspected
  render or measurement proving the same material requirement. A generic page-level test
  cannot substitute for a contracted component transformation.
- A test that positively asserts behavior contrary to the contract is `contract drift` +
  `FAIL`, even when the test passes. Missing required evidence is `unverified` +
  `NOT VERIFIED`.

Use this highest-precedence classification:

| Highest-precedence condition | Classification | Row status | Packet aggregate |
| --- | --- | --- | --- |
| Approved intent is missing, contradictory, or owner-unclear | `contract gap` + exact matching Gap reason | `FAIL` | `BLOCKED`, route to the owning design skill |
| Code/test intentionally encodes behavior contrary to approved intent | `contract drift` | `FAIL` | `Design-Fit Outcome: NOT VERIFIED` |
| Approved intent is clear but implementation behavior is wrong | `implementation defect` | `FAIL` | `Design-Fit Outcome: NOT VERIFIED` |
| Required code/test/render evidence is missing or uninspected | `unverified` | `NOT VERIFIED` | `Design-Fit Outcome: NOT VERIFIED` |
| All required evidence agrees | `aligned` | `PASS` | contributes to `Design-Fit Outcome: READY` |
| Source is genuinely non-applicable and its reason is repeated | `not applicable` | `N/A:<reason>` | ignored for applicable coverage/readiness |

For multiple applicable failures, precedence is `contract gap`, `contract drift`,
`implementation defect`, `unverified`, then `aligned`. `not applicable` is outside
precedence and valid only when no material implementation obligation exists. A duplicate
IMP ID, unknown or absent source, uncovered applicable row, incomplete evidence, or
unjustified N/A yields `Design-Fit Outcome: NOT VERIFIED`.

### Surface Proof Packet

```text
Surface Proof Packet:
- Depth: Seed | Focused Delta | Full
- Scope: <routes, screens, states, and changed contract sections>
- Durable contract: <repo-relative path to design-contract.md> | missing
- Experience rows:
  - PASS: <EXP IDs> | none
  - GAP: <EXP IDs> | none
  - PENDING: <EXP IDs> | none
- Interface rows:
  - PASS: <INT IDs> | none
  - GAP: <INT IDs> | none
  - PENDING: <INT IDs> | none
- Implementation rows:
  - PASS: <IMP IDs> | none
  - FAIL: <IMP IDs> | none
  - CONTRACT GAP: <IMP IDs> | none
  - NOT VERIFIED: <IMP IDs> | none
  - PENDING: <IMP IDs> | none
  - N/A: <IMP ID=reason> | none
- Preserved authority: <unaffected contract sections or none>
- Material gaps: none | <row IDs and routed gap>
- Gate record: READY FOR INTERFACE | READY FOR BUILD | Design-Fit Outcome: READY | Design-Fit Outcome: NOT VERIFIED | BLOCKED
- Next owner: interface-design | design | ui-engineering | verify | product-craft
- Required approvals: none | <comma-separated subset of full_experience, focused_experience, full_interface, focused_interface, seed_build_request, build_authorization>
- Recorded approvals: none | <comma-separated required tokens that have explicit user evidence>
- User approval evidence: not recorded | <concise approved decision/build authorization>
```

`product-craft` coordinates the packet without changing leaf-owned rows. Every row ID
appears in exactly one stage bucket; empty buckets say `none`. Interface N/A evidence
remains in Interface PASS, while Implementation N/A has its own bucket.

Aggregate in this order:

1. Any Experience/Interface GAP or Implementation CONTRACT GAP -> `BLOCKED`.
2. After implementation starts, any FAIL, NOT VERIFIED, duplicate/unknown/unmapped row,
   or remaining PENDING -> `Design-Fit Outcome: NOT VERIFIED`.
3. Otherwise, every applicable aligned PASS plus concretely justified N/A ->
   `Design-Fit Outcome: READY`.

Before implementation, PENDING is allowed but never produces Design-Fit readiness. A row
in two buckets is malformed and follows the NOT VERIFIED path.

Keep row status, stage status, gate status, and next owner distinct:

- A stage is PASS when its rows pass even if typed approval is still missing; the gate is
  then BLOCKED and the unapproved row IDs are the blocking `failed_rows`.
- Experience-only evaluation uses Interface and Implementation `N/A`. Once any Interface
  row exists for an implementation-bound surface, Implementation is `PENDING` until
  Implementation Proof exists, even when Interface is currently GAP.
- Preserved experience authority is `PRESERVED`, not N/A, for a Focused Interface-only
  delta.
- `Next owner` is the stage that must act after the reported gate: READY FOR INTERFACE ->
  `interface-design`; READY FOR BUILD -> `design` when its trigger applies, otherwise
  `ui-engineering`; a routed gap -> its exact owning design skill.

Required and Recorded approval tokens are always present, unique, and sorted in the
packet order. Row PASS proves coverage only:

- Full Experience readiness requires `full_experience`.
- Changed Focused Experience readiness requires `focused_experience`.
- Full Interface readiness requires `full_interface`.
- Changed Focused Interface readiness requires `focused_interface`.
- Seed build chaining requires `seed_build_request`.
- Every durable implementation requires `build_authorization` in addition to applicable
  surface approval.

`product-craft` produces and persists Required approvals and Recorded approvals.
`design` copies both verbatim. `ui-engineering` consumes both before durable writes.
`verify` rechecks both before READY. Approval prose explains tokens but never substitutes
for a missing token.

### Evaluation Normalization

When a structured evaluation asks for closure fields, normalize them exactly:

`owner` is the skill that owns the current decision, never the packet's remedial
`Next owner`. Use this table literally:

| Current decision being reported | `owner` |
| --- | --- |
| Bounded Seed auto-chain through READY FOR BUILD | `product-craft` |
| Full Experience gate after it emits READY FOR INTERFACE | `interface-design` |
| Unresolved or Focused Interface decision, including its READY FOR BUILD gate | `interface-design` |
| Full READY FOR BUILD handoff whose technical-planning trigger applies | `design` |
| Completed proof presented for goal verification, including missing render, invalid N/A, or final readiness | `verify` |
| Implementation defect or drift still in the correction loop | `ui-engineering` |
| Missing or contradictory intent | exact owning experience/interface design skill |
| Owner-unclear contract gap | `product-craft` |

- `applicable_rows`: applicable source obligations only—EXP and INT IDs. Never put an IMP
  ID here.
- `covered_rows`: the unique transitive EXP/INT closure reached from applicable IMP source
  rows.
- Sort source-row arrays by stage (`EXP` before `INT`) and then numeric ID.
- Structured `experience_buckets`, `interface_buckets`, and `implementation_buckets`
  arrays contain raw row IDs only. In particular, structured Implementation `n_a` stores
  `IMP-NNN`; its concrete reason remains in that proof row's `na_reason`. The human
  Surface Proof Packet may render the same entry as `IMP-NNN=reason`.
- Before Implementation Proof exists, `failed_rows` contains the blocking EXP/INT rows
  for the current gate or handoff. Once any IMP row exists, it contains only IMP rows
  whose status is FAIL or NOT VERIFIED; upstream GAP rows remain visible in their stage
  buckets rather than being duplicated here.
- `rejected_substitutes` contains only exact substitute identifiers supplied by the
  evidence or evaluation, without added words:

  | Evidence phrase | Stored identifier |
  | --- | --- |
  | `document-no-overflow assertion` | `document-no-overflow` |
  | `inner-table-scroll behavior` | `inner-table-scroll` |

  Apply the same leading-kebab-case normalization to other named substitutes. Do not
  invent a substitute label for invalid or missing evidence.

When a contract gap reopens Experience, preserve a previously approved Interface PASS if
no INT row maps the affected experience-only obligation. If an INT row does map the
contradictory or missing EXP obligation, put that INT row in Interface GAP and report
Interface BLOCKED. In either case, once IMP rows exist, only the contract-gap IMP IDs
appear in `failed_rows`. Do not rewrite a preserved Interface PASS to N/A merely because
the gap is experience-owned.

### Durable Carrier and Handoff

The packet names one repo-relative Durable contract path that must resolve inside the
execution root.

- When `design` independently triggers, require a validated active plan whose
  `## Product Surface Proof Obligations` contains the exact approved EXP/INT rows, packet,
  approval fields, and contract path.
- Without a required technical plan, require an explicit no-plan handoff naming the same
  contained contract and its packet under Decision Log. Never invent a plan.
- A missing or escaping path, absent durable packet, malformed table, unbound
  plan-required route, or unexpected plan substitution is `NOT VERIFIED` or `BLOCKED` as
  dictated by the affected row; it never authorizes a write.
- After implementation, replace or insert only `### Implementation Proof` beneath the
  single `## Implementation Bridge`; preserve every non-Bridge byte. A stale read, a
  duplicate bridge/proof section, or a diff outside that section stops the handoff.

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
