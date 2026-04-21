#!/usr/bin/env bash
# UserPromptSubmit hook: inject the active plan artifact title as additional context.
# Output: JSON { hookSpecificOutput: { hookEventName, additionalContext } }.
# Fail-open — any error yields empty context (never blocks the prompt).

set -euo pipefail

# Drain stdin (Claude Code passes JSON; this hook does not need the prompt body)
cat > /dev/null

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Current git branch (empty outside a repo)
BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")

CONTEXT=""

if [[ -n "$BRANCH" && -d "$PROJECT_DIR/.claude/plans" ]]; then
  # Find a plan whose frontmatter matches this branch
  PLAN_FILE=$(grep -l "^branch: $BRANCH\$" "$PROJECT_DIR/.claude/plans/"*.md 2>/dev/null | head -1)
  if [[ -n "$PLAN_FILE" ]]; then
    TITLE=$(awk '/^title:/ { sub(/^title: ?/, ""); print; exit }' "$PLAN_FILE")
    STATUS=$(awk '/^status:/ { sub(/^status: ?/, ""); print; exit }' "$PLAN_FILE")
    REL_PATH=${PLAN_FILE#"$PROJECT_DIR/"}
    CONTEXT="Active plan for branch '$BRANCH': \"$TITLE\" [${STATUS:-?}] — $REL_PATH"
  fi
fi

# TaskList summary (대협 Ab.iii): Claude Code does not currently expose the
# per-session task list via hook stdin or a stable filesystem location reachable
# from a subshell. Left as a placeholder — when a future release adds a readable
# source (e.g. `claude tasks list` or a session JSON path), plug it in here and
# append to $CONTEXT.

if [[ -z "$CONTEXT" ]]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  # jq missing — fail-open silently
  exit 0
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
