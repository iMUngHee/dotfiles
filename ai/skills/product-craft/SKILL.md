---
name: product-craft
description: "Route UX planning, interface planning, and durable UI implementation for new or materially changed client surfaces. Use for pages, apps, dashboards, workflows, navigation or state models, reusable component families, visual systems, redesigns, UX/UI audits, and design-contract.md work. Skip routine frontend edits with no UX/UI decision, PR review, and completed-feature verification."
argument-hint: "[product-surface request]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
model: opus
disable-model-invocation: false
---

# Product Craft

Own the product-surface pipeline while loading only the smallest useful stage context:

1. `experience-design` defines what users need, how the surface is organized, and how workflows recover.
2. `interface-design` defines how the approved experience is composed, expressed, and adapted.
3. `ui-engineering` implements the approved contract and verifies the rendered result.

Keep one canonical `design-contract.md`. Planning proposals stay outside it until their applicable gate is approved.

Task: $ARGUMENTS (if empty, infer the requested product surface and desired outcome)

## Routing Precedence

Apply this order without exception. Fanout is an execution modifier beneath the selected owner; it never changes ownership.

1. PRs, branch diffs, and review feedback → `code-review`. Stop product-craft routing.
2. Confirmation that a completed feature meets its goal → `verify`. It may consume UI-engineering evidence.
3. Read-only IA/workflow/recovery audit → `experience-design audit`.
4. Read-only composition/visual-system/craft audit → `interface-design audit`.
5. Read-only accessibility/motion/implementation/contract-drift audit → `ui-engineering audit`.
6. New or materially changed product surface → continue through this router.
7. Routine frontend edit with no UX/UI decision → report `no contract needed` and use the ordinary implementation path.

Whenever the independent `design` trigger applies at any depth, including every expected three-or-more-file change, close the required product-craft surface gates first. Then hand off to `design`; durable writes require its persisted active plan. `design` does not replace experience or interface approval.

## Choose Contract Depth

Use the lightest depth that can guide the work without guessing.

| Depth | Use when | Required path |
| --- | --- | --- |
| Seed | A bounded surface change has no applicable contract and product intent is sufficiently clear. | Disclose a compact inferred experience baseline, resolve material ambiguity, then run the interface gate. |
| Focused Delta | An approved contract exists and named sections must change. | Route only changed sections to their sole owner; preserve every unaffected section. |
| Full | A new app, multi-route workflow, redesign, inconsistent system, or explicit full design needs complete decisions. | Approve Experience, then Interface, then authorize build. |

Do not inflate Seed into a design system. Do not use Focused Delta to smuggle changes into unapproved sections.

## Orchestration

1. Locate the nearest applicable `design-contract.md`; a repository-root contract is a base and a nearer app contract overrides only its declared sections.
2. Read `references/contract-schema.md`, `references/quality-floor.md`, and `references/output-formats.md`. Read `references/craft-review.md` when a render will be judged.
3. Record scope, contract depth, inherited evidence, proposed sections, and owner for each proposal.
4. Run `experience-design` when experience-owned decisions are missing or changing. Pass only Product Context, UX Model, Data & State Model, Interaction Model, and Microcopy plus relevant evidence. Require its experience-stage obligations before considering `READY FOR INTERFACE`.
5. Validate unique ids, material obligation coverage, evidence, depth scope, and `experience_approved`.
6. Continue to `interface-design` only after `READY FOR INTERFACE`. Pass the approved experience sections and their obligations, surface scope, and the shared quality floor.
7. Validate that every applicable experience obligation is covered, that artifact evidence was actually inspected, and that `direction_selected` carries the user's own words, before considering `READY FOR BUILD`.
8. On the applicable user approval, persist the obligation rows, `## Artifact Ledger` entries, approval tokens, and their user evidence under the durable contract's `## Decision Log & Open Questions`.
9. Continue toward implementation only after `READY FOR BUILD`. If `design` independently triggers, pass the exact records and contract path so its technical plan can preserve them; persist and activate that plan before `ui-engineering` writes.
10. Run `ui-engineering` with the approved contract and build authorization. It writes implementation evidence only under Implementation Bridge. Route any gap back to its sole owner; never let implementation invent the answer.

For Seed, an explicit build request may auto-chain disclosed compact experience and interface inferences when none is materially ambiguous. For Focused Delta, every changed section requires approval. Full requires separate Experience and Interface approvals plus explicit implementation authorization.

## Canonical Contract Rules

- `references/contract-schema.md` is the only normative schema.
- Each section has one writer. Product-craft coordinates updates but does not invent leaf-owned content.
- The accessibility floor outranks an approved contract. The contract outranks stage defaults. Implementation constraints may expose a gap but cannot rewrite intent.
- `[captured]` and `[proposed]` are proposal annotations only. Remove them when approved values enter the canonical contract; preserve rationale in Decision Log.
- `design-contract.md` describes how a product surface works and feels. `.agents/plans/*.md` describes how a technical change will be executed.
- Never create or edit a contract, specimen, or product source without user authorization.

## Gate Protocol

Use the exact records in `references/output-formats.md`.

- `READY FOR INTERFACE` — produced by experience-design; consumed by interface-design. Continue only when jobs, IA/flow, visible states, recovery, and material questions are resolved for the selected depth, every applicable EXP obligation has one valid PASS row, and Required approvals are present in Recorded approvals.
- `READY FOR BUILD` — produced by interface-design; consumed by design or ui-engineering. Continue only when composition, art direction, component presentation, responsive behavior, and accessibility values are concrete for the selected depth, every EXP row is mapped, required specimens were inspected, every INT row is valid, and Required approvals are present in Recorded approvals.
- `EXPERIENCE DELTA REQUIRED` — produced by interface-design or ui-engineering when an experience-owned section must change. Stop the affected path and return to experience-design.
- `INTERFACE DELTA REQUIRED` — produced by ui-engineering when an interface-owned section must change. Stop the affected path and return to interface-design.
- `CONTRACT GAP` — produced by a leaf when required intent is absent or conflicting and ownership cannot safely be bypassed. Product-craft routes it; the affected path stays stopped.

## Surface Obligations Lifecycle

Use `Surface Obligations`, `Approvals`, `Craft Findings`, and `ARTIFACT DRIFT` from
`references/output-formats.md`, and `## Artifact Ledger` from `references/contract-schema.md`.

1. Leaves allocate `OBL-NNN` in one namespace and link upward with `Derives from`. Coverage
   follows the ancestor chain: a downstream row covers everything above it.
2. Any `GAP` blocks its gate. `PENDING` marks a stage that has not produced its rows yet and
   never yields readiness.
3. Approvals are `experience_approved`, `direction_selected`, and `build_authorized`, each
   recorded only from explicit user evidence. `direction_selected` belongs to the user —
   record their own words and the chosen `ART-NNN`. Never select on their behalf.
4. When a design artifact carries the visual decision, record it in the contract's
   `## Artifact Ledger` with path, revision, coverage, and reviewed state/viewport scope.
   Inside that reviewed scope the selected artifact outranks written decisions.
5. On approval, persist the obligations, ledger rows, and approvals under the durable
   contract's `## Decision Log & Open Questions`, keeping the path inside the execution root.
6. After implementation, consume both the contract comparison and the `Craft Findings`. A
   material craft finding blocks readiness even when no obligation row mentions it.
7. Route a recomputed-revision mismatch, an external artifact reference, or an
   artifact-versus-decision conflict as `ARTIFACT DRIFT` to its owning skill.

## Carriers and Ownership

For a bounded Seed auto-chain, `product-craft` owns the evaluation through `READY FOR BUILD`.
For a Full `READY FOR BUILD` handoff whose technical trigger applies, ownership moves to
`design`.

For no-plan Seed or Focused work below the independent design trigger, the records persisted
under Decision Log are the durable carrier. The approved in-session handoff names that
contained contract path explicitly; it never invents or implies an active plan.

## Handoff Boundaries

`experience-design` owns jobs, IA, routes, screen inventory, content priority, workflows, visible states, recovery, and microcopy. `interface-design` owns macrostructure, composition, hierarchy, art direction, visual systems, component appearance, responsive presentation, and interface accessibility values. `ui-engineering` owns durable UI code, Implementation Bridge, and render-grounded evidence.

Interface planning produces design artifacts that carry the visual decision. A selected
artifact is durable reference — recorded in `## Artifact Ledger` and read by implementation —
not a disposable specimen. Only ui-engineering writes product source.
