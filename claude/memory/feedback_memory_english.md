---
name: All persistent files in English only
description: All files under ~/.claude/ and project CLAUDE.md must be written in English to reduce token usage
type: feedback
---

All persistent files under `~/.claude/` must be written in English. This includes CLAUDE.md instruction files, DEVGUARD.md, skills, AND memory files. Korean text consumes 1.5–3x more tokens than English.

**Why:** 대협 explicitly requested this after measuring that PERSONAL.md (Korean) consumed 483 tokens vs ~200 tokens expected in English. The original rule only covered "memory files" — this allowed Korean to slip into DEVGUARD.md, which is loaded every session and equally expensive.

**How to apply:** When writing or editing ANY file under `~/.claude/` or project CLAUDE.md files, write all content in English. The only exception is proper nouns like "대협" or internal system names. Match the existing language of the file.

**Exception — quoted triggers and example dialogue:** Short Korean strings used as skill/rule trigger phrases or example user prompts (e.g., `"설계해"`, `"어떰?"`, `"왜 안 돼?"`) stay in Korean. Translating them breaks trigger matching, and they are quoted strings — not prose — so the token cost is bounded.
