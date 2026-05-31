# Development Guardrails (Codex-only addendum)

Shared guardrails (Verification, Scope Resolution, Absence Proofs, Design Gate Trigger) are generated into `~/.codex/AGENTS.md` from `ai/`. This file holds Codex CLI-specific invocation paths only.

## Skill Compliance

If a user request matches a registered skill's trigger condition, use that skill instead of reimplementing its behavior with raw tool calls.

Design/planning requests such as `"설계해"` or `"design this"` use the `design` skill workflow. Do not treat a UI mode switch as a substitute for the design skill workflow; the skill owns plan artifacts under `.agents/plans/` and the state pointer at `.agents/state/current.txt`.

## Commit Verification

Before running `git commit` in a 대협-owned repo, run:

```sh
~/.config/codex/scripts/pre-commit-sensitive-scan.sh
```

If the script reports `FAIL` or `WARN`, surface the finding before committing. Do not auto-strip sensitive content or commit through a flagged result without 대협's confirmation.

## Active Plan Context

The Codex `UserPromptSubmit` hook injects the active plan from `.agents/state/current.txt` when it points to a `draft` or `active` plan. Treat that injected context as the current task pointer; when the pointer is empty, do not infer an active plan from old runtime files.
