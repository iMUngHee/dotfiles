#!/usr/bin/env bash
# Waiting pager mail, for the tmux status bar.
#
# Why here and not in the Claude status line: that script only runs on turn
# boundaries, and pager's Stop hook delivers on the same boundary, so a count
# read there is almost always already zero. tmux redraws on status-interval
# (1s), which is the cadence a notification actually needs.
#
# Prints nothing when no mail is waiting, so the status bar stays clean.
#
# NOTE: this reads pager's SQLite schema directly. `pager ls` is per-session and
# there is no CLI that reports every inbox at once, which is what a global badge
# needs. Read-only, and a schema change makes the badge vanish rather than
# misreport — but it is an unversioned dependency worth replacing with a real
# command if pager grows one.

set -u

DB="${PAGER_DB:-$HOME/.pager/msg.db}"
[ -r "$DB" ] || exit 0
command -v sqlite3 >/dev/null 2>&1 || exit 0

# Only aliases with undelivered mail, newest-pressure first is not needed —
# alphabetical keeps the badge from reordering under the cursor every second.
# Two axes, unioned: delivered_at means a hook injected it into the recipient's
# context, listed_at means an agent looked at it through MCP msg_list. Either one
# is somebody having picked it up, so it leaves the badge. Counting delivered_at
# alone left anything read by polling on the bar forever — and the polling rule
# in ai/memory/ tells agents to read that way, so the badge got worse the better
# the rule was followed. `pager ls` stamps nothing, so neither this query nor a
# person running `ls --session` consumes mail.
rows=$(sqlite3 -readonly -separator '|' "$DB" \
    "SELECT a.alias, count(m.id), COALESCE(s.host_pid, 0)
       FROM messages m
       JOIN aliases a ON a.alias = m.alias
       LEFT JOIN sessions s ON s.session_id = a.session_id
      WHERE m.delivered_at IS NULL AND m.listed_at IS NULL
      GROUP BY a.alias
      ORDER BY a.alias;" 2>/dev/null) || exit 0
[ -n "$rows" ] || exit 0

# Drop inboxes whose owning process is gone. Nobody can act on that mail — claim
# requires a live session in the same workspace — so it would otherwise sit in
# the bar forever; auditing stranded mail belongs to the overlay TUI, not to a
# notification.
#
# Liveness is the pid, NOT the heartbeat. heartbeat_at only advances on hook
# events, and hooks fire at turn boundaries, so a session in a long turn looks
# stale while it is running fine — measured on this repo's own session at 7
# minutes stale with the process very much alive. An absent pid is kept rather
# than hidden: missing a real notification is worse than showing a dead one.
live=""
while IFS='|' read -r alias count pid; do
    [ -n "$alias" ] || continue
    if [ "${pid:-0}" -eq 0 ] 2>/dev/null || kill -0 "$pid" 2>/dev/null; then
        live="${live}${alias}:${count}
"
    fi
done <<ROWS
$rows
ROWS
rows=${live%
}
[ -n "$rows" ] || exit 0

# status-right is length-capped, so show at most three inboxes and count the
# rest. Truncating silently would hide exactly the case this exists to surface.
total=$(printf '%s\n' "$rows" | wc -l | tr -d ' ')
shown=$(printf '%s\n' "$rows" | head -3 | tr '\n' ' ')
shown=${shown% }
if [ "$total" -gt 3 ]; then
    shown="$shown +$((total - 3))"
fi

# Rendered as a catppuccin pill so it sits flush with the cpu/ram/battery
# modules instead of butting against them as bare text. The pill is built here
# rather than via utils/status_module.conf because a catppuccin module always
# renders — an empty pill would sit in the bar whenever no mail waits, which is
# most of the time. Colours and separators are read from the theme in one tmux
# call, so changing the theme carries over.
#
# The tail must NOT reset bg to default. A catppuccin module ends by changing
# only fg and leaving bg on the module colour, so the next module's leading
# space and separator are drawn over that colour and the pills read as one
# strip. Resetting to default drew them over the terminal background instead,
# leaving a black gap that no other module boundary has.
tmux display-message -p "\
#[fg=#{@thm_yellow}]#{@catppuccin_status_left_separator}\
#[fg=#{@thm_crust},bg=#{@thm_yellow}]📬 \
#{@catppuccin_status_middle_separator}\
#[fg=#{@thm_fg},bg=#{E:@catppuccin_status_module_text_bg}] ${shown}\
#[fg=#{E:@catppuccin_status_module_text_bg}]#{@catppuccin_status_right_separator}"
