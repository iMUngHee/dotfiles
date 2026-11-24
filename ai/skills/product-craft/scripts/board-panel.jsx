// Browser side of the candidate board: renders the agent's surface with the board catalog,
// keeps the viewer and the candidate bridge in step with it, and posts the owner's action
// back to board.mjs. Bundled by board.mjs serve with esbuild.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { MessageProcessor } from "@a2ui/web_core";
import { A2uiSurface } from "@a2ui/react";
import { buildBoardCatalog } from "./board-catalog.mjs";
import { BOARD_COMPONENTS, BOARD_CSS, BoardContext } from "./board-components.jsx";
import { validatePin, validateTokenValue } from "./board-controls.mjs";

const HEX_COLOUR = /^#[0-9a-f]{6}$/;

const SURFACE_ID = "candidate-feedback";
const config = window.BOARD;
const HTML = /\.html?$/i;
const READY_TIMEOUT_MS = 3000;
// Observable for the journey tests: candidates whose bridge answered, and handler errors.
window.__pcbConnected = new Set();
window.__pcbErrors = [];

const viewerFrame = document.querySelector("iframe");
const viewerDoc = () => viewerFrame.contentDocument;
const candidateFrame = () => viewerDoc()?.querySelector("section.candidate iframe");
const viewedNumber = () => viewerDoc()?.documentElement.dataset.candidate;
const showCandidate = n => viewerDoc()?.querySelectorAll("nav button")[Number(n) - 1]?.click();

// Board state outside the A2UI data model: which candidate is on screen, bridge state, pin mode.
// revision counts data model changes the panel shows outside A2UI bindings (the send preview).
const store = { state: { viewed: undefined, chosen: "", bridge: {}, pinMode: false, focus: 0, contrast: {}, revision: 0 }, listeners: new Set() };
const bump = () => setState({ revision: store.state.revision + 1 });
const COLOUR_TOKENS = Object.entries(config.controls).filter(([, c]) => c.kind === "color").map(([name]) => name);
const setState = patch => {
  store.state = { ...store.state, ...patch };
  for (const listener of store.listeners) listener();
};
const subscribeStore = listener => {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
};

const status = value => [{ version: "1.0", updateDataModel: { surfaceId: SURFACE_ID, path: "/status", value } }];
const processor = new MessageProcessor([buildBoardCatalog(BOARD_COMPONENTS, args => showCandidate(args.number))], async action => {
  // A send ends pin mode, so a click on the candidate after it adds nothing.
  if (store.state.pinMode) setPinMode(false);
  try {
    const response = await fetch("/__action", {
      method: "POST",
      headers: { "content-type": "application/json", "x-board-token": config.token },
      body: JSON.stringify(action),
    });
    const isJson = (response.headers.get("content-type") ?? "").startsWith("application/json");
    processor.processMessages(isJson ? await response.json() : status(await response.text()));
    // After a send the viewer shows what was sent, so the page agrees with the summary.
    if (response.ok && action.name === "candidate.decide") showCandidate(action.context.choice);
    // After a send the viewer is read-only, so nothing done there looks like it still counts.
    if (response.ok) viewerDoc()?.documentElement.setAttribute("data-locked", "");
  } catch {
    processor.processMessages(status("보드가 닫혔습니다. 대화창에서 답해 주세요."));
  }
});

let model;
const data = path => model?.dataModel.get(path);

function snapshot(n) {
  // Adjustments belong to the chosen candidate; other candidates show as written.
  const adjust = n === store.state.chosen ? data("/adjust") ?? {} : {};
  const tokens = Object.fromEntries(Object.entries(adjust).filter(([name, value]) => {
    const control = config.controls[name];
    return control && validateTokenValue(control, value);
  }));
  const pins = (data("/pins") ?? []).flatMap((p, i) => p.candidate === n
    ? [{ n: i + 1, selector: p.selector, ox: p.ox, oy: p.oy, x: p.x, y: p.y, text: p.text }] : []);
  // Only tokens this candidate declares on :root are measured; an undeclared var() would measure body text.
  const measure = COLOUR_TOKENS.filter(name => config.support[name]?.[n] === "ok");
  return { pcb: 1, type: "state", candidate: n, tokens, pins, pinMode: store.state.pinMode, focus: store.state.focus, measure };
}

function sendState() {
  const n = store.state.viewed;
  const frame = candidateFrame();
  // The candidate frame has an opaque origin, which no targetOrigin can name; the snapshot holds no secrets.
  if (n && frame && store.state.bridge[n] === "connected") frame.contentWindow.postMessage(snapshot(n), "*");
}

const setPinMode = on => {
  setState({ pinMode: on });
  sendState();
};

function addPin(n, pin) {
  const pins = data("/pins") ?? [];
  if (pins.length >= config.limits.pins) return;
  // Pin mode ends before /pins changes, so the snapshot that change sends never re-arms it.
  setState({ pinMode: false });
  model.dataModel.set("/pins", [...pins, { candidate: n, ...pin, note: "" }]);
}

const MESSAGE_KEYS = {
  ready: ["pcb", "type", "candidate"], pinCancel: ["pcb", "type", "candidate"],
  pin: ["pcb", "type", "candidate", "pin"], contrast: ["pcb", "type", "candidate", "values", "unmeasured", "backgrounds", "samples"],
};
const contrastValues = v => typeof v === "object" && v !== null && !Array.isArray(v)
  && Object.entries(v).every(([name, ratio]) => COLOUR_TOKENS.includes(name) && typeof ratio === "number" && ratio >= 1 && ratio <= 21);
const plain = v => typeof v === "object" && v !== null && !Array.isArray(v);
const unmeasuredNames = v => Array.isArray(v) && v.length <= config.limits.controls && new Set(v).size === v.length
  && v.every(name => COLOUR_TOKENS.includes(name));
function isBridgeMessage(d) {
  if (typeof d !== "object" || d === null || d.pcb !== 1 || !MESSAGE_KEYS[d.type]) return false;
  if (typeof d.candidate !== "string" || !/^[1-9]$/.test(d.candidate)) return false;
  const keys = Object.keys(d);
  if (keys.length !== MESSAGE_KEYS[d.type].length || !keys.every(k => MESSAGE_KEYS[d.type].includes(k))) return false;
  if (d.type === "contrast") {
    return contrastValues(d.values) && unmeasuredNames(d.unmeasured)
      && plain(d.backgrounds) && Object.entries(d.backgrounds).every(([name, hex]) => COLOUR_TOKENS.includes(name) && typeof hex === "string" && HEX_COLOUR.test(hex))
      && plain(d.samples) && Object.entries(d.samples).every(([name, text]) => d.unmeasured.includes(name) && typeof text === "string" && text.length <= config.limits.text);
  }
  return d.type !== "pin" || validatePin(d.pin);
}

addEventListener("message", event => {
  try {
    const frame = candidateFrame();
    if (!frame || event.source !== frame.contentWindow || !isBridgeMessage(event.data)) return;
    const { type, candidate, pin, values, unmeasured, backgrounds, samples } = event.data;
    if (candidate !== viewedNumber() || candidate !== store.state.viewed) return;
    if (type === "ready") {
      setState({ bridge: { ...store.state.bridge, [candidate]: "connected" } });
      window.__pcbConnected.add(candidate);
      sendState();
    } else if (type === "contrast") {
      // A report replaces the candidate's last one whole, so an empty report clears it.
      setState({ contrast: { ...store.state.contrast, [candidate]: { values, unmeasured, backgrounds, samples } } });
    } else if (type === "pin") {
      if (store.state.pinMode) addPin(candidate, pin);
    } else {
      setPinMode(false);
    }
  } catch (error) {
    window.__pcbErrors.push(String(error));
  }
});

let readyTimer;
function onViewed(n) {
  if (!n || n === store.state.viewed) return;
  clearTimeout(readyTimer);
  window.__pcbConnected.delete(n);
  const candidate = config.candidates.find(c => c.n === n);
  const image = candidate && !HTML.test(candidate.path);
  setState({ viewed: n, pinMode: false, bridge: { ...store.state.bridge, [n]: image ? "unavailable" : "waiting" } });
  if (!image) {
    readyTimer = setTimeout(() => {
      if (store.state.bridge[n] === "waiting") setState({ bridge: { ...store.state.bridge, [n]: "unavailable" } });
    }, READY_TIMEOUT_MS);
  }
}

// The viewer's number buttons carry the choice too, so the two rows of numbers agree.
function markChosen() {
  viewerDoc()?.querySelectorAll("nav button").forEach((button, i) => {
    const chosen = String(i + 1) === store.state.chosen;
    button.toggleAttribute("data-chosen", chosen);
    button.title = chosen ? `시안 ${i + 1} · 채택됨` : "";
  });
}

function watchViewer() {
  const doc = viewerDoc();
  if (!doc?.documentElement.dataset.candidate) {
    viewerFrame.addEventListener("load", watchViewer, { once: true });
    return;
  }
  onViewed(doc.documentElement.dataset.candidate);
  markChosen();
  new MutationObserver(() => onViewed(doc.documentElement.dataset.candidate))
    .observe(doc.documentElement, { attributes: true, attributeFilter: ["data-candidate"] });
}

function Panel() {
  const [surface, setSurface] = useState();
  const board = useSyncExternalStore(subscribeStore, () => store.state);
  useEffect(() => {
    fetch("/__surface.json")
      .then(response => response.json())
      .then(messages => {
        processor.processMessages(messages);
        model = processor.model.surfacesMap.get(SURFACE_ID);
        model.dataModel.subscribe("/adjust", () => { sendState(); bump(); });
        model.dataModel.subscribe("/pins", () => { sendState(); bump(); });
        model.dataModel.subscribe("/feedback/comment", bump);
        model.dataModel.subscribe("/feedback/choice", value => {
          setState({ chosen: typeof value === "string" ? value : "" });
          sendState();
          markChosen();
        });
        setSurface(model);
        document.getElementById("loading").remove();
        watchViewer();
      });
  }, []);
  const context = useMemo(() => ({
    candidates: config.candidates,
    limits: config.limits,
    viewed: board.viewed,
    chosen: board.chosen,
    pinMode: board.pinMode,
    // Reads the store, not the rendered value, so a quick second press is not taken as a cancel.
    togglePinMode: () => {
      if (store.state.pinMode) return setPinMode(false), true;
      if ((data("/pins") ?? []).length >= config.limits.pins) return false;
      setPinMode(true);
      return true;
    },
    showCandidate,
    bridgeState: n => board.bridge[n],
    contrastFor: tokenName => {
      const report = board.chosen && board.viewed === board.chosen ? board.contrast[board.chosen] : undefined;
      return {
        ratio: report?.values[tokenName], background: report?.backgrounds[tokenName],
        unmeasured: report?.unmeasured.includes(tokenName) ?? false, sample: report?.samples[tokenName],
      };
    },
    reasons: config.reasons,
    sending: () => ({
      chosen: board.chosen,
      adjust: Object.values(data("/adjust") ?? {}).filter(v => v !== null && v !== undefined).length,
      pins: (data("/pins") ?? []).length,
      comment: Boolean(String(data("/feedback/comment") ?? "").trim()),
      short: Object.values(board.contrast[board.chosen]?.values ?? {}).filter(ratio => ratio < 4.5).length,
      unchecked: (board.contrast[board.chosen]?.unmeasured ?? []).filter(name => !((board.contrast[board.chosen].values[name] ?? 5) < 4.5)).length,
    }),
    groupState: () => !board.chosen ? "unchosen" : board.viewed !== board.chosen ? "notChosen" : "ok",
    previewState: tokenName => {
      if (!board.chosen || board.viewed !== board.chosen) return "ok";
      const supported = config.support[tokenName]?.[board.chosen];
      if (supported && supported !== "ok") return supported;
      return board.bridge[board.chosen] === "unavailable" ? "unavailable" : "ok";
    },
    // Whole-array writes: the /pins binding does not re-render on a change below it.
    focusPin: n => {
      setState({ focus: n });
      sendState();
    },
    hasTokenControls: Object.keys(config.controls).length > 0,
    tokenCount: Object.keys(config.controls).length,
    colourCount: COLOUR_TOKENS.length,
    setPinNote: (i, note) => model.dataModel.set("/pins", (data("/pins") ?? []).map((p, k) => k === i ? { ...p, note: note.slice(0, config.limits.note) } : p)),
    deletePin: i => model.dataModel.set("/pins", (data("/pins") ?? []).filter((_, k) => k !== i)),
  }), [board]);
  return surface ? <BoardContext.Provider value={context}><A2uiSurface surface={surface} /></BoardContext.Provider> : null;
}

// The answer area shows a cue while the panel can scroll further, which is when content sits
// under it. Scroll, size and content changes (surface, pins, sent summary) all recompute it.
function trackOverflow() {
  const aside = document.querySelector("aside");
  const update = () => {
    aside.toggleAttribute("data-more-below", aside.scrollTop + aside.clientHeight < aside.scrollHeight - 1);
    aside.toggleAttribute("data-scrolled", aside.scrollTop > 0);
  };
  aside.addEventListener("scroll", update, { passive: true });
  const resize = new ResizeObserver(update);
  resize.observe(aside);
  resize.observe(document.getElementById("panel"));
  new MutationObserver(update).observe(aside, { childList: true, subtree: true });
  update();
}
trackOverflow();

const style = document.createElement("style");
style.textContent = BOARD_CSS;
document.head.append(style);
createRoot(document.getElementById("panel")).render(<Panel />);
