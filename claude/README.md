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
│   └── claude-fanout/          # Claude-only skill; invokes as `fanout`
├── hooks/                      # PreToolUse, PostToolUse, UserPromptSubmit, Stop, etc. — see Hooks section
│   └── lib/                    # Shared helpers
├── agents/                     # Subagent definitions (pre-commit-verifier, reviewer, verifier)
├── workflows/                   # Reusable dynamic-workflow scripts — see Measuring a rule
├── commands/                   # Slash command definitions
├── extensions/
│   └── statusline.sh           # Status line (model, context, cost, quota/proxy status, plan widget)
└── scripts/
    ├── bootstrap.sh            # Deploy ai/ + claude/ → ~/.claude/
    └── sync-back.sh            # Pull repo-tracked keys back from ~/.claude/settings.json
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
| `protect-files.sh` | PreToolUse (Bash, Edit, Write, MultiEdit) | Block edits/commands targeting sensitive files (.env, keys, lock files); block writes to generated files (`AUTO-GENERATED`/`@generated`/`DO NOT EDIT` header) |
| `prompt-guard.sh` | UserPromptSubmit | Scan prompts for accidentally pasted secrets |
| `inject-context.sh` | UserPromptSubmit | Resolve the exact Claude session binding, allow only checkout-local legacy normalization, and inject bound plan/worktree routing (30s bound); unbound main is plan-free, `current.txt` is launcher-only, and the shared restored/compacted-summary continuation guard is delivered |
| `notify.sh` | Notification, PermissionRequest | AgentNotifier desktop/tmux notification on approval requests |
| `stop-handler.sh` | Stop | Final gate — auto-format, then this repo's own test suites selected by changed path, then type check |
| `post-edit-pipeline.sh` | PostToolUse (Edit, Write, MultiEdit) | Auto-format + type check (30s debounce) |
| `context-monitor.sh` | PostToolUse | Warn at 50%/65% context usage (autocompact at 70%) |
| `compact-restore.sh` | SessionStart (matcher: compact) | Inject git branch, recent commits, modified files |
| `log-tool-failure.sh` | PostToolUse | Log tool failures to `~/.claude/tool-failures.log` |

### Gate stages (stop-handler.sh / codex stop-gate.sh)

Both gates run the same stages, and both are scoped to `$HOME/.config` so other projects are untouched. Triggers are per-path, so an untouched area costs nothing:

| Changed path | Suite | Approx |
|---|---|---|
| `{ai,claude,codex}/**/*.{md,sh}` | contract tests (`session-routing-consumers`, `inject-context-hooks`) | 15s |
| `ai/lib/**` | every `ai/lib/*.test.mjs` | 50s |
| `ai/skills/pm-roadmap/**` | `npm test` (tsx) | 50s |
| `ai/skills/pm-context/**` | `npm test` (tsx) | 1s |
| `ai/skills/config-audit/**` | `go test ./...` | 2s |

Instruction files are asserted by exact string match in `ai/lib/*.test.mjs`, and a doc-only change reaches no type checker — so without the first stage a rule can be edited out while its suite goes red unnoticed. That happened once (`6f9b845`).

## Measuring a rule

`workflows/rule-ab.js` A/B-tests one instruction against real tickets: each ticket runs with and without the rule text, n times per arm, and a blind judge that never sees which arm produced what scores size, requirement fit, safety, and over-building.

```
Workflow({ scriptPath: "~/.config/claude/workflows/rule-ab.js", args: {
  rule: "<the exact instruction text under test>",
  tickets: [{ key: "colorpick", brief: "<request as a user would phrase it>" }],
  runs: 2
}})
```

Pick tickets that contain a genuine over-build trap (a native feature already covers the need) and whose deliverable is code the agent can write from the brief alone. It found the Pre-Implementation Gate's delegation loophole (`907a85f`).

**It does not fit every question.** An instruction that depends on repo state, git, or worktrees cannot be isolated this way — attempting it on `design/SKILL.md` module splitting produced 0% completion on both arms and no signal.
| `log-instructions.sh` | InstructionsLoaded | Log loaded instruction files for debugging |
| `context-mode-go hook *` | PreToolUse, PostToolUse, UserPromptSubmit, PreCompact, SessionStart | context-mode MCP integration (sandboxed output indexing/search) |

Claude Code's built-in notification emitter is disabled via `preferredNotifChannel: notifications_disabled` in `settings.json`, so desktop alerts go through a single path (`notify.sh` → AgentNotifier) instead of the terminal's own emitter — which otherwise surfaced under the terminal app's name (e.g. Ghostty), especially while waiting on approvals.
