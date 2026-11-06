#!/usr/bin/env bash
# Stop hook: bounded final quality gate, then shared notification.
set -euo pipefail

MAX_RETRIES=2
CHECKER_TIMEOUT=30
SUITE_TIMEOUT=300
SUITE_DEADLINE=$((SECONDS + SUITE_TIMEOUT))
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)
session_id="${session_id//[^a-zA-Z0-9_-]/}"
[[ -n "$session_id" ]] || session_id="$PPID"

counter_file="/tmp/codex-final-gate-${session_id}"
tmp_out="/tmp/codex-final-gate-output-${session_id}"

notify_and_exit() {
  rm -f "$tmp_out" 2>/dev/null
  "$HOOK_DIR/notify.sh" stop <<< "$input" || true
  exit 0
}

# A gate stage failed: block with the retry budget, then let through.
# Reads "$tmp_out" for the failure output. $1 is the label shown to the agent.
fail_gate() {
  local label="$1" current_count=0
  if [[ -f "$counter_file" ]]; then
    current_count=$(cat "$counter_file" 2>/dev/null || echo 0)
    [[ "$current_count" =~ ^[0-9]+$ ]] || current_count=0
  fi

  if (( current_count >= MAX_RETRIES )); then
    echo "[codex final-gate] ${label} failed after ${MAX_RETRIES} retries. Allowing stop." >&2
    head -10 "$tmp_out" >&2 2>/dev/null || true
    rm -f "$counter_file"
    notify_and_exit
  fi

  echo $((current_count + 1)) > "$counter_file"
  echo "[codex final-gate] ${label} failed (attempt $((current_count + 1))/${MAX_RETRIES}). Fix and retry." >&2
  head -20 "$tmp_out" >&2 2>/dev/null || true
  rm -f "$tmp_out" 2>/dev/null
  exit 2
}

project_root=$(detect_project_root)
[[ -n "$project_root" ]] || notify_and_exit

cd "$project_root" || notify_and_exit

# Keep Unicode filenames literal so file checks and formatters see real paths.
tracked_files=$(git -c core.quotePath=false diff --name-only 2>/dev/null; git -c core.quotePath=false diff --cached --name-only 2>/dev/null)
changed_files=$(printf '%s\n' "$tracked_files"; git -c core.quotePath=false ls-files --others --exclude-standard 2>/dev/null)
[[ -n "$changed_files" ]] || {
  rm -f "$counter_file"
  notify_and_exit
}

changed_files=$(printf '%s\n' "$changed_files" | sort -u)
tracked_files=$(printf '%s\n' "$tracked_files" | sort -u)

# Only tracked changes may be auto-formatted; untracked files select suites only.
formatted=0
while IFS= read -r file; do
  (( SECONDS < SUITE_DEADLINE )) || break
  [[ -n "$file" && -f "$file" ]] || continue
  detect_checker "$file" "$project_root"
  [[ -n "$FMT_CMD" ]] || continue
  before=$(file_checksum "$file")
  portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$file" &>/dev/null || true
  after=$(file_checksum "$file")
  [[ -n "$before" && "$before" != "$after" ]] && formatted=$((formatted + 1))
done <<< "$tracked_files"

if (( formatted > 0 )); then
  jq -n --arg message "[codex final-gate] auto-formatted ${formatted} file(s)" '{systemMessage: $message}'
fi

# Run one suite from a subdirectory, failing the gate on nonzero.
run_suite() {
  local label="$1" dir="$2"; shift 2
  local remaining=$((SUITE_DEADLINE - SECONDS))
  if (( remaining <= 0 )); then
    echo "shared suite budget exhausted" > "$tmp_out"
    fail_gate "$label"
  fi
  set +e
  ( cd "$project_root/$dir" 2>/dev/null && portable_timeout "$remaining" "$@" ) > "$tmp_out" 2>&1
  local rc=$?
  set -e
  (( rc == 0 )) || fail_gate "$label"
}

# Stage 1: this repo's own suites, selected by changed path. Mirrors the same
# stage in claude/hooks/stop-handler.sh. The suites existed but were wired to
# nothing, so a change could ship them red — that is how a rule asserted
# verbatim by ai/lib/*.test.mjs got deleted. Triggers are scoped so untouched
# areas cost nothing (pm-roadmap alone is ~50s).
# -ef compares the directory itself, including Git's C:/ and MSYS's /c/ paths.
if [[ "$project_root" -ef "$HOME/.config" ]] && command -v node &>/dev/null; then
  if grep -qE '^(ai|claude|codex)/.*\.(md|sh)$' <<< "$changed_files"; then
    run_suite "contract tests" . \
      node --test ai/lib/session-routing-consumers.test.mjs ai/lib/inject-context-hooks.test.mjs
  fi
  if grep -qE '^ai/lib/' <<< "$changed_files"; then
    run_suite "ai/lib suite" . bash -c 'node --test ai/lib/*.test.mjs'
  fi
  if grep -qE '^ai/skills/pm-roadmap/' <<< "$changed_files"; then
    run_suite "pm-roadmap tests" ai/skills/pm-roadmap npm test --silent
  fi
  if grep -qE '^ai/skills/pm-context/' <<< "$changed_files"; then
    run_suite "pm-context tests" ai/skills/pm-context npm test --silent
  fi
  if grep -qE '^ai/skills/config-audit/' <<< "$changed_files" && command -v go &>/dev/null; then
    run_suite "config-audit go tests" ai/skills/config-audit/scripts go test ./...
  fi
fi

# Stage 2: type check
# Every distinct checker the changed files call for, in order: one per Rust
# workspace or lone crate, one for a checker that covers the whole project
# (tsc, go vet), so the same command runs once. Taking only the first left a
# second crate, or a second language, unchecked.
# ${a[@]+"${a[@]}"}: macOS /bin/bash 3.2 calls an empty array unbound under set -u.
check_cmds=() check_labels=()
while IFS= read -r file; do
  CHECK_CMD="" LANG_LABEL=""
  detect_checker "$file" "$project_root"
  [[ -n "$CHECK_CMD" ]] || continue
  seen=0
  for cmd in ${check_cmds[@]+"${check_cmds[@]}"}; do
    [[ "$cmd" == "$CHECK_CMD" ]] && { seen=1; break; }
  done
  (( seen )) || { check_cmds+=("$CHECK_CMD"); check_labels+=("$LANG_LABEL"); }
done <<< "$changed_files"

(( ${#check_cmds[@]} > 0 )) || {
  rm -f "$counter_file"
  notify_and_exit
}

# The checkers share one CHECKER_TIMEOUT budget, so the hook's registered
# timeout still covers suites plus checks. A check that runs out of time has
# found nothing: a cold build of a large crate can outlast the budget, and
# blocking on its progress output would ask for a fix to code that may be
# fine. Say so and go on; the first check that fails blocks.
check_deadline=$((SECONDS + CHECKER_TIMEOUT))
for i in "${!check_cmds[@]}"; do
  LANG_LABEL=${check_labels[$i]}
  remaining=$((check_deadline - SECONDS))
  if (( remaining <= 0 )); then
    echo "[final-gate] ${LANG_LABEL} check not started: the ${CHECKER_TIMEOUT}s check budget is spent — not checked." >&2
    continue
  fi
  set +e
  portable_timeout "$remaining" bash -c "${check_cmds[$i]}" > "$tmp_out" 2>&1
  exit_code=$?
  set -e
  if [[ $exit_code -eq 124 ]]; then
    echo "[final-gate] ${LANG_LABEL} check did not finish within ${CHECKER_TIMEOUT}s — not checked; allowing stop." >&2
  elif [[ $exit_code -ne 0 ]]; then
    fail_gate "${LANG_LABEL} check"
  fi
done

rm -f "$counter_file"
notify_and_exit
