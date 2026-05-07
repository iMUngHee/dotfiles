---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.py"
  - "**/*.go"
  - "**/*.rs"
  - "**/*.java"
  - "**/*.kt"
  - "**/*.swift"
  - "**/*.c"
  - "**/*.cpp"
  - "**/*.h"
  - "**/*.lua"
  - "**/*.sh"
  - "**/*.vue"
  - "**/*.svelte"
---

# Rationalization Resistance

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
