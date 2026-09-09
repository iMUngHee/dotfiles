#!/usr/bin/env bash
# InstructionsLoaded hook: log which instruction files are loaded
# Debugging aid for .claude/rules/ path-specific loading verification
# Set ENABLED=true to activate logging, false to silently skip
# Always exits 0 — informational only, never blocks

ENABLED=false
LOG_FILE="/tmp/claude/instructions-loaded.log"

if [[ "$ENABLED" != "true" ]]; then
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"

INPUT=$(cat)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
FILES=$(echo "$INPUT" | jq -r '.files // [] | .[]' 2>/dev/null)

if [[ -z "$FILES" ]]; then
  exit 0
fi

{
  echo "[$TIMESTAMP] Instructions loaded:"
  echo "$FILES" | while read -r f; do
    echo "  $f"
  done
  echo ""
} >> "$LOG_FILE"

# Rotate if > 512KB
#
# GNU spells the size -c %s and BSD -f %z, and GNU is asked first: BSD has no -c
# and refuses it printing nothing, while GNU does have -f — it means "file
# system" — and answers with a block of statistics instead. Asking BSD first is
# why this only ever rotated on macOS. The numeric guard makes a surprise from
# either one harmless: anything that is not a plain number reads as 0, which
# only ever skips a rotation.
MAX_SIZE=$((512 * 1024))
LOG_SIZE=$(stat -c %s "$LOG_FILE" 2>/dev/null || stat -f %z "$LOG_FILE" 2>/dev/null || echo 0)
case "$LOG_SIZE" in '' | *[!0-9]*) LOG_SIZE=0 ;; esac
if [[ -f "$LOG_FILE" ]] && [[ "$LOG_SIZE" -gt $MAX_SIZE ]]; then
  tail -100 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

exit 0
