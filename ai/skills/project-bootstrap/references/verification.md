# Choosing verification

Name the observable contract, the harm if it breaks, and the gap in existing evidence. Reuse the cheapest working check. Reach for this table only while that gap remains. Preserve effective suites, crash corpora and formal records. Record what each selected method exercises and where its evidence stops.

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

Choose a trigger and an observation at the public boundary. Exercise a meaningful limit or failure path when it changes the outcome. For a contract that limits side effects, observe what the entry point creates or changes as well as what it returns. Include first use when initialization can write state. Reproduce an escaped bug before its fix. Skip redundant cases for states the type system rules out. A test should survive a behavior-preserving refactor and fail if its promise breaks. Compare performance under the same representative workload and build conditions after checking equivalent results.

## Scheduling a selected check

Time the check in the environment where contributors will run it. A quick local integration check can run before a push. A property suite that takes minutes belongs in full when its dependencies are available there. For a check that needs specialized hardware or manual access, document its command, prerequisites, trigger, protected property and how to interpret a failure.

Keep each fuzzing crash input as a regression fixture. Replay a cheap corpus in fast and retain an effective regression run for expensive cases. The bundled gate always runs formal drift in fast. A formal record selects full execution or a documented manual run ([gate contract](gate.md)).

## Costly invariants

Consider a model or proof when an important invariant remains unprotected after structure and cheaper checks. State its scope, what existing evidence misses, and who will keep it current. Discuss toolchain cost and obtain maintainer approval before adding it. For an approved adoption use the [formal verification procedure](formal-verification.md); preserve effective existing checks and records.

## Runtime verification

For a critical interaction, exercise its normal entrypoint and observe the user-visible outcome. Reuse a feature map or driver where available. Build a reusable driver only when repeated verification justifies its upkeep.
