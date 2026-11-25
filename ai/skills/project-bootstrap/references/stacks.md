# Stack strictness

Consult this table when an adopted convention needs a mechanical check. Prefer existing configuration and the smallest precise check. The tiers below are examples. Place each selected check according to its runtime and prerequisites in this repository ([verification](verification.md)).

Take every command and option from a source for the installed version: the stack's official documentation, else the tool's own `--help` or manual, else its documentation at the pinned release. Many stacks have only community tools; a flag seen in none of these sources is a guess, so leave it out. Run each wired command once and keep its output as evidence that it exists and does what the row asks.

A dependency rule between workspace packages is machine-decidable: read the resolved graph (`cargo metadata`, `go list -deps`, the package manager's workspace listing) and fail on the forbidden production edge while dev or test edges stay allowed. A manifest that merely declares today's edges does not stop the next one. ARCHITECTURE links whichever policy the gate reads ([architecture](architecture.md#the-dependency-policy)).

Enable the native lints and lint groups that enforce the adopted conventions, including stricter groups where the conventions call for them; the code's current state decides only how a lint is introduced (on now, ratcheted, or recorded as debt until its existing violations are fixed), not whether the convention holds. A lint recorded as debt is an incomplete requirement and is reported as one until it is on.

| Capability | Example tier | Examples |
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

If the stack lacks a native check, use a banned-pattern row only for a precise line-level violation ([banned patterns](../assets/check-contract.md#banned-patterns)). Test the closest legitimate look-alike through the real gate. For example, a no-third-party-dependencies policy permits project-local modules and packages, including absolute imports. If the checker cannot distinguish those from installed packages at acceptable cost, keep the dependency policy in review. If a match cannot distinguish them, use a semantic check or record the review decision. Baseline existing violations only for an adopted constraint. Avoid bulk suppressions and unrelated fixes during setup.
