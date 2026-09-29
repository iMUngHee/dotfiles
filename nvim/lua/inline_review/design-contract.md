# design-contract.md — inline-review

## Scope & Inheritance

- Applies to: `nvim/lua/inline_review/` (Neovim in-editor review threads).
- Parent contract: none.
- Owner: 대협. Last updated: 2026-09-29.
- Medium: TUI (Neovim 0.11+ cell grid; sign column, extmarks, floating windows).

## Surface Type & Craft Profile

- Surface: editor overlay on the user's own code buffers plus one modal thread view and one picker list.
- Density: one header line per thread above its range; everything else on demand.
- Craft priorities: the code stays readable; state is readable without color; long Korean text breaks at 어절 boundaries.
- Anti-patterns: interleaving full threads into the code flow, color-only state, absolute RGB, guessed-width emoji.

## Product Context

- User: 대협, reviewing code an AI agent (Claude Code / Codex) writes or edits.
- Jobs: annotate a line or range; send all unsent notes to the agent as one prompt; see, at each location, the note and how the agent handled it; reply or resolve; browse the full feedback history.
- Success: after an agent pass, each thread shows the agent's handling at the code location it concerns, and the change since the comment is one keystroke away.
- Non-goals: PR hosting integration, multi-user review, syncing threads across worktrees.

## UX Model

- Primary object: a thread anchored to a file range. Entry point is the code (ART-001).
- Thread states: `draft` (my message not sent yet) → `sent` (waiting for the agent) → `answered` (waiting for me) → `resolved`. A reply returns a thread to `draft`.
- Screens: code buffer with lens headers; thread modal; history picker.
- History picker lists every thread including resolved and missing-file ones, filterable by state, jumping to the location on select.

## Data & State Model

Event log: `<git root or cwd>/.agents/state/review/comments.jsonl`, append-only; a `.gitignore` containing `*` is created beside it.

| ev | writer | fields |
| --- | --- | --- |
| `comment` | nvim | `id, file, l:[s,e], snippet, body, ts` |
| `edit` | nvim | `id, seq, body, ts` (draft only, same message) |
| `sent` | nvim | `ids, ts` |
| `response` | agent via `cli.lua respond` | `id` (prompt token, e.g. `c3` or `c3.2`), `status: addressed\|declined\|question, summary, l?, anchor?, anchor_side?, removed?, file?, ts` (`anchor` = post-edit text of line `l[1]`; for removed ranges the line before the deletion point, `anchor_side` before\|after\|empty) |
| `reply` | nvim | `id, body, ts` |
| `resolve` / `delete` | nvim | `id, ts` |
| `move` | nvim | `id, l, snippet, base, anchor_side?, removed?, file?, ts` (confirmed anchor) |

A response changes state only when its token matches the thread's latest user message and the thread is `sent` (or already `answered` for that same message, in which case the latest duplicate wins); otherwise it stays in history as `earlier round`. Full write/read/anchor rules live in the technical plan's Log Protocol.

| Context | State | What the user sees | Recovery |
| --- | --- | --- | --- |
| send | nothing in draft | `No draft comments to send` | — |
| send | clipboard unavailable | copied to the unnamed register, notice says so | paste from `"` |
| load | malformed log line | `inline-review: skipped malformed line <n>` once | fix or ignore the line |
| load | response for unknown id | warning naming the id | — |
| anchor | range moved | header follows extmark / agent `l` / snippet match | — |
| anchor | range not found | header at original line, `(location estimated)` | reply or resolve |
| anchor | range deleted | header at deletion point, `code removed`; modal shows the original snippet | resolve |
| file | file missing | picker only, `FILE MISSING`; modal opens with snippet | agent `file` re-targets |
| view | resolved | hidden inline by default; toggle shows them | `<leader>ah` |

## Interaction Model

| Key | Mode | Action |
| --- | --- | --- |
| `<leader>aa` | n / x | add comment on current line / selection |
| `<leader>ae` | n | edit draft body at cursor |
| `<leader>ay` | n | copy all draft threads as prompt, mark sent |
| `<leader>aY` | n | re-copy threads still `sent` (agent session lost) |
| `<leader>ao` | n | open thread modal at cursor |
| `<leader>ar` / `ax` / `ad` | n | reply / resolve / delete (confirm only when an agent response exists) |
| `<leader>al` | n | history picker |
| `<leader>ah` | n | toggle resolved threads inline |
| `]r` / `[r` | n | next / previous thread in buffer |

Inside the modal: `r` reply, `x` resolve, `e` edit, `d` delete, `]r` next, `q` / `<Esc>` close and return focus to the code window. `<leader>l` / `<leader>L` keep their existing behavior.

## Visual System

Art direction: review lens — a header line above the range tells what is there; reading happens in a focused modal.

- Color authority is the user's colorscheme; every group is a default link, never a hex value.
- `InlineReviewDraft` → `DiagnosticHint`, `InlineReviewSent` → `Comment`, `InlineReviewAddressed` → `DiagnosticOk`, `InlineReviewQuestion` → `DiagnosticWarn`, `InlineReviewDeclined` → `DiagnosticInfo`, `InlineReviewRange` → `CursorLine`, `InlineReviewRemoved` → `DiagnosticWarn`.
- Hierarchy comes from position (header above range), uppercase state word, and the modal's labelled column. Motion: N/A.

## Component Rules

- Lens header: `virt_lines_above` at range start — `-- <id>  <STATE>[ · code removed]  <who>: <summary>`; `--` in `NonText`, id and summary in `Comment`, state word in its state group; summary truncated at an 어절 boundary with `...`.
- Range marks: sign `|` on each range line, priority 5 (gitsigns and diagnostics win on shared lines); `answered` ranges also get `InlineReviewRange` line highlight. Removed ranges get neither.
- Modal: `relative=editor`, row 1, col 3, width `columns - 8`, `border=rounded`, 1-cell left padding, filetype `inline_review` (excluded from marks.nvim), window-local `scrolloff=0` while open. Title ` review · <path>:<s>-<e> ` or ` review · <path>:<l> (code removed) `; footer ` r reply  x resolve  e edit  d delete  ]r next  q close `.
- Modal body: header `<id>  <STATE> · <status>`, then messages with an 8-cell `you`/`agent` label column (`Title` / state group), body wrapped at 어절 boundaries, then the change since comment.
- Change since comment: side-by-side `at comment | now` when `columns >= 120`, unified diff below; `DiffDelete` / `DiffAdd`; code truncated by cell width keeping indentation; removed code shows `(removed)` on the now side.
- Input: `vim.ui.input` (dressing) with prompts `Comment @<path>#L<s>-<e>: `, `Edit <id>: `, `Reply <id>: `.
- Picker: Telescope, entries `<STATE>  <id>  <path>:<s>-<e>  <summary>`, `FILE MISSING` for absent files, preview in modal layout.
- Feedback: `vim.notify`, e.g. `Copied 3 comments (c3, c5, c8)`.

## Responsive & Accessibility

- Adaptation axis: columns × rows. Inspected extremes: 80x24 and 160x40.
- Diff layout switches at 120 columns; header summaries truncate to the window width.
- State is always a word; color only reinforces it. Every action has a key listed in the modal footer or which-key descriptions.
- Hangul occupies two cells; truncation and wrapping measure with `nvim_strwidth`.

## Performance & Formatting

- The log is re-read on fs_event and `FocusGained`; rendering is limited to loaded buffers.
- Line ranges print as `L<s>` or `L<s>-<e>`; paths are repo-root relative, symlinks resolved.

## Microcopy

English UI copy to match existing notifications (`Copied: @path`); comment bodies stay as typed.
`No draft comments to send`, `Copied <n> comments (<ids>)`, `Re-copied <n> sent comments (<ids>)`, `code removed`, `(location estimated)`, `FILE MISSING`, `Delete <id> and its agent responses?`.

## Do / Don't

- Do keep the code's own lines untouched; only one header line per thread enters the flow.
- Do yield the sign column to gitsigns and diagnostics on shared lines.
- Don't inline full threads or diffs into the buffer.
- Don't signal state with color alone or with glyphs of guessed width.

## Artifact Ledger

| ART ID | Path | Revision | Selection | Covers | States / extremes | Status | Supersedes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ART-001 | .agents/plans/artifacts/nvim-review-comments/exp-A-inline.txt | 465238b26d64 | ART-001 | OBL-001–OBL-013 structure | answered@default | selected | — |
| ART-002 | .agents/plans/artifacts/nvim-review-comments/exp-B-panel.txt | 2d283bffe0c4 | — | — | answered@default | exploratory | — |
| ART-003 | .agents/plans/artifacts/nvim-review-comments/exp-C-round.txt | f7ddf7116dd0 | — | — | answered@default | exploratory | — |
| ART-004 | .agents/plans/artifacts/nvim-review-comments/interface-ART-004.html | 40a2bb68a372 | — | — | default, detail @80x24, 160x40 | exploratory | — |
| ART-005 | .agents/plans/artifacts/nvim-review-comments/interface-ART-005.html | 13714b654df2 | — | — | default, detail @80x24, 160x40 | exploratory | — |
| ART-006 | .agents/plans/artifacts/nvim-review-comments/interface-ART-006.html | 6e0b107a23ae | ART-006 | OBL-101–OBL-107 | default, detail, removed, removed-detail @80x24, 160x40 | selected | — |

## Implementation Bridge

Build authorized 2026-09-29 ("승인 ㄱㄱ"), plan `.agents/plans/2026-09-29-nvim-review-comments.md`.

| Contract rule | Existing primitive / new code | Where |
| --- | --- | --- |
| State colors | default hl links re-applied on `:colorscheme` via `utils.palette.on_colorscheme` | `view.lua` `M.LINKS`, `init.lua` `M.setup` |
| Lens header | `virt_lines_above` extmark; line 1 forced visible with window `topfill` | `view.lua` `M.render` |
| Range marks | sign `|` priority 5 (gitsigns 6 and diagnostics 10 win on shared lines), `line_hl_group` for answered | `view.lua` `M.render` |
| Modal | `nvim_open_win` editor-relative, `border = "rounded"` as in diagnostic/telescope/dressing; filetype `inline_review` excluded in marks.nvim | `view.lua` `M.open_modal`, `plugins/20_ui.lua` |
| Diff layout | side-by-side when the content width is >= 110 (a 120-column editor's modal), unified below; `vim.text.diff` with a `vim.diff` fallback for 0.11 | `view.lua` `diff_rows` |
| Input | `vim.ui.input` (dressing) with context captured before the prompt | `init.lua` `M.add` / `M.edit` / `M.reply` |
| Picker | telescope `pickers` + `new_buffer_previewer` reusing the modal rows | `init.lua` `M.list` |
| Feedback | `vim.notify` (noice) | `init.lua` |
| Clipboard | `provider#clipboard#Executable()` decides; `has("clipboard")` stays 1 without a provider in 0.12 | `init.lua` `has_clipboard` |
| Log protocol | lock, tail repair, single write, fold, anchors — shared by nvim and the agent CLI | `store.lua`, `cli.lua` |
| Buffer/disk sync | content comparison after decoding fileencoding, BOM, fileformat and `eol` (plain string equality in place of the planned sha256 — same outcome, no hashing) | `view.lua` `M.synced` |

Verification commands (from the repository root):

- `nvim --headless -u NONE --cmd "set rtp^=nvim" -l nvim/tests/inline_review_spec.lua` → `ALL PASS (36)`
- `~/.local/share/nvim/mason/bin/stylua --check nvim/lua/inline_review nvim/lua/utils/file_ref.lua nvim/tests` → exit 0
- `lua-language-server --check nvim/lua/inline_review --configpath <luarc with the after/lsp/lua_ls.lua settings> --checklevel=Warning` → no problems
- Render: tmux 80x24 / 160x40 (plus 120x30 / 119x30 for the diff boundary) with `XDG_CONFIG_HOME=<worktree>` against fixture repos; captures in `.agents/plans/artifacts/nvim-review-comments/implementation-render.html` (revision 3dbe205fbc46).

Surface Obligations:

| ID | Stage | Obligation | Derives from | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| OBL-201 | implementation | Add / edit / reply / delete through captured-context `vim.ui.input`; empty input creates nothing; edit refused once the draft moved on, text kept in `"` | OBL-001, OBL-002, OBL-108 | code:nvim/lua/inline_review/init.lua:337, test:e2e comment→copy, e2e edit refused, render:implementation-render.html#default | PASS |
| OBL-202 | implementation | Copy drafts as one prompt and record `sent` in one locked step; re-copy sent; clipboard fallback and notices | OBL-003, OBL-004, OBL-110 | code:nvim/lua/inline_review/init.lua:473, code:nvim/lua/inline_review/store.lua:420, test:prompt tokens, e2e copy, e2e no clipboard | PASS |
| OBL-203 | implementation | Lens header per thread with STATE word, flags, 어절 truncation, stacked count, line-1 topfill | OBL-005, OBL-012, OBL-101, OBL-102 | code:nvim/lua/inline_review/view.lua:322, test:lens truncation, e2e line 1 topfill, render:implementation-render.html#default@80,#after-gg@80 | PASS |
| OBL-204 | implementation | Range signs yield to gitsigns and diagnostics; answered ranges tinted | OBL-103 | code:nvim/lua/inline_review/view.lua:379, render:implementation-render.html#default@160 (L13 diagnostic sign wins, tint on c3/c5) | PASS |
| OBL-205 | implementation | Thread modal: geometry, title, footer keys, 8-cell labels, diff switch at content width 110, focus restore, scrolloff 0 while open, no marks.nvim `.` | OBL-006, OBL-104, OBL-105, OBL-107 | code:nvim/lua/inline_review/view.lua:553, code:nvim/lua/plugins/20_ui.lua:325, render:implementation-render.html#detail@80,@160,@120,@119 | PASS |
| OBL-206 | implementation | Removed range: point anchor with context line, `code removed` header, `(code removed)` title, `(removed)` now side | OBL-014, OBL-106 | code:nvim/lua/inline_review/view.lua:159, test:anchor removed middle/end/top, render:implementation-render.html#removed@80,#removed-detail@80 | PASS |
| OBL-207 | implementation | `]r`/`[r` wrap through threads; resolved hidden until `<leader>ah`; all `<leader>a` keys and `:InlineReviewUnlock` registered, `<leader>l`/`L` unchanged | OBL-007, OBL-010, OBL-013 | code:nvim/lua/inline_review/init.lua:689, test:e2e ]r/[r and toggle, test:file_ref characterization | PASS |
| OBL-208 | implementation | Telescope list with state/id/path columns, `FILE MISSING`, modal-layout preview, jump on select | OBL-008, OBL-109, OBL-011 | code:nvim/lua/inline_review/init.lua:599, render:implementation-render.html#picker@80,@160 | PASS |
| OBL-209 | implementation | Log protocol (lock, tail repair, single write, fold rules, move with base, sync-gated anchors, watcher with checktime) | OBL-009, OBL-011, OBL-014 | code:nvim/lua/inline_review/store.lua:354, code:nvim/lua/inline_review/view.lua:204, code:nvim/lua/inline_review/init.lua:206, test:integrity, anchor, sync, e2e | PASS |

Craft findings found and fixed during implementation: line-1 header invisible without topfill (degrades the task — also present in ART-006, missed at selection); preview diff cut to unreadable at 160 columns because the switch used the editor width (degrades the task); `...` after a sentence mark and misaligned `FILE MISSING` column (polish).

## Decision Log & Open Questions

- 2026-09-29 — Storage: append-only JSONL event log (chosen over single JSON / chat-only replies). Plugin lives in dotfiles as a local module.
- 2026-09-29 — Experience structure ART-001 over ART-002 (panel) and ART-003 (round document). Answers: sent state added, resolved hidden by default, drafts editable, `<leader>a` prefix.
- 2026-09-29 — Direction ART-006 over ART-004 (margin note) and ART-005 (interleaved). First pick at revision 588a01b11c17 was refused as ARTIFACT DRIFT after regeneration; re-selected at 6e0b107a23ae.
- 2026-09-29 — Plan review R1 (technical): prompt tokens gain a message sequence (`c3.2`), nvim records confirmed anchors as `move` events, stale responses stay in history only. No user-visible flow change beyond `earlier round` labelling in the thread history.
- 2026-09-29 — OBL-014 (code-removed handling) and build approved: "승인 ㄱㄱ".
- 2026-09-29 — Implementation rows OBL-201–OBL-209 are recorded under Implementation Bridge (the planning-time PENDING placeholder was removed).

Surface Obligations:

| ID | Stage | Obligation | Derives from | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| OBL-001 | experience | Comment on current line (n) or selection (x) creates a draft thread shown at once; empty input or cancel creates nothing | — | artifact:ART-001#answered@default | PASS |
| OBL-002 | experience | Draft body is editable until sent; delete confirms only when an agent response exists | — | captured:payload draft-edit | PASS |
| OBL-003 | experience | Copy sends draft threads (new comments and replies) as `[id] @file#Lcur body` with log path and skill instruction, marks them sent, reports `Copied N (ids)`; nothing to send reports `No draft comments to send` | — | captured:payload sent-state | PASS |
| OBL-004 | experience | A separate action re-copies threads still `sent` | OBL-003 | captured:payload sent-state | PASS |
| OBL-005 | experience | Each unresolved thread shows state and latest message summary at its location; several on one line show a count | — | artifact:ART-001#answered@default | PASS |
| OBL-006 | experience | Thread view: full chronological history, change since comment, keyboard reply/resolve/edit/delete/close | — | artifact:ART-001#answered@default | PASS |
| OBL-007 | experience | `]r` / `[r` move between threads in the buffer | — | captured:payload keymap-prefix | PASS |
| OBL-008 | experience | History list of all threads, state filter, jump on select | — | artifact:ART-001 | PASS |
| OBL-009 | experience | Agent appends appear without manual refresh; reload re-anchors via agent `l`, then snippet, then `(location estimated)` | — | disclosed inference | PASS |
| OBL-010 | experience | Resolved threads hidden inline by default, toggle shows them | — | captured:payload resolved-inline | PASS |
| OBL-011 | experience | Malformed line warned once with line number; unknown id warned; missing file listed as `FILE MISSING`; clipboard failure falls back to unnamed register | — | disclosed inference | PASS |
| OBL-012 | experience | Long Korean text truncates inline at 어절 boundary with `...`; full text wraps at 어절 in the thread view | — | quality-floor Text Setting | PASS |
| OBL-013 | experience | All actions on `<leader>a` keys (aa, ae, ay, aY, ao, ar, ax, ad, al, ah); `<leader>l`/`L` preserved | — | captured:nvim/lua/common/mappings.lua:137 | PASS |
| OBL-014 | experience | Deleted range keeps its thread at the deletion point marked `code removed`; reload uses agent `removed`+`l`, then snippet, then `(location estimated)`; missing file shows in the picker only, agent `file` re-targets | OBL-009 | artifact:ART-006#removed@80x24 | PASS |
| OBL-101 | interface | Lens header above range start with id, STATE word, optional `code removed`, who and 어절-truncated summary | OBL-005, OBL-012 | artifact:ART-006#default@80x24 | PASS |
| OBL-102 | interface | State as words; color via default links to Hint/Comment/Ok/Warn/Info, no hex | OBL-005 | artifact:ART-006#default@160x40 | PASS |
| OBL-103 | interface | Range sign `\|` priority 5 yielding to gitsigns and diagnostics; answered ranges tinted `InlineReviewRange` | OBL-005 | artifact:ART-006#default@80x24 | PASS |
| OBL-104 | interface | Modal geometry, rounded border, padding, title and footer keys; 8-cell label column; 어절 wrapping | OBL-006, OBL-012 | artifact:ART-006#detail@80x24, #detail@160x40 | PASS |
| OBL-105 | interface | Side-by-side diff at >= 120 columns, unified below; indentation-preserving code truncation | OBL-006 | artifact:ART-006#detail@80x24, #detail@160x40 | PASS |
| OBL-106 | interface | Removed state: header only, title `:<l> (code removed)`, now side `(removed)` | OBL-014 | artifact:ART-006#removed-detail@80x24, @160x40 | PASS |
| OBL-107 | interface | Modal owns key scope, q/Esc restore focus, window-local scrolloff=0, filetype excluded from marks.nvim | OBL-006, OBL-013 | critique:ART-006 first-render mark and scroll defects | PASS |
| OBL-108 | interface | Input through `vim.ui.input` with `Comment @<path>#L<s>-<e>: ` / `Edit <id>: ` / `Reply <id>: ` | OBL-001, OBL-002 | captured:nvim/lua/plugins/20_ui.lua:230 | PASS |
| OBL-109 | interface | Telescope picker `<STATE>  <id>  <path>:<s>-<e>  <summary>`, `FILE MISSING`, modal-layout preview | OBL-008 | captured:nvim/lua/plugins/40_telescope.lua | PASS |
| OBL-110 | interface | `vim.notify` feedback strings per Microcopy | OBL-003, OBL-011 | captured:nvim/lua/common/mappings.lua:118 | PASS |

Approvals:

- experience_approved: ART-001 — "코드 중점으로 보는게 흐름 파악이 수월해보임"
- direction_selected: ART-006 — "난 계속봐도 모달열리는게 나은디"
- build_authorized: plan nvim-review-comments — "승인 ㄱㄱ" (2026-09-29; also approves OBL-014)
