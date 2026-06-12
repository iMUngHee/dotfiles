---
name: pm-context
description: "Manage per-task document links and inject context into sessions. Manual invocation only — do NOT auto-trigger."
argument-hint: "get [KEY] | add <KEY> <URL> [LABEL] | remove <KEY> <MATCH> | annotate <KEY> [LABEL] [--regen-triggers] | set <KEY> | unset | list | manage"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, WebFetch
model: sonnet
disable-model-invocation: true
---

Manage per-task document links. **Project-scoped**: stored as a single markdown file per task at `<git-root>/.agents/task-context/<KEY>.md`, where the git root is `git rev-parse --show-toplevel`. Refuse outside a git repo. The active-task pointer lives in `<git-root>/.agents/task-context/.current` (per-project, not global).

`.agents/task-context/` is **gitignored** (task links may carry internal URLs). Before writing the first task file in a repo, ensure `<git-root>/.agents/.gitignore` contains a `task-context/` line — add it if missing; never write internal URLs into a tracked path.

Arguments: $ARGUMENTS

## System — the pm-* loop

One of four skills in a single project-management system. **This skill owns *context*** (a task's external links).

```
(pm-context · context)  ┐
(retro · memory)         ├──▶  (design · plan)
(pm-roadmap · backlog)  ┘
```
`pm-context`→links · `retro`→memory(per-task decisions) · `pm-roadmap`→backlog(items) · `design`→plan(reads all three). Each fact in the smallest file enforcing its invariant; views derived. (Per-task *memory* is **retro's**, not this skill's — stored separately at `.agents/memory/<KEY>.md`; a legacy `## Memory` section here is read-only back-compat.)

> In the subcommands below, `tasks/` is shorthand for the project-scoped dir `<git-root>/.agents/task-context/` and `tasks/.current` for its pointer file. Resolve the git root once per invocation; refuse outside a repo.

> Every subcommand taking a KEY (`get`/`add`/`remove`/`annotate`/`set`) validates it against `^[A-Z0-9_-]+$` **before any filesystem access** — reject with the expected pattern. A lowercase or path-bearing KEY (`../foo`) must never resolve `tasks/<KEY>.md`, on read paths as well as writes.

## Subcommands

### get [KEY]

Inject a task's links — including TRIGGERS and Summary — into the current session so Claude can decide which documents to fetch.

1. Resolve KEY:
   - If KEY argument provided, use it
   - Else read `tasks/.current` — if empty/missing, report "no current task. Run `/pm-context set <KEY>` first." and stop
2. Read `tasks/<KEY>.md`. If not found, run `list` and report missing key.
3. Output a header line followed by the file content verbatim:

   ```
   ## <KEY> — Task Context

   For each link below: if any TRIGGER matches the current task, fetch the URL with the appropriate tool (MCP/WebFetch). The Summary is a hint, not a substitute.

   <file content>
   ```

### add <KEY> <URL> [LABEL]

Add a single link to a task without starting the GUI, then auto-fetch its Summary and suggest Triggers.

1. If LABEL is omitted, auto-detect from URL pattern:
   - `jira.` → Jira, `wiki.`/`confluence` → Wiki, `/pull/\d+` → PR
   - `figma.com` → Figma, `github.com`/`oss.` → GitHub
   - `slack.com` → Slack, `notion.` → Notion, default → Link
2. Ensure task file exists. If missing, create with `# <KEY>\n\n`.
3. Reject if URL already present (grep), or if LABEL collides with an existing label (case-insensitive). On label collision, suggest a numeric suffix (`Wiki-2`) and ask the user via interactive question prompt to confirm/override.
4. **Fetch** the URL using the appropriate tool (see Fetch Routing). The response takes one of two forms:

   **Path 1 — inline response (small pages):** parse the returned content directly, then proceed to step 5.

   **Path 2 — file-saved response (large pages, token limit exceeded):** the tool reports `Output has been saved to <path>`. Do **NOT** read the file in full. Run a grep-based identifier sweep on the saved file:
   - camelCase fields: `grep -oE '\b[a-z][a-zA-Z]+[A-Z][a-zA-Z]+\b' <path> | sort | uniq -c | sort -rn | head -40`
   - snake_case fields/endpoints: `grep -oE '\b[a-z]+_[a-z_]+\b' <path> | sort | uniq -c | sort -rn | head -40`
   - JIRA/issue IDs: `grep -oE '[A-Z]{2,}-[0-9]+' <path> | sort -u`
   - Experiment/feature IDs: `grep -oE '[A-Z]+-[A-Z]+-[0-9]+-[A-Z]+' <path> | sort -u` (adjust regex to your team's ID format)
   - API path tokens: `grep -oE '/[a-z][a-z_]{3,}(_[a-z]+){1,}' <path> | sort -u`
   
   Then `Read <path> limit:80` for title, TOC, and opening section. If a specific section is needed for Summary, use `Read <path> offset:N limit:M` selectively — never read the whole file.

5. **Extract** Summary and Triggers from whichever source step 4 produced (inline content or grep+selective-read output):
   - **Summary**: one-line description (page title + brief context, ≤120 chars)
   - **Triggers**: 5-13 keywords/short phrases, comma-separated, prioritized in this order:
     1. **Code identifiers (highest priority)** — API endpoints (snake_case route segments verbatim from the document), data field names (camelCase fields verbatim), enum values (UPPER_SNAKE constants), JIRA/issue IDs (e.g. `PROJ-1234`, `REPO-567`), experiment/feature IDs (project-specific format), component/module names verbatim from the document
     2. **Domain-specific proper nouns** — project codenames verbatim from the document, domain abbreviations or category labels unique to your team (verbatim), specific feature labels that are unique to this codebase
     3. **Concept terms (last resort)** — only when the document lacks identifiers; use distinctive phrases, never generic words like "block", "slot", "page"
     
     The goal is grep-ability during code work. A trigger like a unique camelCase field name matches a code edit instantly; a generic noun phrase matches noisily across many files. Always prefer identifiers actually present in the document body. **Never invent triggers from outside the source — when in doubt, leave Triggers shorter.**

   On fetch failure (network, permission, 404): Summary `(fetch 실패)`, Triggers empty.

6. Append the new entry in canonical format:

   ```
   - **<LABEL>**
     - URL: <URL>
     - Triggers: <comma-separated keywords or empty on fetch failure>
     - Summary: <one-line summary or "(fetch 실패)" on failure>
   ```

   The user can refine Triggers via `manage` (GUI) — auto-extracted values are a starting point.
7. Output the updated file content verbatim.

### remove <KEY> <MATCH>

Remove an entry from a task by label or URL substring match.

1. Read `tasks/<KEY>.md`. If missing, report and stop.
2. Find entries whose Label or URL contains MATCH (case-insensitive; top-level Link entries only).
3. If no matches, report and stop. If multiple, list them and interactively prompt the user to clarify.
4. Remove the entry block (the `- **Label**` line plus its sub-bullets) and write back.
5. Output the updated file content verbatim.

### annotate <KEY> [LABEL] [--regen-triggers]

Re-fetch the Summary for one or all entries. Triggers behavior depends on current state:

- **Triggers empty** → auto-extract from page content (same prompt as `add`)
- **Triggers populated** → preserved (user authored them)
- **`--regen-triggers` flag** → force re-extraction even when populated (overrides user edits)

1. Read `tasks/<KEY>.md`. If missing, report and stop.
2. Determine target entries:
   - If LABEL provided, target only that entry (case-insensitive match; top-level Link entries only). Error if not found.
   - Else target all top-level Link entries.
3. For each target, fetch URL via Fetch Routing using the same two-path logic as `add` (Path 1 inline / Path 2 file-saved with grep sweep — see `add` step 4). Then:
   - Replace the Summary line with the fresh one-line summary (or `(fetch 실패)` on failure).
   - If Triggers is empty OR `--regen-triggers` flag set: replace Triggers with auto-extracted keywords (5-13, same priority rules as `add` — code identifiers first, concept terms last).
   - Else: preserve existing Triggers verbatim.
   - Label/URL are never modified by `annotate`.
4. Write back. Output the updated file content verbatim.

### set <KEY>

Set the active task pointer.

1. Verify `tasks/<KEY>.md` exists. If not, report missing key and run `list`.
2. Write `<KEY>` to `tasks/.current` (overwrite).
3. Confirm with `current: <KEY>`.

### unset

Clear the active task pointer.

1. Truncate `tasks/.current` to empty.
2. Confirm with `current cleared`.

### list

List all registered task keys, marking the current one.

1. List keys:
   ```bash
   ls "$(git rev-parse --show-toplevel)/.agents/task-context/"*.md 2>/dev/null | xargs -I{} basename {} .md
   ```
2. Read `.current` for the active key.
3. Output one key per line; prefix the current key with `* `.
4. If empty, report no tasks.

### manage

Open the web GUI for full link management (Label, URL, Triggers, Summary).

1. Install dependencies if needed (subshell — do not change the working dir, the git root must stay resolvable):
   ```bash
   (cd ~/.config/ai/skills/pm-context && [[ -d node_modules ]] || npm install)
   ```
2. Check port:
   ```bash
   lsof -ti:8484 2>/dev/null
   ```
   If non-empty, kill stale process first:
   ```bash
   kill $(lsof -ti:8484 2>/dev/null) 2>/dev/null; sleep 1
   ```
   Conversely: if your own background server later exits with SIGTERM, a newer `manage` launch replaced it — do not relaunch reflexively; check the port first (a live listener means the replacement is already serving).
3. Start server in background. **Capture the git root BEFORE `cd`** and pass it as `TASK_CONTEXT_ROOT` (cd-ing first would make the server resolve the skill's own repo, not the project). One block — shell vars do not persist across calls:
   ```bash
   repo_root="$(git rev-parse --show-toplevel)" || { echo "pm-context needs a git repo"; exit 1; }
   cd ~/.config/ai/skills/pm-context && TASK_CONTEXT_ROOT="$repo_root" ./node_modules/.bin/tsx server.ts
   ```
   Use `run_in_background: true`.
4. Wait 2 seconds for server startup, then open browser:
   ```bash
   sleep 2 && { command -v xdg-open >/dev/null && xdg-open http://localhost:8484 || open http://localhost:8484; }
   ```
5. Prompt interactively:
   > 브라우저에서 작업이 끝나면 알려주세요.
6. When user confirms, kill server:
   ```bash
   kill $(lsof -ti:8484 2>/dev/null) 2>/dev/null
   ```
7. Reconcile: for each task, walk entries with empty Summary OR empty Triggers and run the `annotate <KEY>` flow. Per `annotate` rules, only empty fields are filled — populated Triggers stay intact.

## Fetch Routing

Pick the fetch tool by host and page type, in priority order:

1. **Authenticated / internal hosts** → the matching MCP server, per the internal routing table already loaded in context.
2. **SPA / client-rendered pages** → the `spa-fetch` skill, run headless. Applies when the page body is rendered by JS so `WebFetch` returns only title/nav chrome with no field or endpoint identifiers — typical of Swagger UI (`/docs`, `/swagger`), Notion (`notion.so`), and Figma (`figma.com`) URLs. Route here up front for these known patterns, or fall back to it whenever a `WebFetch` summary degrades to a bare page title.
   ```bash
   node ~/.config/ai/skills/spa-fetch/spa-fetch.js <URL>; echo "EXIT:$?"
   ```
   - `EXIT:0` → parse stdout through the same Path 1 / Path 2 logic as `add` step 4.
   - `EXIT:10` (login required) / `EXIT:11` (bot wall) → the host needs an interactive browser session; do NOT drive login inside a batch add/annotate. Set Summary `(fetch 실패)`, leave Triggers empty, and tell the user to run `/spa-fetch <URL>` once to establish the session, then re-`annotate`.
   - `EXIT:1` → treat as fetch failure.
3. **Everything else** → `WebFetch`.

On fetch failure, use `(fetch 실패)` as the Summary. Never block the add/annotate flow on a single fetch failure.

## File Format

`<git-root>/.agents/task-context/<KEY>.md` is the single source of truth (project-scoped).

A task's context has **two parts**: external **Links** (top-level blocks, this file) and per-task **Memory** (decisions / things to remember) stored in the retro-owned `<git-root>/.agents/memory/<KEY>.md`. Both are this task's "context"; `/pm-roadmap` backlog items whose `Task:` is this KEY inherit it. A legacy `## Memory` section in this file is still **read** (union with the memory file) but never written; full-state GUI writes migrate it out.

```markdown
# TASK_KEY

- **<Label>**
  - URL: https://example.com/page
  - Triggers: keyword1, keyword2, keyword3
  - Summary: one-line description

## Memory

- **<note title>**
  - Note: one-line decision / thing to remember
  - Date: YYYY-MM-DD
```

**Field rules:**
- `Label`: required, unique within file (case-insensitive), max 80 char, used as join key
- `URL`: required, must match `https?://`, unique within file
- `Triggers`: optional, comma-separated keyword list (5-13 recommended — see `add` step 5)
- `Summary`: optional, single-line
- **Memory** entries (`.agents/memory/<KEY>.md`, or a legacy `## Memory` section here): `title` (required), `Note` (one-line), `Date` (optional `YYYY-MM-DD`). Written by /retro to the memory file; surfaced in `/pm-roadmap next` prompts and item context.

**Parser:**
- Top-level `- **Label**` opens a link entry; entries under `## Memory` open a memory note
- Sub-bullet `  - Key: Value` populates a field (Key is case-insensitive, value is trimmed)
- Unknown sub-bullet keys are ignored (forward compatibility)
- Sub-bullets without a parent are ignored
- The `add`/`remove`/`annotate` subcommands (including the `manage` reconcile pass, which reuses `annotate`) match and modify **top-level Link entries only** — Memory entries (memory file or legacy `## Memory` section) are outside their match scope and are never fetched or removed by them. Memory notes are written by /retro to `.agents/memory/<KEY>.md`; the `manage` GUI may also edit them (Links + Memory are both task context)

## Pointer File

`<git-root>/.agents/task-context/.current` — single line containing the current task KEY, or empty/missing for none. Per-project (not global). Modified only by `set` / `unset`, the GUI current-task toggle (★ button, `PUT /api/current`), and as a side effect of deleting the current task via the GUI.

## Rules

- All Bash commands are pre-authorized via `allowed-tools` frontmatter — no user confirmation needed
- The web GUI in `manage` writes the full schema (Label/URL/Triggers/Summary). The skill's `add` auto-extracts both Summary and Triggers from page content; the user can refine Triggers in the GUI afterward
- `annotate` overwrites Summary unconditionally. Triggers are auto-extracted only when empty; populated Triggers are preserved unless `--regen-triggers` is passed
- Task keys: uppercase alphanumeric, underscores, hyphens (`^[A-Z0-9_-]+$`) — enforced at every entry surface (skill subcommands, server API endpoints, GUI forms) before filesystem access
- On fetch failure, write `(fetch 실패)` as the Summary — never skip the entry
- Label collisions are rejected at the GUI server (HTTP 409) and at `add` (skill suggests a suffix)
