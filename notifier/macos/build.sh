#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="$HOME/Applications/AgentNotifier.app"
BIN_DIR="$HOME/.agent-notifier/bin"
LAUNCHD_LABEL="com.agent.notifier"
PLIST_PATH="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
OLD_LAUNCHD_LABEL="com.clawd.notifier"
OLD_PLIST_PATH="$HOME/Library/LaunchAgents/${OLD_LAUNCHD_LABEL}.plist"
UID_NUM=$(id -u)

echo "Building AgentNotifier..."
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$BIN_DIR"

swiftc "$SCRIPT_DIR/notifier.swift" \
    -o "$APP_DIR/Contents/MacOS/AgentNotifier" \
    -framework AppKit \
    -framework UserNotifications

cp "$SCRIPT_DIR/Info.plist" "$APP_DIR/Contents/"
cp "$SCRIPT_DIR/AppIcon.icns" "$APP_DIR/Contents/Resources/AgentNotifierIcon.icns"

codesign --force --deep --sign - "$APP_DIR"

if launchctl print "gui/${UID_NUM}/${OLD_LAUNCHD_LABEL}" &>/dev/null; then
    launchctl bootout "gui/${UID_NUM}/${OLD_LAUNCHD_LABEL}" 2>/dev/null || true
fi
rm -f "$OLD_PLIST_PATH"
pkill -x ClaudeNotifier 2>/dev/null || true

if command -v go &>/dev/null; then
    go build -o "$BIN_DIR/agent-notifier-send" "$ROOT_DIR/notifier/send.go"
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${APP_DIR}/Contents/MacOS/AgentNotifier</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENT_NOTIFIER_SOCKET</key>
        <string>/tmp/agent-notifier.sock</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/agent-notifier.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/agent-notifier.out</string>
</dict>
</plist>
PLIST

if launchctl print "gui/${UID_NUM}/${LAUNCHD_LABEL}" &>/dev/null; then
    launchctl kickstart -k "gui/${UID_NUM}/${LAUNCHD_LABEL}"
    echo "Restarted existing agent."
else
    launchctl bootstrap "gui/${UID_NUM}" "$PLIST_PATH"
    echo "Registered new agent."
fi

echo "Built: $APP_DIR"
