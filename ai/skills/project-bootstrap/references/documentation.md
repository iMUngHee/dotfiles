# Documentation

The documents are the repository's design, and the gate is how they stay true. Every rule, check and convention points at a document that says why; every document that describes the code has a check that fails when the code moves away from it. Reuse the repository's existing documents and their places; create only what is missing, and structure each by kind as Diátaxis does (tutorial, how-to, reference, explanation).

## The set

| Document | Default place | Holds | Kept true by |
| --- | --- | --- | --- |
| Agent entry | `.ai/PROJECT.md` | What the project is, a table of each top-level path and what it contains, the commands, where rules and documents live | an inventory check that every top-level path in the table exists and every tracked top-level path is in it |
| Architecture | `docs/architecture.md` | The components and what each owns, the layers and the allowed direction of dependencies, the main data and request flows, external systems and the contracts with them, the invariants that cross components. Diagrams keep an editable source in the repository. Structure it on a published model such as C4 or arc42 | the layering check, which reads its allowed dependencies from this document or a data file the document links; the contract and inventory checks for the external interfaces it lists |
| Decisions | `docs/decisions/NNNN-<slug>.md` | One record per decision that a later reader could undo by accident: context, decision, consequences, status (the ADR format). These are the "decisions with a stated reason" that outrank published guides ([conventions.md](conventions.md)) | a check that each record has a status and that a superseded record names its successor |
| Development guide | `docs/development.md` | Setup, the gate's tiers and what each check enforces and why, the reason for every rule including `unchecked` ones, the convention guides with their overrides, the verification table and the methods standing in for missing tools, the criteria for choosing test cases, the formal upkeep procedure, absent capabilities and waiting rules | rule-docs-sync, and a check that every check name in `scripts/check.sh --list` appears here |
| Feature map, for an application or service | the development guide or `docs/features.md` | The features a user can reach, named as users name them | the feature-verify skill |
| Reference documents | `docs/…` | API, configuration, environment variables, commands, events, schemas | inventory checks that compare each list with the code that defines it |

Write the architecture document from the code as it is, then mark where the code departs from the target that the conventions and decisions set: those departures are debt with a ratchet or a decision record, not a description of intent. A document link that does not resolve fails the gate.

## Keeping them current

- A change that alters a component's ownership, a layer boundary, a flow or an external contract updates the architecture document in the same change, and a change that reverses a recorded decision adds a record that supersedes it. Code review checks both.
- rule-docs-sync compares the documents with the rules, the checks and the code, and fixes the source of any disagreement.
- The report names each document created or reused, the checks that keep it true, and any document left without one.
