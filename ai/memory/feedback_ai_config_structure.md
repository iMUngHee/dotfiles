---
name: ai config structure (3-tier, prefix, token, deploy, manifest)
description: Core rules for ~/.config/ai/, claude/, codex/ — layout, deploy model, prefix convention, AGENTS.manifest ordering, and double-mustache token substitution. Token rules MUST be read first to enable later tokens.
type: feedback
---

## Layout — 3-tier
`~/.config/` uses 3 tiers: `ai/` (shared content), `claude/` and `codex/` (tool-native content). New files go where their dependency lives.

## Native prefix convention
Files inside `claude/` or `codex/` get a `claude-` / `codex-` prefix. Files in `ai/` have no prefix.

## Deploy model
- Claude: reads `ai/` via symlink overlay with in-context token substitution.
- Codex: receives `ai/` as concat+sed-expanded `AGENTS.md`. `MEMORY.md` is auto-generated.
- Edit `ai/` originals only — never directly edit the generated copies or symlink targets.

## AGENTS.manifest
`ai/AGENTS.manifest` controls the concat order of `ai/*.md` into `~/.codex/AGENTS.md`. Update the manifest whenever a new `ai/*.md` is added or removed. Token-substitution memory MUST be the first entry so later tokens can resolve.

## Token substitution
`ai/` files use `{{double-mustache}}` placeholders for tool-varying paths/names. Replace with actual values when referencing, writing, or executing commands containing them.
