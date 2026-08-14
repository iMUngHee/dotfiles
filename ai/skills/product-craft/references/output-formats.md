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
- `Evidence` — `captured:<path>` | `artifact:<ART-NNN>#<state>@<adaptation extreme>` |
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

A pasted **selection payload** is valid user evidence. Quote its required `note` verbatim as
the user's own words and record `base` plus `axes` as the coordinate of what they chose. A
payload carrying `redraft: true` is a redraft signal and records **no** token — a request to
redraw is not a selection, and treating it as one would launder a rejected frame into an
approval.

## Selection Payload

What a selection page hands back. One record, discriminated by `kind`; fields belonging to the
other variant are **forbidden**, not merely unused. `schema` guards against a newer page's
output being read silently by older rules.

`revision` and `template_revision` use the same form as everywhere else in this family — the
first 12 characters of a file's sha256 (`contract-schema.md`).

`revision` is the **chosen artifact's** hash. `template_revision` is the hash of the
**checked-in template** at `references/taste-tournament.html`, not of the filled instance — an
instance cannot contain its own hash. The skill computes it from the template when filling the
page and substitutes it in. Recompute the template's hash to check: a mismatch means the page
was built from an older template with a different axis list, so its answers do not map onto the
current one. Route that like `ARTIFACT DRIFT` rather than folding old choices into a new list.

```json
{ "kind": "decision", "schema": 1,
  "medium": "web|tui|cli|desktop-gui|mobile-gui|deck|print",
  "surface": "<contract path>", "stage": "experience|interface",
  "base": "ART-002", "revision": "<sha256 first 12>",
  "axes": { "<axis-id>": "<value>" },
  "questions": { "<question-id>": "<answer>" },
  "profile_origin": ["<axis-id>"], "overturned": ["<axis-id>"],
  "reviewed": ["default@wide", "empty@narrow"],
  "note": "<the user's own words, required>", "redraft": false }
```

```json
{ "kind": "taste", "schema": 1,
  "template_revision": "<sha256 first 12>",
  "rounds": [ { "pair": "<pair-id>", "axis": "<axis-id>",
                "medium": "<medium>", "chosen": "a|b|neither" } ],
  "resolved": [ { "axis": "<axis-id>", "medium": "*|<medium>",
                  "value": "<value>", "observations": 1 } ],
  "note": "<the user's own words, required>", "redraft": false }
```

- `note` is required in both variants. A click is not words; without this line the
  `direction_selected` verbatim requirement cannot be met.
- `redraft: true` requires only `kind`, `schema`, `note`, and `redraft`. Everything else is
  optional and ignored.
- `taste` forbids `surface`, `stage`, `base`, and `revision`: a tournament page is not an
  Artifact Ledger authority.
- `resolved[].medium` is `*` when both observations of an axis agreed across two media, and a
  specific medium when they disagreed — a disagreement means the axis is medium-bound, not
  invariant, and it yields one entry per medium with `observations: 1`.
- `profile_origin` lists axes left at the value `taste-profile.md` supplied. Every id in it must
  name a row that actually exists in the profile with that value; a page that claims a profile
  origin the profile never had is filled wrong, and the claim is refused rather than recorded.
  With an empty profile this list is empty. `overturned` lists axes where that default was
  flipped. Together they are the audit trail for what the profile
  decided versus what the user decided, and `overturned` drives the counter that retires a
  stale profile value.

## Consuming a Payload

Order matters. Check in this sequence; each step stops the ones below it.

1. **Malformed** — anything failing the record above is refused and returned to the page. It
   records nothing, not even a redraft. Say what field was wrong. A payload that is both
   malformed and stale is **malformed**: this step stops the rest, because a value that is not
   the stated form cannot be meaningfully compared to anything.
2. **`redraft: true`** — checked **before** branching on `kind`, because a redraft carries
   `kind: "decision"` and would otherwise fall into the selection path. Record no token. Quote
   the `note` in the routed stop as the reason the candidates are being redrawn; it is the only
   statement of what the axes should have been.
3. **`kind: "taste"`** — first recompute the checked-in template's hash and compare it to
   `template_revision`. A mismatch means the answers were collected against a different axis
   list, so they do not map onto the current one: emit `ARTIFACT DRIFT` naming the template
   rather than an `ART-NNN`, and stop. Otherwise produce a proposed diff against
   `taste-profile.md` and stop. Write nothing until explicit approval. The mapping is fixed:
   - one row per `resolved[]` entry, `Axis`/`Value`/`Medium` copied across;
   - `Note` is the payload's single `note`, quoted verbatim into every row it justifies — it is
     not split, paraphrased, or translated;
   - `Collected` is the date the user approves the diff, not the date of the rounds;
   - `Confirmations` counts **tournaments**, not observations. A first tournament yields 1
     regardless of whether `observations` was 1 or 2; a later tournament agreeing on the same
     axis and value increments it. Three is where a value stops being provisional.
4. **`kind: "decision"`** — check `profile_origin` and `overturned` against `taste-profile.md`:
   every id in either list must name an existing row whose value matches what the page offered.
   A claim with no matching row means the page was filled from something other than the profile;
   refuse it rather than recording a preference nobody expressed. Then verify the revision before
   recording anything.

### Revision check on a decision payload

The payload carries the revision the page was built from. It is a **third value** beside the
ledger's recorded revision and the recomputed hash of the artifact on disk.

- **First selection** — no ledger row exists yet, so the payload's `base` is resolved against
  the candidate set the interface stage just produced; that is where the path comes from, and
  the ledger row is written at this moment. Recompute that file's hash and compare it to the
  payload's `revision`. They must match: a mismatch means the artifact changed after the page
  was built, so the user chose something that no longer exists.
- **Later selection** — all three must agree.

Any disagreement is `ARTIFACT DRIFT`. Stop; do not record a token, and do not decide which
value looks right. Record the payload value in the drift record's `Payload` field.

Only when the revision agrees: record `direction_selected`, quoting the `note` verbatim beside
`ART-NNN`, or `ART-NNN@<axis combination>` when axes were chosen. The combination serializes as
the payload's `axes` keys in sorted order, `key=value` joined by `+` —
`ART-002@density=airy+list-shape=list`. Sorted so the same choice always produces the same
coordinate.

**Tier-3 answers are not interface decisions.** A dashboard may collect answers to questions the
experience stage still owes; they arrive in `questions`, never in `axes`, so they cannot end up
inside an interface-owned ledger coordinate. Route them to `experience-design` as answers to its
open questions. A payload that puts them in `axes` instead is not distinguishable after the
fact — ask which keys were tier-3 rather than guessing.

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
- Artifact: <ART-NNN> at <path> | template at <path>
- Recorded revision: <value | none, first selection> | Recomputed: <value>
- Payload: <revision the selection page carried | n/a>
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
- Committed: <macrostructure and direction, components, adaptation behavior, accessibility
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
