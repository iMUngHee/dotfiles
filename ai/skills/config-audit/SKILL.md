---
name: config-audit
description: "Audit ~/.config/{ai,claude,codex}/ structure compliance — 3-tier layout, prefix convention, AGENTS.manifest sync, deploy model integrity, generated-file protection. TRIGGER when: creating/editing/moving config files in ~/.config/{ai,claude,codex}/ or {{TOOL_HOME}}/, or asked '구조 검토' / 'config audit'. SKIP project-local .claude/ config; unrelated dotfiles (zsh, vim, etc.); runtime debugging of the AI CLI binary."
allowed-tools: Bash, Read, Grep, Glob
model: sonnet
---

Audit `~/.config/{ai,claude,codex}/` structure for compliance with the 3-tier layout rules.

## Checks (tool-agnostic)

### 1. Tier violation
- A file in `claude/` whose body has NO Claude-specific dependency (no slash commands, no `Agent(subagent_type=...)`, no `EnterPlanMode`/`EnterWorktree`, no `~/.claude/`-only paths, no settings.json permissions) → suggest moving to `ai/`.
- A file in `codex/` whose body has NO Codex-specific dependency (no sandbox modes, no `codex exec`, no `~/.agents/skills/`, no `config.toml [mcp_servers.*]`-only refs) → suggest moving to `ai/`.
- A file in `ai/` whose body uses tool-only tokens or systems → split the tool-specific portion into the tool's directory.

### 2. Prefix violation
- File or skill directory directly under `claude/{rules,memory,skills}/` without `claude-` prefix → FAIL (move with rename).
- File or skill directory directly under `codex/{rules,memory,skills}/` without `codex-` prefix → FAIL.
- Any file under `ai/` with `claude-` or `codex-` prefix → FAIL (prefix is for tool-specific tiers only).

### 3. AGENTS.manifest drift
- A file in `ai/` (excluding `ai/skills/`, `ai/scripts/`, `ai/lib/`, `ai/.gitignore`, `ai/AGENTS.manifest` itself) NOT listed in `ai/AGENTS.manifest` → WARN (Codex will not see this file). Same as `ai/scripts/sync-back.sh --strict` would catch.
- A line in `ai/AGENTS.manifest` whose target file does not exist → FAIL.
- `feedback_token_substitution.md` not the first memory entry in the manifest → FAIL (Codex must see token rules before any token-using file).

### 4. Undefined tokens
- Any `{{[A-Z_]+}}` in `ai/` source files whose name is NOT in the defined token set ({{TOOL_HOME}}, {{TOOL_NAME}}, {{TOOL_NAME_LC}}, {{INSTRUCTIONS_FILE}}, {{CONFIG_FILE}}, {{PLAN_DIR}}, {{STATE_DIR}}) → FAIL. Either add to the token set + bootstrap expand functions, or replace with literal value.

### 5. Generated-file integrity
- `~/.claude/MEMORY.md` missing the `AUTO-GENERATED` header → FAIL (file was hand-edited or bootstrap is broken).
- `~/.codex/AGENTS.md` missing the `AUTO-GENERATED` header → FAIL.
- Bytes of `~/.codex/AGENTS.md` exceeding `project_doc_max_bytes` (read from `codex/config.toml.template`) → FAIL.

## Checks (tool-specific, run only when current tool matches)

### Claude
- `~/.claude/settings.json` hook entries reference scripts that exist under `claude/hooks/` → if a referenced script is missing, FAIL (dangling hook reference).
- `~/.claude/MEMORY.md` index entries reference files that exist under `~/.claude/memory/` (or its `private/` subdir) → FAIL on missing entry target, WARN on file-without-entry.
- `~/.claude/skills/<name>` symlinks resolve to a real directory under `ai/skills/` or `claude/skills/` → FAIL on broken symlink.

### Codex
- `~/.codex/config.toml` parses as valid TOML → FAIL on parse error.
- `[mcp_servers.<name>]` blocks have `command` (stdio) or `url` (HTTP) → WARN if neither.
- `project_doc_max_bytes` is set ≥ current AGENTS.md size → FAIL otherwise.
- `~/.agents/skills/<name>` symlinks resolve under `ai/skills/` or `codex/skills/` → FAIL on broken.

## Output

Report each FAIL/WARN with:
- File path (and line number when applicable)
- Rule violated
- Suggested fix (one line)

Group by Check 1–5 then tool-specific. End with a one-line summary: `N FAIL, M WARN, K PASS`.

## Rules

- Read-only — never modify files. Surface findings only.
- A check that does not apply (no relevant files exist) → report `— (n/a)`, not PASS.
- For Check 3, do not auto-update the manifest; that is the user's call.
