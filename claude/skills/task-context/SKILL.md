---
name: task-context
description: "Manage per-task document links and inject context into sessions. Manual invocation only — do NOT auto-trigger."
argument-hint: "get <KEY> | manage | list"
allowed-tools: Bash, Read, Glob, AskUserQuestion
model: sonnet
---

Manage per-task document links. Stored as markdown in `~/.config/claude/skills/task-context/tasks/`.

Arguments: $ARGUMENTS

## Subcommands

### get <KEY>

Inject a task's links into the current session.

1. Read `~/.config/claude/skills/task-context/tasks/<KEY>.md`
2. If not found, list available keys via `list` and report
3. Output the file content verbatim as session context

### list

List all registered task keys.

1. Glob `~/.config/claude/skills/task-context/tasks/*.md`
2. Output each filename (without `.md`) as a list

### manage

Open the web GUI for link management.

1. Install dependencies if needed:
   ```bash
   cd ~/.config/claude/skills/task-context && [[ -d node_modules ]] || npm install
   ```
   Use `dangerouslyDisableSandbox: true`.

2. Check port:
   ```bash
   lsof -ti:8484 2>/dev/null
   ```
   If output is non-empty, kill stale process first: `lsof -ti:8484 | xargs kill 2>/dev/null` and wait 1 second.

3. Start server in background:
   ```bash
   cd ~/.config/claude/skills/task-context && ./node_modules/.bin/tsx server.ts
   ```
   Use `dangerouslyDisableSandbox: true` and `run_in_background: true`.

4. Wait 2 seconds for server startup, then open browser:
   ```bash
   sleep 2 && open http://localhost:8484
   ```

5. Use AskUserQuestion:
   > 브라우저에서 링크 관리를 마치면 알려주세요.

6. When user confirms, kill server:
   ```bash
   lsof -ti:8484 | xargs kill 2>/dev/null
   ```

## File Format

```markdown
# TASK_KEY

- [Label] https://example.com/link
- [Label] https://example.com/other
```

## Rules

- Do NOT modify task files directly during `manage` — the web GUI handles writes
- `get` outputs raw markdown content, not JSON
- Task keys: uppercase alphanumeric, underscores, hyphens
- All Bash commands that write files or access network require `dangerouslyDisableSandbox: true`
