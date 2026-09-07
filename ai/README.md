# Shared AI Assistant Config — `~/.config/ai/`

Single source of truth for **tool-agnostic** rules, memory, and skills shared between [Claude Code](https://claude.ai/code) and [Codex CLI](https://developers.openai.com/codex/). The orchestrator deploys each piece into the right place for each tool.

## Structure

```
ai/
├── PERSONAL.md                 # Collaboration rules (addressing, file modification, response style, etc.)
├── guardrails.md               # Verification, absence proofs, scope resolution, pre-implementation gate
├── AGENTS.manifest             # Concat order for ~/.codex/AGENTS.md build
├── rules/                      # Session rules — always-on unless `paths:`-scoped (see Rule load scope)
├── memory/                     # Tool-agnostic feedback memories
│   └── private/                # gitignored (sensitive references, internal scan rules)
├── skills/                     # Skills usable from any AI assistant
│   └── private/                # gitignored (sensitive workflows: kafdrop-hunt, track-logging)
├── scripts/
│   ├── bootstrap.sh            # Orchestrator — calls claude/ + codex/ bootstrap
│   ├── sync-back.sh            # Orchestrator — calls per-tool sync-back
│   └── diagram-engines.sh      # User-invoked — installs the pinned archify engine outside skill discovery
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

Shared skill artifacts use repo-local `.agents/plans`, `.agents/state`, and `.agents/tasks/<KEY>/` (per-task backlog/closed/links/memory — the task-first pm model; gitignored). Codex skill discovery uses `.agents/skills`; keep all of these as siblings, never inside `.agents/skills`.

## Project-management loop (pm-*)

Four shared skills form one project-management system over those `.agents/` artifacts:

```
(pm-context · links | retro · memory | pm-roadmap · backlog)  ──▶  design · plan
        ▲__________________________________________________________________│
        retro closes the loop: plan done → close backlog item, harvest defers + decisions
```

`pm-context` owns per-task links (`.agents/tasks/<KEY>/links.md`), `pm-roadmap` owns the task-first backlog (`.agents/tasks/<KEY>/{backlog,closed}.md`, derived cross-task views — no single ROADMAP.md), `retro` owns per-task memory (`.agents/tasks/<KEY>/memory.md`) and the done transition, `design` reads all three and owns the plan. All `tasks/*` writes go through the `pm-roadmap` CLI → ops (lock + CAS). The `pm-context` GUI (`manage`) serves a unified dashboard (backlog + tasks + inline link editing) and reuses `pm-roadmap`'s TS modules.

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

## Rule load scope

Deploying a rule is not the same as having it read. A file in `rules/` is loaded into every
Claude session by default; a `paths:` frontmatter block makes it **path-scoped**, and Claude
then loads it only when the session touches a file matching one of the globs:

```yaml
---
paths:
  - "**/*.test.*"
---
```

So the block is a load-time decision, not documentation. Omit it when the rule must hold no
matter what the session touches — `pager.md` and `code-review.md` depend on that.

**Codex has no equivalent.** `codex/scripts/bootstrap.sh` strips frontmatter before concat,
so every manifest entry is unconditionally present in `~/.codex/AGENTS.md`. A path-scoped
rule is narrow on Claude and always-on for Codex; write one only when that asymmetry is
acceptable.

Measured 2026-08-18: of the six deployed rules, the two carrying `paths:`
(`rationalization.md`, `testing.md`) were absent from a Claude session whose changed files
were only `.md` and `.manifest`, while the four without it were present. Both bodies were
in `AGENTS.md`, with zero surviving `paths:` blocks.

## Skill naming

Tool-specific skill directories use native prefixes for ownership:

- `claude/skills/claude-<id>/`
- `codex/skills/codex-<id>/`

The `SKILL.md` frontmatter `name:` is the user-facing invocation/display name. It may omit the native prefix when the shorter name is clear and does not conflict in that tool's deployed skill scope. Example: `codex/skills/codex-ask-claude/SKILL.md` uses `name: ask-claude`. (A skill that is identical across tools belongs in `ai/skills/<name>/` instead — e.g. `ai/skills/worktree/`.)

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

## Diagram engines

`ai/skills/diagram` is a router: Mermaid by default (and for ERD/class/gantt), archify only when a polished, shareable, interactive technical HTML is asked for. archify is deliberately **not** a skill in either tool. `ai/scripts/diagram-engines.sh` clones it at a pinned release tag into `~/.local/share/diagram-engines/archify`, outside `~/.claude/skills` and `~/.agents/skills`, so the skill listing carries only the router's description and the engine's own 137-line SKILL.md is read on demand. Bump `ARCHIFY_TAG` in the script to update; `--check` prints the pin next to the latest upstream tag. The router runs every engine command with `ARCHIFY_UPDATE_CHECK_DISABLED=1`, so a diagram run makes no network call and writes no ack state. The script is user-invoked only — `bootstrap.sh` never calls it, so deploys stay offline-safe. Hosts without a shell (Claude Cowork, the Codex desktop app) always get the Mermaid route. Evaluated and not adopted on 2026-09-07: cathrynlavery/diagram-design (hand-placed SVG, ~1,000 instruction lines per diagram).
