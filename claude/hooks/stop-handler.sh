#!/usr/bin/env bash
# Stop hook: final quality gate + notification (unified handler)
# Runs type checker on modified files before allowing completion.
# exit 2 = block stop (Claude continues working), exit 0 = allow stop
#
# Flow:
#   1. Check for modified files (unstaged + staged)
#   2. Detect project type, run checker with timeout
#   3. If fail + retries < 2 → exit 2 (block, no notification)
#   4. If pass or retries exhausted → notify + exit 0

MAX_RETRIES=2
CHECKER_TIMEOUT=30
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

INPUT=$(cat)

# Extract session_id for retry counter (fallback to PPID if unavailable)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SESSION_ID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
[[ -z "$SESSION_ID" ]] && SESSION_ID="$PPID"
COUNTER_FILE="/tmp/claude-final-gate-${SESSION_ID}"

# --- Helper: run existing notify.sh and exit ---
run_notify_and_exit() {
  rm -f "$TMPOUT" 2>/dev/null
  "$HOOK_DIR/notify.sh" stop <<< "$INPUT"
  exit 0
}

# --- Check for modified files ---
PROJECT_ROOT=$(detect_project_root)
if [[ -z "$PROJECT_ROOT" ]]; then
  run_notify_and_exit
fi

cd "$PROJECT_ROOT" || run_notify_and_exit

CHANGED_FILES=$(git diff --name-only 2>/dev/null; git diff --cached --name-only 2>/dev/null)
if [[ -z "$CHANGED_FILES" ]]; then
  # No modified files — read-only session, skip gate
  rm -f "$COUNTER_FILE"
  run_notify_and_exit
fi

# --- Detect project type from changed files ---
CHECK_CMD=""
for file in $CHANGED_FILES; do
  detect_checker "$file" "$PROJECT_ROOT"
  [[ -n "$CHECK_CMD" ]] && break
done

if [[ -z "$CHECK_CMD" ]]; then
  # No supported checker for this project
  rm -f "$COUNTER_FILE"
  run_notify_and_exit
fi

# --- Run checker ---
TMPOUT="/tmp/claude-final-gate-output-${SESSION_ID}"
portable_timeout "$CHECKER_TIMEOUT" bash -c "$CHECK_CMD" > "$TMPOUT" 2>&1
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  # Check passed — clean up counter, notify, allow stop
  rm -f "$COUNTER_FILE"
  run_notify_and_exit
fi

# --- Check failed: manage retry counter ---
CURRENT_COUNT=0
if [[ -f "$COUNTER_FILE" ]]; then
  CURRENT_COUNT=$(cat "$COUNTER_FILE" 2>/dev/null)
  [[ -z "$CURRENT_COUNT" ]] && CURRENT_COUNT=0
fi

if (( CURRENT_COUNT >= MAX_RETRIES )); then
  # Retries exhausted — warn and let through
  OUTPUT=$(head -10 "$TMPOUT")
  echo "[final-gate] ${LANG_LABEL} check failed after ${MAX_RETRIES} retries. Allowing stop."
  [[ -n "$OUTPUT" ]] && echo "$OUTPUT"
  rm -f "$COUNTER_FILE"
  run_notify_and_exit
fi

# Increment counter and block stop
echo $(( CURRENT_COUNT + 1 )) > "$COUNTER_FILE"
OUTPUT=$(head -20 "$TMPOUT")
echo "[final-gate] ${LANG_LABEL} check failed (attempt $(( CURRENT_COUNT + 1 ))/${MAX_RETRIES}). Fix and retry."
[[ -n "$OUTPUT" ]] && echo "$OUTPUT"
rm -f "$TMPOUT" 2>/dev/null
exit 2
