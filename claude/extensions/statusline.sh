#!/usr/bin/env bash
# Claude Code status line script
#
# Displays: model name / context usage / session cost / plan quota (5h, 7d, monthly)
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

# --- Quota cache ---
USAGE_CACHE="$HOME/.claude/statusline_usage_cache.json"
LOCK_FILE="${USAGE_CACHE}.lock"
CACHE_TTL=300

fetch_usage() {
    # CCS: find the Keychain entry matching the active profile's subscriptionType
    CCS_CFG="$HOME/.ccs/config.yaml"
    if [ -f "$CCS_CFG" ]; then
        CCS_DEFAULT=$(sed -n 's/^default: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$CCS_CFG")
    fi
    if [ -n "$CCS_DEFAULT" ]; then
        # Search all Claude Code-credentials* entries for matching subscriptionType
        security dump-keychain 2>/dev/null \
            | sed -n 's/.*"svce"<blob>="\(Claude Code-credentials[^"]*\)".*/\1/p' \
            | while IFS= read -r svc; do
            cj=$(security find-generic-password -s "$svc" -w 2>/dev/null)
            st=$(echo "$cj" | jq -r '.claudeAiOauth.subscriptionType // empty')
            if [ "$st" = "$CCS_DEFAULT" ]; then
                echo "$cj" > "$TMPDIR/ccs_cred.tmp"
                echo "$st" > "$TMPDIR/ccs_sub.tmp"
                break
            fi
        done
        if [ -f "$TMPDIR/ccs_cred.tmp" ]; then
            cred_json=$(cat "$TMPDIR/ccs_cred.tmp")
            SUB_TYPE=$(cat "$TMPDIR/ccs_sub.tmp")
            rm -f "$TMPDIR/ccs_cred.tmp" "$TMPDIR/ccs_sub.tmp"
        fi
    fi
    # Fallback: default Keychain entry (standalone claude, no CCS)
    if [ -z "$cred_json" ]; then
        cred_json=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
        SUB_TYPE=$(echo "$cred_json" | jq -r '.claudeAiOauth.subscriptionType // empty')
    fi
    TOKEN=$(echo "$cred_json" | jq -r '.claudeAiOauth.accessToken // empty')
    if [ -n "$TOKEN" ]; then
        resp=$(curl -sf --max-time 10 \
                "https://api.anthropic.com/api/oauth/usage" \
                -H "authorization: Bearer $TOKEN" \
                -H "anthropic-beta: oauth-2025-04-20" \
            -H "anthropic-version: 2023-06-01" 2>/dev/null)
        if [ -n "$resp" ]; then
            echo "$resp" | jq --argjson ts "$(date +%s)" --arg st "$SUB_TYPE" \
                '. + {cached_at: $ts, subscription_type: $st}' \
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
    echo "$used_int" > /tmp/claude-context-pct
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

# --- Quota usage (check cache and refresh) ---
quota_part=""

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

# Read quota data from cache
if [ -f "$USAGE_CACHE" ]; then
    eval "$(jq -r '
    "sub_type=" + (.subscription_type // "" | @sh),
    "fh_util=" + (.five_hour.utilization // 0 | tostring | @sh),
    "fh_reset=" + (.five_hour.resets_at // "" | @sh),
    "sd_util=" + (.seven_day.utilization // 0 | tostring | @sh),
    "eu_enabled=" + (.extra_usage.is_enabled // false | tostring | @sh),
    "eu_limit=" + (.extra_usage.monthly_limit // 0 | tostring | @sh),
    "eu_used=" + (.extra_usage.used_credits // 0 | tostring | @sh),
    "eu_util=" + (.extra_usage.utilization // 0 | tostring | @sh)
  ' "$USAGE_CACHE" 2>/dev/null)"

    # Plan label
    case "$sub_type" in
        team)       plan_label="Team" ;;
        enterprise) plan_label="Ent" ;;
        max)        plan_label="Max" ;;
        pro)        plan_label="Pro" ;;
        *)          plan_label="${sub_type:-?}" ;;
    esac

    # 5-hour quota
    fh_pct=$(awk -v u="$fh_util" 'BEGIN{printf "%.0f", u}')
    if   [ "$fh_pct" -ge 80 ]; then fh_col="$RED"
    elif [ "$fh_pct" -ge 50 ]; then fh_col="$YELLOW"
    else                              fh_col="$GREEN"
    fi
    fh_part="${fh_col}5h:${fh_pct}%${RESET}"

    # Reset countdown (show whenever resets_at is in the future)
    if [ -n "$fh_reset" ]; then
        reset_ts="${fh_reset%%.*}"
        reset_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$reset_ts" +%s 2>/dev/null)
        if [ -n "$reset_epoch" ]; then
            now=$(date +%s)
            diff=$(( reset_epoch - now ))
            if [ "$diff" -gt 0 ]; then
                hours=$(( diff / 3600 ))
                mins=$(( (diff % 3600) / 60 ))
                if [ "$hours" -gt 0 ]; then
                    fh_part="${fh_part} ${DIM}↻${hours}h${mins}m${RESET}"
                else
                    fh_part="${fh_part} ${DIM}↻${mins}m${RESET}"
                fi
            fi
        fi
    fi

    # 7-day quota
    sd_pct=$(awk -v u="$sd_util" 'BEGIN{printf "%.0f", u}')
    if   [ "$sd_pct" -ge 80 ]; then sd_col="$RED"
    elif [ "$sd_pct" -ge 50 ]; then sd_col="$YELLOW"
    else                              sd_col="$GREEN"
    fi
    sd_part="${sd_col}7d:${sd_pct}%${RESET}"

    quota_part=" ${DIM}│${RESET} ${CYAN}${BOLD}${plan_label}${RESET} ${fh_part} ${DIM}·${RESET} ${sd_part}"

    # Monthly extra usage (Enterprise)
    if [ "$eu_enabled" = "true" ]; then
        used_dollars=$(awk -v u="$eu_used" 'BEGIN{printf "%.2f", u/100}')
        remain_dollars=$(awk -v l="$eu_limit" -v u="$eu_used" 'BEGIN{printf "%.2f", (l-u)/100}')
        util_pct=$(awk -v u="$eu_util" 'BEGIN{printf "%.1f", u}')
        util_pct_int=$(printf "%.0f" "$util_pct")

        if   [ "$util_pct_int" -ge 80 ]; then ucol="$RED"
        elif [ "$util_pct_int" -ge 50 ]; then ucol="$YELLOW"
        else                                   ucol="$GREEN"
        fi

        quota_part="${quota_part} ${DIM}·${RESET} ${ucol}M.${util_pct}%${RESET} ${DIM}U.\$${used_dollars} R.\$${remain_dollars}${RESET}"
    fi
fi

# --- Assemble ---
printf "${CYAN}${BOLD}%s${RESET}  %s%s%s\n" \
    "$short_model" \
    "$ctx_part" \
    "$cost_part" \
    "$quota_part"
