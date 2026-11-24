---
name: advanced-verification
description: Choose and install a verification method beyond ordinary tests - property-based tests, fuzzing, differential or mutation testing, model checking or proofs - for a named, costly risk that structure, static checks and the existing suite leave open, and leave its upkeep to the repository. Use when a maintainer asks for one or a project-bootstrap report names a candidate. Skip routine test writing, setting up a repository's quality floor (project-bootstrap) and checking that a finished feature works (verify).
disable-model-invocation: false
---

# Advanced verification

A method earns its place by catching a break that the code's structure, its static checks and its existing tests let through, at a cost the repository will keep paying. Start from the risk, never from the method.

1. **Name the promise and the gap.** State the observable promise, the harm if it breaks, and why structure, static checks and the current suite miss it. If a type, an API change or a cheaper test closes the gap, do that instead and stop.
2. **Pick the method that answers the question.**

   | Risk | Question | Method |
   | --- | --- | --- |
   | Pure logic with a large input space | Does the property hold for every input? | property-based tests (proptest, fast-check, Hypothesis) |
   | Parsers and decoders of untrusted input, unsafe or FFI code | Does a strange input crash it or corrupt memory? | coverage-guided fuzzing, with every crash input kept as a regression fixture |
   | Code with a reference implementation | Does it agree with the reference? | differential tests |
   | The tests themselves | Do they catch a broken implementation? | mutation testing, limited to the files a change touches |
   | Several actors, concurrency, distributed state | Does an invariant hold in every order of steps? | model checking of the design (TLA+, Quint) or of the code itself where the stack allows (loom for Rust threads, Stateright for Rust code written as its actors) |
   | Recovery and escape paths that must stay open | From every state, can the system still reach the state it needs? | branching-time model checking (CTL in nuXmv) |
   | Timeouts, retries, failure rates, latency budgets | How likely is a bad outcome, or how long does it take on average? | probabilistic model checking (PRISM, Storm) fed with measured distributions |
   | A core algorithm whose failure is costly | Is it correct for every case? | proof on the code where the stack has a verifier (Kani or Verus for Rust, Gobra for Go, Dafny for code written in it), otherwise a proof of a model (Lean, or Veil for state machines beyond a model checker's bound) tied to the code by a differential test |

   Rank candidates by the harm a break does, not by how easy they are to verify.
3. **Get the maintainer's decision** before adding anything that brings a toolchain, a model or a check that must stay in step with the code. Property-based tests and fuzz targets in the stack's own test tooling need only the usual review.
4. **Install it so the repository owns it.** Pin the tool through the stack's toolchain files or one setup command, run it from the repository's gate or a documented command, and place it in the gate's fast or full tier by its measured cost. Register mutation testing as an optional `full` check, and judge whether a surviving mutant changes an observable contract before adding a test for it. For a model or proof follow [formal](references/formal.md).
5. **Show what it adds.** Break the code in a way the existing tests still pass and confirm the new method fails. When no such break exists, say so: the method repeats what the tests already guard.
6. **Hand over the upkeep.** Write the command, its prerequisites, the property it protects, how to read a failure and how to bring it back in step into the repository's development guidance, so it can be maintained without this skill.

Report the promise, the method chosen and the ones rejected with why, the toolchain pin, the tier, the break it caught, and what it still cannot see; a proof covers its model or stated bound, and the integrated behavior still needs runtime verification.
