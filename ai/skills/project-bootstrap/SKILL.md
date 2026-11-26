---
name: project-bootstrap
description: Install or realign, once, a repository-owned engineering quality floor - a written architecture and conventions grounded in reasoned decisions and published guides, structure that makes the wrong change hard, a gate that rejects what remains, and maintenance the repository carries on without this skill. Use on a new project or for the first quality setup of an existing one. Skip routine feature work, isolated lint changes, and adding property, fuzz, mutation, model-checking or proof methods (advanced-verification).
disable-model-invocation: false
---

# Project bootstrap

Make engineering quality a property of the repository, not of the agent operating on it. Bootstrap the quality floor, not the entire engineering process.

The floor is strict and the space above it stays free. The repository says what its structure and conventions are, makes unacceptable changes hard to write, rejects the machine-decidable rest, and says plainly what is left to judgment; contributors still choose between good implementations. Bootstrap runs once per repository: for a new project, a first adoption or a realignment of an existing harness. Afterwards the documents, the gate and the maintenance loop work from the checkout alone, with no personal harness, global instructions or copy of this skill. A request to discuss produces a proposal; a setup request installs the floor and proves it.

## The floor

Three layers, each the basis of the next:

1. **Normative.** ARCHITECTURE defines the structure: components and what each owns, layers and allowed dependency directions, security and isolation boundaries, resource lifetimes, extension paths, decisions with their reasons, and where the current code departs from the target. CONVENTIONS defines the rules: the guides followed, the order of authority, and each rule with its source and how it is enforced. Every repository has both roles. Name them `ARCHITECTURE.md` and `CONVENTIONS.md` at the root or under `docs/` as the repository already places documents; when an existing document already meets the content requirements, designate it instead of writing another. See [architecture](references/architecture.md) and [conventions](references/conventions.md).
2. **Enforcement.** Code that makes the wrong change hard, and a gate that reads both documents: the dependency policy that ARCHITECTURE links, and the enforcement tag on each rule CONVENTIONS owns. See [gate](references/gate.md).
3. **Maintenance.** The correction loop, the reasons behind decisions, and a record of corrections the gate cannot catch yet, each written into the repository's own guidance. See [maintenance](references/maintenance.md).

The two documents are short, hold what changes rarely, cite the code behind each claim, keep current, target and debt apart, and scale with the project. Above the floor, add a development guide, reference documents, a decisions directory, scoped rules or project skills only when the project gives one a job and no existing document can hold it ([harness](references/harness.md)). Every rule, check, document and test you add is upkeep the repository inherits; above the floor, add one only for a named failure.

## Where a decision goes

Settle each consequential decision at the first level that holds. Each lower level costs more to keep and protects less:

1. **Code.** An owner, an API, a type or a directory layout that makes the wrong change hard to express.
2. **Static checks.** The compiler, the stack's lints, a boundary or ban check whose message names the fix, a ratchet that lets existing violations only shrink.
3. **Behavior evidence.** A test or measurement for a contract that only running code shows.
4. **Prose.** A short rule with its reason, for the judgment nothing above can carry.

Passing tests, a clean lint run or rising coverage say little about structure or cost: an extra layer or a split responsibility passes every functional test, and a workaround left in place becomes the next contributor's example.

## Steps

1. **Understand the boundaries.** Read the purpose, design and research records, contributor conventions and public surfaces. Locate the owners of persisted state, dependency boundaries, security and isolation boundaries, resource lifetimes, costly execution paths and existing protections. Trace a representative change through the actual code, and follow each consequential boundary not covered by that trace far enough to identify its supported extension path and any credible bypass. For an empty project use the first intended change.
2. **Define the structure.** Write or designate ARCHITECTURE. For a new project it is the intended design, marked provisional. For an existing one it is the current structure with code references, the target, and the debt between them. Existing code is evidence, never authority.
3. **Define the conventions.** Write or designate CONVENTIONS. Take its standards from reasoned project decisions, the maintainer's preferences, published guides you read for this setup, then supported stack defaults ([defaults](references/defaults.md)). Spend the effort on architecture, semantics and implementation cost; use idiom and style where they keep those consistent. For each consequential rule know its source, the failure it prevents, a technically working change it would reject, and the legitimate alternative it must keep allowing.
4. **Carry the structure in code.** Follow the intended extension through its owner, API and types. Where a credible shortcut remains, prefer a small compatible change that gives the responsibility to its owner or makes the invalid path harder to express, and keep one sound implementation as the example. Record a costly migration as a deferred decision instead of performing it. Then compare ARCHITECTURE with the actual tree again and correct whatever the changes made untrue.
5. **Enforce what remains and prove it.** Reuse or install one gate with fast and full tiers, point existing CI at it and enable the clone-local pre-push hook. Turn on the native checks that enforce the adopted conventions. In an existing repository, before writing any baseline, record a reproducible command and its result for every adopted constraint the existing code can break, whether a check or review enforces it: every pair of layers, decisions repeated outside their owner, casts or unparsed input past a boundary, blocking work on a hot path, lists that must change together; a zero needs its command too; bind each positive count instead of fixing it in bulk, with a ratchet or debt rows where a check can count it, and record every remaining gap, an unmeasured constraint included, as an incomplete requirement with its reason and next step. Every boundary or ban the documents state that a machine can decide, such as a forbidden dependency edge between packages or a forbidden import or API in a module, gets a check: the stack's dependency or import tool where it has one, else a small precise script. Prove it with a planted violation and its legitimate counterpart; leaving such a rule to review needs a stated reason no precise check can decide it. Add behavior tests only for a named contract with a gap in existing evidence, and report any risk that needs more than ordinary tests as a candidate instead of installing it. See [stacks](references/stacks.md) and [verification](references/verification.md).
6. **Hand over maintenance.** Write all four items of the correction loop into the contributor guidance, including where a correction the gate cannot catch yet is recorded and that its second occurrence turns it into a check or rule. Link both documents from the entry point. Keep personal addresses, home paths, machine details and global assistant rules out of the repository.

## Done when

- **Defined.** ARCHITECTURE and CONVENTIONS exist or are designated and meet their content requirements, with current, target and debt kept apart.
- **Grounded.** Every consequential standard names its project reason or the guide section it comes from; anything you could not source is marked unsourced.
- **Enforceable.** Each machine-decidable rule fails in the gate with a repair hint, and a nearby legitimate change passes.
- **Self-contained.** A fresh session without this skill, given only the checkout, finds both documents and the gate from the entry point and can judge whether a change breaks the structure.
- **Evolvable.** The maintenance loop is in the guidance, baselines and debt can only shrink, and exceptions say how to add and retire them.
- **Minimal.** Nothing above the floor was added without a named failure, and the harness the repository wrote itself stays small beside the product; generated surfaces rebuild idempotently.

## Proof before reporting

1. Run the fast and full tiers on the checkout.
2. For each new check, plant a realistic violation and confirm it fails with its hint; confirm the closest legitimate change passes; remove both.
3. Rerun any generator or builder and its `--check`; inspect the working-tree diff including untracked files.
4. From the checkout alone, follow the documented setup, including the hook, and the documented extension path, and confirm the repository's guidance carries every correction-loop item and same-change duty in [maintenance](references/maintenance.md).

Report: where ARCHITECTURE and CONVENTIONS live and whether each was written or designated; the guides read and what was adopted from them; what the structure prevents, what each tier runs, the failure and evidence behind each check added above the floor, whether this clone enables the hook, and what remains for review; each adopted constraint's command, result and binding; line counts for product code, harness the repository wrote, and bundled assets copied unchanged; the editable guidance sources; verification candidates with the promise each would protect; deferred migrations; checks you could not run; and every file the session could not write, with the commands a person runs to finish. Report, as an incomplete requirement, any adopted machine-decidable rule not yet enforced, with the reason and remaining work, separately from structural guarantees, active checks and judgment-only rules. Release publishing is a separate action.
