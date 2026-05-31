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
	Title string `json:"title"`
	Body  string `json:"body"`
	Sound string `json:"sound"`
	Tag   string `json:"tag"`
	Icon  string `json:"icon,omitempty"`
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
