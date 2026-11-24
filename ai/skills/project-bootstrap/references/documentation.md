# Contributor documentation

Start with the repository's existing entrypoint. A contributor should be able to find the editable guidance, run fast and full checks, understand which public interfaces are versioned, and repair a failed check using only the checkout. Put the reason for a constraint near its owner. Keep human and agent entrypoints pointing to that source.

Describe a boundary when getting it wrong changes how contributors work. Distinguish today's dependency direction from a desired migration. Check an import or a generated inventory mechanically when the canonical source supports it. A path or link check proves existence; a reviewer still evaluates whether the description matches the design.

Extend the existing development guide when an exception, costly manual check or release procedure needs explanation. Record a durable decision with its rationale when a future change could accidentally reverse it. Update the relevant explanation in the same change as its contract. Add a separate document only when someone needs to consult or maintain it independently.
