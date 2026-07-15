# Output Formats

Read this file when SKILL.md requires a user-job closure record, material-gap record, or final design-fit result. Keep the field labels exact so readiness can be checked mechanically.

## User-Job Closure

```text
User-job closure:
- Requested action: <the user-visible action this change must enable>
- Success: <observable successful result and feedback>
- Failure/retry: <failure state, recovery action, and retry feedback, or justified N/A>
- Preserved invariants: <existing routes, controls, data, states, and visual rules that remain authoritative>
```

Preserved invariants constrain the implementation. They never remove the requested action or success state.

## Material Gaps

Emit this during the existing opportunity approval transition, never as a separate question:

```text
Material gaps: none | <comma-separated gaps>
```

## Design-Fit Result

```text
Design judgment:
- User-job fit: <assessment>
- Workflow and product specificity: <assessment>
- Hierarchy, density, and craft: <assessment>
- Contract integrity: <assessment>

Verification status:
- User-job closure: PASS | FAIL | N/A - <evidence or concrete N/A reason>
- Required states/recovery: PASS | FAIL | N/A - <evidence or concrete N/A reason>
- Inspected render coverage: PASS | FAIL | N/A - <paths or concrete N/A reason>
- Geometry/overflow: PASS | FAIL | N/A - <browser measurements or concrete N/A reason>
- Accessibility floors: PASS | FAIL | N/A - <evidence or concrete N/A reason>
- Contract/code/render agreement: PASS | FAIL | N/A - <evidence or concrete N/A reason>

Outcome: READY | NOT VERIFIED
```

`READY` requires every applicable verification row to pass and every `N/A` to include a concrete reason. Design judgment cannot override verification.

When the outcome is `NOT VERIFIED` because correction stopped with a measured failure, append:

```text
Failed selector/control: <selector or identifying control>
Observed value: <measured value>
Required threshold: <required value>
Correction cycles used: <0-2>
Stop reason: <two-cycle budget exhausted | correction unauthorized | correction impossible>
```
