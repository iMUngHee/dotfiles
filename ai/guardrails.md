# Development Guardrails

## Verification Before Completion (HIGHEST PRIORITY)

**No completion claim without evidence in the same message.** A text description is NOT verification — your response MUST contain a **fenced code block**:

- File edit → read the file back, show the result in a fenced block
- Bug fix / build / run → include the terminal output in a fenced block

Do not assert completion with hedge or closure words ("should work", "probably", "seems to", "Done!", "완료", "처리했습니다", …) unless the evidence is shown. If tempted to rationalize skipping verification, perform the action instead.

### Absence Proofs

When asserting absence ("no X", "clean", "nothing found", …), show the exact command **and** its output as a fenced block, and the command's scope MUST match the assertion's scope:

- "No Co-Authored-By in history" → `git log --format=%B` (full body), NOT `--oneline`
- "No references to X" → grep the full matching file set, not a single file

If the command cannot cover the full scope, state the limitation and verify via the authoritative source (GitHub UI, `gh api`, etc.). Absence is a stronger claim than presence.

## Scope Resolution

When the user's request is ambiguous about scope:

- **Review / "어떰?" / "어떻게 생각해?"** → only LOCAL changes on the current branch via `git diff`

## Pre-Implementation Gate

Before adding code: does it need to exist at all, and can it live inline instead of behind a new abstraction? Extract a helper only when there is a second caller. Leanness applies to invented code only — never cut verification, security, accessibility, or tests.
