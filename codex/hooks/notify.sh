#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-stop}"
INPUT=$(cat)
SOCKET="${AGENT_NOTIFIER_SOCKET:-/tmp/agent-notifier.sock}"
SEND="${AGENT_NOTIFIER_SEND:-$HOME/.agent-notifier/bin/agent-notifier-send}"
DAEMON="${AGENT_NOTIFIER_DAEMON:-$HOME/.agent-notifier/bin/agent-notifier}"
MARKER_DIR="/tmp/agent-notifier-markers"

tmux_tag() {
    [ -n "${TMUX:-}" ] || return 0
    tmux display-message -p -t "${TMUX_PANE:-}" '#S:#I.#P' 2>/dev/null || true
}

tag="$(tmux_tag)"

marker_path() {
    local key
    key=$(printf '%s' "${tag:-codex-default}" | tr -c 'a-zA-Z0-9._-' '_')
    echo "$MARKER_DIR/$key"
}

set_approval_marker() {
    mkdir -p "$MARKER_DIR"
    date +%s > "$(marker_path)"
}

has_recent_approval() {
    local marker marker_time now age
    marker=$(marker_path)
    [ -f "$marker" ] || return 1
    marker_time=$(cat "$marker" 2>/dev/null || echo 0)
    now=$(date +%s)
    age=$(( now - marker_time ))
    rm -f "$marker"
    [ "$age" -le 5 ]
}

ensure_daemon() {
    [ -S "$SOCKET" ] && return 0
    case "$(uname -s)" in
        Darwin)
            local label="com.agent.notifier"
            if launchctl print "gui/$(id -u)/$label" &>/dev/null; then
                launchctl kickstart -k "gui/$(id -u)/$label" 2>/dev/null || true
            else
                open -n "$HOME/Applications/AgentNotifier.app" &>/dev/null || true
            fi
            ;;
        Linux)
            if command -v systemctl &>/dev/null; then
                systemctl --user start agent-notifier.service &>/dev/null || true
            fi
            if [ ! -S "$SOCKET" ] && [ -x "$DAEMON" ]; then
                "$DAEMON" &>/dev/null &
            fi
            ;;
    esac
    local i=0
    while [ ! -S "$SOCKET" ] && [ "$i" -lt 15 ]; do
        sleep 0.2
        i=$((i + 1))
    done
}

send_notification() {
    local title="$1" body="$2" sound="${3:-Glass}" tmux_message="${4:-}" icon="${5:-}"
    local target_tag="${tag:-${TMUX_PANE:-}}"
    ensure_daemon
    [ -x "$SEND" ] || return 0
    AGENT_NOTIFIER_DELIVERY=focus-aware \
    AGENT_NOTIFIER_TMUX_MESSAGE="$tmux_message" \
    "$SEND" "$title" "$body" "$sound" "$target_tag" "$icon" 2>/dev/null || true
}

case "$MODE" in
    stop)
        sleep 0.2
        has_recent_approval && exit 0
        last_msg=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)
        last_line=$(printf '%s\n' "$last_msg" | awk 'NF{line=$0} END{print line}')
        if printf '%s' "$last_line" | grep -qE '\?\s*$'; then
            title="Codex${tag:+ $tag}"
            body="Your review is needed."
            sound="Basso"
            tmux_label="Review needed"
        else
            title="Codex${tag:+ $tag}"
            body="Task completed."
            sound="Glass"
            tmux_label="Task done"
        fi
        send_notification "$title" "$body" "$sound" "Codex [${tag:-${TMUX_PANE:-}}] - $tmux_label"
        ;;
    approval)
        set_approval_marker
        tool_name=$(printf '%s' "$INPUT" | jq -r '.tool_name // "tool"' 2>/dev/null)
        title="Codex - Approval needed${tag:+ $tag}"
        body="$tool_name requires approval."
        send_notification "$title" "$body" "Basso" "Codex [${tag:-${TMUX_PANE:-}}] - Approval needed: $tool_name"
        ;;
esac
