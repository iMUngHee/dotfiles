---
name: markitdown
description: "Convert local files or public URLs to Markdown via markitdown CLI; best for DOCX/PPTX/XLSX. TRIGGER when: asked to convert .docx/.pptx/.xlsx/.html or a public URL to markdown; user says 'extract text from this file'. SKIP: complex PDFs with tables (use PyMuPDF4LLM or Read tool); authenticated/internal URLs (download first, re-invoke with local path); image-only files without OCR."
argument-hint: "<file-path|public-URL>"
allowed-tools: Bash, Read, Write
---

Convert a document to Markdown via markitdown CLI.

Target: $ARGUMENTS

## Scope

Local files and public URLs only. For authenticated or internal services, download the attachment via the appropriate tool (MCP server, CLI, browser) first, then pass the local path to this skill.

## Strengths & Limitations

| Format | Quality | Notes |
|--------|---------|-------|
| DOCX | Good | Clean documents convert well |
| PPTX | **Best** | Highest accuracy among open-source tools (70%+) |
| XLSX | Good | NaN cells may appear — post-process with `sed 's/ NaN/ /g'` |
| HTML | Good | Equivalent to markdownify |
| PDF (simple) | OK | Digital text-only PDFs work fine |
| PDF (complex) | **Weak** | Tables break, headings lost. Use PyMuPDF4LLM or Claude Read instead |
| Audio | Needs ffmpeg | `brew install ffmpeg` if not installed |

## Execution

```bash
markitdown "$TARGET" 2>&1
```

If output exceeds 200 lines, save to `/tmp/markitdown_<basename>.md` and report the path.

## Output

1. **Source**: filename or URL
2. **Converted Markdown**: fenced code block (or saved file path if large)
3. **Structure**: heading outline + table/list count (3-5 bullets max)

## Rules

- Do NOT modify any existing project files
- If markitdown fails, show the error and suggest alternatives
- If the URL requires authentication, remind the user to download the file locally first and re-invoke this skill with the local path
- For complex PDFs with tables, recommend PyMuPDF4LLM or Claude Code `Read` tool instead
