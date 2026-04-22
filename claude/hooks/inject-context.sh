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
  # Collect plans matching this branch, sorted newest-first by filename (YYYY-MM-DD prefix)
  plans=()
  while IFS= read -r f; do
    plans+=("$f")
  done < <(grep -l "^branch: $BRANCH\$" "$PROJECT_DIR/.claude/plans/"*.md 2>/dev/null | sort -r)

  # Prefer an `active` plan (in-progress). Fall back to the most recent otherwise.
  # Guard against empty array — `"${plans[@]}"` under `set -u` in bash 3.2 (macOS)
  # is treated as unbound when the array has zero elements.
  PLAN_FILE=""
  if (( ${#plans[@]} > 0 )); then
    for f in "${plans[@]}"; do
      s=$(awk '/^status:/ { sub(/^status: ?/, ""); print; exit }' "$f")
      if [[ "$s" == "active" ]]; then
        PLAN_FILE="$f"
        break
      fi
    done
    if [[ -z "$PLAN_FILE" ]]; then
      PLAN_FILE="${plans[0]}"
    fi
  fi

  if [[ -n "$PLAN_FILE" ]]; then
    TITLE=$(awk '/^title:/ { sub(/^title: ?/, ""); print; exit }' "$PLAN_FILE")
    STATUS=$(awk '/^status:/ { sub(/^status: ?/, ""); print; exit }' "$PLAN_FILE")
    REL_PATH=${PLAN_FILE#"$PROJECT_DIR/"}
    case "$STATUS" in
      active)  LABEL="Active plan" ;;
      done)    LABEL="Recently completed plan" ;;
      dropped) LABEL="" ;;  # dropped plans carry no active context — skip injection
      *)       LABEL="Plan" ;;
    esac
    if [[ -n "$LABEL" ]]; then
      CONTEXT="$LABEL for branch '$BRANCH': \"$TITLE\" [${STATUS:-?}] — $REL_PATH"
    fi
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
