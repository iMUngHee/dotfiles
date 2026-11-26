---
name: project-bootstrap
description: Install or realign, once, a repository-owned engineering quality floor - a written architecture and conventions grounded in reasoned decisions and published guides, structure that makes the wrong change hard, a gate that rejects what remains, and maintenance the repository carries on without this skill - and lay out the decisions this project still has to make. Use on a new project or for the first quality setup of an existing one. Skip routine feature work, isolated lint changes, and adding property, fuzz, mutation, model-checking or proof methods (advanced-verification).
disable-model-invocation: false
---

# Project bootstrap

Make engineering quality a property of the repository, not of the agent operating on it. Bootstrap the quality floor, not the entire engineering process.

No setup can decide everything a project needs, and this skill does not try: it installs a small floor every repository shares and lays out the rest as decisions for the people who know the project. Bootstrap runs once per repository: for a new project, a first adoption or a realignment of an existing harness. Afterwards the documents, the gate and the maintenance loop work from the checkout alone, with no personal harness, global instructions or copy of this skill. A request to discuss produces a proposal; a setup request installs and proves the floor and leaves the map.

## Two outputs

**The floor** is what every repository gets, finished and proved. Contributors still choose freely above it.

1. **Normative.** ARCHITECTURE defines the structure: components and what each owns, layers and allowed dependency directions, security and isolation boundaries, resource lifetimes, extension paths, decisions with their reasons, and where the current code departs from the target. CONVENTIONS defines the rules: the guides followed, the order of authority, and each rule with its source and how it is enforced. Name them `ARCHITECTURE.md` and `CONVENTIONS.md` at the root or under `docs/` as the repository already places documents; when an existing document already meets the content requirements, designate it instead of writing another. See [architecture](references/architecture.md) and [conventions](references/conventions.md).
2. **Enforcement.** Code that makes the wrong change hard, and one gate that reads both documents: the dependency policy ARCHITECTURE links and the enforcement tag on each rule CONVENTIONS owns. See [gate](references/gate.md).
3. **Maintenance.** The correction loop and the reasons behind decisions, written into the repository's own guidance. See [maintenance](references/maintenance.md).

The two documents are short, cite the code behind each claim, keep current, target and debt apart and scale with the project. Anything above the floor (a development guide, reference documents, scoped rules, project skills) needs a job no existing document can hold ([harness](references/harness.md)), because everything you add is upkeep the repository inherits.

**The customization map** is what this project still has to decide. Each entry carries its evidence (a command and its output, or a code location), the [mechanisms](references/gate.md#choosing-mechanisms) that could carry it and your proposal. It lives in ARCHITECTURE's open decisions, where it outlasts the session, and in the report, and holds only decisions that would change what someone does next; it may be empty.

When a choice would change what you install and a maintainer who can decide it is reachable, ask before making that change. Otherwise install only what approved policy and project evidence settle, and record the choice on the map.

## Where a decision goes

Settle each consequential decision at the first level that holds. Each lower level costs more to keep and protects less:

1. **Code.** An owner, an API, a type or a directory layout that makes the wrong change hard to express.
2. **Static checks.** The compiler, the stack's lints, a boundary or ban check whose message names the fix, a ratchet that lets existing violations only shrink.
3. **Behavior evidence.** A test or measurement for a contract that only running code shows.
4. **Prose.** A short rule with its reason, for the judgment nothing above can carry.

Passing tests, a clean lint run or rising coverage say little about structure or cost: an extra layer or a split responsibility passes every functional test, and a workaround left in place becomes the next contributor's example.

## Steps

1. **Understand the boundaries.** Read the purpose, design and research records, contributor conventions and public surfaces. Locate the owners of persisted state, dependency boundaries, security and isolation boundaries, resource lifetimes, costly execution paths and existing protections. Trace a representative change through the actual code, and follow each consequential boundary not covered by that trace far enough to identify its supported extension path and any credible bypass. For an empty project use the first intended change.
2. **Define the structure.** Write or designate ARCHITECTURE. For a new project it is the intended design, marked provisional. For an existing one it is the current structure with code references, the target, and the debt between them. Existing code is evidence, never authority. A structural question the code cannot settle goes on the map.
3. **Define the conventions.** Write or designate CONVENTIONS. Take its standards from reasoned project decisions, the maintainer's preferences, published guides you read for this setup, then supported stack defaults ([defaults](references/defaults.md)). Spend the effort on architecture, semantics and implementation cost; use idiom and style where they keep those consistent. For each consequential rule know its source, the failure it prevents, a technically working change it would reject, and the legitimate alternative it must keep allowing.
4. **Carry the structure in code.** Follow the intended extension through its owner, API and types. Where a credible shortcut remains, prefer a small compatible change that gives the responsibility to its owner or makes the invalid path harder to express, and keep one sound implementation as the example. Put a costly migration on the map instead of performing it. Then compare ARCHITECTURE with the actual tree again and correct whatever the changes made untrue.
5. **Install and prove the floor.** Reuse or install one gate with fast and full tiers, point existing CI at it and enable the clone-local pre-push hook. Turn on the native checks that enforce the adopted conventions. Every boundary or ban the documents adopt that a machine can decide, such as a forbidden dependency edge between packages or a forbidden import or API in a module, gets a check: the stack's dependency or import tool where it has one, else a small precise script; one you cannot install yet is an incomplete requirement. Prove each check with a planted violation and its legitimate counterpart; leaving such a rule to review needs a stated reason no precise check can decide it. In an existing repository, ratchet the existing violations of an adopted rule that a precise check counts instead of fixing them in bulk. Isolate a failure that predates the setup so both tiers pass at handover, without switching off an adopted protection. Add behavior tests only for a named contract with a gap in existing evidence. See [stacks](references/stacks.md) and [verification](references/verification.md).
6. **Lay out the map.** Collect what the steps above left open: departures from the target that no adopted check binds, boundaries and rules the documents state without a check, checks above the floor that a real occurrence would justify, risks that need more than ordinary tests, deferred migrations and structure you are unsure of. Write the ones that change what the maintainer does next into ARCHITECTURE's open decisions.
7. **Hand over maintenance.** Write all four items of the correction loop into the contributor guidance, including where a correction the gate cannot catch yet is recorded and that its second occurrence turns it into a check or rule. Say that a decided map entry moves to the decisions section or to the check that now carries it. Link both documents from the entry point. Keep personal addresses, home paths, machine details and global assistant rules out of the repository.

## Done when

- **Defined.** ARCHITECTURE and CONVENTIONS exist or are designated and meet their content requirements, with current, target and debt kept apart.
- **Grounded.** Every consequential standard names its project reason or the guide section it comes from; anything you could not source is marked unsourced.
- **Enforceable.** Each machine-decidable rule the documents adopt fails in the gate with a repair hint, a nearby legitimate change passes, and both tiers pass at handover. A rule not enforced yet is an incomplete requirement, on the map as well, and the floor is not finished until it is enforced or withdrawn.
- **Self-contained.** A fresh session without this skill, given only the checkout, finds both documents and the gate from the entry point and can judge whether a change breaks the structure.
- **Evolvable.** The maintenance loop is in the guidance, baselines and debt can only shrink, and exceptions say how to add and retire them.
- **Minimal.** Nothing above the floor was added without a named failure, and the harness the repository wrote itself stays small beside the product; generated surfaces rebuild idempotently.
- **Mapped.** Every open decision carries its evidence, mechanisms and proposal; nothing on the map is presented as done, and nothing done stays on it.

## Proof before reporting

1. Run the fast and full tiers on the checkout, and again once every fixture below is removed.
2. For each new check and audit probe, plant a realistic violation and confirm it fails with its hint; confirm the closest legitimate change passes; remove both.
3. Rerun any generator or builder and its `--check`; inspect the working-tree diff including untracked files.
4. From the checkout alone, follow the documented setup, including the hook, and the documented extension path; follow the guidance from the entry point to where a correction is recorded and to the rule that its second occurrence becomes a check or rule.
5. Follow one installed protection, one incomplete requirement and one open decision, where they exist, through the documents and the report, and confirm each reads as what it is.

Report in two parts. **Floor:** where the two documents live and whether each was written or designated; guides adopted; what the structure prevents and each tier runs; ratchet and audit counts; incomplete requirements with their remaining work; whether this clone enables the hook; line counts for product, authored harness and bundled assets; checks you could not run; and anything the session could not install, with the commands to finish and no document calling it installed. **Map:** the open decisions as ARCHITECTURE records them, and which ones you asked about. Keep structural guarantees, active checks and judgment-only rules apart. Release publishing is a separate action.
