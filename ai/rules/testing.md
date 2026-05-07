---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test/**"
  - "**/tests/**"
  - "**/__tests__/**"
  - "**/test_*.*"
  - "**/*_test.*"
---

# Test Discipline

## Test Awareness

In a test-enabled project, if your response adds or modifies a function/class but does not include test code, append:
`⚠️ test framework detected but no tests written for this change.`

## TDD Discipline

When TDD is required: **No production code without a failing test first.** No exceptions.

Follow strict RED-GREEN-REFACTOR: write failing test → run and watch fail → simplest passing code → run and watch pass → refactor while green → commit. Never skip running tests.
