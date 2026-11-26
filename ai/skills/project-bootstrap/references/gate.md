# Gate

Use one gate. A clone-local hook can be bypassed; server-side enforcement depends on the existing CI and repository settings. Pre-push and any CI call it; nothing else holds a second copy of the checks. When a gate already runs the repository's checks, keep its implementation and command names. Add a missing tier or selected check in its native form. Do not copy a generic driver just to expose unused flags, records or configuration files. Point the local hook at that gate; the bundled hook assumes the bundled driver's pass-record interface, so adapt the hook to an existing gate instead of replacing the gate to fit the hook.

For a new gate, use the bundled [driver](../assets/check.sh) and [hook](../assets/pre-push) when the repository needs their registration, ratchet or pass-record facilities. Keep custom checks in the consuming repository's check-config.sh. Inspect existing hook configuration before enabling the hook once per clone. A small repository can use its existing test command in both tiers. 

## Contract

The bundled driver, hook and layer helper are specified in [the contract](../assets/check-contract.md): registration, base, pass record, banned patterns, ratchet baseline, rule tags, the audit record, the formal verification record, pre-push and the layer policy.

## Replacing a protection

Identify the old control's effective scope, accepted exceptions and the failure it prevents. Run it on the current checkout and on a realistic violation where feasible. Prove the replacement against the same failure and a nearby legitimate change. An import check over workspace packages and a resolved dependency graph may cover different risks. A renamed gate or shorter command needs the same comparison.

Preserve an effective control while its replacement's coverage is uncertain. Where checks or history are missing, recover the important promises from the code, tests, release artifacts and owner decisions, record the gaps with their owners, and weigh a supported contract's consumers and migration cost before changing it.

## Choosing mechanisms

Pick a mechanism by what the constraint is, in this order: the stack's native check with its own baseline or exceptions, a banned-pattern row for a precise line pattern, layer debt for a dependency edge, and an audit probe for a predicate that needs several files or language awareness ([contract](../assets/check-contract.md)). A check that implements an adopted rule belongs to the floor and is installed. A check above the floor is a map proposal, made only when a real occurrence (a past commit, issue or review finding) shows a gap in the existing controls, since a planted violation proves a check works, not that it is needed; installing it follows the skill's ask-first rule.

| Project | Usually fits |
| --- | --- |
| New | Native lints and the two documents; a layer policy once a real boundary exists |
| Mature, with its own rules | Its existing gate and rules, extended in their native form |
| Structurally regressed | Ratchets, layer debt and audit probes, so the debt only shrinks, with the larger moves on the map |
| Harness already present | The existing documents and gate designated, and only the gaps filled |

## Repository checks

Select a check when it protects an adopted contract precisely and at reasonable cost. Add custom logic only for a concrete gap the existing checks miss, and name that failure in its hint or the rule it enforces. For public command or schema checks, exercise the compatibility promise and allow unrelated output or implementation changes. Examples:

- **Work-artifact references:** a `ban` row for comments and test messages that point at plans or agent scratch paths.
- **Surface inventories:** fail when the code exposes a name a relied-on reference document does not list.
- **Layering:** the [dependency policy](architecture.md#the-dependency-policy) ARCHITECTURE links.
- **Generated sources:** the generator's read-only check or a regeneration into a temporary location, failing when the tracked output differs and never rewriting it.
- **Changelog and version** agreeing with the version owner.
- **Flaky tests:** a pass only on retry fails, in either tier.
- **Dependency audit** in `full`, every ignore entry with an id, a date and a reason, and a self-test showing the gate rejects an entry missing one.

Keep regression cases for custom check logic where a mistake could hide a violation or reject a legitimate change. Reuse existing coverage for thin wrappers around a tested tool.

## Turning a correction into a check

When a recurring or costly mistake warrants work, follow the [correction loop](maintenance.md#the-correction-loop) with the affected change as evidence. Prefer structure that leaves one supported way to do the task. Where a precise check is possible, install the stack's ban-with-message facility or a `banned-patterns.tsv` line on its real occurrence, and prove it against a reproduction and the closest legitimate change. Baseline existing occurrences when gradual removal fits, with a deadline when a supported migration and a reason to enforce it both exist. Tag the rule with its check, or tag a judgment-only rule `unchecked` and keep the correction's evidence with it.
