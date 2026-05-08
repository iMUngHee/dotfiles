# Codex CLI Dotfiles — `~/.config/codex/`

Codex-only deploy logic and Codex-native files. Shared content lives in [`../ai/`](../ai/README.md).

## Structure

```
codex/
├── config.toml.template        # Keys ENFORCED on every bootstrap (deep-merged into ~/.codex/config.toml)
├── skills/                     # Codex-native skills (codex-* prefix)
│   └── codex-worktree/         # git worktree create + dep install (Codex sandbox-aware)
└── scripts/
    ├── bootstrap.sh            # Build AGENTS.md, deep-merge config.toml, overlay skills
    └── sync-back.sh            # Stub (Codex side has no editable artifacts to sync back)
```

## Bootstrap behavior

Called from `ai/scripts/bootstrap.sh` (or directly).

1. **`~/.codex/AGENTS.md`** built from `ai/AGENTS.manifest`:
   - concat sources in manifest order
   - frontmatter stripped per-file
   - tokens sed-expanded for Codex (`{{TOOL_HOME}}` → `~/.codex`, `{{PLAN_DIR}}` → `.codex/plans`, etc.)
   - sized against `project_doc_max_bytes` — warns/fails if over cap
   - `AUTO-GENERATED` header — direct edits are lost

2. **`~/.codex/config.toml`** deep-merged with `config.toml.template`:
   - first deploy: `cp template target`
   - subsequent: `yq '. *= load(template)' target` — template keys override; user/machine keys (trust levels, NUX counters, `[mcp_servers.*]`, `[notice]`, etc.) survive untouched
   - depends on `yq` (mikefarah)

3. **`~/.agents/skills/`** overlayed (note: not `~/.codex/skills/` — Codex discovery path is `~/.agents/skills/`):
   - per-skill symlinks from `ai/skills/*/`, `ai/skills/private/*/`, `codex/skills/*/`
   - existing user-added (non-symlink) entries preserved

## What's enforced via template

`config.toml.template` declares the keys that should always match the repo:

- `project_doc_max_bytes` (sets the AGENTS.md cap, default 65536)
- `[tui].theme`

Everything else under `~/.codex/config.toml` is user/machine-managed and is preserved across bootstraps.

## MCP servers

Local-only — `[mcp_servers.*]` blocks are managed by hand in `~/.codex/config.toml`. The bootstrap deep-merge preserves them. Each block:

```toml
[mcp_servers.<name>]
command = "..."
args = ["..."]

[mcp_servers.<name>.env]
FOO = "..."
```

Verify with `codex mcp list`.

## Skills

Codex discovers skills at `~/.agents/skills/` (note: `.agents/`, not `.codex/`). The bootstrap overlay merges three sources into that directory:

- `ai/skills/<name>/` — shared (15)
- `ai/skills/private/<name>/` — shared but gitignored (kafdrop-hunt, track-logging)
- `codex/skills/codex-<name>/` — Codex-only (1: codex-worktree)

Skill SKILL.md files use the same frontmatter as Claude (`name`, `description`, ...). Codex ignores unknown frontmatter keys (live-validated).

## Prerequisites

- `codex` (≥ 0.128.0) — `brew install codex` or via OpenAI Codex install instructions
- `yq` (mikefarah) — required for config.toml deep merge: `brew install yq`
- Authentication via `codex login` (OpenAI Enterprise SSO supported)

## Sandbox

Codex skills that write to disk should declare the required sandbox in their SKILL.md `Rules` section. `codex-worktree` writes to `.git/config`, `.env`, `node_modules/`, so it documents `-s workspace-write --add-dir .codex/worktrees`.
