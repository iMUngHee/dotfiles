package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"time"
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
	if len(os.Args) < 5 || len(os.Args) > 6 {
		fmt.Fprintln(os.Stderr, "usage: agent-notifier-send <title> <body> <sound> <tag> [icon]")
		os.Exit(2)
	}

	msg := payload{
		Title: os.Args[1],
		Body:  os.Args[2],
		Sound: os.Args[3],
		Tag:   os.Args[4],
	}
	if len(os.Args) == 6 {
		msg.Icon = os.Args[5]
	}
	msg.Delivery = os.Getenv("AGENT_NOTIFIER_DELIVERY")
	msg.TmuxMessage = os.Getenv("AGENT_NOTIFIER_TMUX_MESSAGE")

	socketPath := os.Getenv("AGENT_NOTIFIER_SOCKET")
	if socketPath == "" {
		socketPath = "/tmp/agent-notifier.sock"
	}

	conn, err := net.DialTimeout("unix", socketPath, 2*time.Second)
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-notifier-send: connect %s: %v\n", socketPath, err)
		os.Exit(1)
	}
	defer conn.Close()

	if err := json.NewEncoder(conn).Encode(msg); err != nil {
		fmt.Fprintf(os.Stderr, "agent-notifier-send: encode: %v\n", err)
		os.Exit(1)
	}
}
