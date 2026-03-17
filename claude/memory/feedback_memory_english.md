---
name: All persistent files in English only
description: All files under ~/.claude/ (CLAUDE.md, DEVGUARD.md, skills, memory, etc.) must be written in English to reduce token usage
type: feedback
---

All persistent files under `~/.claude/` must be written in English. This includes CLAUDE.md instruction files, DEVGUARD.md, skills, AND memory files. Korean text consumes 1.5–3x more tokens than English.

**Why:** 대협 explicitly requested this after measuring that PERSONAL.md (Korean) consumed 483 tokens vs ~200 tokens expected in English. The original rule only covered "memory files" — this allowed Korean to slip into DEVGUARD.md, which is loaded every session and equally expensive.

**How to apply:** When writing or editing ANY file under `~/.claude/` (instructions, skills, memory, hooks docs), write all content in English. The only exception is proper nouns like "대협" or internal system names that have no English equivalent. Also follow the existing language of the file — if a file is already in English, new additions must match.
