#!/usr/bin/env bash
# PostToolUseFailure hook: log tool failures for debugging and pattern analysis
# Triggered only on tool failures (no grep filtering needed)
# Always exits 0 — informational only, never blocks
# Requires: jq

LOG_FILE="$HOME/.claude/tool-failures.log"
MAX_SIZE=$((1024 * 1024))  # 1MB

INPUT=$(cat)

# An interrupted tool is a decision, not a failure, and it reaches this event
# too. Logging it as an error buries the ones worth reading.
if printf '%s' "$INPUT" | jq -e '.is_interrupt == true' >/dev/null 2>&1; then
  exit 0
fi

# Log rotation: keep last 200 lines if > 1MB.
#
# GNU spells the size -c %s and BSD -f %z, and GNU is asked first: BSD has no -c
# and refuses it printing nothing, while GNU does have -f — it means "file
# system" — and answers with a block of statistics instead. The numeric guard is
# what makes a surprise from either one harmless: anything that is not a plain
# number reads as 0, which only ever skips a rotation.
LOG_SIZE=$(stat -c %s "$LOG_FILE" 2>/dev/null || stat -f %z "$LOG_FILE" 2>/dev/null || echo 0)
case "$LOG_SIZE" in '' | *[!0-9]*) LOG_SIZE=0 ;; esac
if [[ -f "$LOG_FILE" ]] && [[ "$LOG_SIZE" -gt $MAX_SIZE ]]; then
  tail -200 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

# The failure text is in .error. It is not in .tool_response, which this hook
# read for as long as it existed and which this event does not carry at all —
# so every entry was a timestamp and a tool name over an empty line.
#
# What failed matters as much as that something did, so the entry also names the
# subject: the command for Bash, the path for the file tools. First line only,
# and clipped, because a heredoc or a long path would otherwise be the whole
# log.
#
# jq formats the entry rather than the shell reading fields back out of it: on
# Windows a multi-line value carried through a command substitution keeps the
# CRs jq puts there, so the log would fill with them. Piping straight out and
# dropping every CR is right for a log file, which wants Unix line endings and
# has no use for a stray CR inside the error text.
printf '%s' "$INPUT" | jq -r --arg ts "$(date '+%Y-%m-%d %H:%M:%S')" '
  def subject:
    (.tool_input // {} | (.command // .file_path // .path // .pattern // ""))
    # split("") is [] rather than [""], so .[0] on a tool with no subject is
    # null and every later guard has to know it. Pinned back to a string here.
    | tostring | split("\n") | (.[0] // "") | .[0:160];
  "[\($ts)] tool=\(.tool_name // "unknown")"
    + (subject | if . == "" then "" else "  " + . end),
  ((.error // "(no error text)") | tostring | split("\n") | .[0:5] | .[] | "    " + .),
  ""
' 2>/dev/null | tr -d '\r' >> "$LOG_FILE"

exit 0
