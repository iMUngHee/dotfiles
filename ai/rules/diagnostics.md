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

# Diagnostic Discipline

When investigating any issue (bug, config problem, unexpected behavior):

1. **State hypothesis BEFORE investigating**: "Hypothesis: [X] because [observable evidence]"
2. **Simplest, most local cause first**: config issue → check that file first (never blame framework). Runtime error → direct cause from the error message first
3. **One hypothesis at a time**: do not move to the next hypothesis before verifying the current one
4. **Wrong? Full reset**: do not patch on top of a wrong hypothesis — restart analysis from scratch

## Debugging Escalation (3-Strike Rule)

If 3 consecutive fix attempts fail for the same issue: (1) Stop patching (2) Question whether the approach itself is wrong (3) Consider architecture-level problems (4) Report to 대협 before continuing.

For structured debugging, use the `/debug` skill.
