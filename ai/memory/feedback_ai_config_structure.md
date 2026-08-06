---
name: ai config structure (3-tier, prefix, token, deploy, manifest)
description: ~/.config 3-tier (ai/claude/codex): layout, deploy model, prefix, AGENTS.manifest order, token substitution. Must load first.
type: feedback
---

## Layout — 3-tier
`~/.config/` uses 3 tiers: `ai/` (shared content), `claude/` and `codex/` (tool-native content). New files go where their dependency lives.

## Native prefix convention
Files inside `claude/` or `codex/` get a `claude-` / `codex-` prefix. Files in `ai/` have no prefix.

When a `claude-`/`codex-` skill becomes identical across tools, **unify it into `ai/skills/<name>/`** (shared, no prefix) and keep only the platform-specific bits as dual `Claude:` / `Codex:` notes — the pattern `verify`/`design`/`worktree` use (e.g. worktree's sandbox invocation: Claude `dangerouslyDisableSandbox` vs Codex `-s workspace-write`). Don't keep near-duplicate per-tool skills. Note: `ai/` skills must stay tool-agnostic (no `EnterWorktree`/`EnterPlanMode`/`~/.claude`-only refs).

## Deploy model
- Claude: reads `ai/` via symlink overlay with in-context token substitution.
- Codex: receives `ai/` as concat+sed-expanded `AGENTS.md`. `MEMORY.md` is auto-generated.
- Exception: `~/.claude/CLAUDE.md` is **copied**, not symlinked, so its `@imports` resolve inside `~/.claude/`. Edit `claude/CLAUDE.md` and re-run bootstrap — a direct edit of the deployed copy is silently overwritten and no hook blocks it (the generated-artifact marker is absent by design).
- Edit `ai/` originals only — never directly edit the generated copies or symlink targets.

## AGENTS.manifest
`ai/AGENTS.manifest` controls the concat order of `ai/*.md` into `~/.codex/AGENTS.md`. Update the manifest whenever a new `ai/*.md` is added or removed. Token-substitution memory MUST be the first entry so later tokens can resolve.

## Token substitution
`ai/` files use `{{double-mustache}}` placeholders for tool-varying paths/names. Replace with actual values when referencing, writing, or executing commands containing them.

Shared plan/state tokens are intentionally tool-agnostic:
- `PLAN_DIR` placeholder -> `.agents/plans`
- `STATE_DIR` placeholder -> `.agents/state`

(The `ROADMAP` token was retired with the pm task-first redesign — the backlog now lives per-task under `.agents/tasks/<KEY>/`, no single `ROADMAP.md`.)

Codex skill discovery uses `.agents/skills`. Keep `.agents/plans`, `.agents/state`, `.agents/tasks/`, and `.agents/skills` as separate siblings.
