#!/usr/bin/env bash
# Claude Code status line script
#
# Displays: model name / context usage / session cost / plan quota or proxy status
# Supports: Anthropic OAuth accounts (ccs team/enterprise) and API/proxy profiles (ccs namc)
#
# Dependencies: jq, curl
# Platform:     macOS only (Keychain for OAuth tokens)
#
# Install: chmod +x statusline.sh
#          Add to ~/.claude/settings.json: "statusCommand": "/path/to/statusline.sh"
# Refresh: statusline.sh --refresh  (or -r)

# ============================================================================
# CONSTANTS
# ============================================================================
RESET=$'\033[0m'  BOLD=$'\033[1m'  DIM=$'\033[2m'
CYAN=$'\033[36m'  GREEN=$'\033[32m'  YELLOW=$'\033[33m'  RED=$'\033[31m'
_BARS="||||||||||" _DOTS=".........."
_CCS_CFG="$HOME/.ccs/config.yaml"
_LITELLM_CFG="$HOME/.litellm/config.yaml"
_CACHE_TTL_DEFAULT=300

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================
color_by_pct() {
    if   [ "$1" -ge 80 ]; then printf '%s' "$RED"
    elif [ "$1" -ge 50 ]; then printf '%s' "$YELLOW"
    else                        printf '%s' "$GREEN"
    fi
}

# ISO 8601 → " ↻Xh Ym" or "". Requires _now to be set.
fmt_countdown() {
    local epoch
    epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${1:0:19}" +%s 2>/dev/null) || return
    local s=$(( epoch - _now ))
    [ "$s" -le 0 ] && return
    local h=$(( s / 3600 )) m=$(( (s % 3600) / 60 ))
    if [ "$h" -gt 0 ]; then printf ' %s↻%dh%dm%s' "$DIM" "$h" "$m" "$RESET"
    else                     printf ' %s↻%dm%s' "$DIM" "$m" "$RESET"
    fi
}

# ============================================================================
# CONFIG FUNCTIONS
# ============================================================================
detect_mode() {
    MODE="oauth"
    local base_url="${ANTHROPIC_BASE_URL:-}"
    case "$base_url" in
        http://localhost:*|http://127.0.0.1:*|http://0.0.0.0:*|\
        https://localhost:*|https://127.0.0.1:*|https://0.0.0.0:*)
            MODE="proxy" ;;
        https://*.anthropic.com*|https://api.anthropic.com*|"")
            MODE="oauth" ;;
        *)  MODE="proxy" ;;
    esac
}

init_oauth_config() {
    CCS_INSTANCE="" CCS_ALT=""
    [ -n "$CLAUDE_CONFIG_DIR" ] && CCS_INSTANCE=$(basename "$CLAUDE_CONFIG_DIR")
    if [ -f "$_CCS_CFG" ]; then
        [ -z "$CCS_INSTANCE" ] && \
            CCS_INSTANCE=$(sed -n 's/^default: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$_CCS_CFG")
        CCS_ALT=$(sed -n '/^accounts:/,/^[a-z]/{
/^  [a-z]/{
s/:.*//
s/^ *//
p
}
}' "$_CCS_CFG" | grep -v "^${CCS_INSTANCE}$" | head -1)
    fi
    USAGE_CACHE="$HOME/.claude/statusline_usage_cache${CCS_INSTANCE:+_${CCS_INSTANCE}}.json"
    LOCK_FILE="${USAGE_CACHE}.lock"
}

init_proxy_config() {
    PROXY_URL="${ANTHROPIC_BASE_URL:-}"
    PROFILE_NAME="" PROXY_HEALTH="unknown"
    [ -f "$_CCS_CFG" ] || return
    while IFS= read -r _pname; do
        [ -z "$_pname" ] && continue
        local sf="$HOME/.ccs/${_pname}.settings.json"
        [ -f "$sf" ] || continue
        local bu
        bu=$(jq -r '.env.ANTHROPIC_BASE_URL // ""' "$sf" 2>/dev/null)
        if [ "$bu" = "$PROXY_URL" ]; then
            PROFILE_NAME="$_pname"; break
        fi
    done < <(awk '/^profiles:/{p=1;next} p && /^[a-z]/{exit} p && /^  [a-z]/{gsub(/:.*|^ */,"");print}' "$_CCS_CFG")
}

resolve_backend() {
    local alias="$1"
    [ -f "$_LITELLM_CFG" ] && [ -n "$alias" ] || return
    awk -v m="$alias" '
        /^_.*: &/{aname=$2; sub(/^&/,"",aname); anchors[aname]=$NF}
        /- model_name:/{name=$NF}
        name==m && /model:/{
            val=$NF
            if(val~/^\*/){ref=val; sub(/^\*/,"",ref); val=anchors[ref]}
            sub(/.*\//,"",val); print val; exit
        }
    ' "$_LITELLM_CFG"
}

# ============================================================================
# FETCH FUNCTIONS
# ============================================================================
resolve_credentials() {
    cred_json="" SUB_TYPE=""
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
    cred_json=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    SUB_TYPE=$(echo "$cred_json" | jq -r '.claudeAiOauth.subscriptionType // empty')
}

fetch_usage() {
    FETCH_ERROR=""
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
    elif [ "$http_code" = "429" ];                          then FETCH_ERROR="rate_limited"
    elif [ -n "$http_code" ] && [ "$http_code" != "000" ];  then FETCH_ERROR="http_${http_code}"
    else                                                         FETCH_ERROR="network"
    fi
    rm -f "$resp_file" "$LOCK_FILE"
}

check_proxy_health() {
    PROXY_HEALTH="unknown"
    [ -z "$PROXY_URL" ] && return
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 \
        "${PROXY_URL}/health/liveliness" 2>/dev/null)
    if [ "$code" = "200" ]; then PROXY_HEALTH="ok"
    else                         PROXY_HEALTH="down"
    fi
}

handle_refresh() {
    if [ "$MODE" = "proxy" ]; then
        check_proxy_health
        local backend
        backend=$(resolve_backend "${ANTHROPIC_MODEL:-}")
        echo "Profile: ${PROFILE_NAME:-proxy}"
        echo "Backend: ${backend:-unknown}"
        echo "Proxy:   ${PROXY_HEALTH} (${PROXY_URL})"
        return
    fi
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
}

# ============================================================================
# PARSE FUNCTIONS
# ============================================================================
parse_stdin() {
    eval "$(cat | jq -r '
      "model=" + (.model.display_name // "Unknown" | @sh),
      "model_id=" + (.model.id // "" | @sh),
      "used_pct=" + (.context_window.used_percentage // "" | tostring | @sh),
      "session_cost=" + (.cost.total_cost_usd // 0 | tostring | @sh),
      "session_id=" + (.session_id // "" | @sh),
      "cache_read=" + (.context_window.current_usage.cache_read_input_tokens // 0 | tostring),
      "cache_create=" + (.context_window.current_usage.cache_creation_input_tokens // 0 | tostring),
      "input_tk=" + (.context_window.current_usage.input_tokens // 0 | tostring)
    ')"
    _now=$(date +%s)
}

# Single jq: extract cache metadata (for TTL) + all display fields
parse_cache() {
    [ -f "$USAGE_CACHE" ] || return 1
    eval "$(jq -r '
      "cached_at="  + (.cached_at // 0 | tostring),
      "_max_pct="   + ([.five_hour.utilization, .seven_day.utilization, .extra_usage.utilization] | map(. // 0) | max | round | tostring),
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
}

# Adaptive TTL refresh + cache field extraction
refresh_and_parse_cache() {
    sub_type="" fh_avail="false" fh_pct=0 fh_reset="" sd_avail="false" sd_pct=0
    eu_enabled="false" eu_pct=0 eu_pct_raw="0" eu_used="0" eu_remain="0"
    local cached_at=0 _max_pct=0

    # Parse existing cache; sync fetch if none exists
    if ! parse_cache; then
        fetch_usage
        parse_cache || return
    fi

    # Adaptive TTL: shorter interval when any quota is high
    local ttl=$_CACHE_TTL_DEFAULT age=$(( _now - ${cached_at:-0} ))
    if   [ "${_max_pct:-0}" -ge 80 ]; then ttl=60
    elif [ "${_max_pct:-0}" -ge 50 ]; then ttl=120
    fi
    [ "$age" -lt "$ttl" ] && return

    # Extremely stale (2×TTL) → sync refresh + re-parse
    if [ "$age" -ge $(( ttl * 2 )) ]; then
        fetch_usage; parse_cache; return
    fi

    # Normal stale → background refresh (current parsed data is acceptable)
    if [ -f "$LOCK_FILE" ]; then
        local lock_age=$(( _now - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
        [ "$lock_age" -gt 30 ] && rm -f "$LOCK_FILE"
    fi
    ( set -o noclobber; echo $$ > "$LOCK_FILE" ) 2>/dev/null && fetch_usage &
}

# ============================================================================
# RENDER FUNCTIONS
# ============================================================================
render_model() {
    local short
    if [ "$MODE" = "proxy" ]; then
        short=$(resolve_backend "$model_id")
        [ -z "$short" ] && short=$(resolve_backend "${ANTHROPIC_MODEL:-}")
        [ -z "$short" ] && short="$model_id"
    else
        short=$(echo "$model" \
            | sed 's/^Claude //; s/^Sonnet /S/; s/^Haiku /H/; s/^Opus /O/; s/ Sonnet$/S/; s/ Haiku$/H/; s/ Opus$/O/; s/ Sonnet / S/; s/ Haiku / H/; s/ Opus / O/')
    fi
    printf '%s%s%s' "$CYAN$BOLD" "$short" "$RESET"
}

render_context() {
    if [ -z "$used_pct" ]; then
        printf '%s[ctx:--]%s' "$DIM" "$RESET"; return
    fi
    local used_int filled empty
    used_int=$(printf "%.0f" "$used_pct")
    session_id="${session_id//[^a-zA-Z0-9_-]/}"
    local sid_dir="/tmp/claude/sessions/${session_id:-default}"
    mkdir -p "$sid_dir" 2>/dev/null
    echo "$used_int" > "$sid_dir/context-pct"
    filled=$(( used_int * 10 / 100 )); empty=$(( 10 - filled ))
    printf '%s[%s%s]%s %s%d%%%s' \
        "$(color_by_pct "$used_int")" "${_BARS:0:filled}" "${_DOTS:0:empty}" "$RESET" \
        "$DIM" "$used_int" "$RESET"
}

render_cost() {
    [ "${session_cost:-0}" = "0" ] && return
    printf ' %s$%.3f%s' "$DIM" "$session_cost" "$RESET"
}

render_fresh() {
    local total fresh fresh_pct color
    total=$(( ${input_tk:-0} + ${cache_read:-0} + ${cache_create:-0} ))
    [ "$total" -eq 0 ] && return
    # Fresh = non-cached input share (input_tokens + cache_creation) / total.
    # Hit-rate (cache_read / total) sits at 95~99% in steady state — flat and
    # uninformative. Fresh % stays low (1~3%) on routine turns and spikes when
    # large new context enters (skill invoke, file load, etc.).
    fresh=$(( input_tk + cache_create ))
    fresh_pct=$(( fresh * 100 / total ))
    if   [ "$fresh_pct" -ge 10 ]; then color="$RED"
    elif [ "$fresh_pct" -ge 3 ];  then color="$YELLOW"
    else                                color="$GREEN"
    fi
    printf ' 🌱 %s%d%%%s' "$color" "$fresh_pct" "$RESET"
}

render_plan() {
    local branch plans_dir plan_file status color
    branch=$(git -C "$PWD" branch --show-current 2>/dev/null) || return
    [ -z "$branch" ] && return
    plans_dir="$PWD/.claude/plans"
    [ -d "$plans_dir" ] || return
    plan_file=$(grep -l "^branch: $branch\$" "$plans_dir"/*.md 2>/dev/null | head -1)
    [ -z "$plan_file" ] && return
    status=$(awk '/^status:/ { sub(/^status: ?/, ""); print; exit }' "$plan_file")
    [ -z "$status" ] && return
    case "$status" in
        approved)    color="$YELLOW"; status="appr" ;;
        implemented) color="$GREEN";  status="impl" ;;
        abandoned)   color="$DIM";    status="abnd" ;;
        *)           color="$CYAN"   ;;
    esac
    printf ' %s📋%s %s%s%s' "$DIM" "$RESET" "$color" "$status" "$RESET"
}

render_quota() {
    if [ "$MODE" = "proxy" ]; then
        local label
        label=$(printf '%s' "${PROFILE_NAME:-proxy}" | tr '[:lower:]' '[:upper:]')
        printf ' %s│%s %s%s%s' "$DIM" "$RESET" "$CYAN$BOLD" "$label" "$RESET"
        case "$PROXY_HEALTH" in
            ok)   printf ' %s●%s %sok%s' "$GREEN" "$RESET" "$DIM" "$RESET" ;;
            down) printf ' %s✗%s %sdown%s' "$RED" "$RESET" "$DIM" "$RESET" ;;
        esac
        return
    fi

    [ -n "$sub_type" ] || return
    local plan_label sep=""
    case "$sub_type" in
        team) plan_label="Team" ;; enterprise) plan_label="Ent" ;;
        max)  plan_label="Max"  ;; pro)        plan_label="Pro" ;;
        *)    plan_label="$sub_type" ;;
    esac
    printf ' %s│%s %s%s%s' "$DIM" "$RESET" "$CYAN$BOLD" "$plan_label" "$RESET"

    if [ "$fh_avail" = "true" ]; then
        printf ' %s5h:%d%%%s' "$(color_by_pct "$fh_pct")" "$fh_pct" "$RESET"
        [ -n "$fh_reset" ] && fmt_countdown "$fh_reset"
        sep=" ${DIM}·${RESET}"
    fi
    if [ "$sd_avail" = "true" ]; then
        printf '%s %s7d:%d%%%s' "$sep" "$(color_by_pct "$sd_pct")" "$sd_pct" "$RESET"
        sep=" ${DIM}·${RESET}"
    fi
    if [ "$eu_enabled" = "true" ]; then
        printf '%s %sM.%.1f%%%s' "$sep" "$(color_by_pct "$eu_pct")" "$eu_pct_raw" "$RESET"
        printf ' %sU.$%.2f R.$%.2f%s' "$DIM" "$eu_used" "$eu_remain" "$RESET"
    fi
}

render_ccs_hint() {
    [ "$MODE" = "oauth" ] && [ -n "$CCS_ALT" ] || return

    if [ "$fh_avail" = "true" ] && [ "$fh_pct" -ge 95 ]; then
        printf ' %s!ccs %s%s' "$YELLOW" "$CCS_ALT" "$RESET"; return
    fi
    [ "$fh_avail" = "false" ] || return

    local alt_cache="$HOME/.claude/statusline_usage_cache_${CCS_ALT}.json"
    [ -f "$alt_cache" ] || return
    local alt_reset
    alt_reset=$(jq -r '.five_hour.resets_at // ""' "$alt_cache" 2>/dev/null)
    [ -n "$alt_reset" ] || return

    local countdown
    countdown=$(fmt_countdown "$alt_reset")
    if [ -n "$countdown" ]; then printf ' %s%s%s%s' "$DIM" "$CCS_ALT" "$countdown" "$RESET"
    else                         printf ' %s%s ready%s' "$GREEN" "$CCS_ALT" "$RESET"
    fi
}

# ============================================================================
# MAIN
# ============================================================================
detect_mode
"init_${MODE}_config"

if [ "$1" = "--refresh" ] || [ "$1" = "-r" ]; then
    handle_refresh; exit 0
fi

parse_stdin

if [ "$MODE" = "oauth" ]; then refresh_and_parse_cache
else                           check_proxy_health
fi

render_model; printf '\n'
render_context; render_cost; render_fresh; render_plan; render_quota; render_ccs_hint; printf '\n'
