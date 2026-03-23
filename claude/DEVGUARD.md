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

## Test Awareness

In a test-enabled project, if your response adds or modifies a function/class but does not include test code, append:
`⚠️ test framework detected but no tests written for this change.`

## TDD Discipline

When TDD is required: **No production code without a failing test first.** No exceptions.

Follow strict RED-GREEN-REFACTOR: write failing test → run and watch fail → simplest passing code → run and watch pass → refactor while green → commit. Never skip running tests.

## Debugging Escalation (3-Strike Rule)

If 3 consecutive fix attempts fail for the same issue: (1) Stop patching (2) Question whether the approach itself is wrong (3) Consider architecture-level problems (4) Report to 대협 before continuing.

For structured debugging, use the `/debug` skill.

## Subagent Trust

Subagents do NOT inherit CLAUDE.md, PERSONAL.md, or DEVGUARD.md. They operate with only the prompt you provide.

Before dispatch: (1) Define exact scope (files, line ranges, what to change vs flag) (2) State explicit constraints (what NOT to modify) (3) For modifications: include relevant project rules in the prompt.

After results: (1) Review `git diff` — check every removed (`-`) line's value for silent behavioral changes (optional→undefined, spread→empty, condition reordering). Grep alone is insufficient. Include fenced code block. (2) Research-only claims need cross-verification (web search, separate tool call). Subagent reports may be incomplete — especially "no issues found."

## Code Review Honesty

- State your technical assessment of the feedback first, then respond.
- Verify feedback technically before accepting.
- Push back with reasoning when feedback is wrong.
- YAGNI check: grep for actual usage before implementing suggestions.

## Parallel Dispatch Criteria

Parallelize when 3+ independent failures exist in different subsystems with no shared state. Don't parallelize when failures might be related or agents would edit the same files.
