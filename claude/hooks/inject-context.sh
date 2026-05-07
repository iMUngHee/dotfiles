#!/usr/bin/env bash
# UserPromptSubmit hook: inject the current plan as additional context.
#
# Reads `.claude/state/current.txt` (a single-line plan path) and looks up the
# plan's frontmatter `status` to emit a status-aware label:
#   draft  → ⚙️ draft: <title> — <path>
#   active → ▶️ active: <title> — <path>
#   done|dropped|other → no inject
#
# Output: JSON { hookSpecificOutput: { hookEventName, additionalContext } }.
# Fail-open — any error yields empty context (never blocks the prompt).

set -euo pipefail

# Drain stdin (Claude Code passes JSON; this hook does not need the prompt body)
cat > /dev/null

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_FILE="$PROJECT_DIR/.claude/state/current.txt"

# No state pointer → nothing to inject
[[ -f "$STATE_FILE" ]] || exit 0

# Read the first non-empty line as the plan's relative path
PLAN_REL=$(awk 'NF { print; exit }' "$STATE_FILE")
[[ -n "$PLAN_REL" ]] || exit 0

PLAN_PATH="$PROJECT_DIR/$PLAN_REL"
[[ -f "$PLAN_PATH" ]] || exit 0   # plan deleted or moved → silent skip

# Extract a frontmatter scalar field, stripping inline `# ...` comments and
# trailing whitespace (defense in depth — natural-language triggers replace
# the inline-comment pattern, but a user or external tool could still add one).
extract() {
  awk -v key="$1" '
    $0 ~ "^"key":" {
      sub("^"key": ?", "")
      sub(/[[:space:]]*#.*$/, "")
      sub(/[[:space:]]+$/, "")
      print
      exit
    }
  ' "$PLAN_PATH"
}

STATUS=$(extract "status")
TITLE=$(extract "title")

case "$STATUS" in
  draft)  ICON="⚙️"; LABEL="draft"  ;;
  active) ICON="▶️"; LABEL="active" ;;
  *)      exit 0 ;;  # done | dropped | empty | unknown → no inject
esac

CONTEXT="$ICON $LABEL: $TITLE — $PLAN_REL"

# TaskList summary (Ab.iii): Claude Code does not currently expose the
# per-session task list via hook stdin or a stable filesystem location reachable
# from a subshell. Left as a placeholder — when a future release adds a readable
# source (e.g. `claude tasks list` or a session JSON path), plug it in here and
# append to $CONTEXT.

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
