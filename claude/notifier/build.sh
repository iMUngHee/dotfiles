#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$HOME/Applications/ClaudeNotifier.app"
LAUNCHD_LABEL="com.clawd.notifier"
PLIST_PATH="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"

# ── 1. Build ──
echo "Building ClaudeNotifier..."
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

swiftc "$SCRIPT_DIR/notifier.swift" \
    -o "$APP_DIR/Contents/MacOS/ClaudeNotifier" \
    -framework Foundation \
    -framework UserNotifications

cp "$SCRIPT_DIR/Info.plist"   "$APP_DIR/Contents/"
cp "$SCRIPT_DIR/AppIcon.icns" "$APP_DIR/Contents/Resources/"

echo "Built: $APP_DIR"

# ── 2. LaunchAgent plist ──
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${APP_DIR}/Contents/MacOS/ClaudeNotifier</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/claude-notifier.err</string>
    <key>StandardOutPath</key>
    <string>/tmp/claude-notifier.out</string>
</dict>
</plist>
PLIST

echo "Installed plist: $PLIST_PATH"

# ── 3. Register / restart launchd agent ──
UID_NUM=$(id -u)
if launchctl print "gui/${UID_NUM}/${LAUNCHD_LABEL}" &>/dev/null; then
    launchctl kickstart -k "gui/${UID_NUM}/${LAUNCHD_LABEL}"
    echo "Restarted existing agent."
else
    launchctl bootstrap "gui/${UID_NUM}" "$PLIST_PATH"
    echo "Registered new agent."
fi

echo "Done. ClaudeNotifier is running."
