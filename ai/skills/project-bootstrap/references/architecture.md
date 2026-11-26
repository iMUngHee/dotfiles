# Architecture

ARCHITECTURE is the repository's definition of its structure. A later contributor, with only the checkout, judges a change against it, and the gate reads the part a machine can decide.

## What it holds

| Section | Holds |
| --- | --- |
| Components | Each component, what it owns (persisted state, resources, invariants) and the code that is its owner |
| Layers and dependencies | The layers and why they are cut this way, with a link to the dependency policy that owns the allowed directions |
| Boundaries | Security and isolation boundaries, where external input is parsed, who may release each resource, and for each the supported route for a change that must cross it |
| Extension paths | For each component, the supported way to extend it and a real example a contributor can copy |
| Decisions | Each decision a later reader could undo by accident, with its reason; move them to a decisions directory only when they outgrow a section |
| Current, target, debt | For an existing repository: the structure as the code shows it, the target the conventions and decisions set, and the departures between them, each bound in the audit record, the layer debt or a deferred decision |

Write it from the code: every claim names the file, module or type that makes it true, so a reviewer can open it. Keep what changes rarely; leave function-level detail to the code. Scale it to the project: a small app has two or three components and one line of dependencies, and a project with no boundary to enforce says "one component, no layer policy" and why. Mark the structure of a new project provisional and correct it in the change that proves it wrong. Link existing design documents and decision records instead of restating them.

## Decisions carried by code

Use this when a change can meet its visible requirements and still leave worse code for the next contributor, starting at a real entry point and reading the implementation and its callers. Look for a shared decision that is easy to reimplement incorrectly, a boundary that callers can bypass, or work whose cost multiplies on a common path.

| Decision | Inspect | Put the decision here |
| --- | --- | --- |
| Responsibility and dependencies | The files a feature touches, the state or resource it changes, and which code may depend on which | The module that owns the invariant. Keep protocol adapters and presentation at their edges. Use package visibility or the dependency graph where available. |
| Types and errors | The valid states or inputs, their construction sites, conversion points, retry or rollback and the consumer's error contract | The narrow API or type that can represent the valid choices. Parse external input at its boundary and preserve distinctions the caller can act on. |
| Abstraction and duplication | Actual callers and which decisions must change together | The smallest implemented path with a real responsibility. Share decisions that must stay consistent. Let independent choices vary. A wrapper earns its place with a responsibility its callers need. |
| Execution cost | The actual workload, request frequency or input bounds, and ownership, allocation, I/O or concurrency along that path | An API that makes the affordable path natural: borrow when it fits the lifetime, copy when ownership really transfers, move blocking work to the boundary designed for it, and measure under equivalent results and conditions before claiming a speed-up. |

For example, a state change that updates several records belongs in the operation that owns the transaction, and the HTTP handler translates the result and calls that operation like other adapters. A direct write in the handler may return the same response today and split the invariant: prove that visibility prevents it and show the supported API, or narrow access or check the import precisely. A scan that needs only a count consumes an iterator instead of collecting, while a caller that reuses the items may collect them; keep that distinction in the hot-path decision instead of banning collection project-wide.

Follow a normal extension through a real entry point or the smallest useful caller, exercise a nearby bad change through the compiler, boundary check or behavior test while a legitimate alternative still passes, and report the result; for a judgment-only claim, show the callers, costs or responsibilities the reviewer must weigh. When changing a central API, file format or deployment contract costs more than the local gain, preserve its consumers, document the current supported path and record the deferred migration with its trigger.

## The dependency policy

The allowed directions live in data the gate reads; ARCHITECTURE explains them and links that data, and CONVENTIONS links that policy and names the check that enforces it, without restating any edge.

1. Where the stack has a native policy tool (dependency-cruiser, import-linter, a check over `cargo metadata` or `go list`), its configuration is the policy.
2. Where it has none and a real boundary exists, use `scripts/check-data/layers.tsv` with the bundled [`check-layers.sh`](../assets/check-layers.sh) installed as `scripts/check-layers.sh`. The repository supplies an extractor that prints its production dependencies as `from<TAB>to` lines and `file<TAB><path>` for each production file that has none, internal files as canonical repository-relative paths and external dependencies as `ext:<name>`. The rows and outcomes are in the [contract](../assets/check-contract.md#layer-policy).
3. Where no boundary exists, install neither; ARCHITECTURE says so.

Forbidden edges that already exist when the policy is adopted are recorded as debt, never as allowed directions: `debt` rows with the default policy, the tool's own baseline or exception mechanism with a native one. Debt can only shrink, and ARCHITECTURE's debt section points at it. Report a deferred activation as an incomplete requirement. Link ARCHITECTURE from the entry point; in a generated entry point write the link relative to the repository root ([harness](harness.md#agent-guidance-source-and-loaders)).
