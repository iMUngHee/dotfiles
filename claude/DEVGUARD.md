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

### Rationalization Resistance

If your draft contains any phrase below, delete it and perform the action instead.

- "too simple to test" → Write the test — simple code = simple test
- "existing tests cover this" → `grep -r` for actual test coverage, include output
- "I'll add tests after" → Write test NOW before proceeding
- "I verified by reading the code" → Run the code or read the file, show output
- "the logic is straightforward" → Straightforward logic still needs evidence
- "based on the pattern in X" → Read file X, quote the relevant lines
- "this should fix it" → Run the fix, show PASS/FAIL output
- "the issue was likely..." → Reproduce first, then state cause with evidence
- "let me try a quick fix" → State root cause first, then fix
- "while I'm here, I'll also..." → Stop. Only do what was requested
- "minor cleanup" / "small refactor" → Check: did 대협 request this? If no, don't do it

## Scope Resolution

When the user's request is ambiguous about scope:

- **Review / "어떰?" / "어떻게 생각해?"** → only LOCAL changes on the current branch via `git diff`
- **"정리해" / "리팩터해"** → only explicitly named files/symbols. Report related files and wait for approval
- **"왜 이래?" / "왜 안 돼?"** → explain root cause first. Suggest workarounds only when asked
- When scope is unclear, ask a one-sentence clarifying question before proceeding

## Skill Compliance

If a user request matches a registered skill's trigger condition, invoke the skill instead of performing the action manually. Do not bypass skills by reimplementing their behavior with raw tool calls.

## Design Gate & Implementation Planning

**Trigger:** Activate when ANY of these apply:

- Changes expected across 3+ files
- New architecture decisions involved
- Request scope is ambiguous
- 대협 explicitly requests a design

If none apply, skip and proceed directly.

For the design/planning process, use the `/design` skill.
