# design-contract.md

## Scope & Inheritance

- **Applies to:** the drawn surfaces of `claude/mods/pm-band` (band line, `/pm` pane) and `claude/mods/pager-view` (band line, `/pager` pane), on every render surface the engine names: `terminal`, `desktop`, `vscode`, `mobile`.
- **Parent contract:** none.
- **Override rules:** this contract owns what the two mods show and how. Their data and refresh contracts (read-only CLIs, no I/O while drawing, session-tagged single-flight refresh, the pager badge baseline) are upstream inputs recorded in `.agents/plans/2026-10-07-claude-mods-pm-pager.md` and stay authoritative; the per-room `seen` map of 2026-10-09 follows the same rules (kept in `$.store` per session id, moved only by refreshes and handlers). UI engineering may update only Implementation Bridge after build authorization.
- **Owner:** 대협.
- **Depth:** Full.
- **Last updated:** 2026-10-09.

## Surface Type & Craft Profile

- **Surface:** a status line above the prompt and two side panes inside Claude Code: a glanceable product-app workflow surface, not a dashboard.
- **Media:** TUI (Ink, cell grid, the person's terminal theme) and desktop GUI (the Code tab draws Box as a flex div and Text as a span in a proportional face; it has no pixel or canvas element, and Svg is an isolated image that takes no input). vscode and mobile have no Client and fall back to lists.
- **Direction:** **Console** — an app shell inside the engine's pane frame. A tab strip whose active tab is underlined in the accent (gh-dash), chips for status and counts (inverseText on a role background), one focal card per view, messenger rooms of bubbles for the pager (claude-chat-bubbles, waha-tui), two-line chat rows with the unread count pinned right (tgt, gurk-rs), step meters and a line gauge for progress (superpowers-progress, ratatui LineGauge, btop), and a key bar closing each view.
- **Density:** chat rows two lines; backlog and step rows one line; bubbles fold at 8 lines; the drawing takes the rest of the graph tab.
- **Anti-patterns:** a frame around a whole region (the pane frame is the engine's; cards are only for the one focal block and for bubbles), color-only state, a message cut with no way to read the rest, hex/truecolor or emoji glyphs (theme keys only; emoji widths disagree across terminals), a character-grid drawing on a surface whose text is not monospace.
- **Quality bar:** at a glance the band says which plan step this session is on and whether mail came in; opening a pane reads like an app — the steps, backlog, graph or a conversation answer their question without leaving Claude Code.

## Product Context

- **Primary user:** 대협, running several Claude Code sessions in the terminal (tmux, Ghostty, Windows Terminal) and in the desktop app's Code tab.
- **Jobs and success:**
  1. **Know where this session's plan stands.** Success: the band names the plan, its per-step progress and the current step; `/pm` steps shows the gauge, every step with done/current marks, and the current step in full.
  2. **See the backlog and its shape.** Success: the backlog tab groups items by task with priority and blocking reason; the graph tab shows tasks, items and their dependency and order links legibly on every surface, and a node's detail can be read.
  3. **Read this session's pager conversations.** Success: `/pager` lists the conversations by peer with presence, last message and unread count; opening one shows it as bubbles, newest at the bottom, long ones folded with a way to read the rest; peers without messages are still listed.
- **Non-goals:** sending, marking or delivering pager mail; editing plans or the backlog; any write outside the mods' own `$.state` and `$.store`.

## UX Model

- **Band (above the prompt), top to bottom:** the pm line, then the pager line, then whatever the mods beneath draw. A survey takes the band whole.
  - pm line: status glyph and plan id, a meter with one segment per step, `done/total`, the current step text; the `steps` and `graph` controls pinned to the right edge open `/pm` on that tab.
  - pager line: `✉ <name>` as a control that opens `/pager`, a `N new` chip, the last message's direction, peer, age and preview; the live peer count pinned to the right edge.
- **`/pm` pane:** tab strip `1 steps`, `2 backlog`, `3 graph`.
  - steps: plan id, status chip, `done/total · pct` at the right, the plan title, the gauge; then the `NOW` card with the current step's full text, so it is on screen in an inline pane (about eleven rows); then every step, the current one marked `▶`; then the key bar.
  - backlog: one section per task (key, rule, item count), then rows of marker, priority chip, id, `⤷ needs X` / `⤷ after X` and title; the current plan's item marked; the inbox count, then the key bar.
  - graph: the drawing (task hubs, items, task/dependency/order links), then the detail line of the picked node and the key bar. VS Code and mobile show the backlog list instead.
- **`/pager` pane:** two views in one pane; no tabs.
  - chats (default): a header with this session's name as a chip, the live count and the total unread; then one two-line row per room — conversations by their last message, newest first, then the peers without messages, live first, under a dim `PEERS` label when conversations come before them; this session is never a row.
  - room: a header with the back control, the peer's name, presence, tool and root; then the conversation oldest to newest as bubbles (received left, sent right) with a day separator when the date changes, the newest at the bottom; the view opens scrolled to the newest.
- **Content priority:** must see — current step, new-mail count, unread per room, the newest bubbles, graph structure. Should see — ages, priorities, blocking reasons, presence. On demand — folded bubble lines, full titles and notes (node detail), bodies past 6,000 characters (`pager export`).

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
| /pm graph | nothing picked | the key bar naming how to pick | pick a node |
| pager band | no pager or no name | nothing | — |
| pager band | failed refresh | the last line plus a dim `?` | next refresh |
| /pager | no name | `This session has no pager name yet.` | — |
| /pager chats | no rooms at all | `No messages to or from <name> yet.` | a message or a peer appears on the next refresh |
| /pager chats | a peer without messages | its row with `no messages yet · <root>` | — |
| /pager chats | unread in a room | an unread chip with the count on its row; the total in the header | opening the room clears it |
| /pager room | no messages with the peer | `No messages with <peer> yet.` | — |
| /pager room | more than 60 messages, or more unfolded text than a drawing holds | the newest 60 that fit 80,000 characters of bodies, `<N> earlier messages not shown` above them; the newest bubble and the key bar always stay | fold (`e`) to bring the older back; `pager export` |
| /pager room | bubble over 8 lines | the first 8 lines, `▾ <N> more lines` | press it: unfolds; `▴ fold` folds again; `e` unfolds or folds them all |
| /pager room | body over 6,000 characters | the first 6,000 (unfolded), then `… N more characters · full text: pager export (#id)` | run `pager export` |
| /pager room | the peer left pager's roster | the room stays while messages exist; presence `○ gone` | — |
| any | session switched (/clear, /resume, /branch) | the previous session's values vanish at once; the pager pane returns to chats | the new session's first refresh |

## Interaction Model

- **`/pm` tabs:** digit hotkeys `1`–`3` or a click; the shown tab persists for the session.
- **Band controls:** `steps` and `graph` set the tab and open `/pm` with focus; the pager name opens `/pager` and clears the band badge. `/pager` opened anew starts on the chats; opened while it is up, it stays where it is.
- **Chats:** `j` / `k` move the cursor bar down / up; `o` opens the room under it; a click (or Tab, Enter) on a name opens that room. The cursor holds until moved and follows the room last opened.
- **Room:** `b` (or the `‹ chats` control) returns to the chats; the arrows and page keys scroll the pane (the engine's); `e` unfolds every folded bubble at once and, when none is left folded, folds them all again; a bubble's own fold control (a click) unfolds or folds just that one. Tab starts at `‹ chats`, so the folds have `e` rather than a Tab path. Opening a room scrolls to its newest bubble and clears its unread count; while it is open, mail into it stays read.
- **Picking a graph node:** terminal and desktop — click a node, drag to move it, focus the drawing and use the arrows; a resting pointer underlines the node under it. The pick shows the node's detail line; a task hub's detail names the task.
- **Moving around the graph:** the graph lives on a canvas larger than the pane when the backlog is big (it grows with the node count). Drag empty space or shift+arrows to pan; `+` / `-` change the spacing (zoom levels 0.25–2; text keeps its size); `0` fits every node. The wheel scrolls the pane, not the canvas: a Client receives no wheel events.
- **Feedback:** every move, open and fold redraws at once; nothing waits on I/O.

## Microcopy

- Tabs: `steps`, `backlog`, `graph`. Band controls: `steps`, `graph`. Card label: `NOW`.
- Chats header: `<name>` chip, `● <N> live`, `· <N> unread`. Quiet group label: `PEERS`. Row preview: `you: ` before sent text, `(human)` before an operator's text, `no messages yet · <root>` for a peer without messages.
- Room header: `‹ chats`, `<peer>`, `● live` / `○ gone`, `<tool>`, `<root>`. Day separator: `── MM-DD ──`. Fold: `▾ <N> more lines`, `▴ fold`. Over the cap: `<N> earlier messages not shown`.
- Key bars: chats terminal `j: down  k: up  o: open · click a name`; chats elsewhere `click a name to open its chat`; room terminal `e: unfold all` (`e: fold all` once every fold is open; shown only when a bubble folds) then `↑↓ scroll`; room elsewhere the same control then `click ▾ to unfold a message`; pm graph `click a node · drag it to move · drag empty space or shift+arrows to pan · + − zoom · 0 fit`; pm steps and backlog terminal `1 2 3 tabs · ↑↓ scroll` (dim text: the tab strip holds the digit hotkeys).
- Truncation: `… <N> more characters · full text: pager export (#<id>)`.
- State lines as in Data & State Model.

## Visual System

- **Color roles (ThemeKey only; the palette is the person's):** `claude` — plan id, task keys, the active tab's underline, sent bubbles' border, the cursor bar, the chats header chip; `success` — done steps, meter and gauge fill, live `●`, the `active` status chip; `warning` — the current step (its hollow meter segment, `NOW` card border, `▶`), the `N new` and unread chips, P0–P1 chips, blocking reasons; `subtle` — rules, the tab strip's track, received bubbles' border, meter and gauge track; `inactive` — the `draft` chip, order links; `suggestion` — `(human)`, the graph's current node; `inverseText` — text on every chip; dim for metadata; `error` is not used (failures are quiet, recoverable).
- **Type:** terminal — one monospace size; hierarchy by bold, dim, chips and position. Desktop — the surface's system face at its body size; the same hierarchy.
- **Shape:** round borders (`╭╮╰╯`, the engine's own prompt box) for cards and bubbles; `─` rules; `━` for the active tab and the gauge fill; `▰▱` meter segments; `●○◌▶✓▌` glyph markers. No emoji.
- **Spacing:** the pane content is inset one column each side; one blank row between header, body and key bar; bubbles one row apart.
- **Motion:** none beyond the terminal graph settling.
- **Signature moment:** the room — bubbles hugging their sides with the time tucked into their last row, under a header that keeps the peer's presence in view.

## Component Rules

| Component | Composition | States | Used In |
| --- | --- | --- | --- |
| Tab strip | terminal: plain Buttons with digit hotkeys 3 cells apart, then a rule the content width: `━` in `claude` under the shown tab, `─` in `subtle` elsewhere; desktop and others: native Buttons, the shown one `primary` | shown: full strength + underline; other: dim | /pm |
| Chip | ` text ` (one space each side) in `inverseText`, bold, on a role background | — | headers, band, unread, priorities |
| Card | round border, padding 1 across, a dim bold label as its first row | — | `NOW` (border `warning`), right under the steps gauge |
| Key bar | plain hotkey Buttons (`j: down`) then dim hints after `·`; where a view has no keys of its own (pm steps, backlog) dim text naming the tab digits and the scroll, on the terminal | — | every pane view (off the terminal, pm steps and backlog draw none: the native tab Buttons stand alone) |
| Chat row | line 1: cursor bar (`▌` in `claude` or a space), presence (`●` `success` / `○` dim), name Button, tool (dim), flexible gap, age (dim), unread chip; line 2: the bar again, two spaces, the preview (dim, truncated at the edge; a root is cut from its start, keeping the folder that tells sessions apart) | cursor: bar; unread: chip + name at full strength; gone without messages: name dim | /pager chats |
| Bubble | a row Box (`flex-start` received, `flex-end` sent) holding the bubble and a 20% spacer on the far side; the bubble: round border (`subtle` received, `claude` sent), padding 1 across, as wide as its longest line, body lines wrapped, then a footer row justified (not grown, which would widen the bubble to its most): fold control at the left, `(human)` and `HH:MM` (dim) at the right | folded: 8 lines + `▾ N more lines`; unfolded: all + `▴ fold`; capped: the truncation line | /pager room |
| Day separator | centered dim `── MM-DD ──` | — | /pager room |
| Band meter | one `▰` per done step (`success`), a bold `▱` for the current (`warning`), `▱` for the rest (`subtle`), drawn only up to 20 steps; the filled segments always equal the done count beside them | — | pm band |
| Gauge | `━` × round(width × done/total) in `success`, then `─` in `subtle` to the content width | — | /pm steps |
| Backlog section | key (bold `claude`), a `subtle` rule to the width, the count (dim) | — | /pm backlog |
| Backlog row | marker (`▌` current in `claude`, `◌` blocked, space) · priority chip (P0–P1 on `warning`; P2 bold; P3+ dim) · id · reason in `warning` · title (dim) — the reason before the title, so the edge cuts the title and not what blocks the item | current: bar + bold id; blocked: dim | /pm backlog |
| Graph | Client cell drawing; labels placed right, else left, else cut with `…` into free cells. Terminal: one Text per row. Desktop (`isPlaced`): every run of glyphs in its own Box at its cell, `position: absolute`, inside a Box the size of the region | picked: inverse; hovered: bold + underline; current: `suggestion` bold | /pm graph |

## Responsive & Accessibility

- **Terminal:** the content width is `bodyColumns − 2`; every one-line row ends there (`truncate-end`); rules, the tab strip's track and the gauge are drawn to it; a chat row's age and unread chip never shrink — the name and preview give way first; bubbles take at most 80% of it.
- **Inline (the terminal under 110 columns seats a pane above the prompt, about eleven rows):** the blank rows under the tab strip and above the `NOW` card go, so the steps header, gauge and the whole card are on screen when `/pm` opens.
- **Desktop:** Buttons are native (the tab strip's underline is the primary Button instead); bubbles and chips use the same Box and Text props; the graph keeps cell positions whatever the face, because each run is placed at its cell.
- **Focus and state are never color alone:** the cursor carries `▌`, the current step `▶` and the `NOW` card, blocked `◌`, live `●` versus `○`, sent versus received by side as well as border, unread by a number.
- **Every action has a key:** tabs by digit, chats by `j`/`k`/`o`, the room by `b`, the folds by `e`, every Button by Tab and Enter.
- **Korean text:** bubble bodies wrap through the surface (`wrap`); the fold counts a Hangul syllable (and other wide characters) as two cells.

## Performance & Formatting

- Times: a bubble `HH:MM` local, a day separator `MM-DD`; ages `now`, `<n>m`, `<n>h`, `<n>d` from the refresh's `now`.
- A room draws its newest 60 messages; folded bubbles draw at most 8 lines; a body is capped at 6,000 characters; the graph at 120 nodes (`+N more`); backlog titles at 200 characters (the engine refuses a drawing over 100,000 characters of text).

## Do / Don't

- Do keep one accent per meaning; don't color whole rows.
- Do keep cards to the one focal block of a view and to bubbles; don't frame whole regions — the pane frame is the engine's.
- Do place the graph's runs at their cells wherever the text is not a cell grid; don't draw rows of space-aligned text there, and don't fall back to an Svg image (it takes no input — rejected by 대협 on sight).
- Don't hide a message body behind a single truncated line: a folded bubble shows 8 lines and names the rest.
- Don't use emoji or hex colors: theme keys and the glyphs above only.

## Artifact Ledger

| ART ID | Path | Revision | Selection | Covers | States / extremes | Status | Supersedes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ART-001 | .agents/artifacts/pm-pager-redesign/ART-001.html | d811824d5115 | ART-001 | OBL-002,OBL-005,OBL-006,OBL-007 | default@pane-96col, long-message@pane-96col | selected | — |
| ART-002 | .agents/artifacts/pm-pager-redesign/ART-002.html | 4143fd117941 | — | — | default@pane-96col | exploratory | — |
| ART-003 | .agents/artifacts/pm-pager-redesign/ART-003.html | 4bbf8dcb734c | — | — | default@pane-96col | exploratory | — |

ART-001 is an experience-structure artifact (structure, not interface direction). Its index-and-reader structure for `/pager` was superseded on 2026-10-09 (OBL-012–OBL-017); its badge and `(human)` decisions (OBL-006) stand. No interface artifact was selected on either date; Console is the written decision above. The three artifacts live on the machine that drew them (`.agents/` is machine-local).

## Implementation Bridge

<!-- Written by ui-engineering after build authorization. -->

2026-10-09 — Console and chat rooms, built on `agent/claude-mods-app-redesign` (plan `.agents/plans/2026-10-09-claude-mods-app-redesign.md`).

- **pager-view:** `hooks/pager.ts` gains the pure parts (`roomsOf`, `seenOf`, `unreadOf`, `newestInOf`, `cellsOf`, `foldOf`, `clockOf`, `dayOf`); `hooks/register.tsx` draws the band, the chats and the room, keeps the per-room `seen:<session>` map in `$.store` and asks `$.ui.scroll` to the room's end on open; `types/index.d.ts` carries `unread`, `room`, `cursor`, `expanded`.
- **pm-band:** `hooks/plan.ts` gains `meterOf` and `gaugeOf`; `hooks/register.tsx` draws the meter band, the tab strip, the steps tab (chip, gauge, `NOW` card first) and the backlog sections.
- **Engine facts met on the way:** a growing Box in a bubble's footer widens the bubble to its most (Yoga sizes it at most-available), so the footer is justified instead; a plugin's `$.ui.scroll` has no implementation in the `claude plugin test` kit (`HooksError: no implementation for ui.scroll`), so the room's scroll to its end is checked on the terminal render, where it holds.

Evidence (machine-local, `.agents/artifacts/claude-mods-app-redesign/`): hidden-ConPTY captures read by pyte at 160x45 (`a160/`: band, pm-steps, pager-chats, pager-room, pager-room-unfolded, pager-back), 100x40 inline (`a100/`, `a100s/pm-steps`), a sandbox backlog at 160x45 (`b160/`: pm-backlog, pm-graph) and the key bar fix at 160x45 (`k160/`: pm-steps, pm-backlog in its empty state); as `.txt` and `.html`, the first three sets also as `png/*.png` (headless Edge).

| ID | Stage | Obligation | Derives from | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| OBL-024 | implementation | pager-view draws the chats (two-line rows, `PEERS` group, unread chips, start-cut roots), the room (bubbles left/right with the time inside, day separator, fold at 8 lines, `e` for all, `b` back, opened at its end) and the band line (new chip, live count pinned right) | OBL-016,OBL-017,OBL-019,OBL-020,OBL-021 | code:claude/mods/pager-view/hooks/register.tsx; render:.agents/artifacts/claude-mods-app-redesign/a160/pager-room.txt; render:.agents/artifacts/claude-mods-app-redesign/a100/pager-room.txt | PASS |
| OBL-025 | implementation | pm-band draws the meter band (filled = done, hollow current in warning, controls pinned right), the tab strip with the shown tab's heavy segment, the steps tab (status chip, gauge, `NOW` card on screen inline) and the backlog sections (rules and counts, priority chips, reason before title) | OBL-018,OBL-021,OBL-022,OBL-023 | code:claude/mods/pm-band/hooks/register.tsx; render:.agents/artifacts/claude-mods-app-redesign/a100s/pm-steps.txt; render:.agents/artifacts/claude-mods-app-redesign/b160/pm-backlog.txt | PASS |

Craft findings: 6, all fixed on the branch before the final captures
- Severity: degrades the task — Observation: every bubble stretched to 80% of the pane, short ones included. Evidence: a160/pager-room (first run). Cost: the room read as a column of boxes, not a conversation. Correction: the footer is justified, not parted by a growing Box.
- Severity: degrades the task — Observation: Tab then Enter in a room pressed `‹ chats`, not a fold; the hint promised a fold. Evidence: a160/pager-room-tab-enter (first run). Cost: the long bubble could not be read from the keyboard. Correction: `e` unfolds or folds every bubble; the hint names it.
- Severity: degrades the task — Observation: inline, the `NOW` card sat below the visible rows and then lost its last line. Evidence: a100/pm-steps (first two runs). Cost: the current step, a must-see, was off screen. Correction: the card comes first and the blank rows go inline.
- Severity: degrades the task — Observation: roots were cut at their end (`~\.config\.agents\worktrees\clau…`). Evidence: a160/pager-room header. Cost: two sessions in one tree read the same. Correction: cut from the start, as the old peers table did.
- Severity: degrades the task — Observation: a blocked row's `⤷ needs …` was cut at the edge after a long title. Evidence: b160/pm-backlog (first run). Cost: what blocks the item was unreadable. Correction: the reason precedes the title.
- Severity: polish — Observation: the blocked `◌` took the accent. Evidence: b160/pm-backlog (first run). Correction: the accent is the cursor bar's alone.
Pre-commit review (fixed on the branch, kit-tested; the captures above predate these two and show neither path): unfolding twenty long bubbles overran the engine's 100,000 characters and cut the newest bubbles and the `e` control — a room now draws newest-first inside 80,000 characters of bodies, and `e` folds every recent bubble, hidden ones included; `/pager` reopened inside the last room — a pane opened anew now starts on the chats.
Verify (2026-10-09) found OBL-018's key bar missing from the pm steps and backlog tabs; they now close with `1 2 3 tabs · ↑↓ scroll` on the terminal (render: `k160/pm-steps.txt`, `k160/pm-backlog.txt`).
Uninspected scope: the desktop Code tab, vscode and mobile (no render taken; the screen was in use); a terminal set to draw ambiguous-width glyphs wide; a real tmux, Ghostty or Windows Terminal paint (pyte over ConPTY stands in); the graph drawing itself (unchanged by this delta).

Design judgment: the chats and rooms now read as a messenger — side-hugging bubbles, the time tucked inside, unread per room, the newest at the bottom — and pm reads as a dashboard with one focal card; both share the tab strip, chips and key bars. It falls short where it was not seen: the desktop.
Verified: terminal renders at 160x45 dock and 100x40 inline; `claude plugin test` (pager-view 35 pass; pm-band 41 pass, 1 fail that predates the change and is Windows-only: the kit's fs mock turns `/work/main` into `C:\work\main`); `claude plugin validate` and `tsc -p` for both.
Failed or uncovered: the desktop, vscode and mobile surfaces (not inspected).
Craft findings: 6, fixed.
Outcome: NOT VERIFIED (the desktop surface is in scope and uninspected; the terminal is READY)

## Decision Log & Open Questions

- 2026-10-07 — Experience: ART-001 chosen by 대협 over ART-002 (reading stream) and ART-003 (now-first). Answers: badge clears on `/pager` open; graph keeps its own tab; `(human)` stays; desktop nodes are picked from a list under the drawing.
- 2026-10-07 — Interaction: message picking moved from ↑↓ to `j`/`k` and clicking the time, because a focused pane gives the arrows to the engine's scroll. Decided under 대협's delegation.
- 2026-10-07 — Interface: Ledger chosen by Claude under 대협's delegation; boxed panels (lazygit, Charm) rejected because the side pane has no room for a second frame.
- 2026-10-07 — Experience delta at 대협's ask ("무한 캔버스는 불가? 지금은 화면 크기 안에서만 노는데"): the graph became a pannable, zoomable canvas.
- 2026-10-07 — Interface/Experience delta: the desktop Svg + node list shipped in `5fc5ead` was rejected by 대협 on the live render ("너무 구린데, 저게 최선임?", "svg는 너무 별로임"). Of three options (real elements in a Client, a task board, a polished Svg) 대협 chose real elements in a Client. Canvas-like elements (`Raster`, `Image`) exist on the terminal only in this engine build.
- 2026-10-09 — Experience delta at 대협's ask ("mods UI 좀 예쁘게 바꿔봐. 지금은 그냥 작동한다~ 느낌인데 좀 진짜 앱 띄워놓은 것처럼", "pager는 왓츠앱이나 텔레그램처럼 말풍선할수도 있는거잖슴."): `/pager` becomes a chat list and rooms of bubbles, replacing the index and reader of ART-001 (and the reading stream ART-002 that 대협 passed over on 2026-10-07 is not what returns: rooms are per peer). 대협 answered three questions: structure "대화방 목록 → 말풍선 (추천)", long bodies "8줄 후 접기, 펼치기 (추천)", scope "두 mod 전부 (추천)". The peers tab folds into the chat list (OBL-017) and unread is counted per room (OBL-016), decided by Claude under 대협's delegation "게임하고 있을테니 묻지말고 다 개선해놔.". The band badge keeps 대협's 2026-10-07 answer (OBL-006).
- 2026-10-09 — Interface: Console chosen by Claude under the same delegation, after a reference study at 대협's ask ("외부 래퍼를 좀 찾아봐. 완전 화려하고 보기 좋은 것들 많더만"): gh-dash, btop, ratatui LineGauge, beads_viewer, taskwarrior-tui, Zellij status bar, workbench, superpowers-progress, inbox, claude-chat-bubbles, claude-powerline, waha-tui, tgt, gurk-rs, iamb, Elia. Taken: tab underline and chips (gh-dash), step meters (superpowers-progress), line gauge (ratatui), side-hugging bubbles with the time in the last row (waha-tui, claude-chat-bubbles), two-line rows with a protected unread suffix (tgt, gurk-rs). Left: Nerd Font caps and Powerline arrows (need a patched font), hex palettes and emoji (not the person's theme; widths disagree), half-block bubble corners (seams), avatars and five-line rows (too tall for a side pane). Ledger's "no boxes" rule is relaxed to cards for the one focal block and for bubbles: an app look needs a few shapes, and the side pane still holds no second frame around a region.
- 2026-10-09 — Interface delta after verify, by Claude under the same delegation: OBL-018's key bar was missing from the pm steps and backlog tabs; those tabs have no keys of their own, so the terminal bar is dim text naming the tab digits and the scroll (Buttons would clash with the tab strip's hotkeys), and off the terminal they draw none.
- 2026-10-09 — Gates: Experience gate READY FOR INTERFACE (Full; jobs, IA, states, recovery and microcopy above; no open material question). Interface gate READY FOR BUILD under delegation (Full; Selected artifact: none — direction delegated, not selected).

Surface Obligations:
| ID | Stage | Obligation | Derives from | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| OBL-001 | experience | /pm graph tab is readable on desktop: nodes and labels do not collapse into one line | — | captured:대협 screenshot (defu #157) | PASS |
| OBL-002 | experience | On desktop a node is picked in the drawing itself and its detail line is shown | — | captured:대협 "svg는 너무 별로임"; chose A (real elements in a Client) | PASS |
| OBL-003 | experience | Terminal graph labels never overwrite one another | — | captured:.agents/plans/2026-10-07-claude-mods-pm-pager.md Deferred | PASS |
| OBL-004 | experience | The pm band line carries steps and graph controls that open /pm on that tab | — | captured:pm-band-open-buttons backlog item | PASS |
| OBL-005 | experience | /pager messages: the selected message (default newest) is read in full below the index; long bodies keep a route to the full text | — | captured:대협 screenshot "이렇게 축약되어서 보이면 무슨 의미일까" | N/A:superseded by OBL-014 on 2026-10-09 (rooms of bubbles replace the index and reader; the full-read route is kept there) |
| OBL-006 | experience | The badge clears when /pager opens (unchanged); (human) stays | — | artifact:ART-001#default@pane-96col | PASS |
| OBL-007 | experience | Peers read as aligned columns with live sessions first and this session marked | — | artifact:ART-001#default@pane-96col | N/A:superseded by OBL-017 on 2026-10-09 (peers live in the chat list; a room's header carries presence, tool and root) |
| OBL-008 | interface | Ledger system: rules/whitespace, aligned columns, ThemeKey roles as in Decisions, selection by glyph+bold, key-hint footer | OBL-001,OBL-002,OBL-005,OBL-007 | missing | N/A:superseded by OBL-018 on 2026-10-09 (Console replaces Ledger) |
| OBL-009 | interface | The desktop draws the same Client graph with every run placed at its cell (absolute Boxes); click, drag, arrows and hover work in the drawing | OBL-001,OBL-002 | missing | PENDING |
| OBL-010 | interface | Terminal raster places each label right, else left, else truncated with … in free cells; nodeAt follows placed labels | OBL-003 | missing | PENDING |
| OBL-011 | interface | Message reader: header rule with #id, direction, peer, (human), time, age; body wraps with line breaks kept; cap 6,000 chars with a pager export route | OBL-005,OBL-006 | missing | N/A:superseded by OBL-019 on 2026-10-09 (bubbles replace the reader) |
| OBL-012 | experience | /pager opens on a chat list: one row per peer this session has messages with or pager lists, conversations by last message (newest first) then peers without messages (live first); each row shows presence, name, last message preview, its age and the room's unread count; this session is the header, never a row | — | captured:대협 AskUserQuestion "대화방 목록 → 말풍선 (추천)" | PASS |
| OBL-013 | experience | Opening a chat shows that conversation as bubbles — received on the left, sent on the right, oldest to newest with the newest at the bottom — scrolled to the newest on open; a back control returns to the chat list | OBL-012 | captured:대협 "pager는 왓츠앱이나 텔레그램처럼 말풍선할수도 있는거잖슴." | PASS |
| OBL-014 | experience | A bubble longer than 8 visual lines shows its first 8 and a control naming how many lines remain; pressing it unfolds the bubble in place and folds it again; a body past 6,000 characters still names the rest and the pager export route | OBL-013 | captured:대협 AskUserQuestion "8줄 후 접기, 펼치기 (추천)" | PASS |
| OBL-015 | experience | pm-band and pager-view are redesigned together as one app-like system: both band lines and both panes | — | captured:대협 AskUserQuestion "두 mod 전부 (추천)"; "지금은 그냥 작동한다~ 느낌인데 좀 진짜 앱 띄워놓은 것처럼" | PASS |
| OBL-016 | experience | A room's unread count holds the messages received since that room was last opened (mail from before the session's first look is not unread) and clears when the room opens; the band badge keeps OBL-006 | OBL-006,OBL-012 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔." | PASS |
| OBL-017 | experience | Peers with no messages stay reachable: listed after the conversations (live first) with their root; a room's header names the peer's presence, tool and root | OBL-012 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔." | PASS |
| OBL-018 | interface | Console system across both panes: tab strip (terminal: plain hotkey Buttons over a rule whose shown segment is `━` in `claude`; elsewhere native Buttons, the shown one primary), chips (inverseText on a role background) for status and counts, one focal card per view, a key bar closing each view | OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (gh-dash, btop) | PASS |
| OBL-019 | interface | Bubble geometry: round border, padding 1 across, at most 80% of the content width; received with a `subtle` border flush left, sent with a `claude` border flush right; a footer row inside the bubble carries the fold control, `(human)` and the time; a centered `── MM-DD ──` separator when the day changes | OBL-013,OBL-014 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (waha-tui, claude-chat-bubbles) | PASS |
| OBL-020 | interface | Chat row: two lines — cursor bar, presence `●`/`○`, name, tool, then age and an unread chip pinned right; the second line the preview (`you: ` for sent, `(human)`) or `no messages yet · <root>`; a long name or preview never pushes the age or the chip out | OBL-012,OBL-016,OBL-017 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (tgt, gurk-rs) | PASS |
| OBL-021 | interface | Band lines: pm — status glyph, plan id, a `▰`/`▱` meter per step (done `success`, current `warning`, rest `subtle`), count and current step, controls pinned right; pager — `✉ name` control, a `N new` chip, last message direction, peer, age and preview, live count pinned right | OBL-004,OBL-006,OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (superpowers-progress, Zellij) | PASS |
| OBL-022 | interface | Steps tab: plan id, status chip and `done/total · pct` over a `━`/`─` gauge; the current step inside a `NOW` card with its full text wrapped | OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (ratatui LineGauge, workbench) | PASS |
| OBL-023 | interface | Backlog tab: each task a section header (key, rule, count); rows with a cursor bar for the current plan's item, `◌` for blocked, a priority chip (P0–P1 on `warning`), id, dim title and the reason in `warning` | OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (gh-dash, beads_viewer) | PASS |

Approvals:
- experience_approved: ART-001 — 대협 payload note "디자인 시스템도 적당한거 찾아 골라서 좀 고급지게 해봐 ㅇㅇ"
- direction_selected: none (no interface artifact). The Ledger direction was chosen by Claude under 대협's delegation: "디자인 시스템도 적당한거 찾아 골라서 좀 고급지게 해봐 ㅇㅇ", "묻지말고 알아서 끝까지 해놓으셈 ㅇㅇ". Recorded as a delegated direction, not as 대협's selection.
- build_authorized: "묻지말고 알아서 끝까지 해놓으셈 ㅇㅇ" (and the earlier "전체 진행 (추천)" answer)

Approvals (2026-10-09 delta):
- experience_approved: 대협's answers "대화방 목록 → 말풍선 (추천)", "8줄 후 접기, 펼치기 (추천)", "두 mod 전부 (추천)"; the remaining experience decisions (OBL-016, OBL-017) delegated: "게임하고 있을테니 묻지말고 다 개선해놔."
- direction_selected: none (no interface artifact was shown). Console was chosen by Claude under 대협's delegation "게임하고 있을테니 묻지말고 다 개선해놔." Recorded as a delegated direction, not as 대협's selection.
- build_authorized: "하고나서 mods UI 좀 예쁘게 바꿔봐. 지금은 그냥 작동한다~ 느낌인데 좀 진짜 앱 띄워놓은 것처럼." and "게임하고 있을테니 묻지말고 다 개선해놔."

Open: how the desktop Code tab draws a Box border, a Text background and a native Button inside a pane — not inspected on 2026-10-09 (a desktop capture needs the screen while 대협 is using it); the terminal render is the verified surface.
