#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$HOME/.agent-notifier/bin"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ICON_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/notifier/linux"
ICON_PATH="$ICON_DIR/AppIcon.png"

mkdir -p "$BIN_DIR" "$SYSTEMD_DIR" "$ICON_DIR"

go build -o "$BIN_DIR/agent-notifier" "$SCRIPT_DIR/agent-notifier.go"
go build -o "$BIN_DIR/agent-notifier-send" "$ROOT_DIR/notifier/send.go"
# ICON_DIR is $XDG_CONFIG_HOME/notifier/linux and SCRIPT_DIR is this script's
# own directory — and this repo is cloned to ~/.config, so the two are the same
# path and the copy is cp'ing a file onto itself. cp refuses that outright
# ("are the same file"), set -e took the build down with it, and the daemon was
# never installed: the AI bootstrap only reaches this script when go is present,
# so on a box without go the step said "Skipped" and the failure stayed hidden.
# The icon is already where the unit file points when the paths coincide.
if [ "$SCRIPT_DIR/AppIcon.png" -ef "$ICON_PATH" ]; then
    echo "Icon already in place at $ICON_PATH"
else
    cp "$SCRIPT_DIR/AppIcon.png" "$ICON_PATH"
fi

cat > "$SYSTEMD_DIR/agent-notifier.service" <<UNIT
[Unit]
Description=AgentNotifier desktop notification daemon

[Service]
ExecStart=${BIN_DIR}/agent-notifier
Restart=always
Environment=AGENT_NOTIFIER_SOCKET=/tmp/agent-notifier.sock
Environment=AGENT_NOTIFIER_ICON=${ICON_PATH}

[Install]
WantedBy=default.target
UNIT

if command -v systemctl &>/dev/null; then
    systemctl --user daemon-reload
    systemctl --user enable --now agent-notifier.service
fi

echo "Installed AgentNotifier Linux daemon and sender in $BIN_DIR"
