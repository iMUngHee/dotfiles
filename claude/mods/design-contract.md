# design-contract.md

## Scope & Inheritance

- **Applies to:** the drawn surfaces of `claude/mods/pm-band` (band line, `/pm` pane) and `claude/mods/pager-view` (band line, `/pager` pane), on every render surface the engine names: `terminal`, `desktop`, `vscode`, `mobile`.
- **Parent contract:** none.
- **Override rules:** this contract owns what the two mods show and how. Their data and refresh contracts (read-only CLIs, no I/O while drawing, session-tagged single-flight refresh, the pager badge baseline) are upstream inputs recorded in `.agents/plans/2026-10-07-claude-mods-pm-pager.md` and stay authoritative; the per-room `seen` map of 2026-10-09 follows the same rules (kept in `$.store` per session id, moved only by refreshes and handlers). UI engineering may update only Implementation Bridge after build authorization.
- **Owner:** 대협.
- **Depth:** Full.
- **Last updated:** 2026-10-30.

## Surface Type & Craft Profile

- **Surface:** a status line above the prompt and two side panes inside Claude Code: a glanceable product-app workflow surface, not a dashboard.
- **Media:** TUI (Ink, cell grid, the person's terminal theme) and desktop GUI (the Code tab draws Box as a flex div and Text as a span in a proportional face; it has no pixel or canvas element, and Svg is an isolated image that takes no input). vscode and mobile have no Client and fall back to lists.
- **Direction:** **Console** — an app shell inside the engine's pane frame. A tab strip whose active tab is underlined in the accent (gh-dash), chips for status and counts (inverseText on a role background), one focal card per view, pager rooms drawn as a transcript like Claude Code's own (ART-005: a `●` header over Markdown for received runs, a `claude` left bar for sent ones; Crush, Toad, discordo, WeeChat), two-line chat rows with the unread count pinned right (tgt, gurk-rs), step meters and a line gauge for progress (superpowers-progress, ratatui LineGauge, btop), and a key bar closing each view.
- **Density:** chat rows two lines with a blank row between; backlog and step rows one line; older messages fold at 8 lines; the drawing takes the rest of the graph tab.
- **Anti-patterns:** a frame around a whole region (the pane frame is the engine's; cards are only for the one focal block), color-only state, a message cut with no way to read the rest, hex/truecolor or emoji glyphs (theme keys only; emoji widths disagree across terminals), a character-grid drawing on a surface whose text is not monospace.
- **Quality bar:** at a glance the band says which plan step this session is on and whether mail came in; opening a pane reads like an app — the steps, backlog, graph or a conversation answer their question without leaving Claude Code.

## Product Context

- **Primary user:** 대협, running several Claude Code sessions in the terminal (tmux, Ghostty, Windows Terminal) and in the desktop app's Code tab.
- **Jobs and success:**
  1. **Know where this session's plan stands.** Success: the band names the plan, its per-step progress and the current step; `/pm` steps shows the gauge, every step with done/current marks, and the current step in full.
  2. **See the backlog and its shape.** Success: the backlog tab groups items by task with priority and blocking reason; the graph tab shows tasks, items and their dependency and order links legibly on every surface, and a node's detail can be read.
  3. **Read this session's pager conversations.** Success: `/pager` lists the peers this session has talked with, with presence, last message and unread count; opening one shows the conversation as a transcript, newest at the bottom, opened at the first unread message; the newest and unread messages are whole and older long ones folded with a way to read the rest.
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
  - chats (default): a header with this session's name as a chip, the live count and the total unread; then one two-line row per conversation — the peers this session has sent to or received from, by their last message, newest first. Peers without messages are not listed (2026-10-30); this session is never a row.
  - room: a header with the back control, the peer's name, presence, tool and root; then the conversation oldest to newest as a transcript: runs (one side, within 10 minutes) under one sender line, bodies in Markdown, a day separator when the date changes, a `new` divider before the first message unread at open; then a bottom bar with the back control, the peer and presence, and the fold-all control. The view opens at the `new` divider, or at the end when nothing is unread.
- **Content priority:** must see — current step, new-mail count, unread per room, the newest and unread messages whole, graph structure. Should see — ages, priorities, blocking reasons, presence. On demand — folded message lines, full titles and notes (node detail), bodies past 6,000 characters (`pager export`).

## Data & State Model

| Context | State | What the user sees | Recovery / transition |
| --- | --- | --- | --- |
| pm band | unbound session | dim `○ no plan` | binding a plan redraws on the next refresh |
| pm band | done/dropped plan | nothing | — |
| pm band | refresh failed, no last value | dim `⚠ plan: <reason>` | next refresh |
| pm band | refresh failed, last value kept | the line plus a dim `⚠` | next refresh |
| /pm steps | no plan | `No plan is bound to this session.` | — |
| /pm backlog, graph | before the first read | `loading…` (only until the open pane's first refresh lands) | the open pane's refresh |
| /pm backlog, graph | the session runs outside any git repository | bold `No pm backlog here.`, then dim `/pm reads the backlog of the git repository this session runs in; this one runs outside any.` | open /pm in a repository |
| /pm backlog, graph | read failed (or the resolver failed) | `⚠ backlog: <reason>`; a last good listing stays above it | next refresh |
| /pm backlog, graph | empty | bold `The backlog is empty.`, then dim `Items show up here once pm adds them (/pm-roadmap); untriaged ones wait in the inbox.`; the graph draws no empty canvas | pm adds an item |
| /pm backlog, graph | the session's plan is done | the backlog of its repository, as for any session there | — |
| /pm graph | over the node cap | the drawing plus `+N more` | — |
| /pm graph | nothing picked | the key bar naming how to pick | pick a node |
| pager band | no pager or no name | nothing | — |
| pager band | failed refresh | the last line plus a dim `?` | next refresh |
| /pager | no name | `This session has no pager name yet.` | — |
| /pager chats | no conversation at all | bold `No conversations yet.`, then dim `Messages <name> sends or receives show up here.` (the header keeps the live count) | a message appears on the next refresh |
| /pager chats | a peer without messages | not listed | its first message lists it |
| /pager chats | unread in a room | an unread chip with the count on its row; the total in the header | opening the room clears it |
| /pager room | no messages with the peer | `No messages with <peer> yet.` | — |
| /pager room | more than 60 messages, or more unfolded text than a drawing holds | the newest 60 that fit 80,000 characters of bodies, `<N> earlier messages not shown` above them; the newest message and the bottom bar always stay | fold (`e`) to bring the older back; `pager export` |
| /pager room | unread at open | a `new` divider before the first unread message; the window opens with it at the top; those messages and any arriving while the room is open are whole | leaving the room clears the divider |
| /pager room | an older message over 8 lines | the first 8 lines cut at a word boundary with `…`, then `▾ <N> more lines` (the newest and the unread at open are never folded by default) | press it: unfolds; `▴ fold` folds again; `e` unfolds or folds them all |
| /pager room | body over 6,000 characters | the first 6,000 (unfolded), then `… N more characters · full text: pager export (#id)` | run `pager export` |
| /pager room | the peer left pager's roster | the room stays while messages exist; presence `○ gone` | — |
| any | session switched (/clear, /resume, /branch) | the previous session's values vanish at once; the pager pane returns to chats | the new session's first refresh |

## Interaction Model

- **`/pm` tabs:** digit hotkeys `1`–`3` or a click; the shown tab persists for the session.
- **Band controls:** `steps` and `graph` set the tab and open `/pm` with focus; the pager name opens `/pager` and clears the band badge. `/pager` opened anew starts on the chats; opened while it is up, it stays where it is.
- **Chats:** `j` / `k` move the cursor bar down / up; `o` opens the room under it; a click (or Tab, Enter) on a name opens that room. The cursor holds until moved and follows the room last opened.
- **Room:** `b` (the bottom bar's `‹ chats`, or a click on the header's) returns to the chats; the arrows and page keys scroll the pane (the engine's); `e` unfolds every folded message at once and, when none is left folded, folds them all again; a message's own fold control (a click) unfolds or folds just that one. Tab starts at the header's `‹ chats`, so the folds have `e` rather than a Tab path. Opening a room brings its first unread message (the `new` divider) to the top, or its end when nothing is unread, and clears its unread count; while it is open, mail into it stays read and whole.
- **Picking a graph node:** terminal and desktop — click a node, drag to move it, focus the drawing and use the arrows; a resting pointer underlines the node under it. The pick shows the node's detail line; a task hub's detail names the task.
- **Moving around the graph:** the graph lives on a canvas larger than the pane when the backlog is big (it grows with the node count). Drag empty space or shift+arrows to pan; `+` / `-` change the spacing (zoom levels 0.25–2; text keeps its size); `0` fits every node. The wheel scrolls the pane, not the canvas: a Client receives no wheel events.
- **Feedback:** every move, open and fold redraws at once; nothing waits on I/O.

## Microcopy

- Tabs: `steps`, `backlog`, `graph`. Band controls: `steps`, `graph`. Card label: `NOW`.
- Chats header: `<name>` chip, `● <N> live`, `· <N> unread`. Row preview: `you: ` before sent text, `<peer>: ` before received text, `(human)` before an operator's text. Empty: `No conversations yet.` / `Messages <name> sends or receives show up here.`
- Room header: `‹ chats`, `<peer>`, `● live` / `○ gone`, `<tool>`, `<root>`. Sender lines: `● <peer>  HH:MM`, `you  HH:MM`, `(human)` after the time. Day separator: ` MM-DD ` inside a rule. Unread divider: ` new ` inside a rule. Fold: `▾ <N> more lines`, `▴ fold`. Over the cap: `<N> earlier messages not shown`. Bottom bar: `‹ chats`, `<peer>`, `● live` / `○ gone`.
- Key bars: chats terminal `j: down  k: up  o: open · click a name`; chats elsewhere `click a name to open its chat`; room: the bottom bar `b: ‹ chats` with the peer and presence, and `e: unfold all` (`e: fold all` once every fold is open; shown only when a message folds) pinned right — the same on every surface, no other hint; pm graph `click a node · drag it to move · drag empty space or shift+arrows to pan · + − zoom · 0 fit`; pm steps and backlog terminal `1 2 3 tabs · ↑↓ scroll` (dim text: the tab strip holds the digit hotkeys).
- Truncation: `… <N> more characters · full text: pager export (#<id>)`.
- State lines as in Data & State Model.

## Visual System

- **Color roles (ThemeKey only; the palette is the person's):** `claude` — plan id, task keys, the active tab's underline, the cursor bar, the chats header chip, the sent runs' left bar and `you`; `success` — done steps, meter and gauge fill, live `●`, the `active` status chip; `warning` — the current step (its hollow meter segment, `NOW` card border, `▶`), the `N new` and unread chips, P0–P1 chips, blocking reasons, the room's `new` divider; `subtle` — rules, the day separator, the tab strip's track, meter and gauge track; `inactive` — the `draft` chip, order links; `suggestion` — `(human)`, the graph's current node; `inverseText` — text on every chip; dim for metadata; `error` is not used (failures are quiet, recoverable).
- **Type:** terminal — one monospace size; hierarchy by bold, dim, chips and position. Desktop — the surface's system face at its body size; the same hierarchy.
- **Shape:** round borders (`╭╮╰╯`, the engine's own prompt box) for cards; the engine's `quote` border (`▎`) for the sent runs' bar on the terminal; `─` rules; `━` for the active tab and the gauge fill; `▰▱` meter segments; `●○◌▶✓▌` glyph markers. No emoji.
- **Spacing:** the pane content is inset one column each side; one blank row between header, body and key bar; runs one blank row apart (a sent run's `quote` border supplies its own), messages of a run one row apart; chat rows one blank row apart.
- **Motion:** none beyond the terminal graph settling.
- **Signature moment:** the room — it reads like the transcript beside it: the peer's runs as `●` replies in Markdown, your own under the accent bar, a `new` rule where reading resumes, and the way back always in the bottom bar.

## Component Rules

| Component | Composition | States | Used In |
| --- | --- | --- | --- |
| Tab strip | terminal: plain Buttons with digit hotkeys 3 cells apart, then a rule the content width: `━` in `claude` under the shown tab, `─` in `subtle` elsewhere; desktop and others: native Buttons, the shown one `primary` | shown: full strength + underline; other: dim | /pm |
| Chip | ` text ` (one space each side) in `inverseText`, bold, on a role background | — | headers, band, unread, priorities |
| Card | round border, padding 1 across, a dim bold label as its first row | — | `NOW` (border `warning`), right under the steps gauge |
| Key bar | plain hotkey Buttons (`j: down`) then dim hints after `·`; where a view has no keys of its own (pm steps, backlog) dim text naming the tab digits and the scroll, on the terminal | — | every pane view (off the terminal, pm steps and backlog draw none: the native tab Buttons stand alone) |
| Chat row | line 1: cursor bar (`▌` in `claude` or a space), presence (`●` `success` / `○` dim), name Button, tool (dim), flexible gap, age (dim); line 2: the bar again, two spaces, the preview after `you: ` / `<peer>: ` (dim when read, full strength when unread; truncated at the edge), the unread chip pinned right; one blank row between rows | cursor: bar; unread: chip + preview at full strength (a Button carries no weight, so the name cannot be bold) | /pager chats |
| Received run | a sender line `● ` + peer (bold) + two spaces + `HH:MM` (dim) [+ `(human)` in `suggestion`]; each body a `Markdown` in a Box indented two cells; a later message of the run starts with a blank row and its dim time | folded: 8 lines + `▾ N more lines`; unfolded: all + `▴ fold`; capped: the truncation line | /pager room |
| Sent run | the received run's parts with `you` (bold `claude`) for the sender, inside a left bar in `claude`: terminal a Box `borderStyle="quote"` (the engine's `▎`); desktop and others a row with a one-cell `claude`-filled Box beside the content (the desktop draws any `borderStyle` as a full rounded box) | as received | /pager room |
| Room rule | a full-width `─` rule with a centred label: ` MM-DD ` in `subtle` for a day; ` new ` in `warning` before the first message unread at open (keyed `new`, the open scroll's target) | — | /pager room |
| Room bottom bar | a `subtle` rule, then `b: ‹ chats` (hotkey Button), the peer (bold), presence; `e: unfold all` pinned right when a message folds | — | /pager room |
| Band meter | one `▰` per done step (`success`), a bold `▱` for the current (`warning`), `▱` for the rest (`subtle`), drawn only up to 20 steps; the filled segments always equal the done count beside them | — | pm band |
| Gauge | `━` × round(width × done/total) in `success`, then `─` in `subtle` to the content width | — | /pm steps |
| Backlog section | key (bold `claude`), a `subtle` rule to the width, the count (dim) | — | /pm backlog |
| Backlog row | marker (`▌` current in `claude`, `◌` blocked, space) · priority chip (P0–P1 on `warning`; P2 bold; P3+ dim) · id · reason in `warning` · title (dim) — the reason before the title, so the edge cuts the title and not what blocks the item | current: bar + bold id; blocked: dim | /pm backlog |
| Graph | Client cell drawing; labels placed right, else left, else cut with `…` into free cells. Terminal: one Text per row. Desktop (`isPlaced`): every run of glyphs in its own Box at its cell, `position: absolute`, inside a Box the size of the region | picked: inverse; hovered: bold + underline; current: `suggestion` bold | /pm graph |

## Responsive & Accessibility

- **Terminal:** the content width is `bodyColumns − 2`; every one-line row ends there (`truncate-end`); rules, the tab strip's track and the gauge are drawn to it; a chat row's age and unread chip never shrink — the name and preview give way first; message bodies take the whole width less their two-cell indent or bar.
- **Inline (the terminal under 110 columns seats a pane above the prompt, about eleven rows):** the blank rows under the tab strip and above the `NOW` card go, so the steps header, gauge and the whole card are on screen when `/pm` opens.
- **Desktop:** Buttons are native (the tab strip's underline is the primary Button instead); chips use the same Box and Text props; a Text holding box-drawing glyphs is set in the monospace face there, so rules keep their cell width; the sent bar is a filled Box, not a border; the graph keeps cell positions whatever the face, because each run is placed at its cell.
- **Focus and state are never color alone:** the cursor carries `▌`, the current step `▶` and the `NOW` card, blocked `◌`, live `●` versus `○`, sent versus received by the sender line (`you` / the peer) as well as the bar, unread by a number and the word `new`.
- **Every action has a key:** tabs by digit, chats by `j`/`k`/`o`, the room by `b`, the folds by `e`, every Button by Tab and Enter.
- **Korean text:** bodies wrap through the surface's Markdown; the fold counts a Hangul syllable (and other wide characters) as two cells and cuts at the last space it keeps, never inside an 어절.

## Performance & Formatting

- Times: a sender line `HH:MM` local, a day separator `MM-DD`; ages `now`, `<n>m`, `<n>h`, `<n>d` from the refresh's `now`.
- A room draws its newest 60 messages; folded messages draw at most 8 lines; a body is capped at 6,000 characters; the graph at 120 nodes (`+N more`); backlog titles at 200 characters (the engine refuses a drawing over 100,000 characters of text).

## Do / Don't

- Do keep one accent per meaning; don't color whole rows.
- Do keep cards to the one focal block of a view; don't frame whole regions or single messages — the pane frame is the engine's, and a message's side is its sender line and bar.
- Do place the graph's runs at their cells wherever the text is not a cell grid; don't draw rows of space-aligned text there, and don't fall back to an Svg image (it takes no input — rejected by 대협 on sight).
- Don't hide a message body behind a single truncated line: a folded message shows 8 lines and names the rest.
- Don't use emoji or hex colors: theme keys and the glyphs above only.

## Artifact Ledger

| ART ID | Path | Revision | Selection | Covers | States / extremes | Status | Supersedes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ART-001 | .agents/artifacts/pm-pager-redesign/ART-001.html | d811824d5115 | ART-001 | OBL-002,OBL-005,OBL-006,OBL-007 | default@pane-96col, long-message@pane-96col | selected | — |
| ART-002 | .agents/artifacts/pm-pager-redesign/ART-002.html | 4143fd117941 | — | — | default@pane-96col | exploratory | — |
| ART-003 | .agents/artifacts/pm-pager-redesign/ART-003.html | 4bbf8dcb734c | — | — | default@pane-96col | exploratory | — |
| ART-004 | .agents/artifacts/pager-redesign-2026-10-30/ART-004.html | ed1d3c6a7ed8 | — | — | default@term-56, default@term-92, default@desktop-360(mock) | exploratory | — |
| ART-005 | .agents/artifacts/pager-redesign-2026-10-30/ART-005.html | 1efa3fb31e6c | ART-005@chat-row=base+sent-emphasis=line | OBL-026,OBL-027,OBL-028,OBL-029,OBL-030,OBL-031,OBL-032,OBL-033,OBL-034,OBL-035,OBL-036,OBL-037 | default@term-56, default@term-92, default@desktop-360(mock), default@desktop-640(mock) | selected | ART-001 (the /pager parts) |
| ART-006 | .agents/artifacts/pager-redesign-2026-10-30/ART-006.html | 2fb58a45c653 | — | — | default@term-56, default@term-92, default@desktop-360(mock) | exploratory | — |

ART-001 is an experience-structure artifact (structure, not interface direction). Its index-and-reader structure for `/pager` was superseded on 2026-10-09 (OBL-012–OBL-017); its badge and `(human)` decisions (OBL-006) stand. No interface artifact was selected on either date; Console is the written decision above. On 2026-10-30 ART-005 was selected for the `/pager` room and chats (a pre-run comparison artifact: computed terminal cells and a labelled desktop mock); inside its reviewed states it outranks the written rules for those two views. The three artifacts live on the machine that drew them (`.agents/` is machine-local).

## Implementation Bridge

<!-- Written by ui-engineering after build authorization. -->

2026-10-09 — Console and chat rooms, built on `agent/claude-mods-app-redesign` (plan `.agents/plans/2026-10-09-claude-mods-app-redesign.md`).

- **pager-view:** `hooks/pager.ts` gains the pure parts (`roomsOf`, `seenOf`, `unreadOf`, `newestInOf`, `cellsOf`, `foldOf`, `clockOf`, `dayOf`); `hooks/register.tsx` draws the band, the chats and the room, keeps the per-room `seen:<session>` map in `$.store` and asks `$.ui.scroll` to the room's end on open; `types/index.d.ts` carries `unread`, `room`, `cursor`, `expanded`.
- **pm-band:** `hooks/plan.ts` gains `meterOf` and `gaugeOf`; `hooks/register.tsx` draws the meter band, the tab strip, the steps tab (chip, gauge, `NOW` card first) and the backlog sections.
- **Engine facts met on the way:** a growing Box in a bubble's footer widens the bubble to its most (Yoga sizes it at most-available), so the footer is justified instead; a plugin's `$.ui.scroll` has no implementation in the `claude plugin test` kit (`HooksError: no implementation for ui.scroll`), so the room's scroll to its end is checked on the terminal render, where it holds.

Evidence (machine-local, `.agents/artifacts/claude-mods-app-redesign/`): hidden-ConPTY captures read by pyte at 160x45 (`a160/`: band, pm-steps, pager-chats, pager-room, pager-room-unfolded, pager-back), 100x40 inline (`a100/`, `a100s/pm-steps`), a sandbox backlog at 160x45 (`b160/`: pm-backlog, pm-graph) and the key bar fix at 160x45 (`k160/`: pm-steps, pm-backlog in its empty state); as `.txt` and `.html`, the first three sets also as `png/*.png` (headless Edge).

| ID | Stage | Obligation | Derives from | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| OBL-024 | implementation | pager-view draws the chats (two-line rows, `PEERS` group, unread chips, start-cut roots), the room (bubbles left/right with the time inside, day separator, fold at 8 lines, `e` for all, `b` back, opened at its end) and the band line (new chip, live count pinned right) | OBL-016,OBL-017,OBL-019,OBL-020,OBL-021 | code:claude/mods/pager-view/hooks/register.tsx; render:.agents/artifacts/claude-mods-app-redesign/a160/pager-room.txt; render:.agents/artifacts/claude-mods-app-redesign/a100/pager-room.txt | N/A:superseded by OBL-038 on 2026-10-30 |
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

2026-10-30 — Transcript rooms and conversation-only chats, built on `agent/pager-transcript-redesign` (plan `.agents/plans/2026-10-30-pager-transcript-redesign.md`).

- **pager-view:** `hooks/pager.ts` — `roomsOf` returns conversations only; `runStartsOf` (one side, ten minutes, one day, the first unread apart); `foldOf` cuts at the last space when that costs under a row, ends in `…` and closes an open code fence. `hooks/register.tsx` — chat rows (preview after who said it, unread chip on line 2, read previews dim), the room as a transcript (received runs under `● peer  HH:MM` in a two-cell indent, sent runs inside `borderStyle="quote"` on the terminal and beside a one-cell `claude` Box elsewhere, consecutive sent runs in one bar, bodies as `Markdown`), day and `new` rules, a bottom bar with `b` and `e`, defaults whole from `opened.firstNew ?? opened.newest`, and the open scroll to the `new` key retried on a 60 ms timer up to five times. `types/index.d.ts` — `opened` and `folds` replace `expanded`.
- **Engine facts met on the way:** a `$.ui.scroll` to a key asked from the press that opens the room is refused before the room is drawn (no `ui.scroll` reached the engine), so it is asked again after the redraw; the `claude plugin test` kit still has no `ui.scroll`, so the scroll is checked on the terminal render; a `Button` has no weight; flag `--settings` is needed to point a capture's `CLAUDE_CODE_PLUGIN_DIRS` at a worktree, since the user settings' `env` wins over the process environment.

Evidence (machine-local, `.agents/artifacts/pager-transcript-redesign/`): hidden-ConPTY captures read by pyte with a canned `pager` stand-in on PATH (no real store touched), the worktree mod loaded alone: `r160/` (dock pane, 69 body columns: chats, chats-unread, room, room-unfolded, back, room-vige) and `r100/` (inline pane, 96 columns, about eleven rows: the same set), as `.txt` and `.html`, five also as `png/*.png` (headless Edge).

| ID | Stage | Obligation | Derives from | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| OBL-038 | implementation | pager-view draws OBL-026–OBL-037 | OBL-033,OBL-034,OBL-035,OBL-036,OBL-037 | code:claude/mods/pager-view/hooks/register.tsx; render:.agents/artifacts/pager-transcript-redesign/r160/room.txt; render:.agents/artifacts/pager-transcript-redesign/r100/room.txt; render:.agents/artifacts/pager-transcript-redesign/r100/chats-unread.txt | PASS |

Observed in the captures: the chats list ruju, vige and bude and not tozu (live roster, no messages), no `PEERS`; the unread preview at full strength with its chip on line 2; the room's `● ruju  HH:MM` runs with two-cell bodies, the `▎` bar beside both sent runs in one bar a blank row apart, `(human)` after the time, the older long message folded at `… "book intact".…` with `▾ 9 more lines`, the `new` rule, the second unread message under a dim time row, the bottom bar `b: ‹ chats  ruju ● live … e: unfold all`; inline (r100) the room opened with the `new` rule on the pane's first row (`ui.scroll … by 26 to 26`), and a room with nothing unread at its end; Korean wrapped at spaces; no refusal in the debug log.
Craft findings: 3, fixed before the final captures
- Severity: degrades the task — Observation: the room opened at its top though two messages were unread. Evidence: r100 first run, debug log with no `ui.scroll`. Cost: the reader had to find where reading resumes. Correction: the scroll is retried after the redraw.
- Severity: polish — Observation: two sent runs in a row stacked their quote borders into a two-row gap. Evidence: r160 first run. Correction: they share one bar.
- Severity: polish — Observation: the day rule's date in `subtle` read at about 2.6:1. Evidence: r160/room.png. Correction: the date is dim text, the rule stays `subtle`.
Uninspected scope: the desktop Code tab, vscode and mobile (the desktop draws the same tree — kit tests mount it and find the filled bar and no hint — but no paint was taken: the desktop app is 대협's screen); a terminal drawing ambiguous-width glyphs wide; a real Windows Terminal, tmux or Ghostty paint (pyte over ConPTY stands in).

Design judgment: the room now reads like the transcript beside it — a long Korean report takes the whole width, the side of each run is its sender line and bar rather than a box, and reading resumes at the `new` rule with the way back under it. It falls short where it was not seen: the desktop paint.
Verified: terminal renders at 160x50 dock and 100x40 inline; `claude plugin test` (44 pass); `claude plugin validate`; `tsc -p` (types copied from the loaded main mod).
Failed or uncovered: the desktop, vscode and mobile surfaces (not painted).
Craft findings: 3, fixed.
Outcome: NOT VERIFIED (the desktop surface is in scope and unpainted; the terminal is READY)

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

- 2026-10-30 — Experience delta at 대협's ask ("일단 대화한 이력이 있는 애만 좀 대기목록에 뜨도록하고, 대화 말풍선 등 좀 대대적으로 UI 개편 좀 하셈... 저것보단 훨씬 예쁘고 UX 좋게"), with two screenshots: a chats list of eighteen quiet peers, and a desktop room whose `‹ chats` had scrolled out and whose folded bubble was cut mid-word. 대협 approved the delta and answered three questions: folds "최신·안읽음만 펼침 (추천)", entry "첫 안읽음 + 구분선 (추천)", sending "읽기 전용 유지 (추천)". OBL-017's listing of peers without messages is withdrawn (OBL-026).
- 2026-10-30 — Interface: a reference study (Claude Code mods published Sept–Oct 2026: claude-team-chat, agents-mods, High Command, peermesh, session-chat, claude-agentpane; terminal chats: Crush, opencode, Gemini CLI, Toad, Codex CLI, discordo, zulip-terminal, gomuks, WeeChat) and the measured pager data (260 messages: median 427 characters, median one line) led to three candidates — side bubbles refined (ART-004), transcript (ART-005), log columns (ART-006). 대협 chose ART-005 with the line emphasis: "ART-005 트랜스크립트 (추천)", "선 (추천)". Taken: a left rule instead of a frame (Crush, opencode, Toad), sender and time once per run (discordo, zulip-terminal), a read marker rule (WeeChat), a fixed gutter for the hanging indent (Gemini CLI), the way back at the bottom since the host has no sticky header (agents-mods). Left: hex palettes and alpha tints (claude-team-chat, agents-mods), full round bubbles (two rows and four cells a message), trust labels (High Command), hash ids (peermesh).
- 2026-10-30 — Interface delta found in the build, decided by Claude under 대협's delegation ("이제부터는 그냥 알아서 하셈 ㅇㅇ AFK"): ART-005 bolds an unread chat's name, but a `Button` takes no weight, so an unread chat lights its preview (full strength; read previews stay dim) beside the unread chip. Also from the captures: sent runs that follow one another share one bar, so two borders never stack into a double gap, and the day rule's date is dim text rather than `subtle`, which read at about 2.6:1.
- 2026-10-30 — Engine facts read for the build: the terminal's `quote` border is `▎` on the left and spaces elsewhere (2.1.302 binary); the desktop draws any `borderStyle` as a full rounded 1px box with padding and sets a Text holding box-drawing glyphs in its monospace face (`ion-dist.asar`, app 4.29.0); `Markdown` draws on every surface; `$.ui.scroll` reaches an element by `key`.

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
| OBL-012 | experience | /pager opens on a chat list: one row per peer this session has messages with or pager lists, conversations by last message (newest first) then peers without messages (live first); each row shows presence, name, last message preview, its age and the room's unread count; this session is the header, never a row | — | captured:대협 AskUserQuestion "대화방 목록 → 말풍선 (추천)" | PASS (its peers-without-messages clause is superseded by OBL-026 on 2026-10-30) |
| OBL-013 | experience | Opening a chat shows that conversation as bubbles — received on the left, sent on the right, oldest to newest with the newest at the bottom — scrolled to the newest on open; a back control returns to the chat list | OBL-012 | captured:대협 "pager는 왓츠앱이나 텔레그램처럼 말풍선할수도 있는거잖슴." | PASS |
| OBL-014 | experience | A bubble longer than 8 visual lines shows its first 8 and a control naming how many lines remain; pressing it unfolds the bubble in place and folds it again; a body past 6,000 characters still names the rest and the pager export route | OBL-013 | captured:대협 AskUserQuestion "8줄 후 접기, 펼치기 (추천)" | PASS |
| OBL-015 | experience | pm-band and pager-view are redesigned together as one app-like system: both band lines and both panes | — | captured:대협 AskUserQuestion "두 mod 전부 (추천)"; "지금은 그냥 작동한다~ 느낌인데 좀 진짜 앱 띄워놓은 것처럼" | PASS |
| OBL-016 | experience | A room's unread count holds the messages received since that room was last opened (mail from before the session's first look is not unread) and clears when the room opens; the band badge keeps OBL-006 | OBL-006,OBL-012 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔." | PASS |
| OBL-017 | experience | Peers with no messages stay reachable: listed after the conversations (live first) with their root; a room's header names the peer's presence, tool and root | OBL-012 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔." | N/A:superseded by OBL-026 on 2026-10-30 (peers without messages are no longer listed; the room header's presence, tool and root stay under OBL-035) |
| OBL-018 | interface | Console system across both panes: tab strip (terminal: plain hotkey Buttons over a rule whose shown segment is `━` in `claude`; elsewhere native Buttons, the shown one primary), chips (inverseText on a role background) for status and counts, one focal card per view, a key bar closing each view | OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (gh-dash, btop) | PASS |
| OBL-019 | interface | Bubble geometry: round border, padding 1 across, at most 80% of the content width; received with a `subtle` border flush left, sent with a `claude` border flush right; a footer row inside the bubble carries the fold control, `(human)` and the time; a centered `── MM-DD ──` separator when the day changes | OBL-013,OBL-014 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (waha-tui, claude-chat-bubbles) | N/A:superseded by OBL-033 and OBL-034 on 2026-10-30 (the transcript replaces bubbles) |
| OBL-020 | interface | Chat row: two lines — cursor bar, presence `●`/`○`, name, tool, then age and an unread chip pinned right; the second line the preview (`you: ` for sent, `(human)`) or `no messages yet · <root>`; a long name or preview never pushes the age or the chip out | OBL-012,OBL-016,OBL-017 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (tgt, gurk-rs) | N/A:superseded by OBL-037 on 2026-10-30 (the unread chip moves to line 2; no rows for peers without messages) |
| OBL-021 | interface | Band lines: pm — status glyph, plan id, a `▰`/`▱` meter per step (done `success`, current `warning`, rest `subtle`), count and current step, controls pinned right; pager — `✉ name` control, a `N new` chip, last message direction, peer, age and preview, live count pinned right | OBL-004,OBL-006,OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (superpowers-progress, Zellij) | PASS |
| OBL-022 | interface | Steps tab: plan id, status chip and `done/total · pct` over a `━`/`─` gauge; the current step inside a `NOW` card with its full text wrapped | OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (ratatui LineGauge, workbench) | PASS |
| OBL-023 | interface | Backlog tab: each task a section header (key, rule, count); rows with a cursor bar for the current plan's item, `◌` for blocked, a priority chip (P0–P1 on `warning`), id, dim title and the reason in `warning` | OBL-015 | captured:delegation "게임하고 있을테니 묻지말고 다 개선해놔."; reference study 2026-10-09 (gh-dash, beads_viewer) | PASS |

| OBL-026 | experience | /pager chats list only the peers this session has messages with (sent or received), newest first; peers without messages are not listed; the header keeps the live count; with no conversation the list says so | — | captured:대협 "일단 대화한 이력이 있는 애만 좀 대기목록에 뜨도록하고"; AskUserQuestion 2026-10-30 "승인 (추천)" | PASS |
| OBL-027 | experience | In a room the back control and the peer's name and presence are reachable at the newest end (a bottom bar) as well as at the top | — | captured:대협 screenshot (desktop room, header scrolled out); AskUserQuestion 2026-10-30 "승인 (추천)" | PASS |
| OBL-028 | experience | Message bodies are drawn as Markdown (lists, emphasis, code) on every surface | — | captured:AskUserQuestion 2026-10-30 "승인 (추천)" | PASS |
| OBL-029 | experience | Consecutive messages from the same side within 10 minutes form a run that names the sender and time once; a day change or the new divider starts a new run | — | captured:AskUserQuestion 2026-10-30 "승인 (추천)" | PASS |
| OBL-030 | experience | On opening a room the newest message and the messages unread at that moment (and any arriving while it is open) are unfolded; older ones fold past 8 visual lines, cut at a word boundary with `…`; the per-message fold control and `e` stay | OBL-014 | captured:AskUserQuestion 2026-10-30 "최신·안읽음만 펼침 (추천)" | PASS |
| OBL-031 | experience | Opening a room with unread draws a `new` divider before the first unread message and brings it to the top of the window; with none, the room opens at its end | OBL-016 | captured:AskUserQuestion 2026-10-30 "첫 안읽음 + 구분선 (추천)" | PASS |
| OBL-032 | experience | Off the terminal the room no longer prints `click ▾ to unfold a message`; the pane stays read-only | — | captured:AskUserQuestion 2026-10-30 "승인 (추천)", "읽기 전용 유지 (추천)" | PASS |
| OBL-033 | interface | Transcript room: a received run opens with `● <peer>  HH:MM` (name bold, time dim) and its bodies are indented two cells; a sent run sits beside a `claude` left bar (terminal `borderStyle="quote"`, desktop a narrow filled Box) under `you  HH:MM`; `(human)` in `suggestion` after the time; a later message of a run gets a dim time row; no bubbles | OBL-028,OBL-029 | artifact:ART-005#default@term-56; artifact:ART-005#default@term-92 | PASS |
| OBL-034 | interface | Separators: a day is a full-width `─` rule in `subtle` with ` MM-DD ` centred; the new divider is the same rule in `warning` with ` new ` | OBL-031 | artifact:ART-005#default@term-56 | PASS |
| OBL-035 | interface | Room chrome: top header `‹ chats` (plain, no hotkey), peer, presence, tool, root over a rule; bottom bar a rule, then `b: ‹ chats`, peer, presence, and `e: unfold all` pinned right when anything folds; no other hint | OBL-027,OBL-032 | artifact:ART-005#default@term-56; artifact:ART-005#default@term-92 | PASS |
| OBL-036 | interface | Fold control: dim `▾ <N> more lines` / `▴ fold` under the body at the body's indent | OBL-030 | artifact:ART-005#default@term-56 | PASS |
| OBL-037 | interface | Chat rows: two lines and one blank row between rows; line 1 cursor bar, presence, name, tool (dim), age pinned right; line 2 the preview after `you: ` or `<peer>: ` (and `(human)`), dim when read and at full strength when unread, the unread chip pinned right | OBL-026 | artifact:ART-005#default@term-56; artifact:ART-005#default@term-92; critique:Button has no weight prop (2026-10-30 build) | PASS |
| OBL-038 | implementation | pager-view draws OBL-026–OBL-037 | OBL-033,OBL-034,OBL-035,OBL-036,OBL-037 | missing | PENDING |

Approvals:
- experience_approved: ART-001 — 대협 payload note "디자인 시스템도 적당한거 찾아 골라서 좀 고급지게 해봐 ㅇㅇ"
- direction_selected: none (no interface artifact). The Ledger direction was chosen by Claude under 대협's delegation: "디자인 시스템도 적당한거 찾아 골라서 좀 고급지게 해봐 ㅇㅇ", "묻지말고 알아서 끝까지 해놓으셈 ㅇㅇ". Recorded as a delegated direction, not as 대협's selection.
- build_authorized: "묻지말고 알아서 끝까지 해놓으셈 ㅇㅇ" (and the earlier "전체 진행 (추천)" answer)

Approvals (2026-10-09 delta):
- experience_approved: 대협's answers "대화방 목록 → 말풍선 (추천)", "8줄 후 접기, 펼치기 (추천)", "두 mod 전부 (추천)"; the remaining experience decisions (OBL-016, OBL-017) delegated: "게임하고 있을테니 묻지말고 다 개선해놔."
- direction_selected: none (no interface artifact was shown). Console was chosen by Claude under 대협's delegation "게임하고 있을테니 묻지말고 다 개선해놔." Recorded as a delegated direction, not as 대협's selection.
- build_authorized: "하고나서 mods UI 좀 예쁘게 바꿔봐. 지금은 그냥 작동한다~ 느낌인데 좀 진짜 앱 띄워놓은 것처럼." and "게임하고 있을테니 묻지말고 다 개선해놔."

Approvals (2026-10-30 delta):
- experience_approved: 대협 AskUserQuestion 2026-10-30 — "승인 (추천)", "최신·안읽음만 펼침 (추천)", "첫 안읽음 + 구분선 (추천)", "읽기 전용 유지 (추천)"
- direction_selected: ART-005@chat-row=base+sent-emphasis=line — "ART-005 트랜스크립트 (추천)", "선 (추천)"
- build_authorized: "대화 말풍선 등 좀 대대적으로 UI 개편 좀 하셈"; "이제부터는 그냥 알아서 하셈 ㅇㅇ AFK"

Open: how the desktop Code tab draws a Box border, a Text background and a native Button inside a pane — not inspected on 2026-10-09 (a desktop capture needs the screen while 대협 is using it); the terminal render is the verified surface.
