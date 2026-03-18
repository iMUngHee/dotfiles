---
name: Markdown text via clipboard
description: When delivering markdown text (PR body, wiki content, commit messages), copy to clipboard instead of rendering inline
type: feedback
---

When delivering markdown text the user needs to copy (PR bodies, wiki content, etc.), use `pbcopy` to copy to clipboard instead of outputting inline where it renders and becomes hard to copy.

**Why:** Markdown output in the terminal renders visually, making raw markdown impossible to select/copy.

**How to apply:** Whenever producing markdown text intended for the user to paste elsewhere, write to a temp file and pipe to `pbcopy`, then confirm it's on the clipboard.
