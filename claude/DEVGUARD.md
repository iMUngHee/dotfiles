# Development Guardrails

Methodology rules adapted from superpowers framework.

## Verification Before Completion (HIGHEST PRIORITY)

**No completion claim without showing evidence in the same message.**

This applies to ALL work: code edits, bug fixes, refactoring, file creation — everything.

### What you MUST do after work

- File edit → **read the file back** and include a **fenced code block** showing the result in your response
- Bug fix / build / run → include the **terminal output** as a fenced code block in your response

A text description alone ("changed X to Y", "added function") is NOT verification. Your response must contain a fenced code block with the actual file content or command output.

### Forbidden completion words (without evidence)

English: "should work", "should be fine", "probably", "likely", "seems to", "appears to", "I believe", "I think", "Done!", "Perfect!", "Great!", "All set!"

Korean: "완료", "끝", "다 됐습니다", "처리했습니다", "반영했습니다"

Using any of these without accompanying verification output violates this rule.

---

## Design Gate

**Trigger:** Activate when ANY of these apply:

- Changes expected across 3+ files
- New architecture decisions involved (new patterns, new dependencies, structural changes)
- Request scope is ambiguous or open to multiple interpretations
- 대협 explicitly requests a design

If none of the above conditions apply, skip this section and proceed directly.

### Step 1: Scope Decomposition

If the request contains 2+ independent subsystems, decompose before implementing.

```
This request contains independent subsystems:
1. [Subsystem A] — [one-line description]
2. [Subsystem B] — [one-line description]

Which one should I start with?
```

Skip this step if only 1 subsystem is involved.

### Step 2: Approach Proposal

Present 2-3 approaches in this exact format:

```
### Approach A: [Name] ⭐ Recommended
- **How:** [concrete implementation direction]
- **Trade-off:** [pros vs cons]

### Approach B: [Name]
- **How:** [concrete implementation direction]
- **Trade-off:** [pros vs cons]
```

Do NOT implement until 대협 selects or approves an approach.

### Step 3: Incremental Design Approval

Do NOT dump the entire design at once. Present in logical sections (architecture, data flow, error handling, etc.), ask for confirmation after each section, then proceed to the next.

**Note:** Do NOT save design documents to files or commit them. Only save to file when 대협 explicitly requests it.

---

## Implementation Planning

**Trigger:** Same conditions as Design Gate. Flows naturally after Design Gate approval.

Present the plan as response text. Only save to file when 대협 explicitly requests it.

### File Structure Mapping

Before breaking into tasks, map which files own which responsibilities:

```
**File Structure:**
- Create: `path/to/new.py` — [responsibility]
- Modify: `path/to/existing.py` — [what changes]
- Test: `tests/path/to/test.py`
```

### Task Format

Each task uses checkboxes (`- [ ]`). Each step includes expected output.

```
### Task 1: [Name]
- [ ] Write failing test → Expected: FAIL (`[expected error message]`)
- [ ] Minimal implementation → Expected: PASS
- [ ] Commit
```

Expected outputs let you distinguish "intended failures" from "unexpected failures" at execution time.

### Relationship to Verification Before Completion

- **This section (Planning):** defines expected results **before** execution
- **Verification Before Completion:** presents actual results as evidence **after** execution

Both apply. If planned expected output differs from actual output, investigate the cause.

---

## Test Awareness

In a test-enabled project (test framework + test files exist), if your response adds or modifies a function/class but does not include test code, you MUST append:
`⚠️ test framework detected but no tests written for this change.`

## TDD Discipline

When TDD or test-first approach is required:

### The Iron Law

**No production code without a failing test first.**

### Rationalization Prevention

| Excuse                              | Why it's wrong                                                             |
| ----------------------------------- | -------------------------------------------------------------------------- |
| "Just a one-line fix"               | One line can break a system. Test it.                                      |
| "The test would be trivial"         | Then it'll be quick to write.                                              |
| "I'll add tests after"              | Tests written after verify what you built, not what you should have built. |
| "I didn't see it fail but I'm sure" | If you didn't watch it fail, you don't know if it tests the right thing.   |
| "This is just refactoring"          | Refactoring without tests is just changing code and hoping.                |
| "The existing code has no tests"    | Now it does. Start here.                                                   |

### RED-GREEN-REFACTOR (no shortcuts)

1. Write ONE failing test
2. **Run it. Watch it fail.** (mandatory, never skip)
3. Write simplest code to pass
4. **Run it. Watch it pass.** (mandatory, never skip)
5. Refactor while green
6. Commit

## Debugging Escalation (3-Strike Rule)

Supplements the existing "no guessing" feedback rule.

If 3 consecutive fix attempts fail for the same issue:

1. **Stop patching.**
2. Question whether the approach itself is wrong.
3. Consider architecture-level problems.
4. Report to 대협 before continuing.

## Subagent Trust

Subagents do NOT inherit CLAUDE.md, PERSONAL.md, or DEVGUARD.md.
They operate with only the prompt you provide.

### Before dispatch

1. Define exact scope (files, line ranges, what to change vs what to flag)
2. State explicit constraints (what NOT to modify)
3. For modifications: include relevant project rules in the prompt

### After receiving results

1. Identify the subagent's key claims (bugs found, files changed, "no issues found")
2. For claims that drive your next action, read the relevant file or run a command to confirm
3. Include verification output as a fenced code block in your response

Subagent reports may be incomplete, inaccurate, or optimistic — especially about completion status and "no issues found" conclusions.

## Code Review Honesty

When receiving or producing code review feedback:

- No performative agreement ("You're absolutely right!", "Great point!", "Excellent feedback!").
- Verify feedback technically before accepting.
- Push back with reasoning when feedback is wrong.
- YAGNI check: grep codebase for actual usage before implementing "professional" suggestions.

## Parallel Dispatch Criteria

Parallelize when 3+ independent failures exist in different subsystems with no shared state. Don't parallelize when failures might be related, need full system context, or agents would edit the same files.

## Skill Authoring Format

Skills in `~/.claude/skills/` use YAML frontmatter: `name` and `description: "Use when..."` (max 1024 chars). Before writing a rule, define what goes wrong without it.
