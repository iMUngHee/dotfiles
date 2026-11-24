# Stack strictness

Ask for capabilities, not tools. For the repository's stack, find how it provides each capability below and wire what it provides into the gate. The examples are a few known spellings, not a list to pick from; a stack missing from them is handled the same way.

Take every command and option from a source for the installed version: the stack's official documentation, else the tool's own `--help` or manual, else its documentation at the pinned release. Many stacks have only community tools; a flag seen in none of these sources is a guess, so leave it out. Run each wired command once and keep its output as evidence that it exists and does what the row asks.

End with one of three outcomes for every capability, and report all of them:

- **Wired**: a tool provides it and the gate runs it.
- **Stood in for**: no tool provides it, so a repository check covers the risk instead, such as a `banned-patterns.tsv` line for a ban, an import grep for boundaries, a ratcheted `banned-patterns.tsv` line matching suppressions that carry no reason, or a script for an inventory.
- **Absent**: nothing reasonable covers it. Record it in the development guide with the risk it leaves open, so the gap is known rather than silent, and recheck it when the stack's tools change.

| Capability | Gate tier | Examples |
| --- | --- | --- |
| Formatter that can check without writing | fast | `cargo fmt --check`, `prettier --check`, `gofmt -l`, `ruff format --check` |
| Linter with warnings as errors | fast | `cargo clippy -- -D warnings`, `eslint --max-warnings 0`, `golangci-lint run`, `ruff check` |
| Lint suppression that must carry a reason | fast | Rust `#[expect(lint, reason = "...")]`, ESLint `eslint-comment/require-description`, `//nolint:name // reason` |
| Ban with a message: forbid an API, import or type and say what to use instead | fast | clippy `disallowed-methods`/`disallowed-types` with `reason`, ESLint `no-restricted-imports`/`no-restricted-syntax` with `message`, ruff `flake8-tidy-imports.banned-api` with `msg`, golangci `forbidigo`/`depguard` |
| Strict type checking | fast | `tsc --noEmit` with `strict`, `pyright --strict`, `mypy --strict` |
| Import boundaries between layers | fast | dependency-cruiser, eslint-plugin-boundaries, import-linter, `go list -deps`, `cargo metadata` |
| Unit tests in one process per test, flaky counts as failure | fast | cargo-nextest with retries reported as flaky, vitest `--retry 0`, `go test -count=1` |
| Integration and doc tests | full | the stack's runner |
| Dead code and unused dependencies | full | cargo-machete, knip, `deadcode`, vulture |
| Dependency advisories and licenses with a reasoned ignore list | full | cargo-deny, `npm audit` with a checked ignore file, govulncheck, pip-audit |
| Mutation testing on changed files | full, optional | cargo-mutants, Stryker, gremlins, mutmut |

When the stack cannot express a ban, add a line to `scripts/check-data/banned-patterns.tsv` (see [gate.md](gate.md)). Configuration, documentation and comment patterns always go there.

Turn on every rule the existing code already satisfies. A rule the existing code breaks enters through the ratchet: ban it with `mode=ratchet`, write the baseline, and let the garden skill lower it. A linter rule that no line pattern can express enters the same way one step removed: suppress each existing violation with the linter's own line-level suppression naming the rule, then ratchet that suppression comment, so the existing ones are baselined and a new one fails. Record each rule that still waits in the development guide with the reason it waits.
