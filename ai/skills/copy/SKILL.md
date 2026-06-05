---
name: copy
description: "Copy markdown or text to the system clipboard (pbcopy/wl-copy/xclip). TRIGGER when: user says 'copy to clipboard' / '클립보드에 복사' / 'put that on my clipboard'. SKIP: writing to file (use Write tool); sending to external service (use service-specific tool); saving logs (use shell redirect)."
allowed-tools: Bash
model: sonnet
effort: low
disable-model-invocation: false
---

Copy the following content to the clipboard: $ARGUMENTS

If $ARGUMENTS is empty, copy the most recently generated markdown/text output from this conversation.

## Instructions

1. Use `dangerouslyDisableSandbox: true` (clipboard tools require it). Pick the available command per OS:
   ```bash
   copy_clip() {
     local data; data=$(cat)   # read once so we can fall through on runtime failure
     if command -v pbcopy >/dev/null 2>&1; then printf '%s' "$data" | pbcopy                       # macOS
     elif command -v wl-copy >/dev/null 2>&1 && printf '%s' "$data" | wl-copy 2>/dev/null; then :   # Wayland
     elif command -v xclip >/dev/null 2>&1; then printf '%s' "$data" | xclip -selection clipboard   # X11
     else echo "no clipboard tool (pbcopy/wl-copy/xclip)" >&2; return 1; fi
   }
   copy_clip << 'EOF'
   <content>
   EOF
   ```
2. Confirm to the user that it's on the clipboard.

## Rules

- NEVER render the content inline — only via the clipboard command
- Preserve original formatting (indentation, newlines, markdown syntax)
- If the content contains `EOF`, use a different heredoc delimiter
