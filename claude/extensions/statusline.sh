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
#
# Pipeline: Config → Fetch → Parse → Render → Output

# ============================================================================
# 1. CONFIG
# ============================================================================
_ccs_cfg="$HOME/.ccs/config.yaml"

# --- Mode detection ---
# ANTHROPIC_BASE_URL set to non-Anthropic endpoint → proxy mode (LiteLLM etc.)
# Otherwise → oauth mode (standard Anthropic accounts)
MODE="oauth"
_base_url="${ANTHROPIC_BASE_URL:-}"
case "$_base_url" in
    http://localhost:*|http://127.0.0.1:*|http://0.0.0.0:*|\
    https://localhost:*|https://127.0.0.1:*|https://0.0.0.0:*)
        MODE="proxy" ;;
    https://*.anthropic.com*|https://api.anthropic.com*|"")
        MODE="oauth" ;;
    *)
        MODE="proxy" ;;
esac

# --- Mode-specific config ---
CCS_INSTANCE=""
CCS_ALT=""
USAGE_CACHE=""
LOCK_FILE=""
CACHE_TTL=300

PROFILE_NAME=""
BACKEND_MODEL=""
PROXY_URL=""
PROXY_HEALTH=""

if [ "$MODE" = "oauth" ]; then
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
fi

if [ "$MODE" = "proxy" ]; then
    PROXY_URL="$_base_url"

    # Resolve profile name: match ANTHROPIC_BASE_URL against profiles in config.yaml
    if [ -f "$_ccs_cfg" ]; then
        while IFS= read -r _pname; do
            [ -z "$_pname" ] && continue
            _sf="$HOME/.ccs/${_pname}.settings.json"
            [ -f "$_sf" ] || continue
            _bu=$(jq -r '.env.ANTHROPIC_BASE_URL // ""' "$_sf" 2>/dev/null)
            if [ "$_bu" = "$PROXY_URL" ]; then
                PROFILE_NAME="$_pname"
                break
            fi
        done < <(awk '/^profiles:/{p=1;next} p && /^[a-z]/{exit} p && /^  [a-z]/{gsub(/:.*|^ */,"");print}' "$_ccs_cfg")
    fi

    # Resolve backend model from LiteLLM config using active model ID.
    # model_id comes from Claude Code's status JSON (set in PARSE section).
    # Falls back to ANTHROPIC_MODEL, then to model_id itself.
    _litellm_cfg="$HOME/.litellm/config.yaml"
    _resolve_backend() {
        local alias="$1"
        [ -f "$_litellm_cfg" ] && [ -n "$alias" ] || return
        awk -v m="$alias" '
            /^_.*: &/{aname=$2; sub(/^&/,"",aname); anchors[aname]=$NF}
            /- model_name:/{name=$NF}
            name==m && /model:/{
                val=$NF
                if(val~/^\*/){ref=val; sub(/^\*/,"",ref); val=anchors[ref]}
                sub(/.*\//,"",val); print val; exit
            }
        ' "$_litellm_cfg"
    }
fi

# ============================================================================
# 2. CONSTANTS & HELPERS
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
_render_ccs_hint() {
    [ -n "$CCS_ALT" ] || return

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
    countdown=$(_fmt_countdown "$alt_reset")
    if [ -n "$countdown" ]; then printf ' %s%s%s%s' "$DIM" "$CCS_ALT" "$countdown" "$RESET"
    else                   printf ' %s%s ready%s' "$GREEN" "$CCS_ALT" "$RESET"
    fi
}

# ============================================================================
# 3. FETCH
# ============================================================================

# --- OAuth: Keychain + Anthropic API ---
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
    cred_json=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    SUB_TYPE=$(echo "$cred_json" | jq -r '.claudeAiOauth.subscriptionType // empty')
}

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

# --- Proxy: health check ---
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

# --- --refresh handler ---
if [ "$1" = "--refresh" ] || [ "$1" = "-r" ]; then
    if [ "$MODE" = "proxy" ]; then
        check_proxy_health
        echo "Profile: ${PROFILE_NAME:-proxy}"
        BACKEND_MODEL=$(_resolve_backend "${ANTHROPIC_MODEL:-}")
        echo "Backend: ${BACKEND_MODEL:-unknown}"
        echo "Proxy:   ${PROXY_HEALTH} (${PROXY_URL})"
        exit 0
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
    exit 0
fi

# ============================================================================
# 4. PARSE
# ============================================================================
input=$(cat)
eval "$(echo "$input" | jq -r '
  "model=" + (.model.display_name // "Unknown" | @sh),
  "model_id=" + (.model.id // "" | @sh),
  "used_pct=" + (.context_window.used_percentage // "" | tostring | @sh),
  "session_cost=" + (.cost.total_cost_usd // 0 | tostring | @sh),
  "session_id=" + (.session_id // "" | @sh)
')"
_now=$(date +%s)

# --- OAuth: background cache refresh + parse ---
sub_type="" fh_avail="false" fh_pct=0 fh_reset="" sd_avail="false" sd_pct=0
eu_enabled="false" eu_pct=0 eu_pct_raw="0" eu_used="0" eu_remain="0"

if [ "$MODE" = "oauth" ]; then
    _try_refresh() {
        local cached_at
        cached_at=$(jq -r '.cached_at // 0' "$USAGE_CACHE" 2>/dev/null)
        [ $(( _now - ${cached_at:-0} )) -lt "$CACHE_TTL" ] && return

        if [ ! -f "$USAGE_CACHE" ]; then fetch_usage; return; fi

        if [ -f "$LOCK_FILE" ]; then
            local age=$(( _now - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
            [ "$age" -gt 30 ] && rm -f "$LOCK_FILE"
        fi
        ( set -o noclobber; echo $$ > "$LOCK_FILE" ) 2>/dev/null && fetch_usage &
    }
    _try_refresh

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
fi

# --- Proxy: health check ---
if [ "$MODE" = "proxy" ]; then
    check_proxy_health
fi

# ============================================================================
# 5. RENDER
# ============================================================================

# Model name — resolve from active model_id, not env var
if [ "$MODE" = "proxy" ]; then
    # Try model_id from Claude Code status JSON first, fall back to ANTHROPIC_MODEL
    BACKEND_MODEL=$(_resolve_backend "$model_id")
    [ -z "$BACKEND_MODEL" ] && BACKEND_MODEL=$(_resolve_backend "${ANTHROPIC_MODEL:-}")
    [ -z "$BACKEND_MODEL" ] && BACKEND_MODEL="$model_id"
fi
if [ "$MODE" = "proxy" ] && [ -n "$BACKEND_MODEL" ]; then
    short_model="$BACKEND_MODEL"
else
    short_model=$(echo "$model" \
        | sed 's/^Claude //; s/^Sonnet /S/; s/^Haiku /H/; s/^Opus /O/; s/ Sonnet$/S/; s/ Haiku$/H/; s/ Opus$/O/; s/ Sonnet / S/; s/ Haiku / H/; s/ Opus / O/')
fi

# Context bar
if [ -n "$used_pct" ]; then
    used_int=$(printf "%.0f" "$used_pct")
    session_id="${session_id//[^a-zA-Z0-9_-]/}"
    _sid_dir="/tmp/claude/sessions/${session_id:-default}"
    mkdir -p "$_sid_dir" 2>/dev/null
    echo "$used_int" > "$_sid_dir/context-pct"
    filled=$(( used_int * 10 / 100 )); empty=$(( 10 - filled ))
    bar=""; [ "$filled" -gt 0 ] && bar=$(printf '%0.s|' $(seq 1 $filled))
            [ "$empty"  -gt 0 ] && bar="${bar}$(printf '%0.s.' $(seq 1 $empty))"
    ctx_part="$(color_by_pct "$used_int")[${bar}]${RESET} ${DIM}${used_int}%${RESET}"
else
    ctx_part="${DIM}[ctx:--]${RESET}"
fi

# Cost
cost_part=""
awk -v c="$session_cost" 'BEGIN{exit !(c+0>0)}' \
    && cost_part=" ${DIM}\$$(printf '%.3f' "$session_cost")${RESET}"

# Quota / Proxy status
quota_part=""
if [ "$MODE" = "proxy" ]; then
    local_label="${PROFILE_NAME:-proxy}"
    local_label=$(echo "$local_label" | tr '[:lower:]' '[:upper:]')
    if [ "$PROXY_HEALTH" = "ok" ]; then
        quota_part=" ${DIM}│${RESET} ${CYAN}${BOLD}${local_label}${RESET} ${GREEN}●${RESET} ${DIM}ok${RESET}"
    elif [ "$PROXY_HEALTH" = "down" ]; then
        quota_part=" ${DIM}│${RESET} ${CYAN}${BOLD}${local_label}${RESET} ${RED}✗${RESET} ${DIM}down${RESET}"
    else
        quota_part=" ${DIM}│${RESET} ${CYAN}${BOLD}${local_label}${RESET}"
    fi
elif [ -n "$sub_type" ]; then
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

# CCS hint (oauth only — CCS_ALT is empty for proxy, _render_ccs_hint returns early)
ccs_hint=""
[ "$MODE" = "oauth" ] && ccs_hint="$(_render_ccs_hint)"

# ============================================================================
# 6. OUTPUT
# ============================================================================
printf "${CYAN}${BOLD}%s${RESET}\n%s%s%s%s\n" \
    "$short_model" "$ctx_part" "$cost_part" "$quota_part" "$ccs_hint"
