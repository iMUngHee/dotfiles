#!/usr/bin/env bash
# Claude Code status line script
#
# Displays: model name / context usage / session cost / plan quota (5h, 7d, monthly)
# Optional: CCS multi-account hints (switch suggestion, alt-account reset countdown)
#
# Dependencies: jq, curl
# Platform:     macOS only (Keychain for OAuth tokens)
#
# Install: chmod +x statusline.sh
#          Add to ~/.claude/settings.json: "statusCommand": "/path/to/statusline.sh"
# Refresh: statusline.sh --refresh  (or -r)
#
# Pipeline: Config → Fetch → Parse → Render → Output

# ============================================================================
# 1. CONFIG
# ============================================================================
_ccs_cfg="$HOME/.ccs/config.yaml"
CCS_INSTANCE=""
CCS_ALT=""

# Detect CCS instance: CLAUDE_CONFIG_DIR (session-accurate) > config.yaml default
if [ -n "$CLAUDE_CONFIG_DIR" ]; then
    CCS_INSTANCE=$(basename "$CLAUDE_CONFIG_DIR")
fi
if [ -f "$_ccs_cfg" ]; then
    [ -z "$CCS_INSTANCE" ] && \
        CCS_INSTANCE=$(sed -n 's/^default: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$_ccs_cfg")
    CCS_ALT=$(sed -n '/^accounts:/,/^[a-z]/{
/^  [a-z]/{
s/:.*//
s/^ *//
p
}
}' "$_ccs_cfg" | grep -v "^${CCS_INSTANCE}$" | head -1)
fi

USAGE_CACHE="$HOME/.claude/statusline_usage_cache${CCS_INSTANCE:+_${CCS_INSTANCE}}.json"
LOCK_FILE="${USAGE_CACHE}.lock"
CACHE_TTL=300

# ============================================================================
# Constants & helpers
# ============================================================================
RESET=$'\033[0m'  BOLD=$'\033[1m'  DIM=$'\033[2m'
CYAN=$'\033[36m'  GREEN=$'\033[32m'  YELLOW=$'\033[33m'  RED=$'\033[31m'

color_by_pct() {
    if   [ "$1" -ge 80 ]; then printf '%s' "$RED"
    elif [ "$1" -ge 50 ]; then printf '%s' "$YELLOW"
    else                        printf '%s' "$GREEN"
    fi
}

# ISO 8601 → " ↻Xh Ym" or "" (past/invalid). Depends on global _now.
_fmt_countdown() {
    local epoch
    epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${1:0:19}" +%s 2>/dev/null) || return
    local s=$(( epoch - _now ))
    [ "$s" -le 0 ] && return
    local h=$(( s / 3600 )) m=$(( (s % 3600) / 60 ))
    if [ "$h" -gt 0 ]; then printf ' %s↻%dh%dm%s' "$DIM" "$h" "$m" "$RESET"
    else                     printf ' %s↻%dm%s' "$DIM" "$m" "$RESET"
    fi
}

# CCS hint: suggest switch or show alt-account reset countdown.
# Prints hint string or nothing. Pure function of parsed variables + alt cache.
_render_ccs_hint() {
    [ -n "$CCS_ALT" ] || return

    # Current account has 5h and nearly exhausted → suggest switch
    if [ "$fh_avail" = "true" ] && [ "$fh_pct" -ge 95 ]; then
        printf ' %s!ccs %s%s' "$YELLOW" "$CCS_ALT" "$RESET"; return
    fi

    # Current account has no 5h (e.g. enterprise) → show alt's reset status
    [ "$fh_avail" = "false" ] || return

    local alt_cache="$HOME/.claude/statusline_usage_cache_${CCS_ALT}.json"
    [ -f "$alt_cache" ] || return

    local alt_reset
    alt_reset=$(jq -r '.five_hour.resets_at // ""' "$alt_cache" 2>/dev/null)
    [ -n "$alt_reset" ] || return

    local countdown
    countdown=$(_fmt_countdown "$alt_reset")
    if [ -n "$countdown" ]; then printf ' %s%s%s%s' "$DIM" "$CCS_ALT" "$countdown" "$RESET"
    else                   printf ' %s%s ready%s' "$GREEN" "$CCS_ALT" "$RESET"
    fi
}

# ============================================================================
# 2. FETCH — credential resolution + API + cache
# ============================================================================

# Sets: cred_json, SUB_TYPE
resolve_credentials() {
    if [ -n "$CCS_INSTANCE" ]; then
        local now_ms=$(date +%s)000 fallback_cred="" fallback_sub=""
        while IFS= read -r svc; do
            local cj st exp
            cj=$(security find-generic-password -s "$svc" -w 2>/dev/null)
            st=$(echo "$cj" | jq -r '.claudeAiOauth.subscriptionType // empty')
            [ "$st" = "$CCS_INSTANCE" ] || continue
            exp=$(echo "$cj" | jq -r '.claudeAiOauth.expiresAt // 0')
            if [ "$exp" -gt "$now_ms" ] 2>/dev/null; then
                cred_json="$cj"; SUB_TYPE="$st"; return
            elif [ -z "$fallback_cred" ]; then
                fallback_cred="$cj"; fallback_sub="$st"
            fi
        done < <(security dump-keychain 2>/dev/null \
            | sed -n 's/.*"svce"<blob>="\(Claude Code-credentials-[^"]\{1,\}\)".*/\1/p')
        if [ -n "$fallback_cred" ]; then
            cred_json="$fallback_cred"; SUB_TYPE="$fallback_sub"; return
        fi
    fi
    # Standalone Claude (no CCS)
    cred_json=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    SUB_TYPE=$(echo "$cred_json" | jq -r '.claudeAiOauth.subscriptionType // empty')
}

# Sets: FETCH_ERROR (empty on success)
fetch_usage() {
    FETCH_ERROR=""
    cred_json="" SUB_TYPE=""
    resolve_credentials

    local token
    token=$(echo "$cred_json" | jq -r '.claudeAiOauth.accessToken // empty')
    if [ -z "$token" ]; then FETCH_ERROR="no_token"; rm -f "$LOCK_FILE"; return; fi

    local resp_file="${TMPDIR:-/tmp}/statusline_resp.$$.tmp" http_code
    http_code=$(curl -s -o "$resp_file" -w "%{http_code}" --max-time 10 \
        "https://api.anthropic.com/api/oauth/usage" \
        -H "authorization: Bearer $token" \
        -H "anthropic-beta: oauth-2025-04-20" \
        -H "anthropic-version: 2023-06-01" 2>/dev/null)

    if   [ "$http_code" = "200" ]; then
        jq --argjson ts "$(date +%s)" --arg st "$SUB_TYPE" \
            '. + {cached_at: $ts, subscription_type: $st}' \
            "$resp_file" > "${USAGE_CACHE}.$$.tmp" 2>/dev/null \
            && mv "${USAGE_CACHE}.$$.tmp" "$USAGE_CACHE"
    elif [ "$http_code" = "429" ];                            then FETCH_ERROR="rate_limited"
    elif [ -n "$http_code" ] && [ "$http_code" != "000" ];    then FETCH_ERROR="http_${http_code}"
    else                                                           FETCH_ERROR="network"
    fi
    rm -f "$resp_file" "$LOCK_FILE"
}

# --refresh mode
if [ "$1" = "--refresh" ] || [ "$1" = "-r" ]; then
    rm -f "$LOCK_FILE"; fetch_usage
    if [ -n "$FETCH_ERROR" ]; then
        case "$FETCH_ERROR" in
            rate_limited) echo "Rate limited (429). Retry later." ;;
            no_token)     echo "No OAuth token found in Keychain." ;;
            network)      echo "Network error (timeout or unreachable)." ;;
            *)            echo "Fetch failed ($FETCH_ERROR)." ;;
        esac
        [ -f "$USAGE_CACHE" ] && echo "(stale cache preserved)"
    elif [ -f "$USAGE_CACHE" ]; then echo "Usage refreshed."
    else                              echo "Failed to fetch usage."
    fi
    exit 0
fi

# ============================================================================
# 3. PARSE — stdin JSON + cache → shell variables
# ============================================================================
input=$(cat)
eval "$(echo "$input" | jq -r '
  "model=" + (.model.display_name // "Unknown" | @sh),
  "used_pct=" + (.context_window.used_percentage // "" | tostring | @sh),
  "session_cost=" + (.cost.total_cost_usd // 0 | tostring | @sh)
')"
_now=$(date +%s)

# --- Background cache refresh ---
_try_refresh() {
    local cached_at
    cached_at=$(jq -r '.cached_at // 0' "$USAGE_CACHE" 2>/dev/null)
    [ $(( _now - ${cached_at:-0} )) -lt "$CACHE_TTL" ] && return

    if [ ! -f "$USAGE_CACHE" ]; then fetch_usage; return; fi  # sync first run

    # Stale lock cleanup
    if [ -f "$LOCK_FILE" ]; then
        local age=$(( _now - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
        [ "$age" -gt 30 ] && rm -f "$LOCK_FILE"
    fi
    ( set -o noclobber; echo $$ > "$LOCK_FILE" ) 2>/dev/null && fetch_usage &
}
_try_refresh

# --- Parse cache (single jq — integers ready, no awk) ---
sub_type="" fh_avail="false" fh_pct=0 fh_reset="" sd_avail="false" sd_pct=0
eu_enabled="false" eu_pct=0 eu_pct_raw="0" eu_used="0" eu_remain="0"

if [ -f "$USAGE_CACHE" ]; then
    eval "$(jq -r '
      "sub_type="   + (.subscription_type // "" | @sh),
      "fh_avail="   + (if .five_hour != null then "true" else "false" end),
      "fh_pct="     + (.five_hour.utilization // 0 | round | tostring),
      "fh_reset="   + (.five_hour.resets_at // "" | @sh),
      "sd_avail="   + (if .seven_day != null then "true" else "false" end),
      "sd_pct="     + (.seven_day.utilization // 0 | round | tostring),
      "eu_enabled=" + (.extra_usage.is_enabled // false | tostring),
      "eu_pct="     + (.extra_usage.utilization // 0 | round | tostring),
      "eu_pct_raw=" + (.extra_usage.utilization // 0 | tostring | @sh),
      "eu_used="    + (.extra_usage.used_credits // 0 | . / 100 | tostring | @sh),
      "eu_remain="  + ((.extra_usage.monthly_limit // 0) - (.extra_usage.used_credits // 0) | . / 100 | tostring | @sh)
    ' "$USAGE_CACHE" 2>/dev/null)"
fi

# ============================================================================
# 4. RENDER
# ============================================================================

# Model
short_model=$(echo "$model" \
    | sed 's/^Claude //; s/^Sonnet /S/; s/^Haiku /H/; s/^Opus /O/; s/ Sonnet$/S/; s/ Haiku$/H/; s/ Opus$/O/; s/ Sonnet / S/; s/ Haiku / H/; s/ Opus / O/')

# Context bar (writes /tmp/claude/context-pct for context-monitor.sh hook)
if [ -n "$used_pct" ]; then
    used_int=$(printf "%.0f" "$used_pct")
    mkdir -p /tmp/claude 2>/dev/null
    echo "$used_int" > /tmp/claude/context-pct
    filled=$(( used_int * 10 / 100 )); empty=$(( 10 - filled ))
    bar=""; [ "$filled" -gt 0 ] && bar=$(printf '%0.s|' $(seq 1 $filled))
            [ "$empty"  -gt 0 ] && bar="${bar}$(printf '%0.s.' $(seq 1 $empty))"
    ctx_part="$(color_by_pct "$used_int")[${bar}]${RESET} ${DIM}${used_int}%${RESET}"
else
    ctx_part="${DIM}[ctx:--]${RESET}"
fi

# Cost (hide if zero)
cost_part=""
awk -v c="$session_cost" 'BEGIN{exit !(c+0>0)}' \
    && cost_part=" ${DIM}\$$(printf '%.3f' "$session_cost")${RESET}"

# Quota — plan-agnostic: render whichever fields the API provides
quota_part=""
if [ -n "$sub_type" ]; then
    case "$sub_type" in
        team) plan_label="Team" ;; enterprise) plan_label="Ent" ;;
        max)  plan_label="Max"  ;; pro)        plan_label="Pro" ;;
        *)    plan_label="$sub_type" ;;
    esac

    quota_part=" ${DIM}│${RESET} ${CYAN}${BOLD}${plan_label}${RESET}"
    _sep=""

    if [ "$fh_avail" = "true" ]; then
        fh_part="$(color_by_pct "$fh_pct")5h:${fh_pct}%${RESET}"
        [ -n "$fh_reset" ] && fh_part="${fh_part}$(_fmt_countdown "$fh_reset")"
        quota_part="${quota_part} ${fh_part}"; _sep=" ${DIM}·${RESET}"
    fi

    if [ "$sd_avail" = "true" ]; then
        quota_part="${quota_part}${_sep} $(color_by_pct "$sd_pct")7d:${sd_pct}%${RESET}"
        _sep=" ${DIM}·${RESET}"
    fi

    if [ "$eu_enabled" = "true" ]; then
        quota_part="${quota_part}${_sep} $(color_by_pct "$eu_pct")M.$(printf '%.1f' "$eu_pct_raw")%${RESET}"
        quota_part="${quota_part} ${DIM}U.\$$(printf '%.2f' "$eu_used") R.\$$(printf '%.2f' "$eu_remain")${RESET}"
    fi
fi

# ============================================================================
# 5. OUTPUT
# ============================================================================
printf "${CYAN}${BOLD}%s${RESET}\n%s%s%s%s\n" \
    "$short_model" "$ctx_part" "$cost_part" "$quota_part" "$(_render_ccs_hint)"
