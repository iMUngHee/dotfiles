---
name: Reverse grep after file modification
description: After editing a config/rule file, or code that documents describe, grep for what refers to it to catch sync gaps.
type: feedback
---

After modifying any config/rule/instruction file, run a reverse reference search (e.g., `grep -r "FILENAME"`) to find other files that reference or depend on the changed file.

The same holds from code to documents: after removing or renaming something a document can name — a command, a flag, a file, an output format, a numbered step — grep the tracked `*.md` files for the old name, including other skills and the agents that call or are called by the changed one.

**Why:** DEVGUARD.md was slimmed down but self-review.md (which had `<!-- Keep checklist in sync with DEVGUARD.md -->`) was not checked. A single grep would have caught this and also revealed a pre-existing MEMORY.md sync gap.

The 2026-11-16 content audit found some twenty stale claims that all arose this way: a `focus` command removed from `pm-roadmap.ts` while `design` and `retro` still named it, a reviewer agent whose output format no longer matched the validator in `code-review`.

**How to apply:** Treat it as a concrete step within PERSONAL.md's "Side effects" check. After any file edit, before claiming completion, grep for the filename across the project.
