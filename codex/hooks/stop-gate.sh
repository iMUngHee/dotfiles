#!/usr/bin/env bash
# Stop hook: bounded final quality gate, then shared notification.
set -euo pipefail

MAX_RETRIES=2
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
  detect_formatter "$file" "$project_root"
  [[ -n "$FMT_CMD" ]] || continue
  before=$(file_checksum "$file")
  portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$file" &>/dev/null || true
  after=$(file_checksum "$file")
  [[ -n "$before" && "$before" != "$after" ]] && formatted=$((formatted + 1))
done <<< "$tracked_files"

if (( formatted > 0 )); then
  jq -n --arg message "[codex final-gate] auto-formatted ${formatted} file(s)" '{systemMessage: $message}'
fi

# Skip suites for a tree state that already passed. Mirrors the same stage in
# claude/hooks/stop-handler.sh: the changed set is the whole working tree, so
# another session's uncommitted edits select the same suites on every Stop
# (ai/lib alone is ~80s). The key covers what selects the suites (the path
# list, read before keying so another session's edit can fall between, and
# which runners are on PATH), HEAD, the unstaged and staged diffs apart and
# every untracked file's content, so any edit by any session runs the suites
# again. Gitignored inputs such as node_modules and runner versions are not
# keyed. Computed only in ~/.config, the one root with suites.
tree_key() {
  local untracked runner
  printf '%s\n' "$changed_files"
  for runner in node go; do printf '%s=%s\n' "$runner" "$(command -v "$runner" || true)"; done
  git rev-parse HEAD || return
  git diff --binary || return
  git diff --cached --binary || return
  untracked=$(git -c core.quotePath=false ls-files --others --exclude-standard) || return
  printf '%s\n' "$untracked"
  [[ -z "$untracked" ]] || git hash-object --stdin-paths <<< "$untracked"
}
current_key() { tree_key 2>/dev/null | git hash-object --stdin; }
pass_file=""
passed_key=""
if [[ "$project_root" -ef "$HOME/.config" ]]; then
  pass_file=$(git rev-parse --git-path codex-final-gate-pass 2>/dev/null || true)
  passed_key=$(current_key) || passed_key=""
  if [[ -n "$passed_key" && -f "$pass_file" && "$(cat "$pass_file" 2>/dev/null)" == "$passed_key" ]]; then
    # stdout carries one JSON object; a format notice above already used it.
    if (( formatted == 0 )); then
      jq -n --arg message "[codex final-gate] suites skipped: this tree state already passed" '{systemMessage: $message}'
    fi
    rm -f "$counter_file"
    notify_and_exit
  fi
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
  elif grep -qE '^ai/skills/project-bootstrap/assets/' <<< "$changed_files"; then
    run_suite "project-bootstrap builder" . node --test ai/lib/project-bootstrap.test.mjs
  fi
  if grep -qE '^ai/skills/pm-roadmap/' <<< "$changed_files"; then
    run_suite "pm-roadmap tests" ai/skills/pm-roadmap npm test --silent
  fi
  if grep -qE '^ai/skills/pm-context/' <<< "$changed_files"; then
    run_suite "pm-context tests" ai/skills/pm-context npm test --silent
  fi
  if grep -qE '^ai/skills/product-craft/scripts/' <<< "$changed_files"; then
    run_suite "product-craft script tests" . bash -c 'shopt -s failglob; node --test ai/skills/product-craft/scripts/*.test.mjs'
  fi
  # Any .md under the tiers too: TestRepoFrontmatterParses is the only strict
  # YAML parse memory, rule and agent frontmatter gets.
  if grep -qE '^ai/skills/config-audit/|^(ai|claude|codex)/.*\.md$' <<< "$changed_files" && command -v go &>/dev/null; then
    run_suite "config-audit go tests" ai/skills/config-audit/scripts go test ./...
  fi
fi

# No type checker runs here: that belongs to each project and to the
# language skills.
# Another session can edit the tree while the suites run, so record only when
# it still matches the state keyed before them.
if [[ -n "$passed_key" && -n "$pass_file" && "$(current_key)" == "$passed_key" ]]; then
  { printf '%s\n' "$passed_key" > "$pass_file"; } 2>/dev/null || true
fi
rm -f "$counter_file"
notify_and_exit
