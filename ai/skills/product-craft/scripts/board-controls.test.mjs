import assert from "node:assert/strict";
import test from "node:test";
import {
  LIMITS, extractControls, validateAdjust, validatePins, validateTokenValue, tokenSupport, hasCspMeta,
} from "./board-controls.mjs";

const SURFACE_ID = "candidate-feedback";
const surface = extra => [{
  version: "1.0",
  createSurface: {
    surfaceId: SURFACE_ID,
    catalogId: "product-craft/board/v1",
    components: [
      { id: "root", component: "Column", children: ["choice", "comment", "decide", "none", ...extra.map(c => c.id)] },
      { id: "choice", component: "CandidatePicker", label: "채택할 시안", value: { "@path": "/feedback/choice" } },
      { id: "comment", component: "CommentField", label: "코멘트", value: { "@path": "/feedback/comment" } },
      { id: "decide", component: "SubmitButton", label: "보내기", action: { event: { name: "candidate.decide" } } },
      { id: "none", component: "SubmitButton", label: "전부 아님", action: { event: { name: "candidate.none" } } },
      ...extra,
    ],
  },
}];
const color = (token, initial = "#03c75a") => ({ id: `c${token}`, component: "ColorToken", token, label: token, initial, value: { "@path": `/adjust/${token}` } });
const size = (token, o = {}) => ({ id: `s${token}`, component: "SizeNudge", token, label: token, initial: 16, min: 0, max: 64, step: 4, value: { "@path": `/adjust/${token}` }, ...o });
const align = (token, o = {}) => ({ id: `a${token}`, component: "AlignPicker", token, label: token, initial: "start", options: ["start", "center", "end"], value: { "@path": `/adjust/${token}` }, ...o });
const regions = { id: "pins", component: "RegionNotes", label: "영역", value: { "@path": "/pins" } };

test("extractControls reads each token control and whether pins are on the surface", () => {
  const controls = extractControls(surface([color("accent"), size("gap"), align("align"), regions]));
  assert.deepEqual([...controls.tokens.keys()].sort(), ["accent", "align", "gap"]);
  assert.deepEqual(controls.tokens.get("gap"), { kind: "size", label: "gap", initial: 16, min: 0, max: 64, step: 4 });
  assert.equal(controls.tokens.get("accent").kind, "color");
  assert.deepEqual(controls.tokens.get("align").options, ["start", "center", "end"]);
  assert.equal(controls.pins, true);
  assert.equal(extractControls(surface([])).pins, false);
});

test("extractControls rejects controls that break the contract, with code 2", () => {
  const bad = [
    [size("gap", { initial: 18 })], // off the step grid
    [size("gap", { initial: 80 })], // above max
    [size("gap", { min: 10, max: 10 })], // min not below max
    [size("gap", { step: 0 })],
    [size("gap", { max: 66 })], // max off the step grid
    [size("gap", { step: 1.5 })], // not an integer
    [size("gap", { min: -10001 })], // beyond the integer limit
    [align("align", { options: [] })],
    [align("align", { initial: "end", options: ["start", "center"] })],
    [align("align", { options: ["start", "start"] })],
    [align("align", { options: ["start", "middle"] })],
    [color("accent", "red")],
    [color("accent"), size("accent")], // one token, two controls
    [color("x".repeat(LIMITS.tokenLength + 1))],
    [color("with-hyphen")],
    [{ ...color("accent"), value: { "@path": "/adjust/other" } }],
    Array.from({ length: LIMITS.controls + 1 }, (_, i) => color(`t${i}`)),
  ];
  for (const extra of bad) assert.throws(() => extractControls(surface(extra)), { code: 2 }, JSON.stringify(extra));
  extractControls(surface([color("x".repeat(LIMITS.tokenLength)), size("big", { min: LIMITS.intMin, max: LIMITS.intMax, step: 1, initial: LIMITS.intMax })]));
});

test("validateAdjust accepts only declared tokens with values their control allows", () => {
  const controls = extractControls(surface([color("accent"), size("gap"), align("align")]));
  assert.equal(validateAdjust({}, controls), undefined);
  assert.equal(validateAdjust({ accent: "#3b82f6", gap: 24, align: "center" }, controls), undefined);
  for (const bad of [{ radius: 4 }, { accent: "#3b82f" }, { accent: "blue" }, { gap: 22 }, { gap: 68 }, { gap: "24" }, { align: "stretch" }, [], null, "x"]) {
    assert.equal(typeof validateAdjust(bad, controls), "string", JSON.stringify(bad));
  }
});

test("validateTokenValue is the same rule the panel uses before previewing", () => {
  const controls = extractControls(surface([size("gap")]));
  assert.equal(validateTokenValue(controls.tokens.get("gap"), 24), true);
  assert.equal(validateTokenValue(controls.tokens.get("gap"), 25), false);
});

test("validatePins checks the round-wide count and every field", () => {
  const pin = (over = {}) => ({ candidate: "1", selector: "header > h1", ox: 0.1, oy: 0.5, x: 0.4, y: 0.06, text: "스토어", note: "더 작게", ...over });
  assert.equal(validatePins([pin(), pin({ candidate: "2" })], 2), undefined);
  assert.equal(validatePins(Array.from({ length: LIMITS.pins }, (_, i) => pin({ candidate: String(1 + (i % 2)) })), 2), undefined);
  const bad = [
    Array.from({ length: LIMITS.pins + 1 }, () => pin()),
    [pin({ candidate: "3" })], [pin({ candidate: 1 })], [pin({ x: 1.2 })], [pin({ oy: -0.1 })],
    [pin({ note: "x".repeat(LIMITS.note + 1) })], [pin({ selector: "x".repeat(LIMITS.selector + 1) })],
    [pin({ text: "x".repeat(LIMITS.text + 1) })], [pin({ extra: 1 })], [{ candidate: "1" }], [null], "pins",
  ];
  for (const pins of bad) assert.equal(typeof validatePins(pins, 2), "string", JSON.stringify(pins).slice(0, 80));
});

test("tokenSupport accepts only tokens declared on :root and not redeclared elsewhere", () => {
  const one = "<style>:root { --accent: #03c75a; --gap: 16px; --align: start; } .row { gap: var(--gap); }</style>";
  const two = "<style>:root{--accent:#111;--align:center}.card{--accent:red;color:var(--accent)}</style>";
  const shot = { image: true };
  const csp = '<meta http-equiv="Content-Security-Policy" content="script-src none"><style>:root{--accent:#000}</style>';
  const table = tokenSupport({ 1: one, 2: two, 3: shot, 4: csp }, ["accent", "gap", "align", "radius"]);
  assert.deepEqual(table.accent, { 1: "ok", 2: "redeclared", 3: "image", 4: "csp" });
  assert.deepEqual(table.gap, { 1: "ok", 2: "missing", 3: "image", 4: "csp" });
  assert.deepEqual(table.align, { 1: "ok", 2: "ok", 3: "image", 4: "csp" });
  assert.deepEqual(table.radius, { 1: "missing", 2: "missing", 3: "image", 4: "csp" });
});

test("hasCspMeta finds the meta in any case and attribute order", () => {
  assert.equal(hasCspMeta('<META content="x" HTTP-EQUIV="content-security-policy">'), true);
  assert.equal(hasCspMeta('<meta name="viewport" content="width=device-width">'), false);
});
