# Architecture

ARCHITECTURE is the repository's definition of its structure. A later contributor, with only the checkout, judges a change against it, and the gate reads the part a machine can decide. Without it, nothing says whether the code has drifted.

## What it holds

| Section | Holds |
| --- | --- |
| Components | Each component, what it owns (persisted state, resources, invariants) and the code that is its owner |
| Layers and dependencies | The layers, the allowed directions between them, and a link to the dependency policy the gate reads |
| Boundaries | Security and isolation boundaries, where external input is parsed, who may release each resource |
| Extension paths | For each component, the supported way to extend it and a real example a contributor can copy |
| Decisions | Each decision a later reader could undo by accident, with its reason; move them to a decisions directory only when they outgrow a section |
| Current, target, debt | For an existing repository: the structure as the code shows it, the target the conventions and decisions set, and the departures between them, each tied to a ratchet, a debt entry or a deferred decision |

Write it from the code: every claim names the file, module or type that makes it true, so a reviewer can open it. Keep only what changes rarely; leave function-level detail to the code. Scale it to the project: a small app has two or three components and one line of dependencies, and a project with no boundary to enforce says "one component, no layer policy" and why. Mark the structure of a new project provisional and correct it in the change that proves it wrong. Reuse existing design documents and decision records by linking them; do not restate them.

## Decisions carried by code

Use this when a change can meet its visible requirements and still leave worse code for the next contributor. Start at a real entry point and read the implementation and its callers. Look for a shared decision that is easy to reimplement incorrectly, a boundary that callers can bypass, or work whose cost multiplies on a common path.

| Decision | Inspect | Put the decision here |
| --- | --- | --- |
| Responsibility and dependencies | The files a feature touches, the state or resource it changes, and which code may depend on which | The module that owns the invariant. Keep protocol adapters and presentation at their edges. Use package visibility or the dependency graph where available. |
| Types and errors | The valid states or inputs, their construction sites, conversion points, retry or rollback and the consumer's error contract | The narrow API or type that can represent the valid choices. Parse external input at its boundary and preserve distinctions the caller can act on. |
| Abstraction and duplication | Actual callers and which decisions must change together | The smallest implemented path with a real responsibility. Share decisions that must stay consistent. Let independent choices vary. A wrapper earns its place with a responsibility its callers need. |
| Execution cost | The actual workload, request frequency or input bounds, and ownership, allocation, I/O or concurrency along that path | An API that makes the affordable path natural. Borrow when it fits the lifetime, copy when ownership really transfers, and move blocking work to the boundary designed for it. Confirm the measured cost under equivalent results and conditions when making a performance claim. |

For example, a state change that updates multiple records belongs in the operation that owns the transaction. Let the HTTP handler translate the result and call the same operation as other adapters. An additional direct write in the handler may produce the same response today and split the invariant. If visibility already prevents that write, prove the restriction and show the supported API. If it remains possible, narrow access where compatible or check the direct import precisely. A scan that needs only a count can consume an iterator without collecting everything; a caller that reuses the items may legitimately collect them, so keep that distinction in the hot-path decision instead of banning collection project-wide.

Follow a normal extension through a real entry point or compile the smallest useful caller. Exercise a nearby bad change through the relevant compiler, boundary check or behavior test, preserve a legitimate alternative and report the result. For a judgment-only claim, show the relevant callers, costs or responsibilities and explain what the reviewer must decide. Changing a central API, file format or deployment contract may cost more than the local improvement: preserve its consumers, document the current supported path and record the deferred migration with its trigger.

## The dependency policy

The allowed directions live in data the gate reads; ARCHITECTURE explains them and links that data, and CONVENTIONS refers to the check that enforces them without restating any edge.

1. Where the stack has a native policy tool (dependency-cruiser, import-linter, a check over `cargo metadata` or `go list`), its configuration is the policy.
2. Where it has none and a real boundary exists, use `scripts/check-data/layers.tsv` with the bundled [`check-layers.sh`](../assets/check-layers.sh) installed as `scripts/check-layers.sh`. The repository supplies an extractor that prints its production dependencies as `from<TAB>to` lines, internal files as canonical repository-relative paths and external dependencies as `ext:<name>`. The rows and outcomes are in the [contract](../assets/check-contract.md#layer-policy).
3. Where no boundary exists, install neither; ARCHITECTURE says so.

Forbidden edges that already exist when the policy is adopted are `debt` rows, never `allow` rows. They can only be removed, and ARCHITECTURE's debt section points at them.
