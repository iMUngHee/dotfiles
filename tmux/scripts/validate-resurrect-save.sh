#!/usr/bin/env bash
# validate-resurrect-save.sh
# Discards corrupted tmux-resurrect saves where pane dir field is misaligned.
# Cause: race condition — shell dying during save leaves empty pane_current_path,
# shifting fields so dir="1" instead of ":/path", which restores panes at ~.
#
# Hook: @resurrect-hook-post-save-layout
# Runs after dump but before symlink update. If corrupted, overwrite with
# previous good save so files_differ() returns false and symlink stays safe.

file="$1"
[ -z "$file" ] || [ ! -f "$file" ] && exit 0

log_dir="${XDG_DATA_HOME:-$HOME/.local/share}/tmux/resurrect/corruption-logs"
d=$'\t'

while IFS= read -r line; do
    if [[ "$line" == pane"$d"* ]]; then
        dir=$(printf '%s' "$line" | cut -d"$d" -f8)
        if [[ "$dir" != :* ]]; then
            # -- log for root cause analysis --
            mkdir -p "$log_dir"
            ts=$(date +"%Y%m%dT%H%M%S")
            log="${log_dir}/${ts}.log"
            {
                echo "=== CORRUPTION DETECTED ==="
                echo "timestamp: $(date)"
                echo "save_file: $file"
                echo ""
                echo "=== corrupted line ==="
                echo "$line" | cat -vet
                echo ""
                echo "=== full corrupted save ==="
                cat -vet "$file"
                echo ""
                echo "=== dump_panes_raw at detection time ==="
                tmux list-panes -a -F "pane${d}#{session_name}${d}#{window_index}${d}#{window_active}${d}:#{window_flags}${d}#{pane_index}${d}#{pane_title}${d}:#{pane_current_path}${d}#{pane_active}${d}#{pane_current_command}${d}#{pane_pid}${d}#{history_size}" | cat -vet
            } > "$log" 2>&1

            # -- discard corrupted save --
            last_dir="$(dirname "$file")"
            last_link="${last_dir}/last"
            if [ -L "$last_link" ]; then
                cp "${last_dir}/$(readlink "$last_link")" "$file"
            fi
            exit 0
        fi
    fi
done < "$file"
