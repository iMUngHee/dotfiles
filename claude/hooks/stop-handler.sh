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

# --- Helper: a gate stage failed — block with retry budget, then let through ---
# Reads $TMPOUT for the failure output. $1 is the label shown to Claude.
fail_gate() {
  local label="$1" count=0
  if [[ -f "$COUNTER_FILE" ]]; then
    count=$(cat "$COUNTER_FILE" 2>/dev/null)
    [[ -z "$count" ]] && count=0
  fi

  if (( count >= MAX_RETRIES )); then
    echo "[final-gate] ${label} failed after ${MAX_RETRIES} retries. Allowing stop."
    head -10 "$TMPOUT" 2>/dev/null
    rm -f "$COUNTER_FILE"
    run_notify_and_exit
  fi

  echo $(( count + 1 )) > "$COUNTER_FILE"
  echo "[final-gate] ${label} failed (attempt $(( count + 1 ))/${MAX_RETRIES}). Fix and retry."
  head -20 "$TMPOUT" 2>/dev/null
  rm -f "$TMPOUT" 2>/dev/null
  exit 2
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

# Dedup (unstaged and staged lists can overlap)
CHANGED_FILES=$(echo "$CHANGED_FILES" | sort -u)

# --- Stage 0: Auto-format modified files (covers post-edit-pipeline debounce gaps) ---
FORMATTED=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -f "$file" ]] || continue
  detect_checker "$file" "$PROJECT_ROOT"
  [[ -z "$FMT_CMD" ]] && continue
  BEFORE=$(md5 -q "$file" 2>/dev/null)
  portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$file" &>/dev/null
  AFTER=$(md5 -q "$file" 2>/dev/null)
  [[ "$BEFORE" != "$AFTER" ]] && FORMATTED=$((FORMATTED + 1))
done <<< "$CHANGED_FILES"
(( FORMATTED > 0 )) && echo "[final-gate] auto-formatted ${FORMATTED} file(s)"

TMPOUT="/tmp/claude-final-gate-output-${SESSION_ID}"

# --- Stage 1: Contract tests for this config repo ---
# Instruction files here are asserted by string match in ai/lib/*.test.mjs, and a
# doc-only change reaches no type checker — so without this stage, editing a rule
# out of guardrails.md or a DEVGUARD passes the gate untouched. That happened.
if [[ "$PROJECT_ROOT" == "$HOME/.config" ]] &&
   grep -qE '^(ai|claude|codex)/.*\.(md|sh)$' <<< "$CHANGED_FILES"; then
  CONTRACT_TESTS=()
  for t in ai/lib/session-routing-consumers.test.mjs ai/lib/inject-context-hooks.test.mjs; do
    [[ -f "$t" ]] && CONTRACT_TESTS+=("$t")
  done
  if (( ${#CONTRACT_TESTS[@]} > 0 )) && command -v node &>/dev/null; then
    portable_timeout 120 node --test "${CONTRACT_TESTS[@]}" > "$TMPOUT" 2>&1 || fail_gate "contract tests"
  fi
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

# --- Stage 2: Run type checker ---
portable_timeout "$CHECKER_TIMEOUT" bash -c "$CHECK_CMD" > "$TMPOUT" 2>&1 || fail_gate "${LANG_LABEL} check"

# All stages passed — clean up counter, notify, allow stop
rm -f "$COUNTER_FILE"
run_notify_and_exit
