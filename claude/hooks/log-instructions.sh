#!/usr/bin/env bash
# InstructionsLoaded hook: log which instruction files are loaded
# Debugging aid for .claude/rules/ path-specific loading verification
# Set ENABLED=true to activate logging, false to silently skip
# Always exits 0 — informational only, never blocks

ENABLED=true
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
MAX_SIZE=$((512 * 1024))
if [[ -f "$LOG_FILE" ]] && [[ $(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0) -gt $MAX_SIZE ]]; then
  tail -100 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

exit 0
