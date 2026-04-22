# Claude Code Dotfiles

Portable [Claude Code](https://claude.ai/code) configuration synced via git.

## Structure

```
claude/
├── scripts/
│   ├── bootstrap.sh            # Deploy config to ~/.claude/
│   ├── sync-back.sh            # Sync local changes back to repo
│   └── record-quota-reset.sh   # Manual quota reset time recording
├── notifier/
│   ├── notifier.swift          # macOS notification daemon source
│   ├── build.sh                # Build + launchd registration
│   ├── Info.plist
│   └── AppIcon.icns
├── extensions/
│   └── statusline.sh           # Status line (model, context, cost, quota/proxy status)
├── hooks/                      # Claude Code hooks — see Hooks section below
│   └── lib/                    # Shared helpers (detect-project.sh)
├── skills/                     # Public skills (/design, /debug, /verify, /retro, /code-review, ...)
├── skills-private/             # Private skills (gitignored, overlaid into skills/ by bootstrap)
├── rules/                      # Path-scoped instruction rules (testing, diagnostics, rationalization, ...)
├── agents/                     # Agent definitions (pre-commit-verifier, ...)
├── memory/                     # Global long-term memory files
│   └── private/                # Work-only memories (gitignored)
├── CLAUDE.md                   # Entry point — loads all other configs
├── PERSONAL.md                 # Collaboration rules
├── DEVGUARD.md                 # Development guardrails (core rules; extras in rules/)
├── RTK.md                      # RTK (Rust Token Killer) reference
├── MEMORY.md                   # Memory index (public)
├── MEMORY.private.md           # Memory index (work-only, gitignored)
└── settings.json               # Claude Code settings (permissions, hooks, plugins)
```

## Prerequisites

- `jq` — required by bootstrap, RTK hook, statusline
- `python3` — required by notification hook
- `swiftc` — optional, for ClaudeNotifier build (Xcode CLI tools)

## Setup

```bash
# New machine (this repo is part of a multi-tool dotfiles repo at ~/.config)
git clone <repo> ~/.config
cd ~/.config/claude
./scripts/bootstrap.sh
```

Bootstrap will:

1. Symlink config files and directories to `~/.claude/` (`commands/`, `rules/`, `agents/` as wholesale symlinks)
2. Create per-skill symlinks in `~/.claude/skills/` from `skills/` + `skills-private/` (private overlays public)
3. Copy executable scripts to `~/.claude/scripts/` (excluding bootstrap/sync-back)
4. Merge `settings.json` (`permissions.allow` and `permissions.deny` union-merged, repo keys override, local-only keys like `model` preserved)
5. Deploy `MEMORY.md` + `MEMORY.private.md` (if exists) to `~/.claude/`
6. Symlink `memory/` to `~/.claude/memory/`
7. Build ClaudeNotifier (optional, skipped if `swiftc` not found)

## Sync

Git hooks handle sync automatically:

- **`pre-commit`** — runs `sync-back.sh` before committing, stages changed `settings.json` and `memory/`
- **`post-merge`** — runs `bootstrap.sh` after pulling, if `claude/` files changed

### Manual sync

```bash
# Local → repo (after Claude Code modifies settings.json)
./scripts/sync-back.sh

# Repo → local (after pulling changes)
./scripts/bootstrap.sh
```

## What's synced vs local-only

| Synced (git) | Local-only |
|---|---|
| Config files (md, json) | `model` in settings.json |
| Hooks, commands, rules, agents, extensions | `policy-limits.json` |
| Public skills + memory files | `skills-private/`, `memory/private/` |
| Notifier source | `MEMORY.private.md` |
| settings.json (base permissions) | Locally-added permissions |

## Private memory

Work-specific memory files live in `memory/private/` and are gitignored. `MEMORY.private.md` holds their index (also gitignored). Bootstrap merges both indexes at deploy time.

When `sync-back.sh` detects new memory files not referenced in either index, it prompts to classify them as public or private.

## Hooks

All hooks use session-isolated temp files (`/tmp/claude/sessions/${SESSION_ID}/`) to avoid cross-session interference.

| Hook | Event | Purpose |
|------|-------|---------|
| `rtk-rewrite.sh` | PreToolUse (Bash) | Rewrite commands through RTK for token savings (version check cached 1h) |
| `protect-files.sh` | PreToolUse (Bash, Edit, Write, MultiEdit) | Block edits/commands targeting sensitive files (.env, keys, lock files) — fail-closed if jq missing |
| `prompt-guard.sh` | UserPromptSubmit | Scan prompts for accidentally pasted secrets (single combined regex) |
| `notify.sh` | Stop | macOS notification on task completion or approval request |
| `stop-handler.sh` | Stop | Final gate — auto-format modified files, then run type checker before completion |
| `on-rate-limit.sh` | StopFailure | Auto-switch CCS quota account on rate limit |
| `check-quota-switch.sh` | SessionStart, SessionClear | Check quota reset time, switch back if elapsed |
| `post-edit-pipeline.sh` | PostToolUse (Edit, Write, MultiEdit) | Auto-format (prettier/gofmt/rustfmt) + type check after edits (30s debounce) |
| `context-monitor.sh` | PostToolUse | Warn at 50%/65% context usage, autocompact triggers at 70% |
| `compact-restore.sh` | SessionStart (matcher: compact) | Inject git branch, recent commits, modified files after compaction |
| `subagent-stop-reminder.sh` | SubagentStop | Inject DEVGUARD subagent trust reminder |
| `log-tool-failure.sh` | PostToolUse | Log tool failures to `~/.claude/tool-failures.log` |
| `log-instructions.sh` | InstructionsLoaded | Log loaded instruction files for debugging |

## Private skills

Private skills live in `skills-private/<name>/SKILL.md` and are gitignored. Bootstrap overlays them into `~/.claude/skills/` alongside public skills via individual symlinks. If a private skill has the same name as a public one, the private version wins.
