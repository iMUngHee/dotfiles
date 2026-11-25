# Formal verification after approval

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
5. **Record it** with the gate that owns the check. For the bundled driver use `scripts/check-data/formal.tsv` ([formal verification record](../../project-bootstrap/assets/check-contract.md#formal-verification-record)): the command, the code it covers, the commit it was confirmed against, `full` when it is cheap enough for every merge, and the property in one sentence.
6. **Write the upkeep procedure** from "Bringing a formal check back in step" below into the development guide, and put the following rules in the existing unconditional guidance that maintainers and agents read. Use the actual command, record and check names from the repository. Mark a review-only decision `[unchecked: reason]`. The examples use the bundled driver. Its drift check verifies the recorded revision and detects covered changes. Review establishes whether the check was rerun and whether the model still fits the implementation. Its tag checker reads `.ai/rules/*.md` and the documents check-config registers through `rule_files`, such as CONVENTIONS; other guidance is outside that scan. In a new split-rule layout, put these rules in an unconditional `.ai/rules/formal.md`:

   - Register the covered paths and verified revision in the formal record. The recorded revision must exist, be an ancestor of HEAD, and cover the current tree without drift. [check: formal drift]
   - Move `synced` only after following the upkeep procedure and confirming the check still describes the code. [unchecked: review the rerun and model correspondence]
   - A failing check is a finding about the code until a replay of its counterexample shows a step the code cannot take; never weaken the property to make it pass. [unchecked: judged by replaying the counterexample]

When `statechart` is installed, it checks a TLA+ model and draws it as a Mermaid statechart with the shortest path to each state that breaks a rule. Nothing in the repository depends on it: the script in step 2 runs TLC directly, and the development guide's table says how to read TLC's own counterexample output.

## Bringing a formal check back in step

The development guide carries this procedure (step 6 above). When `formal drift` fails, or a check fails after a change, give each check one outcome: **in sync** (nothing the model describes changed), **updated** (the model now describes the new code and passes), **bug** (the model describes the code and the code breaks the property) or **blocked** (it could not be brought back or run; say why). A check can be updated and then a bug.

1. Run the check as it is before changing anything; a pass only says the old description still holds.
2. Read every change to covered code since `synced`, including code that was renamed, split or moved out of `covers`, and new code that writes the state the check guards; widen `covers` to include it.
3. Sort each change: no effect on what the model describes; the model no longer describes the code; the promise changed on purpose, shown by a doc comment, test, changelog or commit message you cite; or the promise may be broken.
4. Update the model from the code before rerunning, never from what makes it pass. Change the property only for a promise that changed on purpose, writing down the old and new wording and the evidence, and keep the bounds or say why they shrank.
5. After a pass, break the new code the way the property guards against and confirm the check still fails. After a failure, replay the counterexample against the code: a step the code cannot take is a model error to fix; otherwise it is a bug, reported with the commit that introduced it, its steps in the code's words and the harm in one sentence.
6. Move `synced` only for checks that ended in sync or updated; a bug or a blocked check keeps it where it was, so the drift check keeps pointing at it.
