#!/usr/bin/env bash
#
# Claude Code notification hook
#
# Usage:
#   Stop hook        — notify on task completion only when terminal is not focused
#   Notification hook — always notify (e.g. approval requests)
#
# Invocation:
#   notify.sh stop       <- Stop event
#   notify.sh approval   <- Notification event
#
# Dependency: ~/Applications/ClaudeNotifier.app

MODE="${1:-stop}"

# --- tmux session tag ---
tmux_tag() {
    [ -n "$TMUX" ] && tmux display-message -p -t "$TMUX_PANE" '#S:#I.#P' 2>/dev/null
}
TAG=$(tmux_tag)

# --- approval/stop deduplication marker ---
MARKER_DIR="/tmp/claude-notify-markers"
marker_path() {
    local key
    key=$(printf '%s' "${TAG:-default}" | tr -c 'a-zA-Z0-9._-' '_')
    echo "$MARKER_DIR/$key"
}

set_approval_marker() {
    mkdir -p "$MARKER_DIR"
    date +%s > "$(marker_path)"
}

has_recent_approval() {
    local marker
    marker=$(marker_path)
    [ -f "$marker" ] || return 1
    local marker_time now age
    marker_time=$(cat "$marker" 2>/dev/null)
    now=$(date +%s)
    age=$(( now - marker_time ))
    rm -f "$marker"
    [ "$age" -le 5 ]
}

# --- daemon socket check and recovery ---
LAUNCHD_LABEL="com.clawd.notifier"
ensure_daemon() {
    [ -S /tmp/claude-notifier.sock ] && return 0
    # If launchd agent exists, restart via kickstart (avoids open -n which goes through Gatekeeper)
    if launchctl print "gui/$(id -u)/$LAUNCHD_LABEL" &>/dev/null; then
        launchctl kickstart -k "gui/$(id -u)/$LAUNCHD_LABEL" 2>/dev/null
    else
        # Fallback when launchd agent is not registered
        pkill -x ClaudeNotifier 2>/dev/null && sleep 0.2
        open -n ~/Applications/ClaudeNotifier.app &>/dev/null &
    fi
    # Wait for socket creation (max 3s, polling every 0.2s)
    local i=0
    while [ ! -S /tmp/claude-notifier.sock ] && [ $i -lt 15 ]; do
        sleep 0.2
        i=$((i + 1))
    done
}

# --- send notification ---
notify() {
    local title="$1"
    local message="$2"
    local sound="${3:-Glass}"
    local tag_clean
    tag_clean=$(printf '%s' "${TAG:-}" | tr -d '[]')
    ensure_daemon
    python3 "${0%/*}/notify_send.py" "$title" "$message" "$sound" "$tag_clean" 2>/dev/null
}

# --- check if a terminal app is focused ---
is_terminal_focused() {
    local script="tell application \"System Events\" to get name of first application process whose frontmost is true"
    local frontmost
    frontmost=$(osascript -e "$script" 2>/dev/null)
    case "$frontmost" in
        Terminal|iTerm2|Warp|kitty|Alacritty|Hyper|Ghostty|ghostty|WezTerm)
            return 0 ;;
        *)
            return 1 ;;
    esac
}

# --- check if the currently active pane is the notification-sending pane ---
# display-message -p returns the calling pane based on $TMUX_PANE (tmux 3.2+)
# Must query server state via list-panes -s to get the actually active pane
is_watching_current_pane() {
    [ -z "$TMUX" ] && return 1
    local active
    active=$(tmux list-panes -s \
        -F '#{window_active}#{pane_active} #S:#I.#P' 2>/dev/null \
        | awk '/^11 /{print $2}')
    [ "$active" = "$TAG" ]
}

# --- tmux internal notification ---
tmux_notify() {
    # Target by session name from TAG — displayed on the most recent client attached to that session
    local session="${TAG%%:*}"
    tmux display-message -d 4000 -t "$session" "$1" 2>/dev/null
}

# --- event handling ---
case "$MODE" in
    stop)
        INPUT=$(cat)
        # Suppress stop notification right after approval (waiting for permission)
        # Event order: PermissionRequest/Notification -> Stop (async)
        sleep 0.2
        if has_recent_approval; then
            exit 0
        fi
        # Infer stop reason from the last non-blank line of last_assistant_message
        LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)
        LAST_LINE=$(echo "$LAST_MSG" | awk 'NF{line=$0} END{print line}')
        if echo "$LAST_LINE" | grep -qE '\?\s*$'; then
            title="Claude Code — Review needed${TAG:+ $TAG}"
            msg="Your review is needed."
            sound="Basso"
            tmux_label="Review needed"
        else
            title="Claude Code${TAG:+ $TAG}"
            msg="Task completed."
            sound="Glass"
            tmux_label="Task done"
        fi
        if ! is_terminal_focused; then
            notify "$title" "$msg" "$sound"
        elif [ -n "$TAG" ] && ! is_watching_current_pane; then
            tmux_notify "Claude Code [${TAG}] — $tmux_label"
        fi
        ;;

    approval)
        INPUT=$(cat)
        MESSAGE=$(echo "$INPUT" | jq -r '.message // empty' 2>/dev/null)
        # The stop handler checks this marker and skips its notification
        # Always set regardless of message presence since both Notification and PermissionRequest fire
        set_approval_marker
        # Skip notification for events without a message (dedup Notification + PermissionRequest)
        [ -z "$MESSAGE" ] && exit 0
        if ! is_terminal_focused; then
            notify "Claude Code — Approval needed${TAG:+ $TAG}" "$MESSAGE" "Basso"
        elif [ -n "$TAG" ] && ! is_watching_current_pane; then
            tmux_notify "Claude Code [${TAG}] — Approval needed: $MESSAGE"
        fi
        ;;
esac

exit 0
