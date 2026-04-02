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

# --- Constants ---
USAGE_CACHE="$HOME/.claude/statusline_usage_cache.json"
LOCK_FILE="${USAGE_CACHE}.lock"
CACHE_TTL=300

# --- Colors ---
RESET=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'

color_by_pct() {
    if   [ "$1" -ge 80 ]; then printf '%s' "$RED"
    elif [ "$1" -ge 50 ]; then printf '%s' "$YELLOW"
    else                        printf '%s' "$GREEN"
    fi
}

# --- Credential resolution ---
# Sets: cred_json, SUB_TYPE
resolve_credentials() {
    local ccs_cfg="$HOME/.ccs/config.yaml" ccs_default=""

    if [ -f "$ccs_cfg" ]; then
        ccs_default=$(sed -n 's/^default: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$ccs_cfg")
    fi

    if [ -n "$ccs_default" ]; then
        # CCS active: search suffixed entries only (unsuffixed = orphaned pre-CCS token)
        # Prefer non-expired token; fall back to expired if none valid
        local now_ms=$(date +%s)000 fallback_cred="" fallback_sub=""
        while IFS= read -r svc; do
            local cj st exp
            cj=$(security find-generic-password -s "$svc" -w 2>/dev/null)
            st=$(echo "$cj" | jq -r '.claudeAiOauth.subscriptionType // empty')
            if [ "$st" = "$ccs_default" ]; then
                exp=$(echo "$cj" | jq -r '.claudeAiOauth.expiresAt // 0')
                if [ "$exp" -gt "$now_ms" ] 2>/dev/null; then
                    cred_json="$cj"; SUB_TYPE="$st"; return
                elif [ -z "$fallback_cred" ]; then
                    fallback_cred="$cj"; fallback_sub="$st"
                fi
            fi
        done < <(security dump-keychain 2>/dev/null \
            | sed -n 's/.*"svce"<blob>="\(Claude Code-credentials-[^"]\{1,\}\)".*/\1/p')

        if [ -n "$fallback_cred" ]; then
            cred_json="$fallback_cred"; SUB_TYPE="$fallback_sub"; return
        fi
    fi

    # Fallback: standalone Claude (no CCS)
    cred_json=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    SUB_TYPE=$(echo "$cred_json" | jq -r '.claudeAiOauth.subscriptionType // empty')
}

# --- Fetch usage from API ---
# Sets: FETCH_ERROR (empty on success)
fetch_usage() {
    FETCH_ERROR=""
    cred_json="" SUB_TYPE=""
    resolve_credentials

    local token
    token=$(echo "$cred_json" | jq -r '.claudeAiOauth.accessToken // empty')
    if [ -z "$token" ]; then
        FETCH_ERROR="no_token"; rm -f "$LOCK_FILE"; return
    fi

    local resp_file="$TMPDIR/statusline_resp.$$.tmp" http_code
    http_code=$(curl -s -o "$resp_file" -w "%{http_code}" --max-time 10 \
        "https://api.anthropic.com/api/oauth/usage" \
        -H "authorization: Bearer $token" \
        -H "anthropic-beta: oauth-2025-04-20" \
        -H "anthropic-version: 2023-06-01" 2>/dev/null)

    if [ "$http_code" = "200" ]; then
        jq --argjson ts "$(date +%s)" --arg st "$SUB_TYPE" \
            '. + {cached_at: $ts, subscription_type: $st}' \
            "$resp_file" > "${USAGE_CACHE}.$$.tmp" 2>/dev/null \
            && mv "${USAGE_CACHE}.$$.tmp" "$USAGE_CACHE"
    elif [ "$http_code" = "429" ]; then
        FETCH_ERROR="rate_limited"
    elif [ -n "$http_code" ] && [ "$http_code" != "000" ]; then
        FETCH_ERROR="http_${http_code}"
    else
        FETCH_ERROR="network"
    fi

    rm -f "$resp_file" "$LOCK_FILE"
}

# --- --refresh / -r: force fetch and exit ---
if [ "$1" = "--refresh" ] || [ "$1" = "-r" ]; then
    rm -f "$LOCK_FILE"
    fetch_usage
    if [ -n "$FETCH_ERROR" ]; then
        case "$FETCH_ERROR" in
            rate_limited) echo "Rate limited (429). Retry later." ;;
            no_token)     echo "No OAuth token found in Keychain." ;;
            network)      echo "Network error (timeout or unreachable)." ;;
            *)            echo "Fetch failed ($FETCH_ERROR)." ;;
        esac
        [ -f "$USAGE_CACHE" ] && echo "(stale cache preserved)"
    elif [ -f "$USAGE_CACHE" ]; then
        echo "Usage refreshed."
    else
        echo "Failed to fetch usage."
    fi
    exit 0
fi

# === Status line mode: read JSON from stdin ===
input=$(cat)

eval "$(echo "$input" | jq -r '
  "model=" + (.model.display_name // "Unknown" | @sh),
  "used_pct=" + (.context_window.used_percentage // "" | tostring | @sh),
  "session_cost=" + (.cost.total_cost_usd // 0 | tostring | @sh)
')"

# --- Model (shorten) ---
short_model=$(echo "$model" \
    | sed 's/^Claude //; s/^Sonnet /S/; s/^Haiku /H/; s/^Opus /O/; s/ Sonnet$/S/; s/ Haiku$/H/; s/ Opus$/O/; s/ Sonnet / S/; s/ Haiku / H/; s/ Opus / O/')

# --- Context bar ---
if [ -n "$used_pct" ]; then
    used_int=$(printf "%.0f" "$used_pct")
    echo "$used_int" > /tmp/claude-context-pct  # shared with hooks
    filled=$(( used_int * 10 / 100 ))
    empty=$(( 10 - filled ))
    bar=""
    [ "$filled" -gt 0 ] && bar=$(printf '%0.s|' $(seq 1 $filled))
    [ "$empty" -gt 0 ] && bar="${bar}$(printf '%0.s.' $(seq 1 $empty))"
    ctx_part="$(color_by_pct "$used_int")[${bar}]${RESET} ${DIM}${used_int}%${RESET}"
else
    ctx_part="${DIM}[ctx:--]${RESET}"
fi

# --- Session cost ---
cost_part=""
if awk -v c="$session_cost" 'BEGIN{exit !(c+0>0)}'; then
    cost_part=" ${DIM}\$$(printf "%.3f" "$session_cost")${RESET}"
fi

# --- Quota: background refresh with cache ---
quota_part=""
_now=$(date +%s)

refresh_needed=true
if [ -f "$USAGE_CACHE" ]; then
    cached_at=$(jq -r '.cached_at // 0' "$USAGE_CACHE" 2>/dev/null)
    [ $(( _now - ${cached_at:-0} )) -lt "$CACHE_TTL" ] && refresh_needed=false
fi

if [ "$refresh_needed" = true ]; then
    if [ -f "$USAGE_CACHE" ]; then
        # Background refresh; stale lock cleanup after 30s
        if [ -f "$LOCK_FILE" ]; then
            lock_age=$(( _now - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
            [ "$lock_age" -gt 30 ] && rm -f "$LOCK_FILE"
        fi
        if ( set -o noclobber; echo $$ > "$LOCK_FILE" ) 2>/dev/null; then
            fetch_usage &
        fi
    else
        fetch_usage  # synchronous on first run
    fi
fi

# --- Read cached quota data ---
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

    # 5-hour quota with reset countdown
    fh_pct=$(awk -v u="$fh_util" 'BEGIN{printf "%.0f", u}')
    fh_part="$(color_by_pct "$fh_pct")5h:${fh_pct}%${RESET}"

    if [ -n "$fh_reset" ]; then
        reset_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${fh_reset%%.*}" +%s 2>/dev/null)
        if [ -n "$reset_epoch" ]; then
            remaining=$(( reset_epoch - _now ))
            if [ "$remaining" -gt 0 ]; then
                h=$(( remaining / 3600 )) m=$(( (remaining % 3600) / 60 ))
                if [ "$h" -gt 0 ]; then fh_part="${fh_part} ${DIM}↻${h}h${m}m${RESET}"
                else                     fh_part="${fh_part} ${DIM}↻${m}m${RESET}"
                fi
            fi
        fi
    fi

    # 7-day quota
    sd_pct=$(awk -v u="$sd_util" 'BEGIN{printf "%.0f", u}')
    sd_part="$(color_by_pct "$sd_pct")7d:${sd_pct}%${RESET}"

    quota_part=" ${DIM}│${RESET} ${CYAN}${BOLD}${plan_label}${RESET} ${fh_part} ${DIM}·${RESET} ${sd_part}"

    # Monthly extra usage (Enterprise)
    if [ "$eu_enabled" = "true" ]; then
        used_dollars=$(awk -v u="$eu_used" 'BEGIN{printf "%.2f", u/100}')
        remain_dollars=$(awk -v l="$eu_limit" -v u="$eu_used" 'BEGIN{printf "%.2f", (l-u)/100}')
        util_pct=$(awk -v u="$eu_util" 'BEGIN{printf "%.1f", u}')
        util_int=$(printf "%.0f" "$util_pct")
        quota_part="${quota_part} ${DIM}·${RESET} $(color_by_pct "$util_int")M.${util_pct}%${RESET} ${DIM}U.\$${used_dollars} R.\$${remain_dollars}${RESET}"
    fi
fi

# --- Assemble ---
printf "${CYAN}${BOLD}%s${RESET}  %s%s%s\n" \
    "$short_model" "$ctx_part" "$cost_part" "$quota_part"
