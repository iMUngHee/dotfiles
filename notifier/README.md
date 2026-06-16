# AgentNotifier

Shared notification bridge for local AI assistants.

AgentNotifier accepts a small JSON payload over a Unix domain socket. Depending on the delivery mode it shows a desktop notification or routes the message to the originating tmux pane. The payload carries a tmux target tag (`#S:#I.#P`), so the notification can jump back to the pane that produced it.

## Protocol

```json
{"title":"Agent","body":"Task done","sound":"Glass","tag":"0:5.1"}
```

| Field | Required | Description |
| --- | --- | --- |
| `title` | yes | Notification title. |
| `body` | yes | Notification body. |
| `sound` | yes | macOS system sound name (e.g. `Glass`, `Basso`). Ignored on Linux. |
| `tag` | yes | tmux target (`#S:#I.#P`) used to focus the originating pane. |
| `icon` | no | Path to a notification icon. |
| `delivery` | no | `focus-aware` suppresses the desktop notification while the originating terminal is frontmost and routes to tmux instead (see below). Any other value delivers a desktop notification. |
| `tmuxMessage` | no | Message shown in the tmux status line under focus-aware delivery. Defaults to `title - body`. |

The sender (`agent-notifier-send`) reads `delivery` and `tmuxMessage` from the `AGENT_NOTIFIER_DELIVERY` and `AGENT_NOTIFIER_TMUX_MESSAGE` environment variables.

Default socket:

```text
/tmp/agent-notifier.sock
```

Override with `AGENT_NOTIFIER_SOCKET`.

## Focus-aware delivery

When `delivery` is `focus-aware`, the daemon picks a delivery channel based on whether the originating terminal is frontmost:

- Terminal not frontmost → desktop notification.
- Terminal frontmost, a different tmux pane active → tmux status-line message.
- Terminal frontmost, the originating pane already active → suppressed.

macOS resolves frontmost state via `NSWorkspace`. On Linux it is compositor-specific (see below). When focus cannot be determined, the daemon falls back to a desktop notification so messages are never silently dropped.

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

Linux foreground focusing is compositor-specific. Two optional hooks tune it:

- `AGENT_NOTIFIER_FOCUS_CHECK_CMD` — shell command used for focus-aware delivery; it should exit `0` when the originating terminal is frontmost. Without it, the daemon attempts a best-effort X11 probe via `xdotool`/`xprop`, and falls back to a desktop notification when neither is available.
- `AGENT_NOTIFIER_FOCUS_CMD` — shell command run to raise the terminal window before tmux pane selection when a notification is actioned.
