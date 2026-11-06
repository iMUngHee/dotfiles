#!/usr/bin/env bash
# PostToolUse hook: bounded auto-format after file edits (no type checker).
set -euo pipefail

DEBOUNCE_SEC=30
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

input=$(cat)
# Codex custom tools pass a raw patch string instead of an argument object.
input=$(printf '%s' "$input" | jq 'if (.tool_input | type) == "string" then .tool_input = {command: .tool_input} else . end')
session_id=$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)
session_id="${session_id//[^a-zA-Z0-9_-]/}"

extract_paths() {
  printf '%s' "$input" | jq -r '
    .tool_input as $i |
    [
      $i.file_path?,
      $i.path?,
      $i.filename?,
      $i.source_path?,
      $i.destination_path?,
      $i.sourcePath?,
      $i.destinationPath?,
      ($i.files[]?.file_path?),
      ($i.files[]?.path?),
      ($i.edits[]?.file_path?),
      ($i.edits[]?.path?)
    ] | .[] | select(type == "string" and length > 0)
  ' 2>/dev/null

  printf '%s' "$input" | jq -r '
    .tool_input | [.command?, .patch?, .input?, .diff?] | .[] |
    select(type == "string")
  ' 2>/dev/null | awk '
    { sub(/\r$/, "") }
    /^\*\*\* (Add|Update|Delete) File: / {
      sub(/^\*\*\* (Add|Update|Delete) File: /, "")
      print
      next
    }
    /^\*\*\* Move to: / {
      sub(/^\*\*\* Move to: /, "")
      print
      next
    }
  '
}

paths=$(extract_paths | awk 'NF && !seen[$0]++')
[[ -n "$paths" ]] || exit 0

project_root=$(detect_project_root)
[[ -n "$project_root" ]] || exit 0

debounce_file="/tmp/codex-pipeline-last-${session_id:-default}"
if [[ -f "$debounce_file" ]]; then
  last=$(cat "$debounce_file" 2>/dev/null)
  now=$(date +%s)
  if [[ -n "$last" ]] && (( now - last < DEBOUNCE_SEC )); then
    exit 0
  fi
fi
date +%s > "$debounce_file"

feedback=""

while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  detect_formatter "$file" "$project_root"

  if [[ -f "$file" && -n "$FMT_CMD" ]]; then
    before=$(file_checksum "$file")
    if [[ -n "$before" ]]; then
      portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$file" &>/dev/null || true
      after=$(file_checksum "$file")
      if [[ "$before" != "$after" ]]; then
        fmt_name="${FMT_CMD%% *}"
        fmt_name="${fmt_name##*/}"
        feedback+="${feedback:+$'\n'}[codex auto-format] $fmt_name formatted $(basename "$file")"
      fi
    fi
  fi
done <<< "$paths"

# Plain stdout is ignored; bracket-prefixed text is treated as invalid JSON.
# Emit one event-specific object so the formatter feedback reaches the model.
if [[ -n "$feedback" ]]; then
  jq -n --arg context "$feedback" '{
    hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $context}
  }'
fi
exit 0
