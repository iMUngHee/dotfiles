# Behavior evidence

Tests and measurements protect contracts that code structure and static checks cannot; they do not set the quality bar.

- Before adding one, name the observable contract, the harm if it breaks and the gap in existing evidence. Reuse the cheapest working check. Preserve effective existing suites, crash corpora, formal records and their repository-owned upkeep.
- Coverage, test counts and the number of methods in use are not goals.
- Do not test what the types or the structure already rule out; when a test would only guard against a misuse, first try to make the misuse unrepresentable.
- Test code is held to the same standard as product code. A test tied to internals blocks the refactors that remove slop.
- Back a performance claim with a measurement on a representative workload under the same build and conditions, after checking the results are equivalent. Do not install a benchmark suite or profiler where no costly path is at stake.

## Choosing cases

Choose a trigger and an observation at the public boundary. Exercise a meaningful limit or failure path when it changes the outcome. For a contract that limits side effects, observe what the entry point creates or changes as well as what it returns. Include first use when initialization can write state. Reproduce an escaped bug before its fix. A test should survive a behavior-preserving refactor and fail if its promise breaks.

## Scheduling a selected check

Time the check where contributors will run it: a quick one can run before a push, and one that takes minutes belongs in full when that environment has its prerequisites. For a check that needs specialized hardware or manual access, document its command, prerequisites, trigger, protected property and how to read a failure. Keep a working crash corpus replaying in fast. The bundled gate always runs formal drift in fast when a formal record exists ([gate contract](../assets/check-contract.md#formal-verification-record)).

## Beyond ordinary tests

Some risks survive structure, static checks and ordinary tests: a large input space, parsers of untrusted input, unsafe or foreign code, orderings among several actors, a costly algorithm, or a suite that passes when the code is broken. Report each as a candidate with the promise it would protect, the harm, and why existing evidence misses it. Choosing and installing property-based tests, fuzzing, mutation testing, model checking or proofs is a separate decision for the maintainer, made with a dedicated procedure such as the `advanced-verification` skill where available. Keep any such method the repository already runs working.

## Runtime verification

Exercise a critical interaction through its normal entrypoint and observe the user-visible outcome, with an existing feature map or driver where there is one; build a driver only when repeated verification justifies its upkeep.
