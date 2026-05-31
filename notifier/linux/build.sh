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
cp "$SCRIPT_DIR/AppIcon.png" "$ICON_PATH"

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
