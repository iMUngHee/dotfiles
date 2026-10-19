---
name: diagram
description: "Produce diagrams two ways: Mermaid DSL copied to the clipboard for mermaid.live or excalidraw (default; also ERD, class, gantt), or a polished self-contained interactive HTML through the local archify engine when the user wants a shareable technical diagram. Skip static images, bar/line/pie charts, and ASCII art."
argument-hint: "[diagram description]"
allowed-tools: Bash, Read
disable-model-invocation: false
---

Create a diagram for: $ARGUMENTS

## Route

- **Mermaid (default)** — quick or editable output, and every flowchart, sequence, class, state, ER, or gantt diagram.
- **archify** — only when the user asks for a polished, shareable, or interactive HTML (or names archify) AND the diagram is an architecture, workflow, sequence, data-flow, or lifecycle/state diagram. Everything else stays on Mermaid.
- Engine missing (`${AI_VENDOR_DIR:-~/.local/share/ai-vendor}/archify` absent, or no `node`): say so, offer `bash ~/.config/ai/scripts/vendor.sh sync archify` (network clone of the latest release — run only with 대협's consent), and deliver Mermaid meanwhile. Environments without a shell (Claude Cowork, Codex desktop app) always take the Mermaid route.

## Mermaid

1. Pick the fitting type (flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt) and output the DSL in a ```mermaid block.
2. Save to `/tmp/diagram.mmd` and copy it to the clipboard (`pbcopy`; `wl-copy`/`xclip` on Linux).
3. Tell the user: preview at mermaid.live, or excalidraw.com → Menu → Mermaid to Excalidraw. When layout matters (many cross-group edges), render it first — a local page loading mermaid from the jsdelivr CDN, screenshotted with headless Chrome — and look before handing over.

### Excalidraw import constraints (hard)

- No `\n` inside node text — it renders literally. Use commas or split into nodes.
- No HTML tags or markdown inside node text.
- `classDef` / `:::class` only in flowchart, classDiagram, stateDiagram — never in sequenceDiagram, erDiagram, gantt.

## archify

Engine root: `ENGINE="${AI_VENDOR_DIR:-$HOME/.local/share/ai-vendor}/archify/archify"` (installed by `ai/scripts/vendor.sh sync archify`; `vendor.sh check archify` compares it with the latest release). The engine's SKILL.md is the authority and changes with each release — read it fresh every time rather than relying on section names from an earlier version.

1. Read `$ENGINE/SKILL.md` and follow its native-diagram path — choose the type, read the schema and example it names, write the candidate, then one `finalize` run that validates, delivers, and browser-checks it — calling the CLI as `node "$ENGINE/bin/archify.mjs"`. Its one-page explainer mode is outside this skill. A non-zero `finalize` is never success; its repair limit applies, and when it is reached, stop and report the remaining diagnostics.
2. One override: work in `/tmp/archify`, so the engine's per-request `.archify/<type>-<slug>-<timestamp>/` folder lands there, unless 대협 names a path. When a receipt's update notice fires, relay it and point 대협 to `bash ~/.config/ai/scripts/vendor.sh sync archify` — never update mid-task.
3. Look before reporting — required here, though the engine calls it optional: once `finalize` passes, run `node "$ENGINE/bin/archify.mjs" visual-check <output.html> --summary --require-provenance` with the same `--out-dir` as the `finalize` that produced that HTML (none after a first run), and read the screenshots it lists. When it cannot run here, take headless Chrome screenshots of the delivered HTML at 1440×900 and at a tall viewport (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 --screenshot=<out.png> file://<html>`; `brave-origin`/`chromium`/`google-chrome` on Linux — whichever is on PATH) and read those. Fix what the automated gates cannot see — overlapping boundaries, clipped rows, dead space — then rerun `finalize` and `visual-check` with one fresh `--out-dir`, as the engine's delivery contract says. Never open a visible browser unless asked.
4. Report as the engine's output guidance says (a clickable link to the HTML first, no command or receipt recap), and say whether the screenshots were looked at and what was skipped.
