---
name: rust
description: "Write, review, or port Rust with the compiler as the feedback loop: clippy, nextest and cargo-mutants checks, dependency APIs at the exact locked version, and Microsoft's Pragmatic Rust Guidelines by rule ID. Skip non-Rust work and questions that need no code."
argument-hint: "[Rust task, crate, or file]"
allowed-tools: Bash, Read, Grep, Glob
disable-model-invocation: false
---

Rust work for: $ARGUMENTS

## Feedback loop

Run these from the crate root, or in a workspace from the workspace root with `--workspace` on every command below: from a member's directory cargo covers that member alone, and from the root without the flag only `default-members`. Run them in order and fix what each reports before moving on. No hook runs any of them for you — the hooks only format — so this loop is the check.

1. `cargo clippy --all-targets --message-format short` — errors first, then warnings; treat a warning as work unless the project allows it.
2. Tests: `cargo nextest run` when `cargo nextest --version` answers, then `cargo test --doc`, because nextest does not run doctests; otherwise `cargo test`, which runs both. nextest exit 4 (`no tests to run`) means the crate has no tests — a gap to fill, not a tool failure; do not silence it with `--no-tests=pass`.
3. Before calling a logic change done, check that the tests would notice it breaking:

   ```bash
   d="$(mktemp -d)"
   # <start> = the commit this work began from. The explicit prefixes override a
   # diff.mnemonicPrefix or diff.noprefix config, whose paths cargo-mutants cannot match.
   git diff --no-ext-diff --src-prefix=a/ --dst-prefix=b/ <start> -- '*.rs' > "$d/change.diff"
   cargo mutants --in-diff "$d/change.diff" --output "$d"
   ```

   `git diff` leaves out a file git does not track yet: run `git add -N <file>` for each new `.rs` file first (it records the path only; nothing is staged). Add `--test-tool=nextest` when nextest is installed; in a crate with no tests yet add `-- --no-tests=pass` too, or nextest fails the unmutated baseline (exit 4) and nothing is tested — with it every mutant shows as `MISSED`, which is the gap. `No mutants to filter`, or zero mutants tested, means nothing was checked — look at the diff before reading it as a pass. Exit status 2 means some mutants were missed, not that the tool failed. A `MISSED` mutant is a test gap: add an assertion that fails on that mutation. Do not write a test that restates the implementation to kill it — skip a truly equivalent mutant and say why (M-TAUTOLOGICAL-TESTS). `#[mutants::skip]` compiles only with the `mutants` crate as a dependency (`cargo add mutants`), and `#[cfg_attr(test, mutants::skip)]` still breaks `cargo test` without it; in a crate that does not depend on it, list the mutant in `.cargo/mutants.toml` instead (`exclude_re = ["replace foo -> i32"]`, matched against `cargo mutants --list`). Skip this step for docs, formatting, and pure renames.

Tests are the oracle. Never change an existing test's expectation to make it pass unless the task changes that behaviour, and say so when it does.

Lint policy belongs to the project: `[workspace.lints]` (or `[lints]`) in Cargo.toml, with item-level exceptions as `#[expect(lint, reason = "...")]`, not `#[allow]` — except in generated code and macro output, where the rule keeps `#[allow]` (M-LINT-OVERRIDE-EXPECT). For a new project, start from the lint set in M-STATIC-VERIFICATION.

## Dependency APIs: the locked version, not memory

- Which version is in use: `cargo tree -i <crate>`. Its source: `cargo metadata --format-version 1 | jq -r '.packages[] | select(.name == "<crate>") | "\(.version) \(.manifest_path)"'` — read the crate under that directory. Prefer these to reading the lockfile: they also name the source directory to read.
- With an LSP tool available, hover and go-to-definition on the symbol (rust-analyzer) give the same version's docs and signature.
- A crate that is not a dependency yet: `cargo info <crate>` for the current version and features, then that version's page on docs.rs.

## Style references

Read the rules that bear on the task, not the whole set; fetch when needed. Precedence: the project's own conventions, then these. Cite the rule ID when one drives a change.

- Rust API Guidelines — the Rust library team's API design rules, `C-` IDs: checklist https://rust-lang.github.io/api-guidelines/checklist.html, each ID linked to its rule.
- Microsoft's Pragmatic Rust Guidelines — broader than API design (panics, `unsafe`, apps, performance, AI-written code), `M-` IDs: checklist https://microsoft.github.io/rust-guidelines/guidelines/checklist/; a rule lives at `https://microsoft.github.io/rust-guidelines/guidelines/<topic>/#M-<ID>`.

  | Task | Microsoft topics |
  | --- | --- |
  | Any change | `universal`, `ai` |
  | Library API: types, traits, constructors, errors | `libs/ux`, `libs/interop`, `libs/resilience` (with the API Guidelines) |
  | Crate layout, features, `-sys` crates, workspaces, MSRV, edition | `libs/building`, `project` |
  | Panics, `unsafe`, soundness | `correctness` |
  | Application binaries: error handling, allocator, target CPU | `apps` |
  | Throughput, allocation, hashing, async yield points | `performance` |
  | Doc comments and module docs | `docs` |
  | FFI | `ffi` |
  | Macros | `macros` |

- The Rust Style Guide — the default formatting style, which rustfmt implements, so the formatter covers it: https://doc.rust-lang.org/stable/style-guide/
