---
name: task-context
description: "Manage per-task document links and inject context into sessions. Manual invocation only — do NOT auto-trigger."
argument-hint: "get <KEY> | add <KEY> <URL> [LABEL] | remove <KEY> <MATCH> | annotate <KEY> | list | manage"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, WebFetch
model: sonnet
---

Manage per-task document links. Stored as markdown in `~/.config/claude/skills/task-context/tasks/`.

Arguments: $ARGUMENTS

## Subcommands

### get <KEY>

Inject a task's links with context descriptions into the current session.

1. Read `~/.config/claude/skills/task-context/tasks/<KEY>.md`
   - If not found, list available keys via `list` and report
2. Read `~/.config/claude/skills/task-context/tasks/<KEY>.meta.md` (may not exist)
3. Merge: for each link, match by label to find its description in meta. Output as:
   ```
   - [Label] https://...
     → description from meta (or omit line if no meta entry)
   ```
4. Output the merged result as session context

### add <KEY> <URL> [LABEL]

Add a single link to a task without starting the GUI, then auto-annotate.

1. If LABEL is omitted, auto-detect from URL pattern:
   - `jira.` → Jira, `wiki.`/`confluence` → Wiki, `/pull/\d+` → PR
   - `figma.com` → Figma, `github.com`/`oss.` → GitHub
   - `slack.com` → Slack, `notion.` → Notion, default → Link
2. Ensure task file exists:
   ```bash
   [[ -f ~/.config/claude/skills/task-context/tasks/<KEY>.md ]] || printf '# <KEY>\n\n' > ~/.config/claude/skills/task-context/tasks/<KEY>.md
   ```

3. Check for duplicate URL:
   ```bash
   grep -qF '<URL>' ~/.config/claude/skills/task-context/tasks/<KEY>.md
   ```
   If exit code 0 (duplicate found), report and stop. Do NOT append.
4. Append `- [<LABEL>] <URL>` and write back

5. Fetch the URL using the appropriate tool (see Fetch Routing) and extract a one-line description (page title + brief summary)
6. Read `~/.config/claude/skills/task-context/tasks/<KEY>.meta.md`
   - If not found, create with `# <KEY> — Context` header and blank line
7. Append `- **<LABEL>** — <description>` (or `- **<LABEL>** — (fetch 실패)` on failure) and write back

8. Output the updated link file content verbatim

### remove <KEY> <MATCH>

Remove a link from a task by label or URL substring match. Also removes matching meta entry.

1. Read `~/.config/claude/skills/task-context/tasks/<KEY>.md`
   - If not found, report and stop
2. Find matching link lines (header and non-link lines are excluded):
   ```bash
   grep -iF '<MATCH>' ~/.config/claude/skills/task-context/tasks/<KEY>.md | grep '^- \['
   ```
   If no matches, report and stop.
3. If multiple matches, list them and use AskUserQuestion to clarify which to remove
4. Remove the matching line and write back

5. Read `~/.config/claude/skills/task-context/tasks/<KEY>.meta.md` — if it exists, remove the entry with the same label and write back

6. Output the updated link file content verbatim

### list

List all registered task keys.

1. List task keys:
   ```bash
   ls ~/.config/claude/skills/task-context/tasks/*.md 2>/dev/null | grep -v '\.meta\.md$' | xargs -I{} basename {} .md
   ```
2. Output the result. If empty, report no tasks.

### manage

Open the web GUI for link management.

1. Install dependencies if needed:
   ```bash
   cd ~/.config/claude/skills/task-context && [[ -d node_modules ]] || npm install
   ```


2. Check port:
   ```bash
   lsof -ti:8484 2>/dev/null
   ```
   If output is non-empty, kill stale process first:
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

5. Use AskUserQuestion:
   > 브라우저에서 링크 관리를 마치면 알려주세요.

6. When user confirms, kill server:
   ```bash
   kill $(lsof -ti:8484 2>/dev/null) 2>/dev/null
   ```


7. Reconcile all tasks: for each `tasks/*.md` (excluding `*.meta.md`), compare labels against corresponding `.meta.md`.
   For any link whose label is NOT in the meta file, fetch and append a description.
   Remove any meta entries whose label no longer exists in the link file (stale cleanup).

### annotate <KEY>

Re-fetch descriptions for all links in a task. Overwrites existing descriptions.

1. Read `~/.config/claude/skills/task-context/tasks/<KEY>.md`
   - If not found, report and stop
2. Extract link entries:
   ```bash
   grep '^- \[' ~/.config/claude/skills/task-context/tasks/<KEY>.md | sed 's/^- \[\([^]]*\)\] \(.*\)/\1\t\2/'
   ```
   For each label/URL pair, fetch the URL using the appropriate tool (see Fetch Routing) and extract a one-line description
3. Write `~/.config/claude/skills/task-context/tasks/<KEY>.meta.md` with all descriptions (replace entire file)

4. Output the meta file content verbatim

## Fetch Routing

Fetch each URL using `WebFetch`. If a relevant MCP server is available (e.g., Confluence, Jira, GitHub), prefer the MCP tool for authenticated or API-based access. Extract a one-line description: page title + brief summary.

On fetch failure, use `(fetch 실패)` as the description. Never block the add/annotate flow on a single fetch failure.

## Meta File Format

Stored at `tasks/<KEY>.meta.md`. Managed exclusively by the skill (never by server.ts/GUI).

```markdown
# TASK_KEY — Context

- **Label** — one-line description of the linked page
- **Label** — (fetch 실패)
```

Labels must match the labels in the corresponding link file exactly.
Users may manually edit descriptions — `annotate` overwrites all, but `add`/`manage` only append new entries.

## File Format

```markdown
# TASK_KEY

- [Label] https://example.com/link
- [Label] https://example.com/other
```

## Rules

- All Bash commands are pre-authorized via `allowed-tools` frontmatter — no user confirmation needed
- Do NOT modify link files (`.md`) directly during `manage` — the web GUI handles writes
- Meta files (`.meta.md`) are managed exclusively by the skill, never by server.ts/GUI
- `get` merges link + meta files and outputs markdown, not JSON
- Task keys: uppercase alphanumeric, underscores, hyphens
- On fetch failure, write `(fetch 실패)` as the description — never skip the entry
- `annotate` overwrites all descriptions; `add`/`manage` only append new entries and clean stale ones
