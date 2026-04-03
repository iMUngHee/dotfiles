#!/bin/bash
# SessionStart hook (matcher: startup, clear)
# If rate-limited account's quota has reset, switch back to it

CCS_CFG="$HOME/.ccs/config.yaml"
RESET_FILE="$HOME/.claude/quota-switch-reset-time"
LOG_FILE="$HOME/.claude/hook-events.log"

NOW=$(date +%s)
RESET_EPOCH=""
ORIGIN=""

# Source 1: reset file (epoch:account written by on-rate-limit.sh)
if [ -f "$RESET_FILE" ]; then
    IFS=: read -r RESET_EPOCH ORIGIN < "$RESET_FILE"
fi

# Source 2: cache fallback — covers reset file deletion edge case
# Only triggers if alt account was heavily used (utilization >= 80), preventing
# false positives when user manually switched accounts at low usage.
if [ -z "$RESET_EPOCH" ]; then
    CURRENT=$(basename "${CLAUDE_CONFIG_DIR:-}")
    [ -z "$CURRENT" ] && CURRENT=$(sed -n 's/^default: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$CCS_CFG")
    [ -z "$CURRENT" ] && exit 0

    ORIGIN=$(sed -n '/^accounts:/,/^[a-z]/{
/^  [a-z]/{
s/:.*//
s/^ *//
p
}
}' "$CCS_CFG" | grep -v "^${CURRENT}$" | head -1)
    [ -z "$ORIGIN" ] && exit 0

    ORIGIN_CACHE="$HOME/.claude/statusline_usage_cache_${ORIGIN}.json"
    [ -f "$ORIGIN_CACHE" ] || exit 0

    ORIGIN_UTIL=$(jq -r '.five_hour.utilization // 0' "$ORIGIN_CACHE" 2>/dev/null)
    awk -v u="$ORIGIN_UTIL" 'BEGIN{exit !(u >= 80)}' || exit 0

    RESET_ISO=$(jq -r '.five_hour.resets_at // ""' "$ORIGIN_CACHE" 2>/dev/null)
    [ -n "$RESET_ISO" ] || exit 0
    RESET_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${RESET_ISO:0:19}" +%s 2>/dev/null)
fi

[ -z "$RESET_EPOCH" ] && exit 0
[ "$NOW" -lt "$RESET_EPOCH" ] && exit 0

# Reset time passed — switch to origin
{
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
    echo "Quota reset. Switching to ${ORIGIN}."
} >> "$LOG_FILE"

if command -v ccs >/dev/null 2>&1; then
    ccs auth default "$ORIGIN" >> "$LOG_FILE" 2>&1
fi

rm -f "$RESET_FILE"

echo "Quota has reset. Default switched to ${ORIGIN}." >&2
echo "Please restart with 'ccs'." >&2
exit 2
