# Contributor documentation

Start at the existing contributor entry point. Record the architecture decisions that change how someone should implement the next feature. Keep the explanation beside existing architecture or development guidance. A small project can use a short section in its README. Create a separate document when people need to consult or maintain it independently.

For a representative change, point from the entry point to the owner and its supported extension path. Record the boundary that matters on that path and why it exists. Depending on the change, that means permitted dependencies, who may update state or release a resource, where errors become public, or which work stays off a hot path. Reference actual modules or an example that demonstrates the intended approach. Record current design and any proposed migration separately.

Make the explanation usable by someone with only the checkout. They should find the editable policy, the commands for fast and full checks, how a rejected change can be repaired, and who owns any versioned public contract. Name the actual check or use `[unchecked: reason]` where review owns the decision. Verify that each stated boundary matches the code, and exercise the path another contributor would follow. A link check proves that the destination exists.

Use one editable guidance source for each decision. Link human and agent entry points to it. Update the explanation with the contract it describes, and record separately owned exceptions or migration decisions with their reasons.
