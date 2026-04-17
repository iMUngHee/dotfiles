---
name: diagram
description: "Generate Mermaid diagrams for architecture, flows, and data structures. Copies to clipboard for mermaid.live or excalidraw import."
argument-hint: "[diagram description]"
allowed-tools: Bash
disable-model-invocation: false
model: sonnet
---

Create a Mermaid diagram for: $ARGUMENTS

## Instructions

1. Generate clean, excalidraw-import-compatible Mermaid DSL (see compatibility rules below)
2. Output the DSL in a ```mermaid fenced code block
3. Save to `/tmp/diagram.mmd`
4. Copy to clipboard: `cat /tmp/diagram.mmd | pbcopy`

## Mermaid Type Selection

- **flowchart LR/TB**: architecture, data flow, pipelines, infrastructure
- **sequenceDiagram**: API calls, protocol flows, request/response (note: classDef not supported)
- **classDiagram**: class hierarchies, type relationships
- **stateDiagram-v2**: state machines, lifecycle
- **erDiagram**: database schema, entity relationships
- **gantt**: timelines, project schedules

## Color Palette (flowchart/classDiagram/stateDiagram only)

`classDef` is NOT supported in sequenceDiagram, erDiagram, or gantt. For those types, skip color definitions entirely.

```
classDef blue fill:#a5d8ff,stroke:#4a9eed,color:#1e1e1e
classDef green fill:#b2f2bb,stroke:#22c55e,color:#1e1e1e
classDef orange fill:#ffd8a8,stroke:#f59e0b,color:#1e1e1e
classDef purple fill:#d0bfff,stroke:#8b5cf6,color:#1e1e1e
classDef red fill:#ffc9c9,stroke:#ef4444,color:#1e1e1e
classDef yellow fill:#fff3bf,stroke:#d97706,color:#1e1e1e
classDef teal fill:#c3fae8,stroke:#22c55e,color:#1e1e1e
classDef pink fill:#eebefa,stroke:#ec4899,color:#1e1e1e
```

Apply colors semantically:

- **blue**: input, sources, primary nodes
- **green**: success, output, storage, cache
- **orange**: warning, external, pending
- **purple**: processing, middleware, transform
- **red**: error, critical, cost
- **yellow**: notes, decisions, highlights
- **teal**: data, memory, persistence
- **pink**: analytics, metrics

Apply via `:::className` or `class nodeId className`.

## Excalidraw Import Compatibility

ALWAYS follow these rules — excalidraw's "Mermaid to Excalidraw" will break otherwise:

- **No HTML tags**: `<b>`, `<br/>`, `<i>` render as literal text. Plain text only.
- **NEVER use `\n` in node text**: `\n` renders as literal "\n" text, NOT a line break. This is a hard constraint — there is no workaround for line breaks inside a single node.
  - BAD: `A[scrollTop=500px\n즉시 설정]`  → displays "\n" as text
  - GOOD: `A[scrollTop=500px, 즉시 설정]` → comma-separated single line
  - GOOD: split into two nodes `A[scrollTop=500px]` → `B[즉시 설정]`
- **No markdown in nodes**: `**bold**`, `_italic_` won't render.

If content is too long for one line: shorten wording, use comma separation, or split into separate connected nodes. Never use `\n`.

## Style Guide

- Use `subgraph` to group related elements with clear labels
- Add meaningful labels on every arrow (`-->|label|`)
- Keep node text short (max ~4 words per node)
- Use shape syntax for visual distinction:
  - `[rect]` for process/action
  - `([stadium])` for start/end
  - `{diamond}` for decision
  - `[(cylinder)]` for database/storage
  - `[[subroutine]]` for external systems
- Prefer LR (left-to-right) for pipelines, TB (top-to-bottom) for hierarchies

## After Generation

Tell the user:

- Clipboard copied. Preview at **mermaid.live**
- To edit as excalidraw: **excalidraw.com → Menu (≡) → Mermaid to Excalidraw**
