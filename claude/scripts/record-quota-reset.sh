#!/bin/bash
# Manual fallback: record Team plan quota reset time
# Usage: record-quota-reset.sh 4h          # 4 hours from now
#        record-quota-reset.sh 30m         # 30 minutes from now
#        record-quota-reset.sh "2026-04-01 16:00"  # absolute time

RESET_FILE="$HOME/.claude/quota-switch-reset-time"
CCS_CFG="$HOME/.ccs/config.yaml"

if [ -z "$1" ]; then
    echo "Usage: $0 <duration or datetime>"
    echo "  $0 4h                    # 4 hours from now"
    echo "  $0 30m                   # 30 minutes from now"
    echo "  $0 '2026-04-01 16:00'   # absolute time"
    exit 1
fi

INPUT="$1"

if [[ "$INPUT" =~ ^([0-9]+)h$ ]]; then
    RESET_EPOCH=$(( $(date +%s) + ${BASH_REMATCH[1]} * 3600 ))
elif [[ "$INPUT" =~ ^([0-9]+)m$ ]]; then
    RESET_EPOCH=$(( $(date +%s) + ${BASH_REMATCH[1]} * 60 ))
else
    RESET_EPOCH=$(date -j -f "%Y-%m-%d %H:%M" "$INPUT" +%s 2>/dev/null)
    if [ -z "$RESET_EPOCH" ]; then
        echo "Error: Cannot parse '$INPUT'"
        exit 1
    fi
fi

CURRENT=$(basename "${CLAUDE_CONFIG_DIR:-}")
[ -z "$CURRENT" ] && [ -f "$CCS_CFG" ] && CURRENT=$(sed -n 's/^default: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$CCS_CFG")

if [ -z "$CURRENT" ]; then
    echo "Error: Cannot detect current CCS account (no CLAUDE_CONFIG_DIR and no $CCS_CFG)"
    exit 1
fi

RESET_DISPLAY=$(date -r "$RESET_EPOCH" "+%Y-%m-%d %H:%M:%S")
echo "${RESET_EPOCH}:${CURRENT}" > "$RESET_FILE"
echo "Quota reset time recorded: $RESET_DISPLAY"
echo ""
echo "Now switch: ccs enterprise"
echo "Auto-switch back to team after reset time."
