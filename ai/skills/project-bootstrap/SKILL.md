---
name: project-bootstrap
description: Install or realign, once, a repository-owned engineering quality floor - conventions grounded in reasoned decisions and published guides, structure that makes the wrong change hard, a gate that rejects what remains, and maintenance the repository carries on without this skill. Use on a new project or for the first quality setup of an existing one. Skip routine feature work, isolated lint changes, and adding property, fuzz, mutation, model-checking or proof methods (advanced-verification).
disable-model-invocation: false
---

# Project bootstrap

Make engineering quality a property of the repository, not of the agent operating on it. Bootstrap the quality floor, not the entire engineering process.

The floor is strict and the space above it stays free. The repository makes unacceptable changes hard to write, rejects the machine-decidable rest, and says plainly what is left to judgment; contributors still choose between good implementations. Bootstrap runs once per repository: on a new project, at the first adoption in an existing one, or to realign an existing harness to this floor. Afterwards the gate, the guidance and the maintenance loop it leaves work from the checkout alone, with no personal harness, global instructions or copy of this skill. A request to discuss produces a proposal; a setup request installs the floor and proves it.

## Where a decision goes

Settle each consequential decision at the first level that holds. Each lower level costs more to keep and protects less:

1. **Code.** An owner, an API, a type or a directory layout that makes the wrong change hard to express.
2. **Static checks.** The compiler, the stack's lints, a boundary or ban check whose message names the fix, a ratchet that lets existing violations only shrink.
3. **Behavior evidence.** A test or measurement for a contract that only running code shows.
4. **Prose.** A short rule with its reason, for the judgment nothing above can carry.

Passing tests, a clean lint run or rising coverage say little about structure or cost: an extra layer, a needless allocation or a split responsibility passes every functional test. Existing code is the next contributor's example, so a workaround left in place gets copied. Every rule, check, document and test you add is upkeep the repository inherits; add one only for a named failure, and prefer sharpening what exists to adding a file.

## Steps

1. **Find what the project must keep.** Read the purpose, design and research records, contributor conventions and public surfaces. Locate the owners of persisted state, dependency boundaries, security and isolation boundaries, resource lifetimes, costly execution paths and existing protections. Trace a representative change through the actual code, and follow each consequential boundary not covered by that trace far enough to identify its supported extension path and any credible bypass. For an empty project use the first intended change.
2. **Set the standard before choosing a tool.** Take conventions from reasoned project decisions, the maintainer's preferences, published guides you read for this setup, then supported stack defaults ([defaults](references/defaults.md)). Existing code is evidence, never authority. Spend the effort on architecture, semantics and implementation cost; use idiom and style where they keep those consistent. For each consequential rule know its source, the failure it prevents, a technically working change it would reject, and the legitimate alternative it must keep allowing. See [conventions](references/conventions.md).
3. **Make the good path the easy one.** Follow the intended extension through its owner, API and types. Where a credible shortcut remains, prefer a small compatible change that gives the responsibility to its owner or makes the invalid path harder to express, and keep one sound implementation as the example. Record a costly migration as a deferred decision instead of performing it. See [structure](references/structure.md).
4. **Enforce what remains and prove it.** Reuse or install one gate with fast and full tiers, point existing CI at it and enable the clone-local pre-push hook. Turn on the native checks that enforce the adopted conventions; ratchet existing violations instead of fixing them in bulk. Every boundary or ban the guidance states that a machine can decide, such as a forbidden dependency edge between packages or a forbidden import or API in a module, gets a check: the stack's dependency or import tool where it has one, else a small precise script. Prove it with a planted violation and its legitimate counterpart; leaving such a rule to review needs a stated reason no precise check can decide it. Add other custom checks only for a precise, repeatable violation the stack cannot see. Add behavior tests only for a named contract with a gap in existing evidence, and report any risk that needs more than ordinary tests as a candidate instead of installing it. See [gate](references/gate.md), [stacks](references/stacks.md) and [verification](references/verification.md).
5. **Hand it over once.** Put each decision in the document that already owns its readers, with its reason and what enforces it. Write all four items of the correction loop into the contributor guidance, including where a correction the gate cannot catch yet is recorded and that its second occurrence turns it into a check or rule. See [harness](references/harness.md) and [maintenance](references/maintenance.md).

## What the repository holds afterwards

At the small end: an agent and contributor entry point, the conventions the code cannot show, and a gate over the stack's strict checks. Add architecture, development, reference, research, scoped rules or project skills only when the project gives one a job and no existing document can hold it ([harness](references/harness.md)). Keep personal addresses, home paths, machine details and global assistant rules out of the repository.

## Done when

- **Grounded.** Every consequential standard names its project reason or the guide section it comes from; anything you could not source is marked unsourced.
- **Enforceable.** Each machine-decidable rule fails in the gate with a repair hint, and a nearby legitimate change passes.
- **Self-contained.** A contributor with only the checkout finds the guidance, runs both tiers and follows the intended extension path.
- **Evolvable.** The maintenance loop is in the guidance, baselines can only shrink, and exceptions say how to add and retire them.
- **Minimal.** Nothing was added without a named failure; generated surfaces rebuild idempotently.

## Proof before reporting

1. Run the fast and full tiers on the checkout.
2. For each new check, plant a realistic violation and confirm it fails with its hint; confirm the closest legitimate change passes; remove both.
3. Rerun any generator or builder and its `--check`; inspect the working-tree diff including untracked files.
4. From the checkout alone, follow the documented setup, including the hook, and the documented extension path.

Report: the guides read and what was adopted from them; what the structure prevents, what each tier runs and what remains for review; ratchet baselines with their counts; the editable guidance sources; verification candidates with the promise each would protect; deferred migrations; checks you could not run; and every file the session could not write, with the commands a person runs to finish. Report, as an incomplete requirement, any adopted machine-decidable rule not yet enforced, with the reason and remaining work, separately from structural guarantees, active checks and judgment-only rules. Release publishing is a separate action.
