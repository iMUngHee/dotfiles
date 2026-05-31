# AgentNotifier

Shared notification bridge for local AI assistants.

AgentNotifier accepts a small JSON payload over a Unix domain socket and shows a desktop notification. The notification carries a tmux target tag (`#S:#I.#P`), so the desktop notification can jump back to the originating pane.

## Protocol

```json
{"title":"Codex","body":"Task done","sound":"Glass","tag":"0:5.1","icon":"optional-path"}
```

Default socket:

```text
/tmp/agent-notifier.sock
```

Override with `AGENT_NOTIFIER_SOCKET`.

## macOS

```bash
notifier/macos/build.sh
```

Builds `~/Applications/AgentNotifier.app`, installs `~/Library/LaunchAgents/com.agent.notifier.plist`, builds `~/.agent-notifier/bin/agent-notifier-send`, and unloads the legacy `com.clawd.notifier` launchd agent.

## Linux

```bash
notifier/linux/build.sh
```

Builds a Go daemon and sender under `~/.agent-notifier/bin`, installs the bundled icon under `~/.config/notifier/linux/`, then installs and starts a user systemd service when `systemctl --user` is available.

The Linux daemon exposes a `Focus` notification action when the notification server supports `notify-send --action`. Selecting that action focuses the originating tmux pane.

Linux foreground focusing is compositor-specific. Set `AGENT_NOTIFIER_FOCUS_CMD` to an optional shell command if the terminal window should be raised before tmux pane selection.
