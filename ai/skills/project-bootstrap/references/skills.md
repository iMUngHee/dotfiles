# Maintenance after bootstrap

Give the repository three maintenance responsibilities. For a small project, put them beside its standard commands in the existing contributor or agent guidance. Create a project skill only when a repeated project-specific procedure benefits from a separate invocation. Reuse the existing layout and expose any shared skill through the project's supported loaders.

- **Review changes.** Follow the change through its code owner and public contract. Check new dependency edges, duplicated decisions, abstractions and changes in cost at actual callers. Run the repository gate. Review the mechanism that protects each consequential decision.
- **Keep rules and documentation current.** Name the editable policy, its enforcing check and any command that syncs generated guidance. When a restriction gains an exception, update its owners and run the gate with two changes: the newly allowed case must pass, and the closest case still covered by the restriction must fail with its repair hint. Retire obsolete checks and tags when their rule is removed. Update the owning architecture, contract or contributor document in the same change. Keep the evidence and its scope available for the next maintainer.
- **Garden recurring mistakes.** Use the existing review or issue log to record the failure, evidence and reason. On recurrence repair the example contributors keep copying when a small compatible change can remove the mistake. Narrow the remaining violation with a precise check or explain what the reviewer needs to judge. Lower an applicable baseline as code is fixed. Retire checks, lessons or prose when the underlying mistake becomes impossible.

Keep the commands usable by humans and by agents with only the repository. Introduce a dedicated lessons file or maintenance skill when there is an actual entry or workflow to maintain.

## Conditional skills

Start with the contributor guide. Use these examples when a repeated project-specific procedure has a concrete check and benefits from an independent invocation.

| Skill | Create when | Does |
| --- | --- | --- |
| `<prefix>-security-review` | The repository has a security boundary: authentication, isolation, secrets, untrusted input crossing into privileged code | Checks a change against each named boundary |
| `<prefix>-change-checklist` | The repository exposes an inventory that must change together: environment variables, commands, routes, bindings, schema | Lists what else to change when one entry is added or renamed |
| `<prefix>-feature-verify` | A repeated user journey already has a reusable local driver | Drives it through the feature map with the reusable driver and keeps the evidence |

Mark deployment or production-touching skills as invoked only on request.
