---
name: Raw URLs in chat output
description: Share links as bare URLs, not Markdown link syntax, so terminal rendering never hides the href.
type: feedback
---

When referencing any URL in assistant text, write the bare URL (for example `https://example.com/path`) instead of Markdown link syntax `[label](https://example.com/path)`.

**Why:** The CLI Markdown renderer displays only the link label from `[label](url)` and suppresses the URL, so the user cannot click, copy, or verify the target. Providing the raw URL keeps the link actionable on every surface.

**How to apply:**
- In every assistant message — reference lists, citations, inline mentions, error messages.
- If a label is helpful, put it on its own line immediately before the bare URL.
- For multiple links, a fenced code block of bare URLs works well because it also disables Markdown parsing.
- Never wrap URLs in `[...](...)` even when the output might land in a surface that renders rich Markdown; some renderers strip the href from view.
