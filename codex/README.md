# Codex CLI Dotfiles — `~/.config/codex/`

Codex-only deploy logic and Codex-native files. Shared content lives in [`../ai/`](../ai/README.md).

## Structure

```
codex/
├── DEVGUARD.md                 # Codex-only instruction addendum appended to ~/.codex/AGENTS.md
├── config.toml.template        # Keys ENFORCED on every bootstrap (deep-merged into ~/.codex/config.toml)
├── hooks/                      # Codex hook commands
├── skills/                     # Codex-native skills (codex-* prefix)
│   └── codex-ask-claude/       # Codex-only skill; invokes as `ask-claude`
└── scripts/
    ├── bootstrap.sh            # Build AGENTS.md, deep-merge config.toml, overlay skills, prune bundled skills
    ├── mcp-secret-env.sh       # Load MCP env from the OS secret store, then exec server
    ├── mcp-secret-set.sh       # Store one MCP env value in the OS secret store
    ├── pre-commit-sensitive-scan.sh  # Read-only staged-diff sensitive-info scan
    └── sync-back.sh            # Stub (Codex side has no editable artifacts to sync back)
```

## Bootstrap behavior

Called from `ai/scripts/bootstrap.sh` (or directly).

1. **`~/.codex/AGENTS.md`** built from `ai/AGENTS.manifest`:
   - concat sources in manifest order
   - append local `ai/memory/private/*.md` files not already in the manifest; private filenames stay out of tracked files and a missing directory is skipped
   - frontmatter stripped per-file
   - tokens sed-expanded for Codex (`{{TOOL_HOME}}` → `~/.codex`, `{{PLAN_DIR}}` → `.agents/plans`, etc.)
   - sized against `project_doc_max_bytes` — warns/fails if over cap
   - appends `codex/DEVGUARD.md` as the Codex-only addendum
   - `AUTO-GENERATED` header — direct edits are lost

2. **`~/.codex/config.toml`** deep-merged with `config.toml.template`:
   - first deploy: `cp template target`
   - subsequent: `yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1) | del(...)' target template` — template keys override; the retired `experimental_network` table and legacy top-level hook arrays are removed; other user/machine keys (trust levels, NUX counters, `[mcp_servers.*]`, `[notice]`, etc.) survive
   - depends on `yq` (mikefarah)

3. **`~/.agents/skills/`** overlayed (note: not `~/.codex/skills/` — Codex discovery path is `~/.agents/skills/`):
   - per-skill symlinks from `ai/skills/*/`, `ai/skills/private/*/`, `codex/skills/*/`
   - unrelated user-added entries preserved; real entries sharing a managed skill name and all old `.stale.*` copies are archived under `~/.agents/skill-backups/`, outside skill discovery
   - plan/state/task artifacts are not deployed here; repo-local `.agents/plans`, `.agents/state`, and `.agents/tasks/` are sibling entries

4. **Bundled Codex system skills disabled by default**:
   - `~/.codex/skills/.system/.codex-system-skills.marker` is preserved
   - bundled skill directories under `~/.codex/skills/.system/` are removed
   - user skills under `~/.agents/skills/`, `ai/skills/`, and `codex/skills/` are unaffected
   - set `CODEX_DISABLE_SYSTEM_SKILLS=0` before bootstrap to keep bundled skills

## What's enforced via template

`config.toml.template` declares the keys that should always match the repo:

- `project_doc_max_bytes` (sets the AGENTS.md cap, default 65536)
- `approval_policy` + `approvals_reviewer` + `sandbox_mode` (default startup automation = maximum local autonomy: no approvals + no sandbox)
- `[features]` disables default apps/plugins and skill MCP dependency install prompts
- `[tui].theme`
- `[tui].vim_mode_default`
- `[tui].status_line_use_colors`
- `[tui].status_line`
- `[tui].terminal_title`
- Codex safety, quality gate, and notification hooks
- `[notice].fast_default_opt_out`

Everything else under `~/.codex/config.toml` is user/machine-managed and is preserved across bootstraps.
Model and reasoning effort are local choices: the template never sets `model` or `model_reasoning_effort`, so bootstrap preserves the values selected on each machine.

The template also declares the opt-in `workspace-local-sockets` permission profile, extending `:workspace` with the notification socket and the current user's two tmux socket paths. Bootstrap expands the UID locally. Select it with `codex -c 'default_permissions="workspace-local-sockets"'`; an invocation override selects this profile over the legacy `sandbox_mode` in the user config (verified with Codex 0.163.0). The normal invocation keeps `danger-full-access`. Merely passing `--sandbox workspace-write` does not select the custom profile. On macOS with Codex 0.163.0 the profile does not yet grant the sockets: all three paths return EPERM because the allowlist never reaches Seatbelt (openai/codex#25416), while `codex sandbox -P workspace-local-sockets --allow-unix-socket <path>` does reach them. Windows validation only confirms configuration loading and policy selection.

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

- `ai/skills/<name>/` — shared (19)
- `ai/skills/private/<name>/` — shared but gitignored (kafdrop-hunt, track-logging)
- `codex/skills/codex-<id>/` — Codex-only (1: `ask-claude`)

Repo-local artifacts use `.agents/plans`, `.agents/state`, and `.agents/tasks/` (per-task backlog/closed/links/memory); do not place them under `.agents/skills`.

Codex also auto-installs bundled system skills such as `skill-creator` under `~/.codex/skills/.system/`. Bootstrap disables those by preserving the marker file and pruning the bundled skill directories, so custom skills remain available without the default bundled skills appearing in the model prompt.

## Codex-only instructions

`codex/DEVGUARD.md` is appended to generated `~/.codex/AGENTS.md` after shared `ai/` content. Use it for Codex-specific invocation paths only; shared policy stays in `ai/`.

Commit-time sensitive-info scanning uses `codex/scripts/pre-commit-sensitive-scan.sh`. Run it before `git commit` in 대협-owned repos and surface any `FAIL` or `WARN` before committing.

## Hooks

Codex hook blocks are enforced through `config.toml.template`.
On Windows, every shell hook uses `command_windows` to pass stdin through `run-bash-hook.ps1` into Git Bash; direct `.sh` execution is not supported by PowerShell.

- `UserPromptSubmit` → `prompt-guard.sh` blocks high-confidence secrets before submission.
- `UserPromptSubmit` → `inject-context.sh` resolves the exact Codex session binding through `ensure-session`, permits only checkout-local legacy normalization, and injects the bound draft/active plan within a 30-second bound. An unbound main session is plan-free, `current.txt` is launcher-only, and the shared restored/compacted-summary continuation guard is delivered; direct `resolve-session` remains read-only.
- The enforced desktop sync policy keeps every current Claude import category except `HOOKS`; bootstrap also backs up any previously imported `~/.codex/hooks.json` and `~/.codex/hooks/` layer so `config.toml` remains the single hook source.
- `PreToolUse` → `protect-files.sh` blocks sensitive file and lockfile access.
- `PostToolUse` → `post-edit-pipeline.sh` runs bounded format/check feedback after edits.
- `Stop` → `stop-gate.sh` runs the final quality gate and then sends task completion or review-needed notifications.
- `PermissionRequest` → `codex/hooks/notify.sh approval` sends approval notifications.

The Stop gate uses staged, unstaged, and untracked files to select suites; only tracked changes may be auto-formatted. Selected suites share a 300-second budget, followed by at most 30 seconds for the type checker; the hook registration allows 360 seconds. Repository matching compares directory identity so Git's Windows paths and Git Bash paths select the same checks.

Hook stdout follows the Codex 0.163.0 event schemas. PostToolUse returns one JSON
object with `hookSpecificOutput.hookEventName = "PostToolUse"` and
`hookSpecificOutput.additionalContext` containing all formatter/checker feedback;
quiet runs emit nothing. Plain PostToolUse stdout is ignored by the model, and
bracket-prefixed text such as `[codex typecheck] ...` is mistaken for malformed
JSON. Stop formatting notices use the universal `systemMessage` field. Blocking
Stop failures retain stderr diagnostics and exit code 2 with bounded retries.
The version-pinned schemas and consumers are in
https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/hooks/src/schema.rs,
https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/hooks/src/events/post_tool_use.rs,
and https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/hooks/src/events/stop.rs.

Hook trust is machine-local. After a pull or bootstrap changes a hook definition
(including its matcher), open the Codex TUI on each machine and review the new or
changed hooks before trusting them. Bootstrap deploys the definitions; it does not
approve them. On Codex 0.163.0, headless `codex exec` can silently skip untrusted
hooks, so a successful command without hook activity does not verify the hooks.
Use the TUI's hook review to grant trust yourself. The
`--dangerously-bypass-hook-trust` flag is only for controlled, explicitly authorized
integration tests; it does not replace that review or persist trust.

An already-running shared app-server can retain startup configuration warnings
from before bootstrap. If the current file is correct but the warning persists,
use `/daemon` in the TUI to restart the server, then check again. Restarting the
shared server can interrupt its connected sessions.

Notifications use the shared AgentNotifier socket and sender from `notifier/`. Codex hooks request focus-aware delivery (`AGENT_NOTIFIER_DELIVERY=focus-aware`): when the originating terminal is already frontmost the daemon suppresses the desktop alert and routes the message to the tmux pane instead — on both macOS and Linux. See [`notifier/README.md`](../notifier/README.md) for the protocol fields and Linux focus hooks (`AGENT_NOTIFIER_FOCUS_CHECK_CMD`).

Skill SKILL.md files use the same frontmatter as Claude (`name`, `description`, ...). Codex ignores unknown frontmatter keys (live-validated). Tool-specific directories keep the `codex-` prefix for ownership, while `name:` is the user-facing invocation/display name and may omit that prefix.

## Prerequisites

- `codex` (≥ 0.128.0) — `brew install codex` or via OpenAI Codex install instructions
- `yq` (mikefarah) — required for config.toml deep merge: `brew install yq`
- `go` — optional, for shared AgentNotifier sender/Linux daemon build
- Authentication via `codex login` (OpenAI Enterprise SSO supported)

## Sandbox

Codex skills that write to disk should declare the required sandbox in their SKILL.md `Rules` section. The shared `worktree` skill (`ai/skills/worktree`) writes to `.git/config`, `node_modules/`, env files, and `.agents/worktrees/`, so it documents `-s workspace-write --add-dir .agents/worktrees` (Codex) alongside the Claude-Code sandbox note.
