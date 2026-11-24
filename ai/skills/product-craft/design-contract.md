# design-contract.md

## Scope & Inheritance

- **Applies to:** the candidate board that `scripts/board.mjs serve` opens: the wrapper page,
  `references/candidate-viewer.html` inside it, and the A2UI feedback panel
  (`scripts/board-panel.jsx`, default surface `references/feedback-surface.json`).
- **Parent contract:** none. The viewer's own behaviour is set by `references/interface.md`
  and is not changed here.
- **Owner:** 대협. **Depth:** Screen. **Last updated:** 2026-11-24.
- **Medium:** web, desktop browser, served from 127.0.0.1. **Toolkit:** React 19 +
  `@a2ui/react` 0.16.1 with the A2UI v1.0 basic catalog.
- **Host ceiling:** the panel can use only basic-catalog components (Text has no heading
  variant; layout is Row/Column/Card), themed through `--a2ui-*` custom properties. The
  viewer is an unmodified file, so nothing can be drawn inside it.

## Surface Type & Craft Profile

- **Surface:** a chooser: look at two or three candidates full size, answer once.
- **Reference:** the existing viewer (`references/candidate-viewer.html`). The panel extends
  its chrome rather than introducing a second look.
- **Optimising for:** an answer the agent can act on without a follow-up question, without
  the board steering the choice.

## Product Context

- **User:** 대협, choosing between candidates the agent rendered.
- **Job:** pick one (optionally asking for changes), or reject all and say why.
- **Success:** the agent's `wait` returns one validated action for this round.
- **Out of scope:** describing or ranking candidates on the page, splicing candidates,
  editing candidates in the board, more than one answer per round.

## UX Model

One screen: viewer (left, fills the width) | panel (right, 360px).

| Object | Action | Expected | Notes |
| --- | --- | --- | --- |
| Candidate | switch | yes | the viewer's own number keys, arrows and buttons |
| Candidate | compare with reference | yes | viewer `R`, unchanged |
| Candidate | choose | yes | number chip in the panel, one at a time; picking it also shows that candidate in the viewer |
| Choice | change before sending | yes | chips toggle until sent |
| Comment | write | yes | optional on choose, required on reject-all |
| Extra question | answer | yes | when the agent added one for this set |
| Answer | send | yes | once per round |
| Answer | edit after sending | no | the round is closed; a new answer is a new round, opened by the agent |
| Candidate | read a description | no | `interface.md`: no descriptions on the page |

Journeys:

1. **Choose.** Open the board → the choose button is disabled and the hint says why → pick
   chip 2 → the viewer shows candidate 2 → type a comment → send → the form is replaced by
   "2번 시안으로 보냈습니다." and the comment → `wait --round <r>` prints `candidate.decide`
   with `choice: "2"` and the comment.
2. **Reject all.** Open the board → the reject button is disabled while the comment is empty
   → type what is wrong → send → `wait` prints `candidate.none` with that comment.
3. **Keys stay where they belong.** Type "2" into the comment → the viewer still shows the
   same candidate → focus the viewer and press "2" → the viewer shows candidate 2.

## Data & State Model

- Data model: `/feedback/choice` (string list, at most one value), `/feedback/comment`,
  `/extra/<key>` for added questions, `/status`.
- States: **open** (choose disabled until a chip is picked; reject disabled until the
  comment has text; the opening line says both conditions); **sent** (the
  server replies with `updateComponents` that replace the form with what was sent and the
  next step, so nothing looks editable; a second POST from elsewhere gets 409 and sets
  `/status`); **server gone** (send fails, `/status` says to answer in the conversation).

## Interaction Model

- Panel: Tab order is chips → comment → extra questions → choose → reject. Enter on a
  focused button sends. Focus shows as a `2px #80c8ff` ring around the focused button or
  chip group (drawn on the component's host element, the shadow-DOM boundary allows no
  closer target).
- Picking a chip clicks the viewer's matching number button, so the preview follows the pick;
  it does not move focus into the viewer.
- Viewer: its keyboard map is unchanged and works only while it has focus.
- Nothing is destructive; sending is the only commit and it is single-shot.

## Visual System

Direction: the viewer's dark chrome, carried into a side panel.

| Value | Source |
| --- | --- |
| Page and panel background `#16191d` | from viewer `body` |
| Text `#fff`; placeholder `#b8bec6` | `#fff` from viewer; placeholder derived: lightened `#555` toward white for legibility on `#22272e` |
| Divider and control borders `1px solid #767d87` | departure: the viewer's `#555` measures 2.37:1 on `#16191d` and 2.02:1 on `#22272e`, under the 3:1 non-text minimum; `#767d87` gives 4.24:1 and 3.62:1 |
| Accent / primary `#80c8ff`, on-primary `#16191d` | from viewer focus ring |
| Primary hover `#a6d8ff`, primary dark `#5fb4f5` | derived: the accent one step lighter and one step darker |
| Control padding: buttons 14px 16px, chips 12px 18px | derived: what makes a 44px control at the 14–16px type sizes |
| Input background `#22272e` | derived: one step lighter than the background |
| Control height 44px, radius 4px | 44px from viewer buttons; radius derived from the viewer candidates' 4px |
| Spacing 8 / 16px (chip gap 8px, other gaps 16px) | derived: viewer uses 4px gaps and 12px padding; doubled for a form column |
| Type: system sans; panel text and labels 14px, line height 1.4 | family and line height from viewer `body`; 14px derived so the hint and summary do not outrank the labels |

## Component Rules

- **ChoicePicker (chips):** 14px text, padding 12px 18px (44px tall); unselected = border `#767d87`,
  text `#fff`; selected = background `#80c8ff`, text `#16191d`.
- **TextField (longText):** background `#22272e`, border `#767d87`, focus border `#80c8ff`,
  placeholder `#b8bec6`.
- **Button primary (choose):** background `#80c8ff`, text `#16191d`, 44px tall, no outer margin; disabled at the renderer's opacity .5.
- **Button default (reject):** border `1px #767d87`, text `#fff`, hover background `#22272e`, 46px tall (the primary's 44px plus its border; the row centres them); disabled at the renderer's opacity .5. Borderless is not used: the basic catalog forces its padding to 0, which leaves a 16px target.
- **Text:** body variant only, `#fff`, Korean kept whole per 어절 (`word-break: keep-all` on the panel). The caption variant is not used: the basic catalog wraps it in `<em>`, which sets Korean in a synthetic italic, and no theme property turns that off.

## Responsive & Accessibility

- Minimum window 960px wide: the panel stays 360px and the viewer takes the rest.
- Every control is reachable by keyboard. The renderer does not display a disabled button's
  check message, so the opening line carries the reason. Contrast measured
  2026-11-24: `#fff` on `#16191d` 17.63:1, `#b8bec6` on `#22272e` (placeholder) 8.03:1,
  `#16191d` on `#80c8ff` 9.76:1.

## Microcopy

- No panel title (the choice label already names the task; the panel is labelled "시안 선택"
  for assistive technology). Choice label: "채택할 시안 (고르면 왼쪽에 그 시안이 나옵니다)", which states the link to the viewer that a still cannot show. Comment label: "코멘트" (not "(선택)", which reads as "pick" right under the choice).
  Comment placeholder: "바꿀 점이 있으면 적어 주세요."
- Opening line, first in the panel, which also gives the reason the buttons start disabled: "어느 시안으로 갈지 골라 주세요. 전부 아니면 무엇이 맞지 않는지 코멘트에 적어 주세요."
- Buttons: "고른 시안으로 보내기" / "전부 아님". Check messages: "채택할 시안을 골라 주세요." /
  "무엇이 맞지 않는지 적어 주세요."
- Sent: "<n>번 시안으로 보냈습니다." or "전부 아님으로 보냈습니다.", then the comment in quotation marks
  when there is one (plain text: a boxed echo read as an editable field), then "에이전트가 이어서 진행합니다. 이 창은 닫아도 됩니다."
- Status: "이미 전송했습니다." / "보드가 닫혔습니다. 대화창에서 답해 주세요."

## Do / Don't

- Don't put candidate descriptions, rankings or the agent's pick on the board.
- Don't add borrow-from-another-candidate controls; a change request goes in the comment.
- Do keep the viewer file untouched; the board wraps it.

## Implementation Bridge

- Dependencies: `package.json` in this skill directory (exact versions, lockfile); install
  with `npm install` here.
- Theme: `--a2ui-*` properties set on the panel root in the wrapper page served by
  `scripts/board.mjs`.
- Fixtures and review: `npm test` runs `scripts/deps-tests/`, which serves a board with two
  candidates and replays the three journeys in Chromium.

## Decision Log & Open Questions

- 2026-11-24 — 대협: "product-craft 제대로 해봐", 웹 전용, A2UI v1.0, 범용 스킬 없이 공식
  a2ui 스킬 사용.
- 2026-11-24 — delegated: chosen by Claude because the viewer is the only existing look
  for this surface: the panel carries the viewer's dark chrome and its accent.

**Decided for you:** panel colours and spacing derived from the viewer; microcopy above;
the 360px panel width.
