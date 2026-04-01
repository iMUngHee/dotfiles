#!/bin/bash
# SessionStart hook (matcher: startup, clear)
# If Team plan quota reset time has passed, switch back to team profile

RESET_FILE="$HOME/.claude/quota-switch-reset-time"
LOG_FILE="$HOME/.claude/hook-events.log"

# No reset time recorded — nothing to do
[ ! -f "$RESET_FILE" ] && exit 0

RESET_EPOCH=$(cat "$RESET_FILE")
NOW_EPOCH=$(date +%s)

if [ "$NOW_EPOCH" -ge "$RESET_EPOCH" ]; then
    RESET_DISPLAY=$(date -r "$RESET_EPOCH" "+%Y-%m-%d %H:%M:%S")

    {
        echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
        echo "Quota reset time reached: $RESET_DISPLAY"
    } >> "$LOG_FILE"

    # Switch back to team profile
    if command -v ccs >/dev/null 2>&1; then
        ccs auth default team >> "$LOG_FILE" 2>&1
        echo "Switched default profile to team" >> "$LOG_FILE"
    fi

    rm -f "$RESET_FILE"

    # Block session (exit 2) to force restart with team profile
    echo "Team plan quota has reset ($RESET_DISPLAY)." >&2
    echo "Default profile switched to team." >&2
    echo "Please restart with 'ccs' to use Team plan." >&2
    exit 2
fi

exit 0
