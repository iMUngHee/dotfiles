# Behavior evidence

Tests and measurements protect contracts that code structure and static checks cannot; they do not set the quality bar.

- Before adding one, name the observable contract, the harm if it breaks and the gap in existing evidence. Reuse the cheapest working check. Preserve effective existing suites, crash corpora, formal records and their repository-owned upkeep.
- Coverage and test counts are not goals.
- Do not test what the types or the structure already rule out; when a test would only guard against a misuse, first try to make the misuse unrepresentable.
- Test code is held to the same standard as product code. A test tied to internals blocks the refactors that remove slop.
- Back a performance claim with a measurement on a representative workload under the same build and conditions, after checking the results are equivalent. Do not install a benchmark suite or profiler where no costly path is at stake.

## Choosing cases

Choose a trigger and an observation at the public boundary, with a limit or failure path when it changes the outcome; for a side-effect contract observe what the entry point creates or changes, include first use when initialization writes state, and reproduce an escaped bug before its fix. A test survives a behavior-preserving refactor and fails if its promise breaks.

## Scheduling a selected check

Time the check where contributors will run it: a quick one can run before a push, and one that takes minutes belongs in full when that environment has its prerequisites. For a check that needs specialized hardware or manual access, document its command, prerequisites, trigger, protected property and how to read a failure. Keep a working crash corpus replaying in fast. The bundled gate always runs formal drift in fast when a formal record exists ([gate contract](../assets/check-contract.md#formal-verification-record)).

## Beyond ordinary tests

A risk that survives structure, static checks and ordinary tests (a large input space, untrusted parsers, unsafe or foreign code, orderings among actors, a costly algorithm, a suite that passes on broken code) goes on the map with the promise it would protect and why existing evidence misses it. Installing property-based tests, fuzzing, mutation testing, model checking or proofs is the maintainer's decision, made with a procedure such as the `advanced-verification` skill; keep any such method the repository already runs.

## Runtime verification

Exercise a critical interaction through its normal entrypoint and observe the user-visible outcome, with an existing feature map or driver where there is one; build a driver only when repeated verification justifies its upkeep.
