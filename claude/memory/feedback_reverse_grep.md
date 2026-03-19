---
name: Reverse grep after file modification
description: After modifying a file, grep for references to that file across the project to catch sync issues
type: feedback
---

After modifying any config/rule/instruction file, run a reverse reference search (e.g., `grep -r "FILENAME"`) to find other files that reference or depend on the changed file.

**Why:** DEVGUARD.md was slimmed down but self-review.md (which had `<!-- Keep checklist in sync with DEVGUARD.md -->`) was not checked. A single grep would have caught this and also revealed a pre-existing MEMORY.md sync gap.

**How to apply:** Treat it as a concrete step within PERSONAL.md's "Side effects" check. After any file edit, before claiming completion, grep for the filename across the project.
