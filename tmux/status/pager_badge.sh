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
rows=$(sqlite3 -readonly -separator ':' "$DB" \
    "SELECT a.alias, count(m.id)
       FROM messages m JOIN aliases a ON a.alias = m.alias
      WHERE m.delivered_at IS NULL
      GROUP BY a.alias
      ORDER BY a.alias;" 2>/dev/null) || exit 0
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
tmux display-message -p "\
#[fg=#{@thm_yellow}]#{@catppuccin_status_left_separator}\
#[fg=#{@thm_crust},bg=#{@thm_yellow}]📬 \
#{@catppuccin_status_middle_separator}\
#[fg=#{@thm_fg},bg=#{E:@catppuccin_status_module_text_bg}] ${shown} \
#[fg=#{E:@catppuccin_status_module_text_bg},bg=default]#{@catppuccin_status_right_separator}"
