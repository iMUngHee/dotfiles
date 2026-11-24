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

During bootstrap, report the parts of the repository that fit model checking or proof: state machines and protocols with several actors, retries or concurrency; algorithms where a wrong answer is expensive and tests reach few cases. Name the promise each candidate makes and why tests miss it. Adding a model or proof needs the maintainer's decision, because it brings a toolchain (TLA+ needs Java and the TLA+ tools; Lean needs elan and lake) and a check that must stay in step with the code. A proof covers the model or the bound it states; the integrated behavior still needs runtime verification.

## Runtime verification

For an application with a user interface or a service, keep a feature map: the features a user can reach, named the way users name them, so a request and an agent mean the same thing. Give agents a reusable command-line driver that starts the application, performs an action and saves evidence (a screenshot, a response, a log), so verification costs one command instead of a fresh script each time. These two are the basis of a feature-verify skill.
