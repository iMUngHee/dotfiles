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
│   └── claude-ask-codex/       # Claude-only skill; invokes as `ask-codex`
├── hooks/                      # PreToolUse, PostToolUse, UserPromptSubmit, Stop, etc. — see Hooks section
│   └── lib/                    # Shared helpers
├── agents/                     # Subagent definitions (pre-commit-verifier, reviewer, verifier)
├── mods/                       # Function-hook mods (pm-band, pager-view) — see Mods section
├── workflows/                   # Reusable dynamic-workflow scripts — see Measuring a rule
├── commands/                   # Slash command definitions
├── keybindings.json            # Overrides of default keybindings only (tmux-safe ctrl+x chords)
├── extensions/
│   └── statusline.sh           # Status line (model, context, cost, quota/proxy status)
└── scripts/
    ├── bootstrap.sh            # Deploy ai/ + claude/ → ~/.claude/
    └── sync-back.sh            # Pull repo-tracked keys back from ~/.claude/settings.json
```

## Prerequisites

- `jq` — required by bootstrap, statusline
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
2. Symlink `hooks/`, `commands/`, `agents/`, `mods/` (wholesale dir symlinks, Claude-only) into `~/.claude/`
3. Per-file symlinks for `rules/` (merged ai/ + claude/) and `memory/` (merged ai/ + claude/ + ai/private)
4. Auto-generate `~/.claude/MEMORY.md` (Shared / Claude-only / Private sections, with `AUTO-GENERATED` header)
5. Per-skill symlinks in `~/.claude/skills/` from `ai/skills/`, `ai/skills/private/`, `claude/skills/`
6. Copy executable scripts to `~/.claude/scripts/` (excluding bootstrap/sync-back)
7. Merge `settings.json` (repo keys override; local-only keys like `model` preserved; permissions resolved against `~/.claude/.settings-repo-managed.json`, so an entry the repo dropped is removed while one you approved at a prompt stays)

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
| `protect-files.sh` | PreToolUse (Bash, Edit, Write, MultiEdit) | Block edits/commands targeting sensitive files (.env, keys, lock files); block writes to generated files (`AUTO-GENERATED`/`@generated`/`DO NOT EDIT` header) |
| `prompt-guard.sh` | UserPromptSubmit | Scan prompts for accidentally pasted secrets |
| `inject-context.sh` | UserPromptSubmit | Resolve the exact Claude session binding, allow only checkout-local legacy normalization, and inject bound plan/worktree routing (30s bound); unbound main is plan-free, `current.txt` is launcher-only, and the shared restored/compacted-summary continuation guard is delivered. A conversation reopened from the agents view continues under a new session id; when the old transcript's last row is `continued-in` naming this session, the binding it held (draft/active only) is carried over and shown as `inherited from <id>`. `/clear`, `/branch` and `--resume` write no such row. Codex has no equivalent, so its adapter does not do this |
| `notify.sh` | Notification, PermissionRequest | AgentNotifier desktop/tmux notification on approval requests |
| `stop-handler.sh` | Stop | Final gate — auto-format, then this repo's own test suites selected by changed path, then type check |
| `post-edit-pipeline.sh` | PostToolUse (Edit, Write, MultiEdit) | Auto-format + type check (30s debounce) |
| `compact-restore.sh` | SessionStart (matcher: compact) | Inject git branch, recent commits, modified files |
| `log-tool-failure.sh` | PostToolUse | Log tool failures to `~/.claude/tool-failures.log` |
| `log-instructions.sh` | InstructionsLoaded | Log loaded instruction files for debugging |

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

## Mods

Mods are Claude Code plugins built on function hooks (2.1.287+, early access: the
API moves between releases). Each folder under `mods/` is one plugin; bootstrap
links `~/.claude/mods` to this directory, and `settings.json`
`env.CLAUDE_CODE_PLUGIN_DIRS` loads them in every session, the desktop app's
Code tab included. Both are read-only: they run the pm and pager CLIs and draw.

| Mod | Draws | Reads |
|-----|-------|-------|
| `pm-band` | One band line above the prompt — the bound plan's id, progress dots and current step (`○ no plan` when unbound), with `steps` and `graph` controls that open `/pm` on that tab. `/pm` opens a pane with three tabs: steps, backlog (by task, `⤷ needs X` / `⤷ after X`), and the dependency graph — on the terminal a force-directed cell drawing (drag a node, arrows to pick), on desktop, VS Code and mobile an Svg with a node list to pick from. | `ai/lib/worktree.mjs resolve-session`, the plan file, `pm-roadmap.ts list --json --all` (pane open only) |
| `pager-view` | `✉ <name> · N new` under the pm line — mail since this session last opened `/pager`. `/pager` opens the session's conversation: an index of messages (`←` in, `→` out; `j`/`k` or a click on the time picks one) over the picked message in full; and the peers table (live first, this session marked). | `pager whoami`, `pager ls --session` (ID column only), `pager export`, `pager who` |

- **What they show and how** is `mods/design-contract.md` (experience and the
  Ledger interface system: rules over boxes, aligned columns, one accent per meaning).
- **Band order** is the `CLAUDE_CODE_PLUGIN_DIRS` order: the first entry is the
  outer hook and draws on top, so pm-band comes first.
- **I/O never runs while drawing.** Events and timers refresh `$.state`;
  `ui.render` only reads it. A refresh is single-flight and tagged with the
  session id, so a `/clear` or `/resume` never shows the previous session's data.
- **The pager badge's baseline** is in `$.store` per session id: a reload keeps
  it, a new session starts its own, and mail from before the first look is not
  new. It is the badge's own notion of "seen"; pager's delivery state is untouched.
- **The step grammar** is pm's: `ai/skills/pm-roadmap/ops.ts` `planStep`. Change
  both together.
- **The graph** draws at most 120 nodes (the current plan's task when one is
  bound, every task otherwise) and keeps its Client props under 60,000 characters.
  It needs a `Client` surface (terminal, desktop); elsewhere the tab shows the list.

Develop in a worktree, never in main: a `CLAUDE_CODE_PLUGIN_DIRS` folder is
watched, so saving into main reloads every live session at once.

```bash
claude plugin validate claude/mods/pm-band      # what the engine would refuse
claude plugin test claude/mods/pm-band          # *.test.ts against the engine
tsc -p claude/mods/pm-band                      # after one load lays .claude-plugin/types/
claude --plugin-dir claude/mods/pm-band --plugin-dir claude/mods/pager-view
```

`.claude-plugin/types/` is written by the engine on every load and is git-ignored.
The Stop gate does not type-check mods (no tsconfig at the repo root), so run
`tsc -p` yourself.

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

Claude Code's built-in notification emitter is disabled via `preferredNotifChannel: notifications_disabled` in `settings.json`, so desktop alerts go through a single path (`notify.sh` → AgentNotifier) instead of the terminal's own emitter — which otherwise surfaced under the terminal app's name (e.g. Ghostty), especially while waiting on approvals.
