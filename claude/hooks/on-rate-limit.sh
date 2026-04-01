#!/bin/bash
# StopFailure hook (matcher: rate_limit)
# Parse reset time from last_assistant_message, record it, switch to enterprise
# macOS (BSD date) compatible

LOG_FILE="$HOME/.claude/hook-events.log"
RESET_FILE="$HOME/.claude/quota-switch-reset-time"
INPUT=$(cat)

# Log the event
{
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
    echo "$INPUT" | jq . 2>/dev/null || echo "$INPUT"
    echo ""
} >> "$LOG_FILE"

# Extract last_assistant_message
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty')
if [ -z "$LAST_MSG" ]; then
    echo "No last_assistant_message in hook input" >> "$LOG_FILE"
    exit 0
fi

# Extract "resets ... (Timezone)" pattern
# Formats: "resets 2pm (Asia/Seoul)" or "resets Feb 20, 5pm (Asia/Seoul)"
RESET_INFO=$(echo "$LAST_MSG" | grep -oE 'resets? (at )?[0-9A-Za-z, :]+\([^)]+\)'  | sed 's/^resets\? //' | sed 's/^at //')
if [ -z "$RESET_INFO" ]; then
    echo "No reset time found in message: $LAST_MSG" >> "$LOG_FILE"
    exit 0
fi
echo "Found reset info: $RESET_INFO" >> "$LOG_FILE"

# Extract time (e.g., "2pm", "5:30pm")
TIME_PART=$(echo "$RESET_INFO" | grep -oE '[0-9]{1,2}(:[0-9]{2})? *[ap]m')
# Extract date (e.g., "Feb 20")
DATE_PART=$(echo "$RESET_INFO" | grep -oE '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{1,2}')
# Extract timezone (e.g., "Asia/Seoul")
TZ_PART=$(echo "$RESET_INFO" | grep -oE '\([^)]+\)' | tr -d '()')

# Parse hour and minute
HOUR=$(echo "$TIME_PART" | grep -oE '^[0-9]{1,2}')
MINUTE=$(echo "$TIME_PART" | sed -n 's/.*:\([0-9][0-9]\).*/\1/p')
[ -z "$MINUTE" ] && MINUTE="00"
AMPM=$(echo "$TIME_PART" | grep -oE '[ap]m')

if [ -z "$HOUR" ] || [ -z "$AMPM" ]; then
    echo "Failed to extract time components from: $TIME_PART" >> "$LOG_FILE"
    exit 0
fi

# Convert to 24-hour
if [ "$AMPM" = "pm" ] && [ "$HOUR" -ne 12 ]; then
    HOUR=$((HOUR + 12))
elif [ "$AMPM" = "am" ] && [ "$HOUR" -eq 12 ]; then
    HOUR=0
fi
TIME_24=$(printf "%02d:%s" "$HOUR" "$MINUTE")

# Build datetime and convert to epoch (BSD date)
if [ -n "$DATE_PART" ]; then
    YEAR=$(date "+%Y")
    DATETIME="$DATE_PART $YEAR $TIME_24"
    FMT="%b %d %Y %H:%M"
else
    DATETIME="$(date '+%Y-%m-%d') $TIME_24"
    FMT="%Y-%m-%d %H:%M"
fi

if [ -n "$TZ_PART" ]; then
    RESET_EPOCH=$(TZ="$TZ_PART" date -j -f "$FMT" "$DATETIME" +%s 2>/dev/null)
else
    RESET_EPOCH=$(date -j -f "$FMT" "$DATETIME" +%s 2>/dev/null)
fi

if [ -z "$RESET_EPOCH" ]; then
    echo "Failed to parse reset time: $DATETIME (TZ=$TZ_PART)" >> "$LOG_FILE"
    exit 0
fi

# If parsed time is in the past and no date part, assume next day
NOW_EPOCH=$(date +%s)
if [ "$RESET_EPOCH" -le "$NOW_EPOCH" ] && [ -z "$DATE_PART" ]; then
    RESET_EPOCH=$((RESET_EPOCH + 86400))
fi

# Record reset time
echo "$RESET_EPOCH" > "$RESET_FILE"
RESET_DISPLAY=$(date -r "$RESET_EPOCH" "+%Y-%m-%d %H:%M:%S")
echo "Auto-recorded quota reset time: $RESET_DISPLAY" >> "$LOG_FILE"

# Switch to enterprise profile
if command -v ccs >/dev/null 2>&1; then
    ccs auth default enterprise >> "$LOG_FILE" 2>&1
    echo "Switched default profile to enterprise" >> "$LOG_FILE"
else
    echo "CCS not found — run: /logout then login with Enterprise plan" >> "$LOG_FILE"
fi

exit 0
