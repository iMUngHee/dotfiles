# Claude Code Dotfiles — `~/.config/claude/`

Claude Code-only deploy logic and Claude-native files. Shared content lives in [`../ai/`](../ai/README.md).

## Structure

```
claude/
├── CLAUDE.md                   # Entry point — @imports PERSONAL/guardrails (from ai/) + DEVGUARD/MEMORY (claude-only)
├── DEVGUARD.md                 # Claude-only addendum (Skill Compliance, /design routing) — shared base in ai/guardrails.md
├── settings.json               # Claude Code settings (permissions, hooks, plugins)
├── rules/
│   └── claude-subagent-trust.md # Claude-only rule (subagent dispatch trust)
├── memory/
│   └── claude-feedback_*.md    # Claude-only feedback memories (claude- prefix)
├── skills/
│   ├── claude-ask-codex/       # Claude-only skill; invokes as `ask-codex`
│   ├── claude-fanout/          # Claude-only skill; invokes as `fanout`
│   └── claude-worktree/        # Claude-only skill; invokes as `worktree`
├── hooks/                      # PreToolUse, PostToolUse, UserPromptSubmit, Stop, etc. — see Hooks section
│   └── lib/                    # Shared helpers
├── agents/                     # Subagent definitions (pre-commit-verifier, reviewer, verifier)
├── commands/                   # Slash command definitions
├── extensions/
│   └── statusline.sh           # Status line (model, context, cost, quota/proxy status, plan widget)
└── scripts/
    ├── bootstrap.sh            # Deploy ai/ + claude/ → ~/.claude/
    ├── sync-back.sh            # Pull repo-tracked keys back from ~/.claude/settings.json
    └── record-quota-reset.sh   # Manual quota reset time recording
```

## Prerequisites

- `jq` — required by bootstrap, RTK hook, statusline
- `go` — optional, for shared AgentNotifier sender build (required for the Linux daemon)
- `swiftc` — optional on macOS, for shared AgentNotifier build (Xcode CLI tools)
- `notify-send` (libnotify) — Linux only, for desktop notifications

## Setup

```bash
git clone <repo> ~/.config
~/.config/ai/scripts/bootstrap.sh           # orchestrator: deploys ai/ + claude/ + codex/
# or claude-only:
~/.config/claude/scripts/bootstrap.sh
```

Bootstrap will:

1. Symlink `ai/PERSONAL.md`, `ai/guardrails.md` and `claude/{CLAUDE,DEVGUARD}.md` into `~/.claude/`
2. Symlink `hooks/`, `commands/`, `agents/` (wholesale dir symlinks, Claude-only) into `~/.claude/`
3. Per-file symlinks for `rules/` (merged ai/ + claude/) and `memory/` (merged ai/ + claude/ + ai/private)
4. Auto-generate `~/.claude/MEMORY.md` (Shared / Claude-only / Private sections, with `AUTO-GENERATED` header)
5. Per-skill symlinks in `~/.claude/skills/` from `ai/skills/`, `ai/skills/private/`, `claude/skills/`
6. Copy executable scripts to `~/.claude/scripts/` (excluding bootstrap/sync-back)
7. Merge `settings.json` (permissions union; repo keys override; local-only keys like `model` preserved)

The top-level orchestrator (`ai/scripts/bootstrap.sh`) builds the shared AgentNotifier from `notifier/` after Claude/Codex deploy.

## Sync

Git hooks (`.git/hooks/`) handle sync:

- **`pre-commit`** — runs `ai/scripts/sync-back.sh`, stages changed `claude/settings.json`
- **`post-merge`** — runs `ai/scripts/bootstrap.sh` if any of `ai/`, `claude/`, `codex/` changed

### Manual sync

```bash
ai/scripts/sync-back.sh [--strict]   # local → repo (settings.json + manifest drift check)
ai/scripts/bootstrap.sh              # repo → local (re-deploy)
```

## What's synced vs local-only

| Synced (git) | Local-only |
|---|---|
| `claude/CLAUDE.md`, `DEVGUARD.md`, `settings.json` | `model` in settings.json |
| Hooks, commands, rules, agents, extensions | `policy-limits.json`, `tool-failures.log` |
| Public skills + memory files | `ai/skills/private/` (work-only), `ai/memory/private/` (work-only) |
| `claude/scripts/`, `ai/scripts/`, `codex/scripts/` | `~/.claude/MEMORY.md` (regenerated) |

## Generated files (do not edit)

- `~/.claude/MEMORY.md` — built from `ai/memory/`, `claude/memory/`, `ai/memory/private/` walks
- `~/.codex/AGENTS.md` — built from `ai/AGENTS.manifest`

Direct edits are lost on the next bootstrap. Edit source files in `ai/` or `claude/` (or `codex/` for Codex-only) and re-run bootstrap.

## Hooks

All hooks use session-isolated temp files (`/tmp/claude/sessions/${SESSION_ID}/`).

| Hook | Event | Purpose |
|------|-------|---------|
| `rtk-rewrite.sh` | PreToolUse (Bash) | Rewrite commands through RTK for token savings |
| `protect-files.sh` | PreToolUse (Bash, Edit, Write, MultiEdit) | Block edits/commands targeting sensitive files (.env, keys, lock files) |
| `prompt-guard.sh` | UserPromptSubmit | Scan prompts for accidentally pasted secrets |
| `inject-context.sh` | UserPromptSubmit | Inject active plan info from `.agents/state/current.txt` |
| `notify.sh` | Notification, PermissionRequest | AgentNotifier desktop/tmux notification on approval requests |
| `stop-handler.sh` | Stop | Final gate — auto-format then type check before completion |
| `on-rate-limit.sh` | StopFailure | Auto-switch CCS quota account on rate limit |
| `check-quota-switch.sh` | SessionStart (startup, clear) | Quota reset check, account swap if elapsed |
| `post-edit-pipeline.sh` | PostToolUse (Edit, Write, MultiEdit) | Auto-format + type check (30s debounce) |
| `context-monitor.sh` | PostToolUse | Warn at 50%/65% context usage (autocompact at 70%) |
| `compact-restore.sh` | SessionStart (matcher: compact) | Inject git branch, recent commits, modified files |
| `subagent-stop-reminder.sh` | SubagentStop | Inject DEVGUARD subagent trust reminder |
| `log-tool-failure.sh` | PostToolUse | Log tool failures to `~/.claude/tool-failures.log` |
| `log-instructions.sh` | InstructionsLoaded | Log loaded instruction files for debugging |
| `context-mode-go hook *` | PreToolUse, PostToolUse, UserPromptSubmit, PreCompact, SessionStart | context-mode MCP integration (sandboxed output indexing/search) |
