# Codex CLI Dotfiles — `~/.config/codex/`

Codex-only deploy logic and Codex-native files. Shared content lives in [`../ai/`](../ai/README.md).

## Structure

```
codex/
├── DEVGUARD.md                 # Codex-only instruction addendum appended to ~/.codex/AGENTS.md
├── config.toml.template        # Keys ENFORCED on every bootstrap (deep-merged into ~/.codex/config.toml)
├── hooks/                      # Codex hook commands
├── skills/                     # Codex-native skills (codex-* prefix)
│   ├── codex-ask-claude/       # Codex-only skill; invokes as `ask-claude`
│   └── codex-worktree/         # Codex-only skill; invokes as `worktree`
└── scripts/
    ├── bootstrap.sh            # Build AGENTS.md, deep-merge config.toml, overlay skills
    ├── mcp-secret-env.sh       # Load MCP env from the OS secret store, then exec server
    ├── mcp-secret-set.sh       # Store one MCP env value in the OS secret store
    ├── pre-commit-sensitive-scan.sh  # Read-only staged-diff sensitive-info scan
    └── sync-back.sh            # Stub (Codex side has no editable artifacts to sync back)
```

## Bootstrap behavior

Called from `ai/scripts/bootstrap.sh` (or directly).

1. **`~/.codex/AGENTS.md`** built from `ai/AGENTS.manifest`:
   - concat sources in manifest order
   - frontmatter stripped per-file
   - tokens sed-expanded for Codex (`{{TOOL_HOME}}` → `~/.codex`, `{{PLAN_DIR}}` → `.agents/plans`, etc.)
   - sized against `project_doc_max_bytes` — warns/fails if over cap
   - appends `codex/DEVGUARD.md` as the Codex-only addendum
   - `AUTO-GENERATED` header — direct edits are lost

2. **`~/.codex/config.toml`** deep-merged with `config.toml.template`:
   - first deploy: `cp template target`
   - subsequent: `yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1) | del(.UserPromptSubmit, .PreToolUse, .PostToolUse, .PreCompact, .SessionStart, .Stop, .PermissionRequest)' target template` — template keys override, legacy top-level hook arrays are removed, and user/machine keys (trust levels, NUX counters, `[mcp_servers.*]`, `[notice]`, etc.) survive untouched
   - depends on `yq` (mikefarah)

3. **`~/.agents/skills/`** overlayed (note: not `~/.codex/skills/` — Codex discovery path is `~/.agents/skills/`):
   - per-skill symlinks from `ai/skills/*/`, `ai/skills/private/*/`, `codex/skills/*/`
   - existing user-added (non-symlink) entries preserved
   - plan/state artifacts are not deployed here; repo-local `.agents/plans` and `.agents/state` are sibling directories

## What's enforced via template

`config.toml.template` declares the keys that should always match the repo:

- `project_doc_max_bytes` (sets the AGENTS.md cap, default 65536)
- `[tui].theme`
- `[tui].vim_mode_default`
- `[tui].status_line_use_colors`
- `[tui].status_line`
- `[tui].terminal_title`
- Codex safety, context-mode, quality gate, and notification hooks
- `[notice].fast_default_opt_out`

Everything else under `~/.codex/config.toml` is user/machine-managed and is preserved across bootstraps.

## Status Line

Codex 0.133.0 supports built-in status line items only. `config.toml.template` keeps the footer compact by prioritizing model, run state, `task-progress`, context, quota, current directory, and git branch. Wider duplicate or low-signal items stay out of the footer to avoid truncation.

The current Codex CLI does not support a Claude-style external status command. Local plan frontmatter such as `.agents/plans/*` `draft` or `active` cannot be rendered directly in the Codex footer without a Codex TUI feature or fork. Use `task-progress` as the closest built-in signal.

## MCP servers

Local-only — `[mcp_servers.*]` blocks are managed by hand in `~/.codex/config.toml`. The bootstrap deep-merge preserves them.

MCP secrets must not be stored as plaintext `[mcp_servers.<name>.env]` tables. Store them in the OS secret store:

```sh
printf '%s' "$VALUE" | ~/.config/codex/scripts/mcp-secret-set.sh <profile> <KEY>
```

Then wrap the MCP server command with:

```toml
[mcp_servers.<name>]
command = "$HOME/.config/codex/scripts/mcp-secret-env.sh"
args = ["<profile>", "--", "/path/to/server", "stdio"]
```

Verify with `codex mcp list`.

## Skills

Codex discovers skills at `~/.agents/skills/` (note: `.agents/`, not `.codex/`). The bootstrap overlay merges three sources into that directory:

- `ai/skills/<name>/` — shared (15)
- `ai/skills/private/<name>/` — shared but gitignored (kafdrop-hunt, track-logging)
- `codex/skills/codex-<id>/` — Codex-only (2: `ask-claude`, `worktree`)

Repo-local plans and state use `.agents/plans` and `.agents/state`; do not place them under `.agents/skills`.

## Codex-only instructions

`codex/DEVGUARD.md` is appended to generated `~/.codex/AGENTS.md` after shared `ai/` content. Use it for Codex-specific invocation paths only; shared policy stays in `ai/`.

Commit-time sensitive-info scanning uses `codex/scripts/pre-commit-sensitive-scan.sh`. Run it before `git commit` in 대협-owned repos and surface any `FAIL` or `WARN` before committing.

## Hooks

Codex hook blocks are enforced through `config.toml.template`.

- `UserPromptSubmit` → `prompt-guard.sh` blocks high-confidence secrets before submission.
- `UserPromptSubmit` → `inject-context.sh` injects `.agents/state/current.txt` when it points to a `draft` or `active` plan.
- `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SessionStart` → `context-mode.sh` forwards supported Codex hook events to `context-mode-go`.
- `PreToolUse` → `protect-files.sh` blocks sensitive file and lockfile access.
- `PostToolUse` → `post-edit-pipeline.sh` runs bounded format/check feedback after edits.
- `PostToolUse` → `context-monitor.sh` emits context usage warnings when Codex supplies usage metrics.
- `Stop` → `stop-gate.sh` runs the final quality gate and then sends task completion or review-needed notifications.
- `PermissionRequest` → `codex/hooks/notify.sh approval` sends approval notifications.

Notifications use the shared AgentNotifier socket and sender from `notifier/`.

Skill SKILL.md files use the same frontmatter as Claude (`name`, `description`, ...). Codex ignores unknown frontmatter keys (live-validated). Tool-specific directories keep the `codex-` prefix for ownership, while `name:` is the user-facing invocation/display name and may omit that prefix.

## Prerequisites

- `codex` (≥ 0.128.0) — `brew install codex` or via OpenAI Codex install instructions
- `yq` (mikefarah) — required for config.toml deep merge: `brew install yq`
- `go` — optional, for shared AgentNotifier sender/Linux daemon build
- Authentication via `codex login` (OpenAI Enterprise SSO supported)

## Sandbox

Codex skills that write to disk should declare the required sandbox in their SKILL.md `Rules` section. The `worktree` skill (`codex/skills/codex-worktree`) writes to `.git/config`, `.env`, `node_modules/`, so it documents `-s workspace-write --add-dir .codex/worktrees`.
