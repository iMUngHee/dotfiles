# Maintenance after bootstrap

After bootstrap the repository maintains its own floor. Write the loop below and the three responsibilities into the existing contributor or agent guidance, beside the standard commands, using the repository's own commands, check names and nouns. Create a separate lessons file or project skill only when there is an actual entry or a repeated procedure to hold.

## The correction loop

Seed all four items into the unconditional guidance, naming the actual place where corrections are recorded; a repository without an issue tracker or review log gets the lessons file at its first entry, and the guidance says so. In a tagged `.ai/rules` file each item ends with its tag ([rule tags](../assets/check-contract.md#rule-tags)); elsewhere say in words what enforces it.

- When a change is corrected for a mistake, remove the mistake at the first level that holds: structure, an API or a type, then a lint or a ban whose message names the alternative, then a test; prose last. Before relying on a new check, show it failing on the real mistake and passing the closest legitimate change.
- Existing code is evidence, not precedent: new code follows the adopted rules, and old violations stay in the ratchet until the code around them changes.
- Record a correction the gate cannot catch yet where the repository keeps review findings (an issue, a review log, or a lessons file created with its first entry): what went wrong, the reason given, the evidence, and what would enforce it. On its second occurrence turn it into a check or a rule and remove the entry in the same change.
- Remove a rule, check, lesson or document once the mistake it guards against has become impossible or the code it describes is gone.

## Responsibilities

- **Review changes.** Follow the change through its code owner and public contract. Check new dependency edges, duplicated decisions, abstractions and changes in cost at actual callers. Run the repository gate. Review the mechanism that protects each consequential decision.
- **Keep rules and documentation current.** Name the editable policy, its enforcing check and any command that syncs generated guidance. When a restriction gains an exception, update its owners and run the gate with two changes: the newly allowed case must pass, and the closest case still covered must fail with its repair hint. Retire obsolete checks and tags with their rule. Update the owning document in the same change: a change to a component's ownership, a layer boundary, a flow or an external contract updates ARCHITECTURE, a reversed decision records its successor and reason, and a new or retired rule updates CONVENTIONS.
- **Garden.** Repair the example contributors keep copying when a small compatible change removes a recurring mistake, lower an applicable baseline as code is fixed, and keep the evidence and its scope for the next maintainer.

## Questions every harness piece must answer

- What goes wrong without it?
- Could structure remove that failure instead?
- Is there a cheaper mechanism that already enforces it?
- Does it repeat an existing check, test or document?
- What knowledge is lost if it is deleted?

A piece that cannot answer is a candidate for removal in the garden.

## Conditional skills

Start with the contributor guide. Create one of these only when a repeated project-specific procedure has a concrete check and benefits from an independent invocation; name it with the project's prefix and make it work with only the repository.

| Skill | Create when | Does |
| --- | --- | --- |
| `<prefix>-security-review` | The repository has a security boundary: authentication, isolation, secrets, untrusted input crossing into privileged code | Checks a change against each named boundary |
| `<prefix>-change-checklist` | The repository exposes an inventory that must change together: environment variables, commands, routes, bindings, schema | Lists what else to change when one entry is added or renamed |
| `<prefix>-feature-verify` | A repeated user journey already has a reusable local driver | Drives it through the feature map with the reusable driver and keeps the evidence |

Mark deployment or production-touching skills as invoked only on request.
