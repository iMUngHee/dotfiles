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
│   ├── vendor.sh               # User-invoked — checks / syncs vendored code (archify, rea, eli5) outside the repo
│   └── vendor.manifest         # What vendor.sh manages; machine-only entries live outside the repo
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

## Vendored dependencies

Third-party code this config uses but does not carry. `ai/scripts/vendor.manifest` lists it (the format and the kinds are described at the top of that file) and `ai/scripts/vendor.sh` installs and checks it under `~/.local/share/ai-vendor/<name>` (override with `AI_VENDOR_DIR`).

```
vendor.sh                     # check (read-only): installed vs upstream, one row per entry
vendor.sh sync archify eli5   # install / update by name; name@ref overrides the ref for one run
vendor.sh sync --all
```

| Kind | What it is | Used for |
|---|---|---|
| `release` | a git tag or commit, read in place | archify, the diagram engine |
| `skill` | the same, plus a link into `~/.claude/skills` and `~/.agents/skills` | eli5, upstream DreambigOu/ELI5 verbatim |
| `npm` | a package whose own installer does the work | rea — `rea setup` registers its MCP server on both tools and installs its skill |
| `source` | a checkout, cloned when missing and only ever built afterwards | machine-only entries |

Machine-only entries — internal hosts, MCP servers carrying local patches — go in `~/.local/share/ai-vendor/private.manifest`: same format, outside this repo on purpose, so nothing in it can be committed by accident. vendor.sh never changes an existing `source` checkout: `sync` only runs its build there, and `check` reads it with lock-free, read-only git.

The script is user-invoked only — `bootstrap.sh` never calls it, so deploys stay offline-safe. A new machine needs the entries synced once after bootstrap; until then the diagram router falls back to Mermaid and eli5 and rea are simply absent. `sync --all` includes rea, whose `setup --yes` edits `~/.claude.json` and `~/.codex/config.toml` with no review step — to look first, sync the others by name and preview rea with `npx -y rea-agents@<version> setup --client claude_code --client codex --dry-run`. Lookups in `check` give up after `AI_VENDOR_TIMEOUT` seconds (a positive whole number, default 20) and print `unreachable` instead of hanging; `AI_VENDOR_DIR` must be absolute. On Windows run `windows\scripts\vendor.ps1`, which runs the same script under Git Bash.

### Bringing another machine up to date

1. Before pulling, on a machine bootstrapped after c240add: `git -C ~/.config config filter.machine-local.smudge cat` (why: the machine-local filter note in the root README). The pull's post-merge hook then re-runs bootstrap, which drops the old link to the removed `ai/skills/eli5`.
2. `vendor.sh sync archify eli5` — on Windows `windows\scripts\vendor.ps1 sync archify eli5`, with Developer Mode on so the eli5 links can be real symlinks.
3. Preview rea with `npx -y rea-agents@<version> setup --client claude_code --client codex --dry-run`, then `vendor.sh sync rea`.
4. Confirm: `vendor.sh` shows archify `ok`, rea `ok` and eli5 `ok (pinned)`; `node --test ~/.config/ai/lib/vendor.test.mjs` passes (on Windows run it from Git Bash, so `bash` is not WSL's); on Windows `Get-Item ~\.claude\skills\eli5` reports `LinkType` `SymbolicLink`.

If `sync eli5` reports `~/.claude/skills/eli5` or `~/.agents/skills/eli5` as "not a working link to this skill", that path is a real directory left by an older deploy (a Windows deploy without symlink rights copies instead of linking): delete it and sync again. rea keeps `~/.claude.json.rea.backup*` and `~/.codex/config.toml.rea.backup*` — full copies of those files, MCP tokens included — so guard them like the originals. `~/.local/share/diagram-engines/`, left behind by the retired `diagram-engines.sh`, is no longer read and can be deleted.

### Diagram engine

`ai/skills/diagram` is a router: Mermaid by default (and for ERD/class/gantt), archify only when a polished, shareable, interactive technical HTML is asked for. archify is deliberately **not** a skill in either tool: vendor.sh clones it as a `release` entry, outside `~/.claude/skills` and `~/.agents/skills`, so the skill listing carries only the router's description and the engine's own SKILL.md is read on demand. Its ref follows release tags (`v*`), never the dev `main`; write an exact tag in the manifest to pin. archify's own update notice stays on: its receipts carry an update check it caches for a day, and it never installs anything — when it fires, the router points at `vendor.sh sync archify`. Hosts without a shell (Claude Cowork, the Codex desktop app) always get the Mermaid route. Evaluated and not adopted on 2026-09-07: cathrynlavery/diagram-design (hand-placed SVG, ~1,000 instruction lines per diagram).

