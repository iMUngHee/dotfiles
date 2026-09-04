---
name: claude-feedback_skill_model_frontmatter_noop
description: Skill frontmatter `model:` is ignored unless the skill sets `context: fork` (Claude Code 2.1.260, measured in -p and interactive); `effort:` is honored inline. Removed from every skill 2026-09-04 — do not re-add without fork.
metadata:
  type: feedback
---

A probe skill with `model: haiku` and body "reply MODELTEST OK" ran under a `claude-fable-5-1` session in four ways. Direct `/modeltest` and Skill-tool auto-invocation both billed only `claude-fable-5-1` (`modelUsage` in the `-p --output-format json` result; interactive `/modeltest` → Usage panel showed a single `claude-fable-5-1` line). Only with `context: fork` did `claude-haiku-4-5-20251001` appear — alone for a direct call, alongside the session model for an auto-invocation. The docs row (code.claude.com/docs/en/skills, `model`: "applies for the rest of the current turn") describes behavior that does not occur without fork.

`effort:` behaves differently: a skill whose body prints `${CLAUDE_EFFORT}` returned `low` with `effort: low` in every path (inline direct, inline auto, fork) and `xhigh` — the `settings.json` `effortLevel` — without the field. A reasoning probe confirmed the override reaches the model, not just Claude Code's state: with `effort: low` the reply carried no thinking block and ~115 output tokens; the no-field control thought first and used 364–430 (two runs each). Side effect worth knowing: at `low` the probe ignored an exact-output-format instruction both times.

**Why:** 27 skills carried `model: sonnet` (cost) or `model: opus` (capability) that never took effect — every one ran on the session model. Dead config misleads audits and cost reasoning, so all 27 lines were removed on 2026-09-04 (23 `ai/skills`, 2 `ai/skills/private`, 2 `claude/skills`); `effort:` lines stayed. The field was introduced with the first skills in 2026-03 (`31dfb76`, `8a28e6f`) as scaffolding, with no recorded rationale.

**How to apply:** do not put `model:` on a skill unless it also has `context: fork` — and then it runs as a subagent without the conversation. Use `effort:` for cost or depth control; it works inline. Re-measure after a Claude Code upgrade: a `model: haiku` probe skill plus `claude -p "/probe" --output-format json` and a look at `modelUsage` takes about twenty seconds. The measurement contract in `ai/skills/config-audit/references/skill-authoring.md` records the same finding.
