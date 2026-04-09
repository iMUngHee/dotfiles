---
name: copy
description: "Copy markdown or text to clipboard via pbcopy. Use when asked to copy something to clipboard."
allowed-tools: Bash
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
