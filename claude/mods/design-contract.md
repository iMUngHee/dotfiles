# design-contract.md

## Scope & Inheritance

- **Applies to:** the drawn surfaces of `claude/mods/pm-band` (band line, `/pm` pane) and `claude/mods/pager-view` (band line, `/pager` pane), on every render surface the engine names: `terminal`, `desktop`, `vscode`, `mobile`.
- **Parent contract:** none.
- **Override rules:** this contract owns what the two mods show and how. Their data and refresh contracts (read-only CLIs, no I/O while drawing, session-tagged single-flight refresh, the pager badge baseline) are upstream inputs recorded in `.agents/plans/2026-10-07-claude-mods-pm-pager.md` and stay authoritative. UI engineering may update only Implementation Bridge after build authorization.
- **Owner:** 대협.
- **Depth:** Full.
- **Last updated:** 2026-10-07.

## Surface Type & Craft Profile

- **Surface:** a status line above the prompt and two side panes inside Claude Code: a glanceable product-app workflow surface, not a dashboard.
- **Media:** TUI (Ink, cell grid, the person's terminal theme) and desktop GUI (the Code tab draws Box as a flex div and Text as a span in a proportional face; it has no pixel or canvas element, and Svg is an isolated image that takes no input). vscode and mobile have no Client and fall back to lists.
- **Direction:** **Ledger** — a mail-reader index over a reading pane (aerc, neomutt) and a list ledger of glyph-led rows (Linear, GitHub Primer). Structure comes from rules, whitespace and aligned columns; a single accent per meaning; selection by glyph and weight; a key-hint line closes each tab.
- **Density:** one item per row in lists; the reader and the drawing take the rest of the pane.
- **Anti-patterns:** boxed panels inside the pane (the frame is the engine's), color-only state, a message or step cut to one line with no way to read the rest, a character-grid drawing on a surface whose text is not monospace.
- **Quality bar:** at a glance the band says which plan step this session is on and whether mail came in; opening a pane answers what the steps, backlog, graph or conversation hold without leaving Claude Code.

## Product Context

- **Primary user:** 대협, running several Claude Code sessions in the terminal (tmux, Ghostty) and in the desktop app's Code tab.
- **Jobs and success:**
  1. **Know where this session's plan stands.** Success: the band names the plan, progress and current step; `/pm` steps lists every step with done/current marks.
  2. **See the backlog and its shape.** Success: the backlog tab groups items by task with priority and blocking reason; the graph tab shows tasks, items and their dependency and order links legibly on every surface, and a node's detail can be read.
  3. **Read this session's pager conversation.** Success: `/pager` lists the messages and shows the selected one (newest by default) in full; the peers tab shows who can be paged and which hosts are live.
- **Non-goals:** sending, marking or delivering pager mail; editing plans or the backlog; any write.

## UX Model

- **Band (above the prompt), top to bottom:** the pm line, then the pager line, then whatever the mods beneath draw. A survey takes the band whole.
  - pm line: plan id, progress dots and count, current step text, then two controls `steps` and `graph` that open `/pm` on that tab.
  - pager line: the session's name as a control that opens `/pager`, `● N new`, the last message's direction, peer, age and preview, the live peer count.
- **`/pm` pane:** tabs `1 steps`, `2 backlog`, `3 graph`.
  - steps: plan id · status · done/total, the plan title, then every step.
  - backlog: one group per task (name and item count), then rows of marker, priority, id and title, with `⤷ needs X` / `⤷ after X`; the current plan's item marked; inbox count last.
  - graph: the drawing (task hubs, items, task/dependency/order links), then the detail line of the picked node. VS Code and mobile show the backlog list instead.
- **`/pager` pane:** tabs `1 messages`, `2 peers`.
  - messages: an index of recent messages (time, direction, peer, `(human)`, first line), then the reader for the selected message (header rule with id, direction, peer, `(human)`, time, age; the whole body), then the key hints.
  - peers: a column header, then one row per peer — live hosts first, then by last activity; this session marked `(this)`.
- **Content priority:** must see — current step, new-mail count, selected message body, graph structure. Should see — ages, priorities, blocking reasons. On demand — full titles and notes (node detail), message bodies other than the selected one.

## Data & State Model

| Context | State | What the user sees | Recovery / transition |
| --- | --- | --- | --- |
| pm band | unbound session | dim `○ no plan` | binding a plan redraws on the next refresh |
| pm band | done/dropped plan | nothing | — |
| pm band | refresh failed, no last value | dim `⚠ plan: <reason>` | next refresh |
| pm band | refresh failed, last value kept | the line plus a dim `⚠` | next refresh |
| /pm steps | no plan | `No plan is bound to this session.` | — |
| /pm backlog, graph | before the first read | `loading…` | the open pane's refresh |
| /pm backlog, graph | read failed | `⚠ backlog: <reason>` | next refresh |
| /pm backlog | empty | `The backlog is empty.` | — |
| /pm graph | over the node cap | the drawing plus `+N more` | — |
| /pm graph | nothing picked | hint naming how to pick | pick a node |
| pager band | no pager or no name | nothing | — |
| pager band | failed refresh | the last line plus a dim `?` | next refresh |
| /pager | no name | `This session has no pager name yet.` | — |
| /pager messages | none | `No messages to or from <name> yet.` | — |
| /pager messages | body over 6,000 characters | the first 6,000, then `… N more characters · full text: pager export (#id)` | run `pager export` |
| /pager peers | before the first read | `loading…` | next refresh |
| any | session switched (/clear, /resume, /branch) | the previous session's values vanish at once | the new session's first refresh |

## Interaction Model

- **Pane tabs:** digit hotkeys `1`–`3` (pm) and `1`–`2` (pager), or a click; the shown tab persists for the session.
- **Band controls:** `steps` and `graph` set the tab and open `/pm` with focus; the pager name opens `/pager` and clears the badge.
- **Picking a message:** `j` older, `k` newer (hotkey Buttons in the hint line), or a click on / Enter over a message's time. The arrows and page keys scroll the pane body (the engine's). The pick holds until the person moves it; with no pick the newest message is shown and follows new mail.
- **Picking a graph node:** terminal and desktop — click a node, drag to move it, focus the drawing and use the arrows; a resting pointer underlines the node under it. The pick shows the node's detail line; a task hub's detail names the task.
- **Moving around the graph:** the graph lives on a canvas larger than the pane when the backlog is big (it grows with the node count). Drag empty space or shift+arrows to pan; `+` / `-` change the spacing (zoom levels 0.25–2; text keeps its size); `0` fits every node. The wheel scrolls the pane, not the canvas: a Client receives no wheel events.
- **Feedback:** every pick redraws at once; nothing waits on I/O.

## Microcopy

- Tabs: `steps`, `backlog`, `graph`; `messages`, `peers`. Band controls: `steps`, `graph`.
- Hints: pm graph `click a node · drag it to move · drag empty space or shift+arrows to pan · + − zoom · 0 fit`; pager messages terminal `j older · k newer · 1 2 tabs · ↑↓ scroll`; pager messages other surfaces `click a time to read it`.
- Reader header: `#<id> · ← <peer> (human) · MM-DD HH:MM · <age> ago` (`→` for sent).
- Truncation: `… <N> more characters · full text: pager export (#<id>)`.
- State lines as in Data & State Model.

## Visual System

- **Color roles (ThemeKey only; the palette is the person's):** `claude` accent for task names and the plan id; `suggestion` incoming `←`; `success` outgoing `→` and progress dots; `warning` current step, new mail, blocking reason; `subtle` rules and task links; `inactive` draft status and order links; dim for metadata; `error` is not used (failures are quiet, recoverable).
- **Type:** terminal — one monospace size; hierarchy by bold, dim and position. Desktop — the surface's system face at its body size; hierarchy as on the terminal.
- **Spacing:** one blank row between regions; group headers sit flush left, rows indent one cell.
- **Rules:** a `─` line in `subtle`, carrying a label at its left end (`── #157 · … ──`), sized to the pane's `bodyColumns`.
- **Motion:** none beyond the terminal graph settling.
- **Signature moment:** the reader rule — the message's identity laid into the line that separates index from body.

## Component Rules

| Component | Composition | States | Used In |
| --- | --- | --- | --- |
| Tab row | plain Buttons with digit hotkeys, 3 cells apart | shown: full strength; other: dim | both panes |
| Band control | plain Button, dim at rest | focus/hover: full strength (engine) | pm line, pager name |
| Index row | marker cell (`▌` picked, space otherwise) · time Button · direction+peer in its color · `(human)` · first line, truncated at the edge | picked: marker + bold preview; other: preview at normal weight | /pager messages |
| Reader | rule header, then the body as one Text per line, wrapped; blank lines kept | truncated: closing dim line | /pager messages |
| Peer row | fixed columns name 6 · tool 7 · host 8 · last 10 · root (start-truncated, `~` for home) | live: `●` normal; other: `○` dim; this session: bold + `(this)` | /pager peers |
| Backlog row | marker (`▶` current, `◌` blocked, `·` other) · `[P#]` · id · `—` title (dim) · reason in `warning` | current: bold; blocked: dim | /pm backlog |
| Graph | Client cell drawing; labels placed right, else left, else cut with `…` into free cells. Terminal: one Text per row. Desktop (`isPlaced`): every run of glyphs in its own Box at its cell, `position: absolute`, inside a Box the size of the region | picked: inverse; hovered: bold + underline; current: `suggestion` bold | /pm graph |
| Hint line | dim Text; on terminal it carries the `j`/`k` Buttons | — | /pager messages, /pm graph |

## Responsive & Accessibility

- **Terminal:** every row ends at `bodyColumns` (`truncate-end`); rules are drawn to `bodyColumns`; the index window keeps the picked row visible and takes `max(3, ⌊bodyRows × 0.35⌋)` rows; the graph Client takes the rows left after the hint and detail lines.
- **Desktop:** the graph keeps cell positions whatever the face, because each run is placed at its cell; a run is never wider than the cells it took on the terminal, so runs cannot collide.
- **Focus and state are never color alone:** picked rows carry `▌`, the current step `▶`, blocked `◌`, live `●` versus `○`.
- **Every action has a key:** tabs by digit, message pick by `j`/`k`, Buttons by Tab+Enter.
- **Korean text:** bodies wrap through the surface (`wrap`); the terminal counts a Hangul syllable as two cells (Ink).

## Performance & Formatting

- Times as `MM-DD HH:MM` local; ages `just now`, `<n>s`, `<n>m`, `<n>h`, `<n>d` from the refresh's `now`.
- The index draws only the rows in its window; the reader body is capped at 6,000 characters; the graph at 120 nodes (`+N more`); backlog titles at 200 characters (the engine refuses a drawing over 100,000 characters of text).

## Do / Don't

- Do keep one accent per meaning; don't color whole rows.
- Do let the engine's pane frame be the only box; don't draw nested borders.
- Do place the graph's runs at their cells wherever the text is not a cell grid; don't draw rows of space-aligned text there, and don't fall back to an Svg image (it takes no input — rejected by 대협 on sight).
- Don't hide a message body behind a single truncated line.

## Artifact Ledger

| ART ID | Path | Revision | Selection | Covers | States / extremes | Status | Supersedes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ART-001 | .agents/artifacts/pm-pager-redesign/ART-001.html | d811824d5115 | ART-001 | OBL-002,OBL-005,OBL-006,OBL-007 | default@pane-96col, long-message@pane-96col | selected | — |
| ART-002 | .agents/artifacts/pm-pager-redesign/ART-002.html | 4143fd117941 | — | — | default@pane-96col | exploratory | — |
| ART-003 | .agents/artifacts/pm-pager-redesign/ART-003.html | 4bbf8dcb734c | — | — | default@pane-96col | exploratory | — |

ART-001 is an experience-structure artifact (structure, not interface direction). No interface artifact was selected; the Ledger direction is the written decision above.

## Implementation Bridge

<!-- Written by ui-engineering after build authorization. -->

## Decision Log & Open Questions

- 2026-10-07 — Experience: ART-001 chosen by 대협 over ART-002 (reading stream) and ART-003 (now-first). Answers: badge clears on `/pager` open; graph keeps its own tab; `(human)` stays; desktop nodes are picked from a list under the drawing.
- 2026-10-07 — Interaction: message picking moved from ↑↓ to `j`/`k` and clicking the time, because a focused pane gives the arrows to the engine's scroll. Decided under 대협's delegation.
- 2026-10-07 — Interface: Ledger chosen by Claude under 대협's delegation; boxed panels (lazygit, Charm) rejected because the side pane has no room for a second frame.

Surface Obligations:
| ID | Stage | Obligation | Derives from | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| OBL-001 | experience | /pm graph tab is readable on desktop: nodes and labels do not collapse into one line | — | captured:대협 screenshot (defu #157) | PASS |
| OBL-002 | experience | On desktop a node is picked in the drawing itself and its detail line is shown | — | captured:대협 "svg는 너무 별로임"; chose A (real elements in a Client) | PASS |
| OBL-003 | experience | Terminal graph labels never overwrite one another | — | captured:.agents/plans/2026-10-07-claude-mods-pm-pager.md Deferred | PASS |
| OBL-004 | experience | The pm band line carries steps and graph controls that open /pm on that tab | — | captured:pm-band-open-buttons backlog item | PASS |
| OBL-005 | experience | /pager messages: the selected message (default newest) is read in full below the index; long bodies keep a route to the full text | — | captured:대협 screenshot "이렇게 축약되어서 보이면 무슨 의미일까" | PASS |
| OBL-006 | experience | The badge clears when /pager opens (unchanged); (human) stays | — | artifact:ART-001#default@pane-96col | PASS |
| OBL-007 | experience | Peers read as aligned columns with live sessions first and this session marked | — | artifact:ART-001#default@pane-96col | PASS |
| OBL-008 | interface | Ledger system: rules/whitespace, aligned columns, ThemeKey roles as in Decisions, selection by glyph+bold, key-hint footer | OBL-001,OBL-002,OBL-005,OBL-007 | missing | PENDING |
| OBL-009 | interface | The desktop draws the same Client graph with every run placed at its cell (absolute Boxes); click, drag, arrows and hover work in the drawing | OBL-001,OBL-002 | missing | PENDING |
| OBL-010 | interface | Terminal raster places each label right, else left, else truncated with … in free cells; nodeAt follows placed labels | OBL-003 | missing | PENDING |
| OBL-011 | interface | Message reader: header rule with #id, direction, peer, (human), time, age; body wraps with line breaks kept; cap 6,000 chars with a pager export route | OBL-005,OBL-006 | missing | PENDING |

Approvals:
- experience_approved: ART-001 — 대협 payload note "디자인 시스템도 적당한거 찾아 골라서 좀 고급지게 해봐 ㅇㅇ"
- direction_selected: none (no interface artifact). The Ledger direction was chosen by Claude under 대협's delegation: "디자인 시스템도 적당한거 찾아 골라서 좀 고급지게 해봐 ㅇㅇ", "묻지말고 알아서 끝까지 해놓으셈 ㅇㅇ". Recorded as a delegated direction, not as 대협's selection.
- build_authorized: "묻지말고 알아서 끝까지 해놓으셈 ㅇㅇ" (and the earlier "전체 진행 (추천)" answer)

- 2026-10-07 — Experience delta at 대협's ask ("무한 캔버스는 불가? 지금은 화면 크기 안에서만 노는데"): the graph became a pannable, zoomable canvas.
- 2026-10-07 — Interface/Experience delta: the desktop Svg + node list shipped in `5fc5ead` was rejected by 대협 on the live render ("너무 구린데, 저게 최선임?", "svg는 너무 별로임"). Of three options (real elements in a Client, a task board, a polished Svg) 대협 chose real elements in a Client. Canvas-like elements (`Raster`, `Image`) exist on the terminal only in this engine build.

Open: how the desktop Code tab sizes a cell for absolute positions — answered by the desktop render (plan step 9).
