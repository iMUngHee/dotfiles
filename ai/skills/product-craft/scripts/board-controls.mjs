// The adjustment controls' contract: limits, what a surface declares, what an answer may
// carry, and which candidates can preview a token. Node built-ins only; the panel bundle
// imports it too, so the browser checks values by the same rules as the server.

export const LIMITS = Object.freeze({
  tokenLength: 30, intMin: -10000, intMax: 10000, pins: 20, selector: 300, text: 120, note: 500,
});
export const ALIGN_OPTIONS = Object.freeze(["start", "center", "end", "stretch"]);
const TOKEN_KINDS = { ColorToken: "color", SizeNudge: "size", AlignPicker: "align" };
const HEX = /^#[0-9a-fA-F]{6}$/;
// UAX #31 identifiers, as the protocol requires of ids; tokens become CSS custom property names too.
const IDENTIFIER = /^[\p{ID_Start}_][\p{ID_Continue}]*$/u;
const PIN_KEYS = ["candidate", "selector", "ox", "oy", "x", "y", "text", "note"];

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.code = 2;
  }
}

const isInt = v => Number.isInteger(v) && v >= LIMITS.intMin && v <= LIMITS.intMax;
const isObject = v => typeof v === "object" && v !== null && !Array.isArray(v);
const unit = v => typeof v === "number" && v >= 0 && v <= 1;

function readControl(c) {
  const where = `component ${c.id} (${c.component})`;
  if (typeof c.token !== "string" || c.token.length > LIMITS.tokenLength || !IDENTIFIER.test(c.token)) {
    throw new ContractError(`${where}: token must be an identifier of at most ${LIMITS.tokenLength} characters`);
  }
  if (c.value?.["@path"] !== `/adjust/${c.token}` || Object.keys(c.value).length !== 1) {
    throw new ContractError(`${where}: value must be {"@path": "/adjust/${c.token}"}`);
  }
  const kind = TOKEN_KINDS[c.component];
  // A literal label names the token in the sent summary; a bound one falls back to the token.
  const label = typeof c.label === "string" ? c.label : c.token;
  if (kind === "color") {
    if (!HEX.test(c.initial)) throw new ContractError(`${where}: initial must be #rrggbb`);
    return { kind, label, initial: c.initial };
  }
  if (kind === "size") {
    const { min, max, step, initial } = c;
    if (![min, max, step, initial].every(isInt) || !(min < max) || !(step > 0) || initial < min || initial > max
      || (initial - min) % step !== 0 || (max - min) % step !== 0) {
      throw new ContractError(`${where}: min, max, step and initial must be integers within ±${LIMITS.intMax} with min < max, step > 0, and initial and max on the step grid from min`);
    }
    return { kind, label, initial, min, max, step };
  }
  const { options, initial } = c;
  if (!Array.isArray(options) || options.length === 0 || new Set(options).size !== options.length
    || !options.every(o => ALIGN_OPTIONS.includes(o)) || !options.includes(initial)) {
    throw new ContractError(`${where}: options must be distinct values from ${ALIGN_OPTIONS.join("/")} and include initial`);
  }
  return { kind, label, initial, options: [...options] };
}

/** Reads the token controls a surface declares and whether it lets the owner pin places. */
export function extractControls(messages) {
  const components = messages.flatMap(m => m?.createSurface?.components ?? m?.updateComponents?.components ?? []);
  const tokens = new Map();
  for (const c of components) {
    if (!TOKEN_KINDS[c?.component]) continue;
    const control = readControl(c);
    if (tokens.has(c.token)) throw new ContractError(`token ${c.token} has more than one control`);
    tokens.set(c.token, control);
  }
  return { tokens, pins: components.some(c => c?.component === "RegionNotes") };
}

export function validateTokenValue(control, value) {
  if (control.kind === "color") return typeof value === "string" && HEX.test(value);
  if (control.kind === "size") {
    return Number.isInteger(value) && value >= control.min && value <= control.max && (value - control.min) % control.step === 0;
  }
  return control.options.includes(value);
}

/** Returns a reason the adjustments are not acceptable, or undefined. */
export function validateAdjust(adjust, controls) {
  if (!isObject(adjust)) return "adjust must be an object";
  for (const [token, value] of Object.entries(adjust)) {
    const control = controls.tokens.get(token);
    if (!control) return `adjust.${token} is not a token this board offers`;
    if (!validateTokenValue(control, value)) return `adjust.${token} is outside what its control allows`;
  }
  return undefined;
}

export function validatePin(pin) {
  if (!isObject(pin)) return false;
  const keys = Object.keys(pin);
  return typeof pin.selector === "string" && pin.selector.length > 0 && pin.selector.length <= LIMITS.selector
    && typeof pin.text === "string" && pin.text.length <= LIMITS.text
    && unit(pin.ox) && unit(pin.oy) && unit(pin.x) && unit(pin.y)
    && keys.every(k => ["selector", "ox", "oy", "x", "y", "text"].includes(k)) && keys.length === 6;
}

/** Returns a reason the round's pins are not acceptable, or undefined. */
export function validatePins(pins, count) {
  if (!Array.isArray(pins)) return "pins must be an array";
  if (pins.length > LIMITS.pins) return `at most ${LIMITS.pins} pins per round`;
  for (const [i, p] of pins.entries()) {
    if (!isObject(p) || Object.keys(p).length !== PIN_KEYS.length || !PIN_KEYS.every(k => k in p)) return `pins[${i}] must have exactly ${PIN_KEYS.join(", ")}`;
    if (typeof p.candidate !== "string" || !/^[1-9]$/.test(p.candidate) || Number(p.candidate) > count) return `pins[${i}].candidate must be a candidate number`;
    if (typeof p.note !== "string" || p.note.length > LIMITS.note) return `pins[${i}].note must be text of at most ${LIMITS.note} characters`;
    const { candidate, note, ...located } = p;
    if (!validatePin(located)) return `pins[${i}] has an out-of-range position or an over-long selector or text`;
  }
  return undefined;
}

export function hasCspMeta(html) {
  return /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy/i.test(html);
}

function styleText(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

function supportFor(html, token) {
  const declaration = new RegExp(`--${token}\\s*:`);
  let onRoot = false;
  for (const rule of styleText(html).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!declaration.test(rule[2])) continue;
    if (rule[1].trim() === ":root") onRoot = true;
    else return "redeclared";
  }
  return onRoot ? "ok" : "missing";
}

/**
 * Per token and candidate: "ok" when the candidate declares the token on :root and nowhere
 * else in its inline styles (the bridge writes :root only), otherwise "missing",
 * "redeclared", "csp" (the bridge is not injected) or "image" (no document to reach).
 * `sources` maps candidate numbers to HTML text, or to {image: true}.
 */
export function tokenSupport(sources, tokens) {
  const table = {};
  for (const token of tokens) {
    table[token] = {};
    for (const [n, source] of Object.entries(sources)) {
      table[token][n] = typeof source !== "string" ? "image" : hasCspMeta(source) ? "csp" : supportFor(source, token);
    }
  }
  return table;
}
