#!/usr/bin/env bash
# Claude Code status line script
#
# Displays: model name / context usage / session cost / monthly usage (Pro)
#
# Dependencies: jq, curl, awk
#
# Limitations:
#   - macOS only (uses security command to retrieve OAuth token from Keychain)
#   - Requires Claude Code OAuth login (monthly usage not shown with API Key auth)
#   - Monthly usage section does not work on Linux
#
# Installation:
#   1. chmod +x statusline.sh
#   2. Add the following to ~/.claude/settings.json:
#        "statusCommand": "/path/to/statusline.sh"
#
# Manual refresh (invalidate cache and fetch immediately):
#   statusline.sh --refresh   or   statusline.sh -r
#   Command: usage-refresh (if registered as a global command, run the following)
#     printf '#!/usr/bin/env bash\n~/.claude/statusline.sh -r\n' > ~/.local/bin/usage-refresh
#     chmod +x ~/.local/bin/usage-refresh
#
# Queries actual usage via OAuth API (/api/oauth/usage), cache TTL 5 min

# --- Monthly usage cache ---
USAGE_CACHE="$HOME/.claude/statusline_usage_cache.json"
LOCK_FILE="${USAGE_CACHE}.lock"
CACHE_TTL=300

fetch_usage() {
    TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
        | jq -r '.claudeAiOauth.accessToken // empty')
    if [ -n "$TOKEN" ]; then
        resp=$(curl -sf --max-time 10 \
                "https://api.anthropic.com/api/oauth/usage" \
                -H "authorization: Bearer $TOKEN" \
                -H "anthropic-beta: oauth-2025-04-20" \
            -H "anthropic-version: 2023-06-01" 2>/dev/null)
        if [ -n "$resp" ]; then
            echo "$resp" | jq --argjson ts "$(date +%s)" '. + {cached_at: $ts}' \
                > "${USAGE_CACHE}.tmp" 2>/dev/null \
                && mv "${USAGE_CACHE}.tmp" "$USAGE_CACHE"
        fi
    fi
    rm -f "$LOCK_FILE"
}

# --- --refresh / -r: invalidate cache, fetch immediately, and exit ---
if [ "$1" = "--refresh" ] || [ "$1" = "-r" ]; then
    rm -f "$USAGE_CACHE" "$LOCK_FILE"
    fetch_usage
    if [ -f "$USAGE_CACHE" ]; then
        echo "Usage refreshed."
    else
        echo "Failed to fetch usage (no OAuth token or network error)."
    fi
    exit 0
fi

input=$(cat)

# --- Parse JSON in one pass ---
eval "$(echo "$input" | jq -r '
  "model=" + (.model.display_name // "Unknown" | @sh),
  "used_pct=" + (.context_window.used_percentage // "" | tostring | @sh),
  "session_cost=" + (.cost.total_cost_usd // 0 | tostring | @sh)
')"

# --- Colors ---
RESET=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'

# --- Model (shorten) ---
short_model=$(echo "$model" \
        | sed 's/^Claude //' \
        | sed 's/^Sonnet /S/' \
        | sed 's/^Haiku /H/' \
        | sed 's/^Opus /O/' \
        | sed 's/ Sonnet / S/' \
        | sed 's/ Haiku / H/' \
    | sed 's/ Opus / O/')

# --- Context bar ---
if [ -n "$used_pct" ]; then
    used_int=$(printf "%.0f" "$used_pct")
    filled=$(( used_int * 10 / 100 ))
    empty=$(( 10 - filled ))
    bar=$(printf '%0.s|' $(seq 1 $filled) 2>/dev/null)$(printf '%0.s.' $(seq 1 $empty) 2>/dev/null)

    if   [ "$used_int" -ge 80 ]; then bar_color="$RED"
    elif [ "$used_int" -ge 50 ]; then bar_color="$YELLOW"
    else                               bar_color="$GREEN"
    fi
    ctx_part="${bar_color}[${bar}]${RESET} ${DIM}${used_int}%${RESET}"
else
    ctx_part="${DIM}[ctx:--]${RESET}"
fi

# --- Session cost ---
cost_part=""
if awk -v c="$session_cost" 'BEGIN{exit !(c+0>0)}'; then
    cost_fmt=$(printf "%.3f" "$session_cost")
    cost_part=" ${DIM}\$${cost_fmt}${RESET}"
fi

# --- Monthly usage (check cache status and refresh) ---
monthly_part=""

refresh_needed=true
if [ -f "$USAGE_CACHE" ]; then
    cached_at=$(jq -r '.cached_at // 0' "$USAGE_CACHE" 2>/dev/null)
    age=$(( $(date +%s) - ${cached_at:-0} ))
    [ "$age" -lt "$CACHE_TTL" ] && refresh_needed=false
fi

if [ "$refresh_needed" = true ]; then
    if [ -f "$USAGE_CACHE" ]; then
        # Background refresh if cache exists (lock to prevent duplicates, remove stale lock after 30s)
        if [ -f "$LOCK_FILE" ]; then
            lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
            [ "$lock_age" -gt 30 ] && rm -f "$LOCK_FILE"
        fi
        if ( set -o noclobber; echo $$ > "$LOCK_FILE" ) 2>/dev/null; then
            fetch_usage &
        fi
    else
        # Synchronous fetch if no cache (show immediately on first run)
        fetch_usage
    fi
fi

# Read from cache in one pass
if [ -f "$USAGE_CACHE" ]; then
    eval "$(jq -r '
    .extra_usage // {} |
    "eu_enabled=" + (.is_enabled // false | tostring | @sh),
    "eu_limit=" + (.monthly_limit // 0 | tostring | @sh),
    "eu_used=" + (.used_credits // 0 | tostring | @sh),
    "eu_util=" + (.utilization // 0 | tostring | @sh)
  ' "$USAGE_CACHE" 2>/dev/null)"

    if [ "$eu_enabled" = "true" ]; then
        used_dollars=$(awk -v u="$eu_used" 'BEGIN{printf "%.2f", u/100}')
        remain_dollars=$(awk -v l="$eu_limit" -v u="$eu_used" 'BEGIN{printf "%.2f", (l-u)/100}')
        util_pct=$(awk -v u="$eu_util" 'BEGIN{printf "%.1f", u}')
        util_pct_int=$(printf "%.0f" "$util_pct")

        if   [ "$util_pct_int" -ge 80 ]; then ucol="$RED"
        elif [ "$util_pct_int" -ge 50 ]; then ucol="$YELLOW"
        else                               ucol="$GREEN"
        fi

        monthly_part=" ${DIM}│${RESET} ${ucol}M.${util_pct}%${RESET} ${DIM}U.\$${used_dollars} R.\$${remain_dollars}${RESET}"
    fi
fi

# --- Assemble ---
printf "${CYAN}${BOLD}%s${RESET}  %s%s%s\n" \
    "$short_model" \
    "$ctx_part" \
    "$cost_part" \
    "$monthly_part"
