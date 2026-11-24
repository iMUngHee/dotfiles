# Choosing verification

A single passing run proves one case. Pick a method by the risk the code carries and the question that risk asks, then find the stack's tool for that family. The tools named are examples; any method that answers a question below fits the same way.

| Risk | Question | Family |
| --- | --- | --- |
| Pure logic with a large input space | Does the property hold for every input? | property-based tests (proptest, fast-check, Hypothesis) |
| Parsers and decoders of untrusted input, unsafe or FFI code | Does a strange input crash it or corrupt memory? | coverage-guided fuzzing |
| Several actors, concurrency, distributed state | Does an invariant hold in every order of steps? | model checking (TLA+) |
| A core algorithm whose failure is costly | Is it correct for every case? | proof (Lean, or a verifier that runs on the code such as Kani) |
| Code with a reference implementation | Does it agree with the reference? | differential tests |
| The tests themselves | Do they catch a broken implementation? | mutation testing |
| Behavior as integrated | Does the user see the right result? | runtime verification against a feature map |

## Where each method runs

- **fast**: unit and property-based tests, and a replay of every saved fuzzing crash input as a regression test.
- **full**: integration tests, dead-code and dependency checks, fuzzing with a time limit per target (for example 60 seconds), optional mutation testing on changed files.
- **Outside the gate**, in the development guide's table of verification commands with the target, the property, the run time and when to run it again: long fuzzing runs, model checking and proofs.

Save every crash a fuzzer finds as a corpus file in the repository before fixing it, so the fast replay keeps it fixed.

## Formal verification candidates

During bootstrap, report the parts of the repository that fit model checking or proof: state machines and protocols with several actors, retries or concurrency; algorithms where a wrong answer is expensive and tests reach few cases. Name the promise each candidate makes and why tests miss it. Prefer model checking when the risk lives in the order of steps across actors, retries or time, and a proof when the code is a pure function that a proof language can restate almost line for line: the closer the model is to the code, the less a result depends on a translation nobody checks. Adding a model or proof needs the maintainer's decision, because it brings a toolchain (TLA+ needs Java and the TLA+ tools; Lean needs elan and lake) and a check that must stay in step with the code. A proof covers the model or the bound it states; the integrated behavior still needs runtime verification.

## Adding a formal check

When the maintainer agrees, build it so the repository can run and maintain it without any personal skill:

1. **Pin the toolchain** so contributors install it with one command. For TLA+, `.mise.toml` with Temurin 25 and the TLA+ tools at a checksum, installed by `mise install`:

   ```toml
   [tools]
   java = "temurin-25"
   "http:tla2tools" = { version = "1.7.4", url = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar", checksum = "sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88" }
   ```

   `temurin-25` pins the major version; a repository that must reproduce the patch release enables `mise.lock`.

   For Lean, put a Lake project in `spec/lean/` with a `lean-toolchain` file naming the exact release (for example `leanprover/lean4:v4.36.0`); elan reads it and installs that version. mise has no Lean or elan entry, so elan is the one prerequisite contributors install themselves. Start on the core library alone: Mathlib costs gigabytes and minutes of build, and list, arithmetic and permutation lemmas in core cover most properties of application code.
2. **Run the tool directly** from one script, such as `scripts/model-check.sh <Spec>` running `mise exec -- java -cp "$(mise where http:tla2tools)/tla2tools.jar" tlc2.TLC -workers auto -metadir "$(mktemp -d)" -config spec/<Spec>.cfg spec/<Spec>.tla`. TLC exits non-zero and prints the shortest counterexample when an invariant breaks. For Lean the script runs `lake build` in `spec/lean`, which fails on any unproved theorem; check once with `#print axioms <theorem>` that no proof rests on `sorryAx`.
3. **Tie the model to the code** with examples the code's own tests already check. Restate a few of those test cases against the model, as `#guard` lines in Lean or, in TLA+, a configuration that fixes a test's inputs and checks its expected result as an invariant, so a model that has drifted from the code fails before any property is trusted.
4. **Show what it adds.** Break the code in a way the existing tests still pass, mirror the break in the model, and confirm the formal check fails. When no such variant can be found, say so in the report: the check then repeats what the tests already guard.
5. **Record it** in `scripts/check-data/formal.tsv` ([gate.md](gate.md) contract 7): the command, the code it covers, the commit it was confirmed against, `full` when it is cheap enough for every merge, and the property in one sentence.
6. **Seed `.ai/rules/formal.md`**, unconditional, so every agent in the repository reads it whatever skill it runs:

   - The coverage and sync commit of every formal check live only in `scripts/check-data/formal.tsv`; a verify skill names its row and never copies them. [check: formal drift]
   - After a change to covered code, rerun the check, confirm the model still describes the code, then move `synced` to the commit you checked. [check: formal drift]
   - A failing check is a finding about the code until a replay of its counterexample shows a step the code cannot take; never weaken the property to make it pass. [unchecked: judged by replaying the counterexample]

When `create-formal-verification-skill`, `maintain-formal-verification-skill` and `statechart` are installed, invoke them by name to choose the target, write the model, generate the project-local verify skill and keep it in step; the seeded rule points their coverage record at `formal.tsv`. The generated skill must also say how to read TLC's own counterexample output, so a contributor without `statechart` can still act on a failure.

## Runtime verification

For an application with a user interface or a service, keep a feature map: the features a user can reach, named the way users name them, so a request and an agent mean the same thing. Give agents a reusable command-line driver that starts the application, performs an action and saves evidence (a screenshot, a response, a log), so verification costs one command instead of a fresh script each time. These two are the basis of a feature-verify skill.
