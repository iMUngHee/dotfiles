# Maintenance defaults

Use the decisions that affect this repository. Resolve ordinary preferences from the checkout and present an inferred setup in one sentence. If purpose is unknown, ask what the maintainer expects to do with the project. Defer stack-specific files until that answer exists.

| Decision | Default | When to ask |
| --- | --- | --- |
| Conventions | Keep reasoned decisions and existing tools. Select relevant guide items for concrete failures ([conventions.md](conventions.md)). | A choice would require a disruptive migration. |
| Strictness | Enforce adopted machine-decidable rules on new code. Record why an exception is needed; ratchet measurable existing violations and leave judgment to review. | A constraint would exclude a legitimate use or change a public contract. |
| Gate | Keep the existing gate and entry point. For a new gate, use a small entry point such as `scripts/check.sh` with fast and full tiers and connect the clone-local pre-push hook. Wire an existing CI to call the same script; do not create CI. | The maintainer wants CI created, or the full tier needs special hardware or credentials. |
| Compatibility | Identify a concrete consumer of a command, setting, file format, result or interaction. Preserve its observable behavior. | A missing acceptance criterion determines whether the result is correct. |
| Verification | Reuse the cheapest relevant working entrypoint. Add behavior evidence only for a named contract with a gap, and report risks that need more than ordinary tests as candidates ([verification.md](verification.md)). Name the changed behavior, trigger and expected observation. | An expensive job, specialized device or uncertain scientific threshold needs a human decision. |
| Agent guidance | Keep one editable source with the smallest working loader arrangement. Write or designate ARCHITECTURE and CONVENTIONS ([architecture](architecture.md), [conventions](conventions.md#writing-conventions)); place maintenance commands and reasons in the existing contributor guidance ([harness](harness.md), [maintenance](maintenance.md)). | Independent human-owned instructions conflict with the requested migration. |
| Versioning | Trace each published contract to its consumers and version owner. Preserve the release unit, bump rules, tags and changelog those consumers use. For a first release, choose the version and release signals its consumers need ([conventions.md](conventions.md)). Defer publishing machinery until there is a release target. | Independent release units or a compatibility promise cannot be inferred. |

A keyboard-only save/reopen flow may need a manual GUI check; a terminal UI may need restoration verified after exit. A small CPU fixture can exercise a research pipeline and a full dataset can test numerical equivalence only once the reference and tolerance are known. A runner that exits successfully with zero applicable tests proves only that the runner starts. Record actual and proposed checks separately. Put each check in fast or full by its cost.

Official support indicates a compatible default. Describe a choice as measurably more efficient only with a relevant comparison.
