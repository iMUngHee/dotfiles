package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type payload struct {
	Title       string `json:"title"`
	Body        string `json:"body"`
	Sound       string `json:"sound"`
	Tag         string `json:"tag"`
	Icon        string `json:"icon,omitempty"`
	Delivery    string `json:"delivery,omitempty"`
	TmuxMessage string `json:"tmuxMessage,omitempty"`
}

func main() {
	socketPath := getenv("AGENT_NOTIFIER_SOCKET", "/tmp/agent-notifier.sock")
	_ = os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-notifier: listen %s: %v\n", socketPath, err)
		os.Exit(1)
	}
	defer listener.Close()

	for {
		conn, err := listener.Accept()
		if err != nil {
			continue
		}
		go handle(conn)
	}
}

func handle(conn net.Conn) {
	defer conn.Close()
	var msg payload
	if err := json.NewDecoder(conn).Decode(&msg); err != nil {
		return
	}
	// focus-aware delivery: when the originating terminal is frontmost,
	// suppress the desktop notification and surface a tmux message instead
	// (mirrors the macOS daemon). Falls back to desktop delivery whenever
	// focus cannot be determined.
	if msg.Delivery == "focus-aware" && strings.Trim(msg.Tag, "[]") != "" && isTerminalFrontmost() {
		if !isWatchingCurrentPane(msg.Tag) {
			displayTmuxMessage(msg.Tag, tmuxMessageOf(msg))
		}
		return
	}
	if notify(msg) {
		focusTmux(msg.Tag)
	}
}

func notify(msg payload) bool {
	args := []string{"--app-name=AgentNotifier", "--action=focus=Focus", "--wait"}
	if icon := resolveIcon(msg.Icon); icon != "" {
		args = append(args, "--icon", icon)
	}
	args = append(args, msg.Title, msg.Body)
	out, err := exec.Command("notify-send", args...).Output()
	if err == nil {
		return strings.TrimSpace(string(out)) == "focus"
	}

	fallback := []string{"--app-name=AgentNotifier"}
	if icon := resolveIcon(msg.Icon); icon != "" {
		fallback = append(fallback, "--icon", icon)
	}
	fallback = append(fallback, msg.Title, msg.Body)
	_ = exec.Command("notify-send", fallback...).Run()
	return false
}

func focusTmux(tag string) {
	target := strings.Trim(tag, "[]")
	if target == "" {
		return
	}
	if focusCmd := os.Getenv("AGENT_NOTIFIER_FOCUS_CMD"); focusCmd != "" {
		_ = exec.Command("sh", "-lc", focusCmd).Run()
	}
	_ = exec.Command("tmux", "select-window", "-t", target).Run()
	_ = exec.Command("tmux", "select-pane", "-t", target).Run()
}

func tmuxMessageOf(msg payload) string {
	if msg.TmuxMessage != "" {
		return msg.TmuxMessage
	}
	return msg.Title + " - " + msg.Body
}

// isTerminalFrontmost reports whether the originating terminal currently has
// foreground focus. Focus detection is compositor-specific on Linux, so an
// explicit AGENT_NOTIFIER_FOCUS_CHECK_CMD (exit 0 == frontmost) takes priority;
// otherwise a best-effort X11 probe runs. When neither can decide, it returns
// false so the caller falls back to a desktop notification.
func isTerminalFrontmost() bool {
	if cmd := os.Getenv("AGENT_NOTIFIER_FOCUS_CHECK_CMD"); cmd != "" {
		return exec.Command("sh", "-lc", cmd).Run() == nil
	}
	return x11TerminalFrontmost()
}

func x11TerminalFrontmost() bool {
	class := strings.ToLower(activeWindowClass())
	if class == "" {
		return false
	}
	for _, name := range []string{
		"term", "kitty", "alacritty", "ghostty", "wezterm",
		"konsole", "hyper", "warp", "tilix", "foot",
	} {
		if strings.Contains(class, name) {
			return true
		}
	}
	return false
}

func activeWindowClass() string {
	if _, err := exec.LookPath("xdotool"); err == nil {
		if out, err := exec.Command("xdotool", "getactivewindow", "getwindowclassname").Output(); err == nil {
			return strings.TrimSpace(string(out))
		}
	}
	if _, err := exec.LookPath("xprop"); err == nil {
		if root, err := exec.Command("xprop", "-root", "_NET_ACTIVE_WINDOW").Output(); err == nil {
			fields := strings.Fields(string(root))
			if len(fields) > 0 {
				id := fields[len(fields)-1]
				if id != "" && id != "0x0" {
					if out, err := exec.Command("xprop", "-id", id, "WM_CLASS").Output(); err == nil {
						return string(out)
					}
				}
			}
		}
	}
	return ""
}

func normalizeTmuxTarget(target string) string {
	clean := strings.Trim(target, "[]")
	if clean == "" {
		return ""
	}
	out, err := exec.Command("tmux", "display-message", "-p", "-t", clean, "#S:#I.#P").Output()
	if err != nil {
		return clean
	}
	if res := strings.TrimSpace(string(out)); res != "" {
		return res
	}
	return clean
}

func isWatchingCurrentPane(tag string) bool {
	normalized := normalizeTmuxTarget(tag)
	if normalized == "" {
		return false
	}
	out, err := exec.Command("tmux", "list-panes", "-s", "-F", "#{window_active}#{pane_active} #S:#I.#P").Output()
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "11 ") {
			return strings.TrimSpace(line[3:]) == normalized
		}
	}
	return false
}

func displayTmuxMessage(tag, message string) {
	normalized := normalizeTmuxTarget(tag)
	clean := normalized
	if clean == "" {
		clean = tag
	}
	clean = strings.Trim(clean, "[]")
	if clean == "" {
		return
	}
	session, _, _ := strings.Cut(clean, ":")
	_ = exec.Command("tmux", "display-message", "-d", "4000", "-t", session, message).Run()
}

func resolveIcon(icon string) string {
	if icon != "" && fileExists(icon) {
		return icon
	}
	if envIcon := os.Getenv("AGENT_NOTIFIER_ICON"); envIcon != "" && fileExists(envIcon) {
		return envIcon
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	candidate := filepath.Join(home, ".config", "notifier", "linux", "AppIcon.png")
	if fileExists(candidate) {
		return candidate
	}
	return ""
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
