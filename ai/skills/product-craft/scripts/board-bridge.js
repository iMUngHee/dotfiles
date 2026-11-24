// Runs inside a candidate page that board.mjs serves. It applies the panel's token values to
// :root, captures a click as a pin while pin mode is on, and draws pin markers. The board
// prepends `const PCB_LIMITS = {...}` when it serves this file. Messages are
// {pcb: 1, type, candidate, ...}; the panel always sends a full snapshot, so repeats are harmless.
(() => {
  const script = document.currentScript;
  const candidate = script.dataset.candidate;
  const boardOrigin = new URL(script.src).origin;
  const L = PCB_LIMITS;
  const ALIGN = ["start", "center", "end", "stretch"];
  const IDENTIFIER = /^[\p{ID_Start}_][\p{ID_Continue}]*$/u;
  const root = document.documentElement;
  let gotState = false;
  let pinMode = false;
  let pins = [];
  let focus = 0;
  let applied = new Set();
  let layer;
  let frame = 0;

  const post = message => window.top.postMessage({ pcb: 1, candidate, ...message }, boardOrigin);
  const unit = v => typeof v === "number" && v >= 0 && v <= 1;
  const plain = v => typeof v === "object" && v !== null && !Array.isArray(v);
  const onlyKeys = (o, keys) => Object.keys(o).every(k => keys.includes(k));

  // Transport format only; the panel has already checked the values against the controls.
  const tokenValue = v => (typeof v === "string" && (/^#[0-9a-fA-F]{6}$/.test(v) || ALIGN.includes(v)))
    || (Number.isInteger(v) && v >= L.intMin && v <= L.intMax);
  const pinShape = p => plain(p) && onlyKeys(p, ["n", "selector", "ox", "oy", "x", "y", "text"])
    && Number.isInteger(p.n) && p.n >= 1 && p.n <= L.pins
    && typeof p.selector === "string" && p.selector.length > 0 && p.selector.length <= L.selector
    && typeof p.text === "string" && p.text.length <= L.text && unit(p.ox) && unit(p.oy) && unit(p.x) && unit(p.y);
  const isState = d => plain(d) && d.pcb === 1 && d.type === "state" && d.candidate === candidate
    && onlyKeys(d, ["pcb", "type", "candidate", "tokens", "pins", "pinMode", "focus", "measure"]) && typeof d.pinMode === "boolean"
    && Array.isArray(d.measure) && d.measure.length <= L.controls && d.measure.every(k => typeof k === "string" && k.length <= L.tokenLength && IDENTIFIER.test(k))
    && Number.isInteger(d.focus) && d.focus >= 0 && d.focus <= L.pins
    && plain(d.tokens) && Object.entries(d.tokens).every(([k, v]) => k.length <= L.tokenLength && IDENTIFIER.test(k) && tokenValue(v))
    && Array.isArray(d.pins) && d.pins.length <= L.pins && d.pins.every(pinShape);

  function applyTokens(tokens) {
    for (const name of applied) if (!(name in tokens)) root.style.removeProperty(`--${name}`);
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, typeof value === "number" ? `${value}px` : value);
    applied = new Set(Object.keys(tokens));
  }

  const channel = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const rgba = text => {
    const [r, g, b, a = 1] = (text.match(/[\d.]+/g) ?? []).map(Number);
    return [r, g, b, a];
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const over = ([r, g, b, a], base) => [r, g, b].map((c, i) => c * a + base[i] * (1 - a));
  // The colour behind an element's text: its own and its ancestors' background colours,
  // composited from the first opaque one (or the white canvas) up. Null when a background
  // image or gradient is on the way, since its colour under the text is unknown.
  function backgroundOf(el) {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null;
      const layer = rgba(style.backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] >= 1) break;
    }
    return layers.reverse().reduce((base, layer) => over(layer, base), [255, 255, 255]);
  }
  // For each colour token, the lowest contrast between text drawn in that colour and the
  // background behind it, so the panel can warn about a value that makes text unreadable.
  function measureContrast(names) {
    const values = {};
    const unmeasured = new Set();
    for (const name of names) {
      const probe = document.createElement("span");
      probe.style.color = `var(--${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      // Only sRGB serialisations are measured; other colour spaces would be misread.
      if (!colour.startsWith("rgb")) continue;
      const text = rgba(colour);
      let lowest = Infinity;
      for (const el of document.body.querySelectorAll("*")) {
        if (el.closest("#pcb-layer") || !el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.color !== colour) continue;
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const background = backgroundOf(el);
        if (!background) {
          unmeasured.add(name);
          continue;
        }
        const [a, b] = [luminance(over(text, background)), luminance(background)].sort((x, y) => y - x);
        lowest = Math.min(lowest, (a + 0.05) / (b + 0.05));
      }
      if (Number.isFinite(lowest)) values[name] = Math.round(lowest * 1000) / 1000;
    }
    // Sent even when empty, so ratios from an earlier value do not linger in the panel.
    post({ type: "contrast", values, unmeasured: [...unmeasured] });
  }

  function selectorFor(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== root; node = node.parentElement) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const same = [...node.parentElement.children].filter(c => c.tagName === node.tagName);
      parts.unshift(same.length > 1 ? `${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})` : node.tagName.toLowerCase());
    }
    let selector = parts.join(" > ");
    // Keep the tail of the path so a long selector stays valid and near the element.
    while (selector.length > L.selector && parts.length > 1) {
      parts.shift();
      selector = parts.join(" > ");
    }
    // A click on the root itself leaves no path; "html" still names it.
    return selector.slice(0, L.selector) || "html";
  }

  function find(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  const box = (css, text = "") => {
    const el = document.createElement("span");
    el.style.cssText = css;
    el.textContent = text;
    return el;
  };

  function draw() {
    frame = 0;
    if (!layer) return;
    // While pin mode is on, the candidate itself says so: an accent frame and a banner.
    const armed = pinMode ? [
      box("position:absolute;inset:0;box-shadow:inset 0 0 0 3px #80c8ff;"),
      box("position:absolute;bottom:12px;left:12px;padding:6px 12px;border-radius:4px;"
        + "background:#16191d;color:#fff;font:600 13px/1.4 system-ui;box-shadow:0 0 0 1px #80c8ff;", "위치를 눌러 주세요 · Esc 취소"),
    ] : [];
    layer.replaceChildren(...armed, ...pins.flatMap(pin => {
      const el = find(pin.selector);
      let left;
      let top;
      let outline = [];
      if (el) {
        const r = el.getBoundingClientRect();
        left = r.left + pin.ox * r.width;
        top = r.top + pin.oy * r.height;
        // Only the pin whose note the owner is on gets its element outlined.
        if (pin.n === focus) {
          outline = [box(`position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`
            + "outline:2px dashed #ffc24d;outline-offset:2px;")];
        }
      } else {
        left = pin.x * root.scrollWidth - window.scrollX;
        top = pin.y * root.scrollHeight - window.scrollY;
      }
      // A lollipop: the lettered disc on a short stem whose end dot is the exact point. The
      // disc stays tied to its point and clear of the line that was pinned; near the top edge
      // it hangs below instead.
      const flip = top < 40;
      const marker = box(`position:absolute;left:${left - 12}px;top:${flip ? top - 3 : top - 39}px;width:24px;height:42px;`
        + `display:flex;flex-direction:${flip ? "column-reverse" : "column"};align-items:center;`);
      marker.className = "pcb-pin-marker";
      marker.dataset.n = String(pin.n);
      // Lettered like the panel's list (pin.n is 1-based), never numbered like candidates.
      const disc = box("flex:none;width:24px;height:24px;border-radius:50%;background:#ffc24d;color:#16191d;"
        + "box-shadow:0 0 0 2px #16191d;font:600 12px/24px system-ui;text-align:center;", String.fromCharCode(64 + pin.n));
      disc.className = "pcb-pin-disc";
      const stem = box("flex:none;width:2px;height:12px;background:#ffc24d;box-shadow:0 0 0 1px #16191d;");
      const dot = box("flex:none;width:6px;height:6px;border-radius:50%;background:#ffc24d;box-shadow:0 0 0 1.5px #16191d;");
      dot.className = "pcb-pin-dot";
      dot.dataset.n = String(pin.n);
      marker.append(disc, stem, dot);
      return [...outline, marker];
    }));
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };

  function mountLayer() {
    layer = document.createElement("div");
    layer.id = "pcb-layer";
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    document.body.append(layer);
    new ResizeObserver(schedule).observe(root);
    schedule();
  }
  if (document.body) mountLayer();
  else document.addEventListener("DOMContentLoaded", mountLayer, { once: true });
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule);

  addEventListener("message", event => {
    if (event.source !== window.top || event.origin !== boardOrigin || !isState(event.data)) return;
    gotState = true;
    applyTokens(event.data.tokens);
    pins = event.data.pins;
    window.__pcbPins = pins;
    pinMode = event.data.pinMode;
    focus = event.data.focus;
    root.style.cursor = pinMode ? "crosshair" : "";
    schedule();
    const names = event.data.measure;
    if (names.length && document.body) requestAnimationFrame(() => measureContrast(names));
  });

  addEventListener("click", event => {
    if (!pinMode) return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.target instanceof Element ? event.target : root;
    const r = el.getBoundingClientRect();
    const clamp = v => Math.min(1, Math.max(0, v));
    pinMode = false;
    root.style.cursor = "";
    post({
      type: "pin",
      pin: {
        selector: selectorFor(el),
        ox: clamp(r.width ? (event.clientX - r.left) / r.width : 0.5),
        oy: clamp(r.height ? (event.clientY - r.top) / r.height : 0.5),
        x: clamp((event.clientX + window.scrollX) / root.scrollWidth),
        y: clamp((event.clientY + window.scrollY) / root.scrollHeight),
        // innerText keeps the visible breaks (a <br> between name and price) as whitespace.
        text: (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, L.text),
      },
    });
  }, true);

  addEventListener("keydown", event => {
    if (pinMode && event.key === "Escape") post({ type: "pinCancel" });
  });

  // Repeat ready until a snapshot arrives, so a panel that loads late still connects.
  let tries = 0;
  post({ type: "ready" });
  const timer = setInterval(() => {
    if (gotState || ++tries >= 40) return clearInterval(timer);
    post({ type: "ready" });
  }, 250);
})();
