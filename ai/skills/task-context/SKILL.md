---
name: task-context
description: "Manage per-task document links and inject context into sessions. Manual invocation only — do NOT auto-trigger."
argument-hint: "get [KEY] | add <KEY> <URL> [LABEL] | remove <KEY> <MATCH> | annotate <KEY> [LABEL] [--regen-triggers] | set <KEY> | unset | list | manage"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, WebFetch
model: sonnet
disable-model-invocation: true
---

Manage per-task document links. Stored as a single markdown file per task in `~/.config/claude/skills/task-context/tasks/<KEY>.md`. The pointer to the active task lives in `tasks/.current`.

Arguments: $ARGUMENTS

## Subcommands

### get [KEY]

Inject a task's links — including TRIGGERS and Summary — into the current session so Claude can decide which documents to fetch.

1. Resolve KEY:
   - If KEY argument provided, use it
   - Else read `tasks/.current` — if empty/missing, report "no current task. Run `/task-context set <KEY>` first." and stop
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
2. Find entries whose Label or URL contains MATCH (case-insensitive).
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
   - If LABEL provided, target only that entry (case-insensitive match). Error if not found.
   - Else target all entries.
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
   ls ~/.config/claude/skills/task-context/tasks/*.md 2>/dev/null | xargs -I{} basename {} .md
   ```
2. Read `.current` for the active key.
3. Output one key per line; prefix the current key with `* `.
4. If empty, report no tasks.

### manage

Open the web GUI for full link management (Label, URL, Triggers, Summary).

1. Install dependencies if needed:
   ```bash
   cd ~/.config/claude/skills/task-context && [[ -d node_modules ]] || npm install
   ```
2. Check port:
   ```bash
   lsof -ti:8484 2>/dev/null
   ```
   If non-empty, kill stale process first:
   ```bash
   kill $(lsof -ti:8484 2>/dev/null) 2>/dev/null; sleep 1
   ```
3. Start server in background:
   ```bash
   cd ~/.config/claude/skills/task-context && ./node_modules/.bin/tsx server.ts
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

Use `WebFetch` by default. Prefer the matching MCP server for authenticated/internal hosts. The naver-internal routing table lives in `~/.config/claude/memory/private/reference_naver_tools.md`; it is loaded into context via `MEMORY.private.md`.

On fetch failure, use `(fetch 실패)` as the Summary. Never block the add/annotate flow on a single fetch failure.

## File Format

`tasks/<KEY>.md` is the single source of truth.

```markdown
# TASK_KEY

- **<Label>**
  - URL: https://example.com/page
  - Triggers: keyword1, keyword2, keyword3
  - Summary: one-line description
- **<Another Label>**
  - URL: ...
  - Triggers: 
  - Summary: ...
```

**Field rules:**
- `Label`: required, unique within file (case-insensitive), max 80 char, used as join key
- `URL`: required, must match `https?://`, unique within file
- `Triggers`: optional, comma-separated keyword list (recommend 3-7 per entry)
- `Summary`: optional, single-line

**Parser:**
- Top-level `- **Label**` opens an entry
- Sub-bullet `  - Key: Value` populates a field (Key is case-insensitive, value is trimmed)
- Unknown sub-bullet keys are ignored (forward compatibility)
- Sub-bullets without a parent are ignored

## Pointer File

`tasks/.current` — single line containing the current task KEY, or empty/missing for none. Modified only by `set` / `unset` (and as a side effect of deleting the current task via the GUI).

## Rules

- All Bash commands are pre-authorized via `allowed-tools` frontmatter — no user confirmation needed
- The web GUI in `manage` writes the full schema (Label/URL/Triggers/Summary). The skill's `add` auto-extracts both Summary and Triggers from page content; the user can refine Triggers in the GUI afterward
- `annotate` overwrites Summary unconditionally. Triggers are auto-extracted only when empty; populated Triggers are preserved unless `--regen-triggers` is passed
- Task keys: uppercase alphanumeric, underscores, hyphens
- On fetch failure, write `(fetch 실패)` as the Summary — never skip the entry
- Label collisions are rejected at the GUI server (HTTP 409) and at `add` (skill suggests a suffix)
