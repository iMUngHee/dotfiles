# Development Guardrails (Claude-only addendum)

Shared guardrails (Verification, Scope Resolution, Absence Proofs, Design Gate Trigger) live in `~/.claude/guardrails.md` (deployed from `ai/guardrails.md`). This file holds the Claude Code-specific rules only.

## Skill Compliance

If a user request matches a registered skill's trigger condition, invoke the skill instead of performing the action manually. Do not bypass skills by reimplementing their behavior with raw tool calls.

**Plan Mode routing**: "설계해", "design this", or any design/planning request → invoke `/design` skill. Do NOT enter Plan Mode unless 대협 explicitly types `/plan` or asks for plan mode. Plan Mode is an operational mode, not a substitute for the `/design` skill workflow.

## Design Gate Invocation (Claude)

When the shared Design Gate Trigger (in `~/.claude/guardrails.md`) fires, invoke the `/design` skill for the design/planning process. Do not improvise the planning workflow — the skill manages plan artifacts under `.claude/plans/` and the state pointer at `.claude/state/current.txt`.
