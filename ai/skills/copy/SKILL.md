---
name: copy
description: "Copy markdown or text to clipboard via pbcopy. TRIGGER when: user says 'copy to clipboard' / '클립보드에 복사' / 'put that on my clipboard'. SKIP: writing to file (use Write tool); sending to external service (use service-specific tool); saving logs (use shell redirect)."
allowed-tools: Bash
model: sonnet
disable-model-invocation: false
---

Copy the following content to the clipboard: $ARGUMENTS

If $ARGUMENTS is empty, copy the most recently generated markdown/text output from this conversation.

## Instructions

1. Use `dangerouslyDisableSandbox: true` (pbcopy requires it):
   ```bash
   pbcopy << 'EOF'
   <content>
   EOF
   ```
2. Confirm to the user that it's on the clipboard.

## Rules

- NEVER render the content inline — only pbcopy
- Preserve original formatting (indentation, newlines, markdown syntax)
- If the content contains `EOF`, use a different heredoc delimiter
