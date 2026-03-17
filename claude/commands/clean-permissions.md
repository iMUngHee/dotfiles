---
description: "Review and clean up accumulated one-off permission entries in the project's settings.local.json"
allowed-tools: Read, Bash, Edit, Write, Glob
---

Clean up the project-level `settings.local.json` permission allow list.

## Instructions

1. **Find the target file.** Run `claude config list --json 2>/dev/null` or locate the project's `.claude/settings.local.json` relative to the current working directory. If not found, report and stop.

2. **Read both files:**
   - The project's `settings.local.json` (target to clean)
   - `~/.claude/settings.json` (global baseline — entries here never need to be in local)

3. **Categorize every entry** in the local allow list into one of these buckets:

   | Bucket        | Criteria                                                                                                 | Action                               |
   | ------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
   | **Redundant** | Already covered by a global `settings.json` pattern (exact match or wildcard superset)                   | Remove                               |
   | **One-off**   | Contains specific file paths, test strings, task IDs, or literal command lines with no wildcard          | Remove (recommend)                   |
   | **Reusable**  | Generic wildcard patterns (`Bash(gh:*)`, `WebFetch(domain:...)`, `mcp__*` tools) that are broadly useful | Keep, or suggest promoting to global |

4. **Present the analysis** as a table, grouped by bucket. For "One-off" entries, briefly explain why each is considered disposable.

5. **Ask for confirmation** before making changes. Wait for explicit approval. Offer three options:
   - **A) Full clean**: Remove all Redundant + One-off entries
   - **B) Selective**: Let the user pick which One-off entries to keep
   - **C) Promote + clean**: Move Reusable entries to global `settings.json`, then remove everything from local

6. **Apply changes** based on the user's choice. Rewrite `settings.local.json` preserving other keys (`outputStyle`, `spinnerTipsEnabled`, etc.).

7. **Verify** by reading the file back and showing the final allow list.
