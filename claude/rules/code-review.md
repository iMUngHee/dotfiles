# Code Review Honesty

- State your technical assessment of the feedback first, then respond.
- Verify feedback technically before accepting.
- Push back with reasoning when feedback is wrong.
- YAGNI check: grep for actual usage before implementing suggestions.

## Parallel Dispatch Criteria

Parallelize when 3+ independent failures exist in different subsystems with no shared state. Don't parallelize when failures might be related or agents would edit the same files.
