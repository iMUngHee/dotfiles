# Decisions carried by code

Use this when a change can meet its visible requirements and still leave worse code for the next contributor. Start at a real entry point and read the implementation and its callers. Look for a shared decision that is easy to reimplement incorrectly, a boundary that callers can bypass, or work whose cost multiplies on a common path.

## Compare concrete ways to make the change

| Decision | Inspect | Put the decision here |
| --- | --- | --- |
| Responsibility and dependencies | The files a feature touches, the state or resource it changes, and which code may depend on which | The module that owns the invariant. Keep protocol adapters and presentation at their edges. Use package visibility or the dependency graph where available. |
| Types and errors | The valid states or inputs, their construction sites, conversion points, retry or rollback and the consumer's error contract | The narrow API or type that can represent the valid choices. Parse external input at its boundary and preserve distinctions the caller can act on. |
| Abstraction and duplication | Actual callers and which decisions must change together | The smallest implemented path with a real responsibility. Share decisions that must stay consistent. Let independent choices vary. A wrapper earns its place with a responsibility its callers need. |
| Execution cost | The actual workload, request frequency or input bounds, and ownership, allocation, I/O or concurrency along that path | An API that makes the affordable path natural. Borrow when it fits the lifetime, copy when ownership really transfers, and move blocking work to the boundary designed for it. Confirm the measured cost under equivalent results and conditions when making a performance claim. |

For example, a state change that updates multiple records belongs in the operation that owns the transaction. Let the HTTP handler translate the result and call the same operation as other adapters. An additional direct write in the handler may produce the same response today and split the invariant. If visibility already prevents that write, prove the restriction and show the supported API. If it remains possible, narrow access where compatible or check the direct import precisely. Use an existing transaction test for the behavior.

A scan that needs only a count can consume an iterator without collecting everything. A caller that reuses the items may legitimately collect them. Keep that distinction in a hot path decision. Avoid a project-wide collection ban for a cost observed at one site.

## Leave a path contributors can exercise

Follow a normal extension through a real entry point or compile the smallest useful caller. Identify the owning example a future contributor can open. Exercise a nearby bad change through the relevant compiler, boundary check or behavior test. Preserve a legitimate alternative and report the result. For a judgment-only claim, show the relevant callers, costs or responsibilities and explain what the reviewer must decide. Scope the evidence to the exercised path and configuration.

Changing a central API, file format or deployment contract may cost more than the local improvement. Preserve its consumers, document the current supported path and record any deferred migration with its trigger. Fix the existing example when a narrow compatible change removes the shortcut. Send larger change sets through the repository's planning process.
