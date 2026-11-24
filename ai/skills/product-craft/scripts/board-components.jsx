// React implementations of the board catalog's components, and their stylesheet. Each reads
// the board (candidates, the viewed and chosen ones, token support, pins) through
// BoardContext, which board-panel.jsx provides. Look and wording: ../design-contract.md.
import { createContext, useContext, useEffect, useId, useState } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { BOARD_COMPONENT_APIS } from "./board-catalog.mjs";
import { pinLabel, readableColour } from "./board-controls.mjs";

export const BoardContext = createContext(null);
const useBoard = () => useContext(BoardContext);
const api = name => BOARD_COMPONENT_APIS.find(a => a.name === name);

const ALIGN_LABELS = { start: "왼쪽", center: "가운데", end: "오른쪽", stretch: "채움" };

function notice(state) {
  if (state === "ok") return "";
  if (state === "missing" || state === "redeclared") return "이 시안에는 반영되지 않습니다.";
  return "미리보기 반영 불가.";
}

// 4.5:1 is the WCAG minimum for body-size text. A measured shortfall outranks the notice that
// some text could not be measured.
function Contrast({ token, current, onFix }) {
  const { ratio, background, unmeasured, sample } = useBoard().contrastFor(token);
  if (ratio !== undefined && ratio < 4.5) {
    const fix = background ? readableColour(current, background) : null;
    return (
      <div className="pcb-note pcb-contrast">
        {/* Rounded down, so a ratio just under the minimum never displays as 4.5. */}
        <p>이 색과 배경의 대비가 {(Math.floor(ratio * 10) / 10).toFixed(1)}:1입니다.<br />글자에는 4.5:1 이상이 필요합니다.</p>
        {fix && fix !== current ? <button type="button" className="pcb-link pcb-fix" onClick={() => onFix(fix)}>{fix}로 바꾸기</button> : null}
      </div>
    );
  }
  if (!unmeasured) return null;
  const named = sample ? `글자(“${sample.length > 20 ? `${sample.slice(0, 20)}…` : sample}”)` : "글자";
  return <p className="pcb-note pcb-unmeasured"><strong>확인 필요:</strong> 배경 이미지 위 {named}는 대비를 재지 못했습니다. 눈으로 확인해 주세요.</p>;
}

// A line that keeps the height of the tallest text it can show, so a change of text never
// moves what is below it. The other texts sit in the same grid cell as hidden generated
// content, which is neither page text nor in the accessibility tree.
function ReservedLine({ className, texts, shown }) {
  return (
    <div className={`pcb-reserved ${className}`}>
      {texts.map(text => <span key={text} className="pcb-ghost" data-text={text} />)}
      <p>{shown}</p>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg className="pcb-eye" viewBox="0 0 16 16" width="14" height="14">
      <title>보는 중</title>
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

// A token row: label, the control, a reset slot that keeps its width, notice lines below.
function TokenRow({ token, label, changed, onReset, children, extra }) {
  const board = useBoard();
  const state = board.previewState(token);
  // Adjustments apply to the chosen candidate, so they lock while it is not the one on screen.
  const locked = !board.chosen || board.viewed !== board.chosen;
  return (
    <div className="pcb-row" data-pcb-control={token} title={`--${token}`}>
      <span className="pcb-label">{label}</span>
      <div className="pcb-inline">
        {children(locked)}
        <button type="button" className="pcb-reset" data-hidden={!changed || locked} tabIndex={changed && !locked ? 0 : -1} aria-hidden={!changed || locked} disabled={locked} onClick={onReset}>초기화</button>
      </div>
      <p className={state === "ok" ? "pcb-note" : "pcb-note pcb-unavailable"}>{notice(state)}</p>
      {extra}
    </div>
  );
}

const UNCHOSEN = "시안을 채택하면 색·간격·정렬을 조정할 수 있습니다.";
const notChosen = n => `조정은 채택한 시안 ${n}에만 적용됩니다.`;
const applied = n => `조정은 시안 ${n}에 바로 반영됩니다.`;
const show = n => `시안 ${n} 보기`;
// What a send carries, then how many colour tokens fall short of 4.5:1 or could not be measured.
const preview = ({ chosen, adjust, pins, comment, short, unchecked }) => ["시안 " + chosen, adjust ? `조정 ${adjust}개` : "",
  pins ? `위치 ${pins}개` : "", comment ? "코멘트 1개" : "", short ? `대비 경고 ${short}개` : "",
  unchecked ? `대비 확인 ${unchecked}개` : ""].filter(Boolean).join(" · ");
const drops = n => `다시 그리면 시안 ${n} 채택과 조정값은 버려집니다.`;

const CandidatePicker = createComponentImplementation(api("CandidatePicker"), ({ props }) => {
  const board = useBoard();
  return (
    <fieldset className="pcb-field">
      <legend className="pcb-label">{props.label}</legend>
      <div className="pcb-cards">
        {board.candidates.map(c => {
          const viewed = board.viewed === c.n;
          const chosen = props.value === c.n;
          return (
            <button key={c.n} type="button" className="pcb-card" data-candidate={c.n} aria-pressed={chosen} title={`시안 ${c.n} 채택`}
              aria-label={`시안 ${c.n}${viewed ? " 보는 중" : ""}${chosen ? " 채택됨" : ""}`}
              onClick={() => { props.setValue(c.n); board.showCandidate(c.n); }}>
              {viewed ? <EyeIcon /> : null}
              {c.thumbnail ? <img src={c.thumbnail} alt="" /> : null}
              <span className="pcb-number">{c.n}</span>
              <span className={chosen ? "pcb-tag" : "pcb-tag pcb-pick"}>{chosen ? "채택됨" : "채택"}</span>
            </button>
          );
        })}
      </div>
      {/* One note for the whole group of token controls, instead of one under each. */}
      {board.hasTokenControls ? <ReservedLine className="pcb-note" texts={[UNCHOSEN, `${notChosen(board.candidates.length)} ${show(board.candidates.length)}`, applied(board.candidates.length)]}
        shown={board.groupState() === "unchosen" ? UNCHOSEN : board.groupState() === "notChosen"
          ? <>{notChosen(board.chosen)} <button type="button" className="pcb-link" onClick={() => board.showCandidate(board.chosen)}>{show(board.chosen)}</button></>
          : applied(board.chosen)} /> : null}
    </fieldset>
  );
});

const Heading = createComponentImplementation(api("Heading"), ({ props }) =>
  props.level === 2 ? <h3 className="pcb-heading pcb-heading2">{props.text}</h3> : <h2 className="pcb-heading">{props.text}</h2>);

const Hint = createComponentImplementation(api("Hint"), ({ props }) =>
  props.text ? <p className="pcb-hint">{props.text}</p> : null);

const SubmitButton = createComponentImplementation(api("SubmitButton"), ({ props }) => {
  const board = useBoard();
  const blocked = props.isValid === false;
  // A button that drops the choice warns about it; the one that sends it says what goes.
  const note = !board.chosen ? "" : props.dropsChoice ? drops(board.chosen) : preview(board.sending());
  const longest = props.dropsChoice ? drops(board.candidates.length)
    // A token is either short or unchecked; the unchecked wording is the longer one.
    : preview({ chosen: board.candidates.length, adjust: board.tokenCount, unchecked: board.colourCount, pins: board.limits.pins, comment: true });
  const texts = [...board.reasons, longest];
  return (
    <div className="pcb-submit-wrap">
      <button type="button" className={`pcb-submit pcb-${props.variant ?? "primary"}`} disabled={blocked} onClick={() => props.action()}>
        {props.label}
      </button>
      <ReservedLine className="pcb-reason" texts={texts} shown={blocked ? props.validationErrors?.[0] ?? "" : props.dropsChoice && note ? <span className="pcb-caution">{note}</span> : note} />
    </div>
  );
});

// A focused field scrolls clear of the pinned answer area (the panel's scroll-padding).
const reveal = event => event.target.scrollIntoView({ block: "nearest" });

// The label is tied by id, not by wrapping: a wrapping label puts the typed text into the
// field's accessible name in Chromium.
const CommentField = createComponentImplementation(api("CommentField"), ({ props, accessibilityRef }) => {
  const id = useId();
  return (
    <div className="pcb-field">
      <label className="pcb-label" htmlFor={id}>{props.label}</label>
      <textarea id={id} ref={accessibilityRef} className="pcb-comment" rows={4} placeholder={props.placeholder}
        value={props.value ?? ""} onChange={e => props.setValue(e.target.value)} onFocus={reveal} />
    </div>
  );
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const ColorToken = createComponentImplementation(api("ColorToken"), ({ props }) => {
  const current = props.value ?? props.initial;
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(current); setError(false); }, [current]);
  const commit = value => {
    if (!HEX.test(value)) return setError(true);
    setError(false);
    props.setValue(value.toLowerCase() === props.initial.toLowerCase() ? null : value);
  };
  return (
    <TokenRow token={props.token} label={props.label} changed={props.value != null} onReset={() => props.setValue(null)}
      extra={<Contrast token={props.token} current={current} onFix={commit} />}>
      {locked => <>
        <input type="color" className="pcb-swatch" aria-label={`${props.label} 색 선택`} value={current} disabled={locked} onChange={e => commit(e.target.value)} />
        <input type="text" className="pcb-hex" aria-label={`${props.label} hex`} value={draft} spellCheck={false} disabled={locked}
          onChange={e => setDraft(e.target.value)} onBlur={() => commit(draft)} onKeyDown={e => { if (e.key === "Enter") commit(draft); }} />
        {error ? <span className="pcb-reason">#rrggbb 형식으로 적어 주세요.</span> : null}
      </>}
    </TokenRow>
  );
});

const SizeNudge = createComponentImplementation(api("SizeNudge"), ({ props }) => {
  const current = props.value ?? props.initial;
  const [draft, setDraft] = useState(String(current));
  const typed = text => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : current);
  useEffect(() => setDraft(String(current)), [current]);
  const set = value => {
    const clamped = Math.min(props.max, Math.max(props.min, value));
    const next = Math.min(props.max, props.min + Math.round((clamped - props.min) / props.step) * props.step);
    props.setValue(next === props.initial ? null : next);
    setDraft(String(next));
  };
  return (
    <TokenRow token={props.token} label={props.label} changed={props.value != null} onReset={() => props.setValue(null)}>
      {locked => <>
        <button type="button" className="pcb-step" aria-label={`${props.label} 줄이기`} disabled={locked || current <= props.min} onClick={() => set(current - props.step)}>−</button>
        <input type="number" className="pcb-number-field" aria-label={props.label} value={draft} min={props.min} max={props.max} step={props.step} disabled={locked}
          onChange={e => setDraft(e.target.value)} onBlur={() => set(typed(draft))}
          onKeyDown={e => { if (e.key === "Enter") set(typed(draft)); }} />
        <span className="pcb-unit">px</span>
        <button type="button" className="pcb-step" aria-label={`${props.label} 늘리기`} disabled={locked || current >= props.max} onClick={() => set(current + props.step)}>+</button>
      </>}
    </TokenRow>
  );
});

function AlignIcon({ option }) {
  const widths = option === "stretch" ? [16, 16, 16] : [10, 14, 8];
  const x = w => option === "end" ? 18 - w : option === "center" ? 10 - w / 2 : 2;
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {widths.map((w, i) => <rect key={i} x={x(w)} y={3 + i * 5} width={w} height="3" fill="currentColor" />)}
    </svg>
  );
}

const AlignPicker = createComponentImplementation(api("AlignPicker"), ({ props }) => {
  const current = props.value ?? props.initial;
  const labelId = useId();
  const choose = option => props.setValue(option === props.initial ? null : option);
  const move = (event, delta) => {
    event.preventDefault();
    const i = props.options.indexOf(current);
    choose(props.options[(i + delta + props.options.length) % props.options.length]);
  };
  return (
    <TokenRow token={props.token} label={<span id={labelId}>{props.label}</span>} changed={props.value != null} onReset={() => props.setValue(null)}>
      {locked => (
        <div className="pcb-segments" role="radiogroup" aria-labelledby={labelId}>
          {props.options.map(option => (
            <button key={option} type="button" role="radio" aria-checked={current === option} aria-label={ALIGN_LABELS[option]} disabled={locked}
              tabIndex={current === option ? 0 : -1} className="pcb-segment" onClick={() => choose(option)}
              onKeyDown={e => { if (e.key === "ArrowRight" || e.key === "ArrowDown") move(e, 1); if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(e, -1); }}>
              <AlignIcon option={option} />
            </button>
          ))}
        </div>
      )}
    </TokenRow>
  );
});

const RegionNotes = createComponentImplementation(api("RegionNotes"), ({ props }) => {
  const board = useBoard();
  const pins = Array.isArray(props.value) ? props.value : [];
  const full = pins.length >= board.limits.pins;
  const [limitShown, setLimitShown] = useState(false);
  useEffect(() => { if (!full) setLimitShown(false); }, [full]);
  const unavailable = board.bridgeState(board.viewed) !== "connected";
  const toggle = () => { if (!board.togglePinMode()) setLimitShown(true); };
  // The pin-mode instruction lives here, next to the toggle; the candidate shows only a frame.
  // A pin on a candidate other than the chosen one is reference for redrawing the chosen one.
  const elsewhere = board.chosen && board.viewed && board.viewed !== board.chosen ? "채택한 시안이 아니라서 참고 메모로 보냅니다." : "";
  const message = limitShown ? `위치는 ${board.limits.pins}개까지 남길 수 있습니다.` : unavailable ? "미리보기 반영 불가."
    : board.pinMode ? "시안에서 위치를 눌러 주세요 · Esc 취소" : elsewhere;
  return (
    <div className="pcb-field">
      <span className="pcb-label">{props.label}{pins.length ? ` · ${pins.length}개` : ""}</span>
      <div className="pcb-inline">
        <button type="button" className="pcb-toggle" aria-pressed={board.pinMode} disabled={unavailable && !board.pinMode} onClick={toggle}>
          {board.pinMode ? "지정 취소" : "위치 지정"}
        </button>
        {board.viewed ? <span className="pcb-target">시안 {board.viewed}에 남깁니다.</span> : null}
      </div>
      <p className={limitShown || unavailable ? "pcb-note pcb-unavailable" : "pcb-note"}>{message}</p>
      <ol className="pcb-pins">
        {pins.map((pin, i) => (
          <li key={`${pin.candidate}-${pin.selector}-${i}`} className="pcb-pin"
            onMouseEnter={() => board.focusPin(i + 1)} onMouseLeave={() => board.focusPin(0)}
            onFocus={() => board.focusPin(i + 1)} onBlur={() => board.focusPin(0)}>
            <div className="pcb-pin-head">
              <span className="pcb-pin-number" aria-hidden="true">{pinLabel(i)}</span>
              <span className="pcb-pin-where">시안 {pin.candidate} · “{pin.text || pin.selector}”</span>
              <button type="button" className="pcb-reset" aria-label={`위치 ${pinLabel(i)} 삭제`} onClick={() => board.deletePin(i)}>삭제</button>
            </div>
            <textarea rows={2} aria-label={`위치 ${pinLabel(i)} 메모`} placeholder="이 위치에서 바꿀 점을 적어 주세요." value={pin.note} onChange={e => board.setPinNote(i, e.target.value)} onFocus={reveal} />
          </li>
        ))}
      </ol>
    </div>
  );
});

export const BOARD_COMPONENTS = [CandidatePicker, Heading, Hint, SubmitButton, CommentField, ColorToken, SizeNudge, AlignPicker, RegionNotes];

// Basic components render into light DOM with tag-scoped adopted styles, so the a2ui-basic-*
// selectors here override them by specificity.
export const BOARD_CSS = `
.pcb-heading { margin: 0; font-size: 16px; font-weight: 600; color: #fff; }
.pcb-heading2 { font-size: 14px; }
.pcb-hint { margin: 0; color: #b8bec6; font-style: normal; }
.pcb-label { display: block; margin-bottom: 8px; color: #fff; font-weight: 600; }
.pcb-field { margin: 0; padding: 0; border: 0; min-width: 0; display: block; }
.pcb-field legend { padding: 0; }
.pcb-note { margin: 4px 0 0; color: #b8bec6; }
.pcb-note:empty { display: none; }
.pcb-cards { display: flex; flex-wrap: wrap; gap: 8px; }
.pcb-card { position: relative; min-width: 64px; height: 60px; padding: 8px 12px; display: grid; grid-template-rows: 1fr 16px; justify-items: center; align-items: center;
  border: 1px solid #767d87; border-radius: 4px; background: #16191d; color: #fff; font: inherit; cursor: pointer; }
.pcb-card:has(img) { height: auto; grid-template-rows: auto 1fr 16px; }
.pcb-eye { position: absolute; top: 4px; right: 4px; color: #b8bec6; }
.pcb-card[aria-pressed="true"] .pcb-eye { color: #16191d; }
.pcb-card img { max-width: 96px; border-radius: 2px; }
.pcb-card[aria-pressed="true"] { background: #80c8ff; border-color: #80c8ff; color: #16191d; }
.pcb-number { font-size: 16px; font-weight: 600; }
.pcb-tag { font-size: 12px; line-height: 16px; }
.pcb-pick { color: #b8bec6; }
.pcb-field > .pcb-reserved { margin-top: 8px; }
.pcb-submit-wrap { display: grid; gap: 4px; justify-items: start; }
.pcb-submit { min-height: 44px; padding: 14px 16px; border-radius: 4px; font: inherit; font-weight: 600; cursor: pointer; line-height: 1; white-space: nowrap; }
.pcb-primary { background: #fff; color: #16191d; border: 1px solid #fff; }
.pcb-primary:hover:not(:disabled) { background: #e3e6ea; border-color: #e3e6ea; }
.pcb-secondary { background: transparent; color: #fff; border: 1px solid #767d87; font-weight: 500; }
.pcb-caution { color: #ffb4a8; }
.pcb-secondary:hover:not(:disabled) { background: #22272e; }
.pcb-submit:disabled, .pcb-toggle:disabled, .pcb-step:disabled, .pcb-segment:disabled, .pcb-hex:disabled, .pcb-number-field:disabled {
  background: transparent; color: #fff; border-color: #4a5058; opacity: .6; cursor: not-allowed; }
/* A disabled answer button is a flat grey slab, unlike both the white and the outlined ones. */
.pcb-submit:disabled { background: #22272e; border-color: #22272e; color: #b8bec6; opacity: 1; }
.pcb-reason { margin: 0; color: #b8bec6; }
.pcb-reason:empty { display: none; }
.pcb-reserved { display: grid; }
.pcb-reserved > * { grid-area: 1 / 1; margin: 0; }
.pcb-ghost { visibility: hidden; }
.pcb-ghost::before { content: attr(data-text); }
.pcb-unavailable { color: #b8bec6; }
.pcb-contrast { color: #ffb4a8; }
.pcb-contrast p { margin: 0; }
.pcb-fix { margin-top: 2px; color: #ffb4a8; }
.pcb-unmeasured { color: #b8bec6; }
.pcb-unmeasured strong { color: #fff; font-weight: 600; }
/* The sent summary groups each section's lines under its heading. */
aside a2ui-basic-column > a2ui-basic-column { --a2ui-column-gap: 4px; }
/* The panel fills the window, so the answer area sits at its foot even when content is short. */
#panel > a2ui-basic-column { min-height: calc(100dvh - 32px); }
.pcb-comment, .pcb-pin textarea { width: 100%; resize: none; padding: 10px 12px; border: 1px solid #767d87; border-radius: 4px;
  background: #22272e; color: #fff; font: inherit; }
.pcb-comment::placeholder, .pcb-pin textarea::placeholder { color: #b8bec6; }
.pcb-row { display: grid; }
.pcb-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pcb-swatch { width: 32px; height: 32px; padding: 2px; border: 1px solid #767d87; border-radius: 4px; background: none; cursor: pointer; }
.pcb-hex, .pcb-number-field { height: 32px; padding: 0 8px; border: 1px solid #767d87; border-radius: 4px; background: #22272e; color: #fff; font: inherit; }
.pcb-hex { width: 88px; }
.pcb-number-field { width: 64px; }
.pcb-swatch:disabled { border-color: #4a5058; cursor: not-allowed; }
.pcb-reset:disabled { color: #b8bec6; opacity: .6; cursor: not-allowed; }
.pcb-step { width: 32px; height: 32px; border: 1px solid #767d87; border-radius: 4px; background: #16191d; color: #fff; font: inherit; font-size: 16px; cursor: pointer; }
.pcb-unit { color: #b8bec6; }
.pcb-segments { display: inline-flex; border: 1px solid #767d87; border-radius: 4px; overflow: hidden; }
.pcb-segment { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: #16191d; color: #fff; cursor: pointer; }
.pcb-segment + .pcb-segment { border-left: 1px solid #767d87; }
.pcb-segment[aria-checked="true"] { background: #80c8ff; color: #16191d; }
.pcb-segments:has(.pcb-segment:disabled) { border-color: #4a5058; }
.pcb-segment:disabled + .pcb-segment:disabled { border-left-color: #4a5058; }
.pcb-segment[aria-checked="true"]:disabled { background: #4a5058; color: #fff; }
.pcb-toggle { height: 32px; padding: 0 12px; border: 1px solid #767d87; border-radius: 4px; background: transparent; color: #fff; font: inherit; cursor: pointer; }
.pcb-reset { height: 32px; padding: 0 4px; border: 0; background: transparent; color: #b8bec6; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.pcb-reset:hover { color: #fff; }
.pcb-target { color: #b8bec6; }
.pcb-reset[data-hidden="true"] { visibility: hidden; }
.pcb-toggle[aria-pressed="true"] { border: 2px solid #80c8ff; background: rgba(128, 200, 255, .16); }
.pcb-link { padding: 0; border: 0; background: none; color: #fff; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.pcb-pins { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 12px; }
.pcb-pins:empty { display: none; }
.pcb-pin { display: grid; gap: 4px; padding: 8px; border: 1px solid #4a5058; border-radius: 4px; }
.pcb-pin-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pcb-pin-where { flex: 1; min-width: 0; color: #b8bec6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcb-pin-number { flex: none; display: inline-grid; place-items: center; width: 24px; height: 24px; line-height: 24px; border-radius: 50%; background: #ffc24d; color: #16191d;
  font-weight: 600; font-size: 12px; }
aside :is(button, input, textarea, select):focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
aside a2ui-basic-text em { font-style: normal; }
/* The panel title stays in view while the panel scrolls. React hosts are display: contents
   (set inline by the renderer), so the sticky box is the heading inside the first host. */
#panel > a2ui-basic-column > a2ui-react-heading:first-child > .pcb-heading { position: sticky; top: -16px; z-index: 1;
  margin: -16px -16px 0; padding: 16px 16px 8px; background: #16191d; border-bottom: 1px solid #767d87; }
/* The answer buttons stay in reach however long the panel grows. */
aside a2ui-basic-column:has(> a2ui-react-submitbutton) { position: sticky; bottom: -16px; z-index: 1;
  width: calc(100% + 32px); margin: auto -16px -16px; padding: 12px 16px 16px; --a2ui-column-gap: 8px;
  background: #16191d; border-top: 1px solid #767d87; }
/* While the panel scrolls further, content is under the answer area and fades into it; the
   panel's scrollbar stays visible beside it. Scrolled content fades out under the title too. */
aside[data-more-below] a2ui-basic-column:has(> a2ui-react-submitbutton)::before { content: ""; position: absolute; left: 0; right: 0; bottom: calc(100% + 2px); height: 48px;
  background: linear-gradient(rgba(22, 25, 29, 0), #16191d 85%); pointer-events: none; }
/* The answer buttons share one row; under it, one line for each, which names its button. */
aside a2ui-basic-column:has(> a2ui-react-submitbutton) { display: grid; grid-template-columns: auto auto 1fr; column-gap: 8px; row-gap: 4px; align-items: start; }
aside a2ui-basic-column:has(> a2ui-react-submitbutton) .pcb-submit-wrap { display: contents; }
aside a2ui-basic-column > a2ui-react-submitbutton:nth-of-type(1) .pcb-submit { grid-area: 1 / 1; }
aside a2ui-basic-column > a2ui-react-submitbutton:nth-of-type(2) .pcb-submit { grid-area: 1 / 2; }
aside a2ui-basic-column > a2ui-react-submitbutton:nth-of-type(1) .pcb-reason { grid-area: 2 / 1 / 3 / 4; }
aside a2ui-basic-column > a2ui-react-submitbutton:nth-of-type(2) .pcb-reason { grid-area: 3 / 1 / 4 / 4; }
aside[data-scrolled] #panel > a2ui-basic-column > a2ui-react-heading:first-child > .pcb-heading::after { content: ""; position: absolute; left: 0; right: 0; bottom: -33px; height: 32px;
  background: linear-gradient(#16191d 30%, rgba(22, 25, 29, 0)); pointer-events: none; }
`;
