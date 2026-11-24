# Choosing verification

Name the observable contract, the harm if it breaks, and the gap in existing evidence. Reuse the cheapest working check. Reach for this table only while that gap remains. Preserve effective suites, crash corpora and formal records. If a necessary method lacks tooling, a small deterministic fixture may suffice; record what it exercises and what remains uncertain.

| Risk | Question | Family |
| --- | --- | --- |
| Pure logic with a large input space | Does the property hold for every input? | property-based tests (proptest, fast-check, Hypothesis) |
| Parsers and decoders of untrusted input, unsafe or FFI code | Does a strange input crash it or corrupt memory? | coverage-guided fuzzing |
| Several actors, concurrency, distributed state | Does an invariant hold in every order of steps? | model checking of the design (TLA+, Quint) or of the code itself where the stack allows (loom for Rust threads, Stateright for Rust code written as its actors) |
| Recovery and escape paths that must stay open | From every state, can the system still reach the state it needs? | branching-time model checking (CTL in nuXmv) |
| Timeouts, retries, failure rates, latency budgets | How likely is a bad outcome, or how long does it take on average? | probabilistic model checking (PRISM, Storm) fed with measured distributions |
| A core algorithm whose failure is costly | Is it correct for every case? | proof on the code where the stack has a verifier (Kani or Verus for Rust, Gobra for Go, Dafny for code written in it), otherwise a proof of a model (Lean, or Veil for state machines beyond a model checker's bound) tied to the code by a differential test |
| Code with a reference implementation | Does it agree with the reference? | differential tests |
| The tests themselves | Do they catch a broken implementation? | mutation testing |
| Behavior as integrated | Does the user see the right result? | runtime verification against a feature map |

## Choosing cases

Choose a trigger and an observation at the public boundary. Exercise a meaningful limit or failure path when it changes the outcome. Reproduce an escaped bug before its fix. Skip redundant cases for states the type system rules out. A test should survive a behavior-preserving refactor and fail if its promise breaks. Measure performance claims under a stated representative workload.

## Scheduling a selected check

Time the check in the environment where contributors will run it. A quick local integration check can run before a push. A property suite that takes minutes belongs in full when its dependencies are available there. For a check that needs specialized hardware or manual access, document its command, prerequisites, trigger, protected property and how to interpret a failure.

Keep each fuzzing crash input as a regression fixture. Replay a cheap corpus in fast and retain an effective regression run for expensive cases. The bundled gate always runs formal drift in fast. A formal record selects full execution or a documented manual run ([gate contract](gate.md)).

## Formal verification candidates

Consider this section only when an uncovered, costly invariant warrants a model or proof. Examples include state machines and protocols with several actors, retries or concurrency; algorithms where a wrong answer is expensive and tests reach few cases. Name the promise each candidate makes and why tests miss it, and rank them by the harm a break does, not by how easy they are to verify. A separate model, in TLA+, Quint, PRISM or Lean alike, is a translation of the code that nobody checks, so prefer in this order: a checker or verifier that runs on the code itself; a model of a design question tests cannot ask, such as orderings, possibility or probability, which is worth that gap; and last a proof about a model of one function, which rarely beats property-based tests on the real code unless a differential test ties the model to it. Linear-time checkers such as TLC say what holds on every path; what must stay possible on some path needs CTL, and how often something happens needs a probabilistic checker. Adding a model or proof needs the maintainer's decision, because it brings a toolchain and a check that must stay in step with the code. A proof covers the model or the bound it states; the integrated behavior still needs runtime verification.

## After approval: adding a formal check

When the maintainer agrees, build it so the repository can run and maintain it without any personal skill. A checker or verifier that runs on the code itself, such as Kani, Verus, Gobra, Stateright or loom, has no model: pin it through the stack's own toolchain files, run its harnesses from the script in step 2, skip step 3, and in step 4 break only the code. The steps below otherwise use TLA+ and Lean as worked examples:

1. **Pin the toolchain** so contributors install it with one command. For TLA+, `.mise.toml` with Temurin 25 and the TLA+ tools at a checksum, installed by `mise install`:

   ```toml
   [tools]
   java = "temurin-25"
   "http:tla2tools" = { version = "1.7.4", url = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar", checksum = "sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88" }
   ```

   `temurin-25` pins the major version; a repository that must reproduce the patch release enables `mise.lock`.

   For Lean, put a Lake project in `spec/lean/` with a `lean-toolchain` file naming the exact release (for example `leanprover/lean4:v4.36.0`); elan reads it and installs that version. mise has no Lean or elan entry, so elan is the one prerequisite contributors install themselves. Start on the core library alone: Mathlib costs gigabytes and minutes of build, and list, arithmetic and permutation lemmas in core cover most properties of application code.
2. **Run the tool directly** from one script, such as `scripts/model-check.sh <Spec>` running `mise exec -- java -cp "$(mise where http:tla2tools)/tla2tools.jar" tlc2.TLC -workers auto -metadir "$(mktemp -d)" -config spec/<Spec>.cfg spec/<Spec>.tla`. TLC exits non-zero and prints the shortest counterexample when an invariant breaks. For Lean the script runs `lake build` in `spec/lean`, which fails on any unproved theorem; check once with `#print axioms <theorem>` that no proof rests on `sorryAx`.
3. **Tie the model to the code.** Every part of the model names the code a reviewer can open, uses the repository's nouns, and treats as one step only what is one indivisible step in the code; the model's header states its bounds and assumptions. Then check it with examples the code's own tests already check. Restate a few of those test cases against the model, as `#guard` lines in Lean or, in TLA+, a configuration that fixes a test's inputs and checks its expected result as an invariant, so a model that has drifted from the code fails before any property is trusted. Examples only spot-check: where the model can run, feed it and the code the same generated inputs and compare, or check traces recorded from the running code against the spec, so agreement is checked by machine instead of assumed.
4. **Show what it adds.** Break the code in a way the existing tests still pass, mirror the break in the model, and confirm the formal check fails. When no such variant can be found, say so in the report: the check then repeats what the tests already guard.
5. **Record it** with the gate that owns the check. For the bundled driver use `scripts/check-data/formal.tsv` ([gate.md](gate.md) contract 7): the command, the code it covers, the commit it was confirmed against, `full` when it is cheap enough for every merge, and the property in one sentence.
6. **Write the upkeep procedure** from "Bringing a formal check back in step" below into the development guide, and put the following rules in the existing unconditional guidance that maintainers and agents read. Use the actual command, record and check names from the repository. Mark a review-only decision `[unchecked: reason]`. The examples use the bundled driver. Its tag checker reads scoped and unconditional `.ai/rules/*.md` files; standalone guidance is outside that scan. In a new split-rule layout, put these rules in an unconditional `.ai/rules/formal.md`:

   - The coverage and sync commit of every formal check live only in `scripts/check-data/formal.tsv`; anything that runs or describes a formal check names its row and never copies them. [check: formal drift]
   - After a change to covered code, follow the development guide's procedure for bringing a formal check back in step, and move `synced` only to a commit you checked. [check: formal drift]
   - A failing check is a finding about the code until a replay of its counterexample shows a step the code cannot take; never weaken the property to make it pass. [unchecked: judged by replaying the counterexample]

When `statechart` is installed, it checks a TLA+ model and draws it as a Mermaid statechart with the shortest path to each state that breaks a rule. Nothing in the repository depends on it: the script in step 2 runs TLC directly, and the development guide's table says how to read TLC's own counterexample output.

## Bringing a formal check back in step

The development guide carries this procedure (step 6 above). When `formal drift` fails, or a check fails after a change, give each check one outcome: **in sync** (nothing the model describes changed), **updated** (the model now describes the new code and passes), **bug** (the model describes the code and the code breaks the property) or **blocked** (it could not be brought back or run; say why). A check can be updated and then a bug.

1. Run the check as it is before changing anything; a pass only says the old description still holds.
2. Read every change to covered code since `synced`, including code that was renamed, split or moved out of `covers`, and new code that writes the state the check guards; widen `covers` to include it.
3. Sort each change: no effect on what the model describes; the model no longer describes the code; the promise changed on purpose, shown by a doc comment, test, changelog or commit message you cite; or the promise may be broken.
4. Update the model from the code before rerunning, never from what makes it pass. Change the property only for a promise that changed on purpose, writing down the old and new wording and the evidence, and keep the bounds or say why they shrank.
5. After a pass, break the new code the way the property guards against and confirm the check still fails. After a failure, replay the counterexample against the code: a step the code cannot take is a model error to fix; otherwise it is a bug, reported with the commit that introduced it, its steps in the code's words and the harm in one sentence.
6. Move `synced` only for checks that ended in sync or updated; a bug or a blocked check keeps it where it was, so the drift check keeps pointing at it. Commit verification changes apart from any product fix.

## Runtime verification

For a critical interaction, exercise its normal entrypoint and observe the user-visible outcome. Reuse a feature map or driver where available. Build a reusable driver only when repeated verification justifies its upkeep.
