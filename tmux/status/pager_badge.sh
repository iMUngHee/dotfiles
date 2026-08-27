#!/usr/bin/env bash
# Waiting pager mail, for the tmux status bar.
#
# Why here and not in the Claude status line: that script only runs on turn
# boundaries, and pager's Stop hook delivers on the same boundary, so a count
# read there is almost always already zero. tmux redraws on status-interval
# (1s), which is the cadence a notification actually needs.
#
# Prints nothing when no mail is waiting, so the status bar stays clean.

set -u

command -v pager >/dev/null 2>&1 || exit 0

# `pager inbox` is the whole-store view — every alias with mail waiting, one row
# each, alphabetical. It replaced the direct SQLite read this script used to do;
# `pager ls` is per-session, and one call per session is too expensive at a
# one-second refresh.
#
# Its WAITING column is the same predicate `pager ls --waiting` uses (both share
# `undealtWith`: delivered_at IS NULL AND listed_at IS NULL). delivered_at means
# a hook injected the message into the recipient's context, listed_at means an
# agent pulled it up through MCP msg_list — either is somebody having picked it
# up. Counting only the first left anything read by polling on the bar forever,
# and the polling rule in ai/memory/ tells agents to read that way, so the badge
# got worse the better the rule was followed. Sharing the constant means the bar
# and an agent checking its own inbox can no longer disagree.
out=$(pager inbox 2>/dev/null) || exit 0

# HOST is pager's judgement, not ours. It holds the pid *and* the start token
# recorded at attach, so a pid recycled by an unrelated process reads as gone
# instead of live — the distinction `kill -0` cannot make, which is why the
# liveness loop that used to live here is gone.
#
# Only 'gone' is dropped. Nobody can act on mail whose session is definitely
# over — claim requires a live session in the same workspace — so it would
# otherwise sit in the bar forever; auditing stranded mail belongs to the
# overlay TUI, not to a notification.
#
# 'unknown' is kept. It means there is no pid to ask about (host detection
# failed at attach, or the alias outlived its session), which is not the same as
# nobody being there. Missing a real notification is worse than showing a dead
# one. Hiding dead inboxes is this badge's policy alone — pager reports and does
# not filter.
#
# Rows are accepted only when WAITING is numeric, which skips the header and the
# 'nothing waiting' line without matching either by text. If pager ever appends
# a column, HOST absorbs it and stops equalling 'gone', so the badge shows too
# much rather than silently hiding mail.
rows=""
while read -r alias count host; do
    case "$count" in
        ''|*[!0-9]*) continue ;;
    esac
    [ "$host" = gone ] && continue
    rows="${rows}${alias}:${count}
"
done <<OUT
$out
OUT
rows=${rows%
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
