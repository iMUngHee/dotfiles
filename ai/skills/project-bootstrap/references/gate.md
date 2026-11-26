# Gate

Use one gate. A clone-local hook can be bypassed; server-side enforcement depends on the existing CI and repository settings. Pre-push and any CI call it; nothing else holds a second copy of the checks. When a gate already runs the repository's checks, keep its implementation and command names. Add a missing tier or selected check in its native form. Do not copy a generic driver just to expose unused flags, records or configuration files. Point the local hook at that gate; the bundled hook assumes the bundled driver's pass-record interface, so adapt the hook to an existing gate instead of replacing the gate to fit the hook.

For a new gate, use the bundled [driver](../assets/check.sh) and [hook](../assets/pre-push) when the repository needs their registration, ratchet or pass-record facilities. Keep custom checks in the consuming repository's check-config.sh. Inspect existing hook configuration before enabling the hook once per clone. A small repository can use its existing test command in both tiers. 

## Contract

The bundled driver, hook and layer helper are specified in [the contract](../assets/check-contract.md): registration, base, pass record, banned patterns, ratchet baseline, rule tags, the formal verification record, pre-push and the layer policy.

## Replacing a protection

Identify the old control's effective scope, accepted exceptions and the failure it prevents. Run it on the current checkout and on a realistic violation where feasible. Prove the replacement against the same failure and a nearby legitimate change. An import check over workspace packages and a resolved dependency graph may cover different risks. A renamed gate or shorter command needs the same comparison.

Preserve an effective control while its replacement's coverage is uncertain. If checks or history are missing, recover important promises from the code, tests, release artifacts and owner decisions. Record gaps you cannot recover and who owns them. When deciding whether to change a supported contract, bring its consumers and the migration cost into the decision.

## Repository checks

Select a check when it protects an adopted contract precisely and at reasonable cost. Try the stack's existing inspection or test first. Add custom logic only for a concrete gap the existing checks miss, and name that failure in its hint or the rule it enforces; a check with no failure to name, or no occurrence or reproduction to show, is proposed in the report instead of installed. For public command or schema checks, exercise the compatibility promise and allow unrelated output or implementation changes. Examples:

- **Work-artifact references.** Comments and test messages that point at plans, review rounds or agent scratch paths. A `ban` pattern with a hint that says to write the reason in the comment itself.
- **Surface inventory drift.** Where contributors rely on a reference document's completeness, extract the names the code exposes (environment variables, commands and options, routes, configuration keys) and fail when it does not list one. Keep build- or test-only names in a reasoned exception list inside the check.
- **Layering.** Fail when a module imports across a boundary ARCHITECTURE forbids, with the stack's native policy tool or else the bundled layer helper on the policy ARCHITECTURE links ([architecture](architecture.md#the-dependency-policy)).
- **Generated sources.** Use the generator's read-only mode, or regenerate into a temporary location, and fail when the result differs from the tracked output, so edits go to the source; the check never rewrites tracked files.
- **Changelog and version.** Fail when the version owner and the changelog's released sections disagree, or when the unreleased section is missing.
- **Flaky tests fail.** A test that passes only on retry fails the run, in either tier.
- **Dependency audit.** Known advisories, unused dependencies and disallowed licenses in `full`. Each ignore entry carries an id, a date and a reason, and a self-test proves the gate fails on an entry that lacks one.

Keep regression cases for custom check logic where a mistake could hide a violation or reject a legitimate change. Reuse existing coverage for thin wrappers around a tested tool.

## Turning a correction into a check

When a recurring or costly mistake warrants work, follow the [correction loop](maintenance.md#the-correction-loop) with the affected change as evidence. Prefer structure that leaves one supported way to do the task. Where a precise check is possible, use the stack's ban-with-message facility or a `banned-patterns.tsv` line, proved against the real mistake or a reproduction and the closest legitimate change. Baseline existing occurrences when gradual removal fits, with a deadline when a supported migration and a reason to enforce it both exist. Tag the rule with its check, or tag a judgment-only rule `unchecked` and keep the correction's evidence with it.
