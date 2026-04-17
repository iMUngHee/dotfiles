# Development Guardrails

## Verification Before Completion (HIGHEST PRIORITY)

**No completion claim without showing evidence in the same message.**

### What you MUST do after work

- File edit → **read the file back** and include a **fenced code block** showing the result
- Bug fix / build / run → include the **terminal output** as a fenced code block

A text description alone is NOT verification. Your response must contain a fenced code block.

### Forbidden completion words (without evidence)

English: "should work", "should be fine", "probably", "likely", "seems to", "appears to", "I believe", "I think", "Done!", "Perfect!", "Great!", "All set!"

Korean: "완료", "끝", "다 됐습니다", "처리했습니다", "반영했습니다"

- If tempted to rationalize skipping verification, delete the rationalization and perform the action instead.

### Absence Proofs

When asserting absence ("no X", "clean", "empty", "nothing found", "not present", "there are no ..."):

- Show the exact command or search used **and** its output as a fenced code block
- The command's scope MUST match the assertion's scope:
  - "No Co-Authored-By in history" → `git log --format=%B` (full body), NOT `--oneline`
  - "No references to X" → grep across the full matching file set, not a single file
  - "No stale dependencies" → inspect lockfile + package manifest, not just one
- If the command cannot cover the full assertion scope, state the limitation explicitly and verify via the authoritative source (GitHub UI, `gh api`, remote registry, etc.)

Absence is a stronger claim than presence — treat it accordingly.

## Scope Resolution

When the user's request is ambiguous about scope:

- **Review / "어떰?" / "어떻게 생각해?"** → only LOCAL changes on the current branch via `git diff`
- **"정리해" / "리팩터해"** → only explicitly named files/symbols. Report related files and wait for approval
- **"왜 이래?" / "왜 안 돼?"** → explain root cause first. Suggest workarounds only when asked
- When scope is unclear, ask a one-sentence clarifying question before proceeding

## Skill Compliance

If a user request matches a registered skill's trigger condition, invoke the skill instead of performing the action manually. Do not bypass skills by reimplementing their behavior with raw tool calls.

**Plan Mode routing**: "설계해", "design this", or any design/planning request → invoke `/design` skill. Do NOT enter Plan Mode unless 대협 explicitly types `/plan` or asks for plan mode. Plan Mode is an operational mode, not a substitute for the `/design` skill workflow.

## Design Gate & Implementation Planning

**Trigger:** Activate when ANY of these apply:

- Changes expected across 3+ files
- New architecture decisions involved
- Request scope is ambiguous
- 대협 explicitly requests a design

If none apply, skip and proceed directly.

For the design/planning process, use the `/design` skill.
