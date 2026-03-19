# Development Guardrails

## Verification Before Completion (HIGHEST PRIORITY)

**No completion claim without showing evidence in the same message.**

This applies to ALL work: code edits, bug fixes, refactoring, file creation — everything.

### What you MUST do after work

- File edit → **read the file back** and include a **fenced code block** showing the result
- Bug fix / build / run → include the **terminal output** as a fenced code block

A text description alone is NOT verification. Your response must contain a fenced code block.

### Forbidden completion words (without evidence)

English: "should work", "should be fine", "probably", "likely", "seems to", "appears to", "I believe", "I think", "Done!", "Perfect!", "Great!", "All set!"

Korean: "완료", "끝", "다 됐습니다", "처리했습니다", "반영했습니다"

---

## Design Gate

**Trigger:** Activate when ANY of these apply:

- Changes expected across 3+ files
- New architecture decisions involved
- Request scope is ambiguous
- 대협 explicitly requests a design

If none apply, skip and proceed directly.

### Process

1. **Decompose** if 2+ independent subsystems exist. Ask which to start with.
2. **Propose 2-3 approaches** with How + Trade-off for each. Mark one as recommended.
3. **Present design incrementally** — section by section with confirmation. Do NOT dump all at once.
4. Do NOT implement until 대협 approves. Do NOT save design to files unless requested.

---

## Implementation Planning

**Trigger:** Same as Design Gate. Present as response text only.

1. **File Structure**: Map Create/Modify/Test files with responsibilities.
2. **Tasks**: Use `- [ ]` checkboxes. Each step includes expected output (PASS/FAIL).
3. If planned output differs from actual, investigate.

---

## Test Awareness

In a test-enabled project, if your response adds or modifies a function/class but does not include test code, append:
`⚠️ test framework detected but no tests written for this change.`

## TDD Discipline

When TDD is required: **No production code without a failing test first.** No exceptions.

Follow strict RED-GREEN-REFACTOR: write failing test → run and watch fail → simplest passing code → run and watch pass → refactor while green → commit. Never skip running tests.

## Debugging Escalation (3-Strike Rule)

If 3 consecutive fix attempts fail for the same issue:

1. **Stop patching.**
2. Question whether the approach itself is wrong.
3. Consider architecture-level problems.
4. Report to 대협 before continuing.

## Subagent Trust

Subagents do NOT inherit CLAUDE.md, PERSONAL.md, or DEVGUARD.md.
They operate with only the prompt you provide.

### Before dispatch

1. Define exact scope (files, line ranges, what to change vs flag)
2. State explicit constraints (what NOT to modify)
3. For modifications: include relevant project rules in the prompt

### After receiving results

1. Identify subagent's key claims
2. For claims that drive your next action, read the file or run a command to confirm
3. Include verification output as a fenced code block

Subagent reports may be incomplete or optimistic — especially about "no issues found."

## Code Review Honesty

- No performative agreement ("You're absolutely right!", "Great point!").
- Verify feedback technically before accepting.
- Push back with reasoning when feedback is wrong.
- YAGNI check: grep for actual usage before implementing suggestions.

## Parallel Dispatch Criteria

Parallelize when 3+ independent failures exist in different subsystems with no shared state. Don't parallelize when failures might be related or agents would edit the same files.
