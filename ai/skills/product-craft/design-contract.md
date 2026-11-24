# design-contract.md

## Scope & Inheritance

- **Applies to:** the candidate board that `scripts/board.mjs serve` opens. That covers the
  wrapper page, `references/candidate-viewer.html` inside it, the bridge the board adds to
  candidate HTML (`scripts/board-bridge.js`), and the A2UI panel (`scripts/board-panel.jsx`,
  `scripts/board-components.jsx`, catalog `scripts/board-catalog.mjs`).
- **Parent contract:** none. The viewer's own behaviour is set by `references/interface.md`
  and is not changed here.
- **Owner:** 대협. **Depth:** Screen. **Last updated:** 2026-11-24.
- **Medium:** web, desktop browser, served from 127.0.0.1. **Toolkit:** React 19 +
  `@a2ui/react` 0.16.1, catalog `product-craft/board/v1` (the v1.0 basic catalog plus the
  components below).
- **Host ceiling:**
  - The viewer file is not modified. Live preview and pins reach HTML candidates only,
    through the bridge, and never reach screenshot candidates or candidates that carry a
    Content-Security-Policy meta.
  - A disabled basic Button never shows its check message. SubmitButton exists for that
    reason.

## Surface Type & Craft Profile

- **Surface:** a chooser with structured adjustment. The owner looks at two or three
  candidates full size, picks one, tunes the tokens the agent exposed, points at places to
  change, and answers once.
- **Reference:** the existing viewer (`references/candidate-viewer.html`) for the look. For
  the adjustment controls, the inspector pattern of design tools: a label, the value and a
  direct control per row.
- **Optimising for:** an answer the agent can apply without a follow-up question, without the
  board steering the choice.

## Product Context

- **User:** 대협, choosing between candidates the agent rendered.
- **Job:** pick one, optionally ask for changes in words, in exact token values, or at exact
  places; or reject all and say why.
- **Success:** the agent's `wait` returns one validated action for this round.
- **Out of scope:**
  - describing or ranking candidates on the page;
  - splicing candidates;
  - editing candidate markup in the board;
  - more than one answer per round;
  - pins on screenshot candidates.

## UX Model

One screen: viewer (left, fills the width) | panel (right, 360px). The agent composes the panel
for each round from the catalog. A round shows only the controls its candidates call for.

| Object | Action | Expected | Notes |
| --- | --- | --- | --- |
| Candidate | switch | yes | the viewer's own number keys, arrows and buttons |
| Candidate | compare with reference | yes | viewer `R`, unchanged |
| Candidate | choose | yes | CandidatePicker card; choosing also shows it in the viewer (`showCandidate`) |
| Candidate | see which one is on screen | yes | CandidatePicker marks the viewed card with an eye icon ("보는 중" as its tooltip and accessible name), separately from the "선택됨" fill and tag |
| Choice | change before sending | yes | pick another card until sent |
| Token | adjust with live preview | yes | ColorToken / SizeNudge / AlignPicker, enabled once a candidate is chosen; only the chosen candidate previews them, other candidates show as written |
| Token | reset | yes | each control's 초기화 restores the candidate's own value and drops it from the answer |
| Token | see that it does not apply here | yes | "이 시안에는 반영되지 않습니다" when the viewed candidate does not declare it on `:root` |
| Place | pin with a note | yes | RegionNotes: 위치 지정 → the candidate shows an accent frame and a banner → click → note |
| Pin | delete | yes | per pin |
| Comment | write | yes | optional on choose, required on reject-all |
| Answer | send | yes | once per round |
| Answer | edit after sending | no | the round is closed; a new answer is a new round, opened by the agent |
| Candidate | read a description | no | `interface.md`: no descriptions on the page |

Journeys:

1. **Choose.** Open the board → SubmitButton "고른 시안으로 보내기" is disabled and shows
   "채택할 시안을 골라 주세요." under it → pick card 2 → the viewer shows candidate 2, card 2
   shows the eye icon and "선택됨" → type a comment → send → the form is replaced by
   "2번 시안으로 보냈습니다." and the comment → `wait --round <r>` prints `candidate.decide`
   with `choice: "2"` and the comment.
2. **Reject all.** Open the board → "전부 아님" is disabled with "전부 아님은 코멘트를 적어야
   보낼 수 있습니다." under it → type what is wrong → send → `wait` prints `candidate.none` with that
   comment.
3. **Keys stay where they belong.** Type "2" into the comment → the viewer still shows the
   same candidate → focus the viewer and press "2" → the viewer shows candidate 2.
4. **View versus choose.** Choose card 2 → switch the viewer to 1 with its own buttons →
   card 1 shows the eye icon, card 2 reads "선택됨".
5. **Adjust with live preview.** The token controls are disabled with "시안을 고르면 색·간격·정렬 같은
   값을 조정할 수 있습니다." → choose card 1 → set ColorToken accent to `#3b82f6`, press SizeNudge gap + twice
   (16 → 24), set AlignPicker align to center → candidate 1 changes as each value changes →
   view candidate 2 → it shows as written and the controls say "선택한 시안 1에만 적용됩니다."
   → view 1 again → the values still apply → reset gap → it returns to 16 and leaves the
   answer → send → `adjust` is `{accent: "#3b82f6", align: "center"}`.
6. **Pin a place.** 위치 지정 → the candidate shows an accent frame and "위치를 눌러 주세요 · Esc
   취소" → click the candidate's heading → a numbered marker and a dashed outline of the element
   appear, and a note field appears in the panel → type the note → scroll the candidate, open
   the viewer's compare mode → the marker stays on the heading → delete another pin → send →
   `pins` lists the remaining pins with their candidate, selector and note.
7. **No preview here.** View a candidate that does not declare a token, or that carries a CSP
   meta → the affected controls say so; RegionNotes is disabled with the reason.

## Data & State Model

- Data model:
  - `/feedback/choice`: candidate number string;
  - `/feedback/comment`;
  - `/adjust/<token>`: only tokens the owner changed;
  - `/pins`: the round's pins, at most 20 across all candidates;
  - `/extra/<key>`: questions the agent added;
  - `/status`.
- Panel state outside the data model:
  - the viewed candidate number (read from the viewer);
  - per-candidate bridge state: connected, waiting, or unavailable with its reason
    (`missing`, `redeclared`, `csp`, `image`, `timeout`);
  - pin mode on/off.
- States:
  - **open**: SubmitButtons are disabled until their checks pass, and the reason shows under
    each.
  - **pin mode**: the candidate shows a crosshair cursor, an accent frame and a banner; the
    next click adds a pin. Mode ends after one pin, on 지정 취소 or Esc, or when the viewer
    switches candidate.
  - **pin limit**: at 20 pins, 위치 지정 does not arm and "위치는 20개까지 남길 수 있습니다."
    shows until a pin is deleted.
  - **not chosen yet**: token controls are disabled with "시안을 고르면 색·간격·정렬 같은 값을 조정할 수 있습니다.".
  - **preview unavailable**: per candidate, with the reason.
  - **sent**: `updateComponents` replace the form with what was sent.
  - **server gone**: send fails, and `/status` says to answer in the conversation.

## Interaction Model

- Tab order follows the panel's order. Enter or Space activates a focused card, button or
  segment.
- SizeNudge: − and + step by `step`. The number field accepts typing and is clamped to
  min..max on the grid of `step` when it loses focus. ArrowUp/ArrowDown in the field step it.
- ColorToken: the swatch opens the native colour picker. The hex field accepts `#rrggbb` and
  rejects anything else with its message.
- AlignPicker: a segmented control, one option active, arrow keys move between options.
- Picking a card calls `showCandidate`. It does not move focus into the viewer.
- The viewer's keyboard map is unchanged and works only while it has focus.
- Nothing is destructive except deleting a pin, which is one click and can be redone by
  pinning again. Sending is the only commit and it is single-shot.

## Visual System

Direction: the viewer's dark chrome, carried into a side panel; adjustment rows in the manner
of a design-tool inspector.

| Value | Source |
| --- | --- |
| Page and panel background `#16191d` | from viewer `body` |
| Text `#fff`; secondary text and placeholder `#b8bec6` | `#fff` from viewer; secondary derived: lightened `#555` toward white for legibility on `#16191d` and `#22272e` |
| Divider and control borders `1px solid #767d87` | departure: the viewer's `#555` measures 2.37:1 on `#16191d` and 2.02:1 on `#22272e`, under the 3:1 non-text minimum; `#767d87` gives 4.24:1 and 3.62:1 |
| Selection (chosen card, active segment, pin-mode toggle border) `#80c8ff`, on-selection `#16191d` | from viewer focus ring |
| Focus ring `#fff`, 2px, offset 2px | departure: the viewer's focus ring is `#80c8ff`, which here already means "selected"; white keeps focus from reading as selection (17.63:1 on the panel) |
| Pin `#ffc24d` disc, `#16191d` letter, 2px `#16191d` ring | derived: a third hue, so a pin never reads as selection or focus; the dark ring keeps it visible on light candidates (letter 10.98:1) |
| Primary action `#fff`, text `#16191d`, hover `#e3e6ea` | departure: the accent already means "selected"; the main action takes the viewer's white so the two never read alike |
| Primary hover `#a6d8ff` | derived: the accent one step lighter |
| Disabled control: transparent, `1px solid #4a5058` border, text `#b8bec6`, opacity .6. The colour swatch keeps its colour under the same fade; the active segment of a disabled AlignPicker is filled `#4a5058` | derived: one look for every disabled control, so nothing reads as live before a candidate is chosen |
| "보는 중": a 14px eye icon in the card's top-right corner, `#b8bec6` (`#16191d` on a chosen card); "선택됨": `#80c8ff` fill and tag | derived: viewing is information, not a state to confuse with selection or focus; an icon keeps one tag line per card |
| Overflow cue: a 24px fade from transparent to `#16191d` above the answer area, and a "아래에 더 있습니다." pill (12px `#b8bec6`, `1px #767d87` border) on the divider at the right; scrolled content fades out under the sticky title over 32px | derived: a dark shadow does not show on the dark panel; text over the content read as a clipped field in review |
| Input background `#22272e` | derived: one step lighter than the background |
| Control height 44px, radius 4px | 44px from viewer buttons; radius from the viewer candidates' 4px |
| Spacing 8 / 16px; inspector rows 8px apart, groups 16px | derived: viewer uses 4px gaps and 12px padding; doubled for a form column |
| Type: system sans; panel text and labels 14px, Heading 16px/600, line height 1.4 | family and line height from viewer `body`; sizes derived so labels and headings rank above body text |

## Component Rules

- **Heading:** 16px, weight 600, `#fff`, 0 margin. The surface's first Heading sticks to the
  top of the panel while it scrolls, over a 1px `#767d87` bottom border.
- **Hint:** 14px, `#b8bec6`, upright (the basic caption's `<em>` is not used).
- **CandidatePicker:**
  - A row of cards, 8px apart. Each card is 60px high, with the number and one reserved tag
    line, so the height does not change. The thumbnail sits above the number when
    `board.json` gives one (max 96px wide).
  - Unselected: border `#767d87`.
  - Viewed: the eye icon in the top-right corner, with the tooltip "보는 중"; the card's
    accessible name includes "보는 중".
  - Selected: `#80c8ff` fill, `#16191d` number and a "선택됨" tag.
  - The group note under the cards keeps the height of its tallest text, so choosing or
    viewing never moves the rows below.
- **SubmitButton:**
  - Primary: `#fff` fill, `#16191d` text. Secondary: `1px #767d87` border, `#fff` text.
  - Both are 44px high with 14px 16px padding, and the text never wraps.
  - Disabled: the shared disabled style, and the first failing check message directly under
    the button. The line under each button keeps the height of the tallest text it can show
    (every check message declared on the surface's buttons, the drop warning and the send
    preview), so the answer area never changes height.
  - A button without `dropsChoice`, once it can send and a candidate is chosen, says what goes:
    "보낼 내용: 시안 <n> · 조정 <k>개 · 위치 <p>개 · 코멘트", leaving out the parts that are empty.
  - `dropsChoice: true` (the default surface sets it on "전부 아님"): while a candidate is
    chosen, the line under the button says "전부 아님을 보내면 시안 <n> 선택과 조정값은 버려집니다.".
    Rejecting is always allowed once the comment says why. 대협 chose a warning over
    disabling.
  - The column that holds the SubmitButtons sticks to the bottom of the panel, full width,
    over a 1px top border, so the answer stays in reach however long the panel grows. The
    panel has a 200px scroll padding, and the comment and pin note fields scroll themselves
    into view on focus, so a focused field is never under the answer area.
  - While the panel can scroll further down, the answer area shows the overflow cue along its
    top edge; at the end of the panel, or when everything fits, it does not.
- **CommentField:** label above; 4 rows; `#22272e` background; `#767d87` border, the focus ring
  on focus; no resize handle.
- **Token rows (ColorToken, SizeNudge, AlignPicker):**
  - The label shows the human name only. The token name is in the row's tooltip.
  - 초기화 is an underlined text button in `#b8bec6` that keeps its place while hidden, so the
    row never changes width.
  - A notice line under the control only for a problem with this token on the chosen
    candidate ("이 시안에는 반영되지 않습니다.", "미리보기 반영 불가.").
  - The group states ("시안을 고르면 색·간격·정렬 같은 값을 조정할 수 있습니다.", "조정은 선택한
    시안 <n>에만 적용됩니다.", and while the chosen candidate is on screen "조정은 시안 <n>에 바로
    반영됩니다.") show once, under the CandidatePicker.
- **ColorToken:**
  - One row: label, a 32px swatch that opens the native picker, a hex field 88px wide, and
    초기화.
  - Contrast: the bridge measures, on the chosen candidate, the lowest contrast between text
    drawn in the token's colour and the background behind it. Below 4.5:1 the row shows
    "이 색 글자의 배경 대비가 <r>:1입니다. 글자에는 4.5:1 이상이 필요합니다." in `#ffb4a8` (10.37:1 on the
    panel). The value is not blocked; the owner may keep it.
  - The background behind the text is found by compositing each ancestor's translucent
    background colour down to the first opaque one (or the white canvas); a translucent text
    colour is composited over that background.
  - Text with a background image or gradient on the way down cannot be measured. When nothing
    measured is below 4.5:1 but such text exists, the row shows "이미지·그라디언트 위의 이 색
    글자는 대비를 재지 못했습니다. 눈으로 확인해 주세요." in `#b8bec6`.
  - Not measured, and not flagged: text over a separately positioned element, ancestor
    `opacity`, `mix-blend-mode` and filters.
  - Invalid hex shows "#rrggbb 형식으로 적어 주세요".
- **SizeNudge:**
  - One row: label, a 32px − button, a number field 64px wide with the `px` unit, a 32px +
    button, and 초기화 when changed.
  - − is disabled at min and + at max.
- **AlignPicker:** one row: label, then a segmented control of 32px icon buttons for the
  options with text alternatives (왼쪽/가운데/오른쪽/채움); the active one in `#80c8ff`, or
  `#4a5058` while disabled.
- **RegionNotes:**
  - "위치 지정" toggle button, followed by "시안 <n>에 남깁니다." naming the viewed candidate the
    next pin goes to (대협: pins go on the viewed candidate and say so). While pin mode is on, the
    button reads "지정 취소" with a 2px accent border over a 16% accent tint, which a focus ring
    never has. The instruction shows only on the candidate.
  - While another candidate than the chosen one is on screen, the line reads "시안 <n>에 참고로
    남깁니다.", which is how the agent reads such pins.
  - Below it, a list of pins. The header row has the number badge, "시안 n · <element text>"
    and 삭제; below it is a note field.
  - On the candidate: a lollipop marker. The 24px lettered disc stands on a 12px amber stem
    whose 6px end dot is the exact point, so the disc is tied to its point and sits clear of the
    pinned line; within 40px of the top edge it hangs below the point. The element gets a dashed accent
    outline only while its note row is hovered or focused.
  - In the panel each pin row shows its number badge and "시안 <c> · <element text>"; the
    summary names it "위치 <L> · 시안 <c> · <element text>". The panel badge is the
    candidate marker's amber disc.
  - Pins are lettered A–T in list order, never numbered, so a pin is never confused with a
    candidate number. Deleting a pin relabels the ones after it.
  - In pin mode the banner sits at the candidate's bottom-left corner, clear of its header.
- **Unavailable notice:** Hint style, in the control's row: "이 시안에는 반영되지 않습니다"
  (token missing or redeclared), "미리보기 반영 불가" (bridge unavailable).
- **Focus:** a 2px `#fff` ring, offset 2px, on every focusable control, board and basic alike.

## Responsive & Accessibility

- Minimum window 960px wide: the panel stays 360px and the viewer takes the rest; the panel
  scrolls when its content is taller than the window.
- Every control is reachable by keyboard and has an accessible name. Icon segments carry text
  alternatives; "선택됨" is a text tag and "보는 중" is in the card's accessible name, so
  neither is colour alone.
- Contrast measured 2026-11-24: `#fff` on `#16191d` 17.63:1, `#b8bec6` on `#22272e` 8.03:1,
  `#16191d` on `#80c8ff` 9.76:1, `#16191d` on `#fff` (primary) 17.63:1, `#b8bec6` on `#16191d`
  (disabled text) 9.42:1, `#16191d` on `#ffc24d` (pin) 10.98:1, `#fff` focus ring on `#16191d`
  17.63:1. Inactive controls are exempt from the non-text contrast minimum; the fade and the
  reason under the button carry the state.

## Microcopy

- Heading (default surface): "시안 선택". Opening Hint: "어느 시안으로 갈지 골라 주세요." The
  reject rule is said once, under "전부 아님".
- CandidatePicker label: "채택할 시안". Tag: "선택됨". Eye icon tooltip: "보는 중".
- Comment label: "코멘트". Placeholder: "바꿀 점이 있으면 적어 주세요."
- Buttons: "고른 시안으로 보내기" / "전부 아님". Check messages: "채택할 시안을 골라 주세요." /
  "전부 아님은 코멘트를 적어야 보낼 수 있습니다." (the reject reason is written in the comment).
- Controls: "초기화", "위치 지정", "지정 취소", "삭제", "시안 <n>에 남깁니다.", "시안 <n>에 참고로 남깁니다.",
  "시안 <n> 보기" (a text button after "조정은 선택한 시안 <n>에만 적용됩니다."), "보낼 내용: …",
  "전부 아님을 보내면 시안 <n> 선택과 조정값은 버려집니다.", "아래에 더 있습니다.", "위치는 20개까지 남길 수 있습니다.", "시안을 고르면 색·간격·정렬 같은 값을 조정할 수 있습니다.",
  "선택한 시안 <n>에만 적용됩니다.", "조정은 시안 <n>에 바로 반영됩니다.", "이 시안에는 반영되지 않습니다.", "미리보기 반영 불가.",
  "이미지·그라디언트 위의 이 색 글자는 대비를 재지 못했습니다. 눈으로 확인해 주세요.". Pin controls: "위치 <L> 메모",
  "위치 <L> 삭제".
  Every hint is a sentence ending in a period.
- On the candidate in pin mode: "위치를 눌러 주세요 · Esc 취소".
- Sent, in this order, each section under its own small heading and left out when empty:
  - "<n>번 시안으로 보냈습니다." or "전부 아님으로 보냈습니다.";
  - 조정: a line per changed token in its own label, with units and the old value
    ("카드 간격: 16px → 24px", "카드 정렬: 왼쪽 → 가운데");
  - 위치 메모: "위치 A · 시안 1 · <element text>: <note>";
  - 코멘트: "“…”";
  - "에이전트가 이어서 진행합니다. 이 창은 닫아도 됩니다."
  After a send, the viewer shows the sent candidate.
- Status: "이미 전송했습니다." / "보드가 닫혔습니다. 대화창에서 답해 주세요."

## Do / Don't

- Don't put candidate descriptions, rankings or the agent's pick on the board.
- Don't add borrow-from-another-candidate controls. A change request goes in the comment or a
  pin.
- Don't expose a token control for a token no candidate declares.
- Don't show token names to the owner; they are for the agent.
- Do keep the viewer file untouched; the board wraps it.

## Implementation Bridge

- Dependencies: `package.json` in this skill directory (exact versions, lockfile, zod 3.25.76
  matching web_core); install with `npm install` here.
- Catalog: `basicCatalog.derive({catalogId: "product-craft/board/v1", components: [...basic,
  ...board], functions: [...basic, showCandidate]})`. Node imports API-only entries for
  validation and `board.mjs catalog`; the browser bundle uses the React implementations
  under the same names.
- Measured 2026-11-24 (spike in Chromium): basic catalog components render into light DOM.
  Their styles are adopted stylesheets scoped by tag name, and no element on the page has a
  shadow root. A React component inside a basic Column renders as
  `a2ui-basic-column > a2ui-react-<name> > …` in the document, and document CSS applies to it.
  Document CSS also overrides basic styles when its selector is more specific
  (`a2ui-basic-text em { font-style: normal }` took effect). `functionCall` from a Button
  action runs a renderer function, and a disabled Button does not display its check message.
  Consequence: board components are styled from one stylesheet in the wrapper page.
- Theme: wrapper stylesheet with `--a2ui-*` properties for basic components and `pcb-*`
  classes for board components.
- Fixtures and review: `npm test` runs `scripts/deps-tests/`, which serves boards and replays
  the journeys in Chromium.

## Decision Log & Open Questions

- 2026-11-24 — 대협: "product-craft 제대로 해봐", 웹 전용, A2UI v1.0, 범용 스킬 없이 공식
  a2ui 스킬 사용.
- 2026-11-24 — delegated: chosen by Claude because the viewer is the only existing look
  for this surface: the panel carries the viewer's dark chrome and its accent.
- 2026-11-24 — 대협: custom catalog; live preview of adjustments; colour token, size nudge,
  align picker and region notes; a surface composed per round; dedicated functions.
- 2026-11-24 — correction: the earlier "shadow DOM ceiling" for basic components was wrong.
  The spike above shows that basic components render into light DOM, and document CSS can
  override their styles.

- 2026-11-24 — 대협: pins are amber and lettered A–T, so they never read as candidate numbers;
  contrast composites translucent backgrounds and says when a background image or gradient
  cannot be measured.
- 2026-11-24 — delegated: focus moves to a white ring so selection, focus and pins are three
  distinct colours; "보는 중" becomes an eye icon so each card keeps one tag line.

**Decided for you:**
- panel colours and spacing derived from the viewer;
- the faded disabled style and the white primary action;
- the pin marker look, the white focus ring and the eye icon for "보는 중";
- the overflow cue above the answer area;
- the inspector row layout;
- the microcopy above;
- the 360px panel width.
