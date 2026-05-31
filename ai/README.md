# Shared AI Assistant Config — `~/.config/ai/`

Single source of truth for **tool-agnostic** rules, memory, and skills shared between [Claude Code](https://claude.ai/code) and [Codex CLI](https://developers.openai.com/codex/). The orchestrator deploys each piece into the right place for each tool.

## Structure

```
ai/
├── PERSONAL.md                 # Collaboration rules (addressing, expertise, file modification, etc.)
├── guardrails.md               # Verification, scope resolution, absence proofs, design gate
├── AGENTS.manifest             # Concat order for ~/.codex/AGENTS.md build
├── rules/                      # Path-scoped rules (code-review, diagnostics, rationalization, testing)
├── memory/                     # Tool-agnostic feedback memories
│   └── private/                # gitignored (sensitive references, internal scan rules)
├── skills/                     # Skills usable from any AI assistant
│   └── private/                # gitignored (sensitive workflows: kafdrop-hunt, track-logging)
├── scripts/
│   ├── bootstrap.sh            # Orchestrator — calls claude/ + codex/ bootstrap
│   └── sync-back.sh            # Orchestrator — calls per-tool sync-back
└── lib/
    ├── verify-no-residual-tokens.sh
    └── verify-agents-md-size.sh
```

## Token substitution

Files under `ai/` use double-mustache placeholders for tool-varying paths/names. The model substitutes them at runtime per `memory/feedback_ai_config_structure.md`:

| Token | Claude Code | Codex CLI |
|---|---|---|
| `{{TOOL_HOME}}` | `~/.claude` | `~/.codex` |
| `{{TOOL_NAME}}` | `Claude Code` | `Codex CLI` |
| `{{TOOL_NAME_LC}}` | `claude` | `codex` |
| `{{INSTRUCTIONS_FILE}}` | `CLAUDE.md` | `AGENTS.md` |
| `{{CONFIG_FILE}}` | `settings.json` | `config.toml` |
| `{{PLAN_DIR}}` | `.agents/plans` | `.agents/plans` |
| `{{STATE_DIR}}` | `.agents/state` | `.agents/state` |

Codex's AGENTS.md is built by sed-expanding these tokens at concat time (decisive). Claude's deploy keeps tokens intact and the model handles substitution in-context (live-validated 5/5 on tool calls).

Shared skill artifacts use repo-local `.agents/plans` and `.agents/state`. Codex skill discovery uses `.agents/skills`; keep plans/state as siblings, never inside `.agents/skills`.

## Deploy model

| Source | Claude target | Codex target |
|---|---|---|
| `ai/*.md` | `~/.claude/<file>` symlink | concat → `~/.codex/AGENTS.md` |
| `ai/rules/*.md` | `~/.claude/rules/<file>` symlink | included in AGENTS.md |
| `ai/memory/*.md` | `~/.claude/memory/<file>` symlink | included in AGENTS.md |
| `ai/memory/private/*.md` | `~/.claude/memory/private/<file>` symlink (gitignored) | included in AGENTS.md (gitignored, local-only) |
| `ai/skills/*/` | `~/.claude/skills/<name>/` symlink | `~/.agents/skills/<name>/` symlink |
| `ai/skills/private/*/` | same overlay | same overlay |

`~/.claude/MEMORY.md` and `~/.codex/AGENTS.md` are **auto-generated**. They carry an `AUTO-GENERATED` header. Do not edit them — edit the source files in `ai/` (or `claude/`, `codex/` for tool-only content) and re-run bootstrap.

## Skill naming

Tool-specific skill directories use native prefixes for ownership:

- `claude/skills/claude-<id>/`
- `codex/skills/codex-<id>/`

The `SKILL.md` frontmatter `name:` is the user-facing invocation/display name. It may omit the native prefix when the shorter name is clear and does not conflict in that tool's deployed skill scope. Example: `codex/skills/codex-worktree/SKILL.md` can use `name: worktree`.

## AGENTS.manifest

Codex sees no index file — it reads `AGENTS.md` body directly. `ai/AGENTS.manifest` declares the concat order. New `ai/*.md` files MUST be added to the manifest, otherwise Codex never sees them. `feedback_ai_config_structure.md` MUST stay first in the memory section so Codex receives token rules before any token-using content.

`ai/scripts/sync-back.sh` (or `claude/scripts/sync-back.sh --strict`) detects manifest drift and warns/fails accordingly.

## 3-tier classification

When adding new content, decide where it belongs:

- `ai/`: tool-agnostic. No slash commands, no subagent dispatch, no `EnterPlanMode`/`EnterWorktree`, no `~/.claude/`-only paths.
- `claude/`: depends on Claude-specific systems (subagents, slash commands, hooks, settings.json permissions). Files use `claude-` prefix.
- `codex/`: depends on Codex-specific systems (sandbox modes, `codex exec`, `~/.agents/skills/` discovery, `[mcp_servers.*]`). Files use `codex-` prefix.

If unsure, default to `ai/` and tokenize tool-specific paths/names.

## Orchestrator

```bash
ai/scripts/bootstrap.sh           # default: backup + deploy + sanity
ai/scripts/bootstrap.sh --no-backup
ai/scripts/bootstrap.sh --no-cleanup-backups
```

`ai/scripts/sync-back.sh [--strict]` forwards to each tool's sync-back. `--strict` turns AGENTS.manifest drift into a hard fail.
