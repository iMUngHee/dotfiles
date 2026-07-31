# Development Guardrails (Claude-only addendum)

## Skill Compliance

If a user request matches a registered skill's trigger condition, invoke the skill instead of performing the action manually. Do not bypass skills by reimplementing their behavior with raw tool calls.

## Design Gate Invocation (Claude)

When the `design` skill's trigger conditions fire, invoke it for the design/planning process.

## Active Plan Context

Obey the injected session-routing block. In an unbound session, never infer plan, branch, or approval scope from main `current.txt` or from another session's selection.
