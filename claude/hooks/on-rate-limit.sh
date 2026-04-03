#!/bin/bash
# StopFailure hook (matcher: rate_limit)
# Switch to alt CCS account, record origin account and reset time

CCS_CFG="$HOME/.ccs/config.yaml"
LOG_FILE="$HOME/.claude/hook-events.log"
RESET_FILE="$HOME/.claude/quota-switch-reset-time"

# Log event
{ echo "=== $(date '+%Y-%m-%d %H:%M:%S') rate_limit ==="; cat; echo; } >> "$LOG_FILE"

# Detect current instance (CLAUDE_CONFIG_DIR > config default)
CURRENT=$(basename "${CLAUDE_CONFIG_DIR:-}")
[ -z "$CURRENT" ] && CURRENT=$(sed -n 's/^default: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$CCS_CFG")
[ -z "$CURRENT" ] && exit 0

# Find alt account from CCS config
ALT=$(sed -n '/^accounts:/,/^[a-z]/{
/^  [a-z]/{
s/:.*//
s/^ *//
p
}
}' "$CCS_CFG" | grep -v "^${CURRENT}$" | head -1)
[ -z "$ALT" ] && exit 0

# Switch to alt
if command -v ccs >/dev/null 2>&1; then
    ccs auth default "$ALT" >> "$LOG_FILE" 2>&1
fi

# Record reset time from current account's cache (API data, not text parsing)
CURRENT_CACHE="$HOME/.claude/statusline_usage_cache_${CURRENT}.json"
if [ -f "$CURRENT_CACHE" ]; then
    RESET_ISO=$(jq -r '.five_hour.resets_at // ""' "$CURRENT_CACHE")
    if [ -n "$RESET_ISO" ]; then
        RESET_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${RESET_ISO:0:19}" +%s 2>/dev/null)
        if [ -n "$RESET_EPOCH" ]; then
            echo "${RESET_EPOCH}:${CURRENT}" > "$RESET_FILE"
            echo "Reset time: $(date -r "$RESET_EPOCH" '+%Y-%m-%d %H:%M:%S') origin=$CURRENT" >> "$LOG_FILE"
        fi
    fi
fi

exit 0
