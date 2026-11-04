---
name: rust
description: "Write, review, or port Rust with the compiler as the feedback loop: clippy, nextest and cargo-mutants checks, dependency APIs at the exact locked version, and Microsoft's Pragmatic Rust Guidelines by rule ID. Skip non-Rust work and questions that need no code."
argument-hint: "[Rust task, crate, or file]"
allowed-tools: Bash, Read, Grep, Glob
disable-model-invocation: false
---

Rust work for: $ARGUMENTS

## Feedback loop

Run these from the crate or workspace root, in order, and fix what each reports before moving on.

1. `cargo clippy --all-targets --message-format short` — errors first, then warnings; treat a warning as work unless the project allows it. The Stop gate runs the same command (falling back to `cargo check --all-targets` when the toolchain has no clippy) and blocks only on errors and deny-level lints: it is a floor, not the loop.
2. Tests: `cargo nextest run` when `cargo nextest --version` answers, otherwise `cargo test`.
3. Before calling a logic change done, check that the tests would notice it breaking:

   ```bash
   d="$(mktemp -d)"
   git diff <start> -- '*.rs' > "$d/change.diff"   # <start> = the commit this work began from
   cargo mutants --in-diff "$d/change.diff" --output "$d"
   ```

   Add `--test-tool=nextest` when nextest is installed. Exit status 2 means some mutants were missed, not that the tool failed. A `MISSED` mutant is a test gap: add an assertion that fails on that mutation. Do not write a test that restates the implementation to kill it — skip a truly equivalent mutant with `#[mutants::skip]` and say why (M-TAUTOLOGICAL-TESTS). Skip this step for docs, formatting, and pure renames.

Tests are the oracle. Never change an existing test's expectation to make it pass unless the task changes that behaviour, and say so when it does.

Lint policy belongs to the project: `[workspace.lints]` (or `[lints]`) in Cargo.toml, with item-level exceptions as `#[expect(lint, reason = "...")]`, not `#[allow]` (M-LINT-OVERRIDE-EXPECT). For a new project, start from the lint set in M-STATIC-VERIFICATION.

## Dependency APIs: the locked version, not memory

- Which version is in use: `cargo tree -i <crate>`. Its source: `cargo metadata --format-version 1 | jq -r '.packages[] | select(.name == "<crate>") | "\(.version) \(.manifest_path)"'` — read the crate under that directory. Prefer these to reading the lockfile: they also name the source directory to read.
- With an LSP tool available, hover and go-to-definition on the symbol (rust-analyzer) give the same version's docs and signature.
- A crate that is not a dependency yet: `cargo info <crate>` for the current version and features, then that version's page on docs.rs.

## Guidelines

Microsoft's Pragmatic Rust Guidelines, one rule per file: `G="${AI_VENDOR_DIR:-$HOME/.local/share/ai-vendor}/rust-guidelines/src/guidelines"`, at `$G/<topic>/M-<ID>.md`. Find a rule with `find "$G" -name 'M-<ID>.md'`, list a topic with `ls "$G/<topic>"`, search with `grep -ril '<term>' "$G"`. Read the rules for the task, not the whole set.

| Task | Topics under `$G` |
| --- | --- |
| Any change | `universal`, `ai` |
| Library API: types, traits, constructors, errors | `libs/ux`, `libs/interop`, `libs/resilience` |
| Crate layout, features, `-sys` crates, workspaces, MSRV, edition | `libs/building`, `project` |
| Panics, `unsafe`, soundness | `correctness` |
| Application binaries: error handling, allocator, target CPU | `apps` |
| Throughput, allocation, hashing, async yield points | `performance` |
| Doc comments and module docs | `docs` |
| FFI | `ffi` |
| Macros | `macros` |

Missing (`$G` absent): say so, offer `bash ~/.config/ai/scripts/vendor.sh sync rust-guidelines` (network clone — run only with 대협's consent), and meanwhile read the rule on https://microsoft.github.io/rust-guidelines/.

For naming and style the Microsoft set leaves open, Google's Rust Style Guide is a secondary reference: https://google.github.io/styleguide/rustguide.html, fetched when needed. Precedence: the project's own conventions, then Microsoft by rule ID, then Google. Cite the rule ID when a guideline drives a change.
