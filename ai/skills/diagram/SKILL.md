---
name: diagram
description: "Produce Mermaid diagrams (architecture, flows, sequences, ERDs, data structures) and copy the DSL to the clipboard for mermaid.live or excalidraw. Skip static images, bar/line/pie charts, and ASCII art."
argument-hint: "[diagram description]"
allowed-tools: Bash
disable-model-invocation: false
effort: medium
---

Create a Mermaid diagram for: $ARGUMENTS

1. Pick the fitting type (flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt) and output the DSL in a ```mermaid block.
2. Save to `/tmp/diagram.mmd` and copy it to the clipboard (`pbcopy`; `wl-copy`/`xclip` on Linux).
3. Tell the user: preview at mermaid.live, or excalidraw.com → Menu → Mermaid to Excalidraw.

## Excalidraw import constraints (hard)

- No `\n` inside node text — it renders literally. Use commas or split into nodes.
- No HTML tags or markdown inside node text.
- `classDef` / `:::class` only in flowchart, classDiagram, stateDiagram — never in sequenceDiagram, erDiagram, gantt.
