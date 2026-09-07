---
name: All persistent files in English only
description: All AI-config files (instructions, guardrails, rules, skills, memory) stay in English for one-language consistency and greppability; only the address 대협, proper nouns, and strings 대협 types or reads verbatim stay Korean.
type: feedback
---

All persistent AI-assistant config files are written in English: the global instructions file ({{INSTRUCTIONS_FILE}}), guardrails, rules, skills, and memory files.

**Why:** 대협 keeps the whole `~/.config/{ai,claude,codex}` tree in one language on purpose. Vendored skill families, the `ai/lib` contract tests, and the config-audit reporter match English phrases, and one language keeps files greppable and stops mixed-language drift between tiers. The original reason — Korean costing 1.5–3x the tokens of English on 200K-context models — no longer applies on 1M-context models; 대협 re-confirmed English-only on 2026-09-07 with this rationale in its place.

**How to apply:** When writing or editing any file under `~/.config/ai/`, `{{TOOL_HOME}}/`, or a project {{INSTRUCTIONS_FILE}}, write in English and match the existing language of the file. Exceptions: the address 대협, proper nouns and system names, and strings 대협 types or reads verbatim (the `(추천)` label, the `어떰?` scope trigger, self-review's feasibility labels). Skill descriptions carry no Korean trigger lists — routing is semantic on both tools (see config-audit's skill-authoring.md).
