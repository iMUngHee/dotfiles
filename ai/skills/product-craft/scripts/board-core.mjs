// The candidate board's HTTP server, round files and wait logic. Node built-ins only, so
// the Stop-hook tests run without `npm install`; board.mjs adds the A2UI pieces.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SURFACE_ID = "candidate-feedback";
const RESERVED_IDS = ["choice", "comment", "decide", "none"];
const MAX_BODY = 64 * 1024;
const MAX_CANDIDATES = 9; // the viewer switches candidates with the keys 1-9
const VIEWER = fileURLToPath(new URL("../references/candidate-viewer.html", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

export class BoardError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

function relativeFile(value, label) {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.split(/[\\/]/).some(part => part === ".." || part.startsWith("."))) {
    throw new BoardError(`board.json: ${label} must be a relative path inside the board directory without dot segments`);
  }
  return value.replaceAll("\\", "/");
}

export function readBoard(dir) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(dir, "board.json"), "utf8"));
  } catch (error) {
    throw new BoardError(`board.json: ${error.message}`);
  }
  const list = raw?.candidates;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_CANDIDATES) {
    throw new BoardError(`board.json: candidates must list 1-${MAX_CANDIDATES} entries`);
  }
  const candidates = list.map((entry, index) => ({
    path: relativeFile(entry?.path, `candidates[${index}].path`),
    reference: entry?.reference === undefined ? undefined : relativeFile(entry.reference, `candidates[${index}].reference`),
  }));
  const reference = raw.reference === undefined ? undefined : relativeFile(raw.reference, "reference");
  if (reference && candidates.some(c => c.reference)) {
    throw new BoardError("board.json: use either one shared reference or per-candidate references, not both");
  }
  return { candidates, reference, surface: relativeFile(raw.surface ?? "surface.json", "surface") };
}

const urlPath = path => "/" + path.split("/").map(encodeURIComponent).join("/");

export function viewerQuery(board) {
  const query = new URLSearchParams();
  for (const c of board.candidates) query.append("c", urlPath(c.path));
  if (board.reference) query.append("reference", urlPath(board.reference));
  // The viewer pairs references with candidates by position, so a missing one keeps its slot.
  else if (board.candidates.some(c => c.reference)) {
    for (const c of board.candidates) query.append("reference", c.reference ? urlPath(c.reference) : "");
  }
  return query.toString();
}

export function prepareSurface(messages, count) {
  if (!Array.isArray(messages)) throw new BoardError("surface: expected an array of A2UI messages");
  const components = messages.flatMap(m => m?.createSurface?.components ?? m?.updateComponents?.components ?? []);
  const missing = RESERVED_IDS.filter(id => !components.some(c => c?.id === id));
  if (missing.length) throw new BoardError(`surface: missing reserved component ids: ${missing.join(", ")}`);
  const choice = components.find(c => c.id === "choice");
  choice.options = Array.from({ length: count }, (_, i) => ({ label: String(i + 1), value: String(i + 1) }));
  return messages;
}

function checkRound(round) {
  if (typeof round !== "string" || !/^[a-z0-9-]{1,64}$/i.test(round)) throw new BoardError("round must be the id printed by serve");
  return round;
}
const boardFile = (dir, name) => join(dir, ".board", name);
const statePath = (dir, round) => boardFile(dir, `state-${checkRound(round)}.json`);
const answerPath = (dir, round) => boardFile(dir, `answer-${checkRound(round)}.json`);

// 0600: the state file holds the round token.
function writeAtomic(path, text) {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function sameToken(given, token) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateAction(action, count) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return "action must be an object";
  if (action.surfaceId !== SURFACE_ID) return `surfaceId must be ${SURFACE_ID}`;
  const context = action.context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return "context must be an object";
  if (context.comment !== undefined && typeof context.comment !== "string") return "comment must be a string";
  if (action.name === "candidate.decide") {
    if (typeof context.choice !== "string" || !/^[1-9]$/.test(context.choice) || Number(context.choice) > count) {
      return `choice must be a candidate number from 1 to ${count}`;
    }
    if (context.extra !== undefined && (typeof context.extra !== "object" || context.extra === null || Array.isArray(context.extra))) {
      return "extra must be an object";
    }
    return undefined;
  }
  if (action.name === "candidate.none") {
    return typeof context.comment === "string" && context.comment.trim() ? undefined : "say what is wrong in the comment";
  }
  return "name must be candidate.decide or candidate.none";
}

function status(text) {
  return JSON.stringify([{ version: "1.0", updateDataModel: { surfaceId: SURFACE_ID, path: "/status", value: text } }]);
}

// Replaces the form with what was sent, so the panel cannot look editable after the round closed.
function sentSummary(action) {
  const comment = action.context.comment?.trim();
  const head = action.name === "candidate.decide" ? `${action.context.choice}번 시안으로 보냈습니다.` : "전부 아님으로 보냈습니다.";
  const text = (id, value) => ({ id, component: "Text", text: value });
  return JSON.stringify([{
    version: "1.0",
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        { id: "root", component: "Column", children: comment ? ["sentHead", "sentComment", "sentNext"] : ["sentHead", "sentNext"] },
        text("sentHead", head),
        ...(comment ? [text("sentComment", `“${comment}”`)] : []),
        text("sentNext", "에이전트가 이어서 진행합니다. 이 창은 닫아도 됩니다."),
      ],
    },
  }]);
}

const escapeHtml = text => text.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

function wrapperPage({ token, round, query }) {
  const config = JSON.stringify({ token, round }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>시안 선택</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; background: #16191d; color: #fff; font: 16px/1.4 sans-serif; }
  iframe { display: block; width: 100%; height: 100dvh; border: 0; }
  aside { height: 100dvh; overflow: auto; border-left: 1px solid #767d87; padding: 16px; word-break: keep-all; font-size: 14px;
    --a2ui-color-background: #16191d; --a2ui-color-surface: #16191d; --a2ui-color-on-surface: #fff;
    --a2ui-color-on-background: #fff; --a2ui-text-color-text: #fff; --a2ui-text-color: #fff;
    --a2ui-color-border: #767d87; --a2ui-border: 1px solid #767d87;
    --a2ui-color-primary: #80c8ff; --a2ui-color-primary-hover: #a6d8ff; --a2ui-color-primary-dark: #5fb4f5;
    --a2ui-color-primary-light: #80c8ff; --a2ui-color-on-primary: #16191d;
    --a2ui-color-input: #22272e; --a2ui-color-on-input: #fff; --a2ui-textfield-color-border-focus: #80c8ff;
    --a2ui-choicepicker-chip-background-selected: #80c8ff; --a2ui-choicepicker-label-color: #fff;
    --a2ui-border-radius: 4px; --a2ui-textfield-border-radius: 4px; --a2ui-spacing-s: 8px; --a2ui-spacing-m: 16px;
    --a2ui-font-size-s: 14px; --a2ui-font-size-xs: 14px; --a2ui-label-font-size: 14px;
    --a2ui-color-on-secondary: #fff; --a2ui-color-secondary-hover: #22272e;
    --a2ui-button-margin: 0; --a2ui-button-padding: 14px 16px; --a2ui-button-border: 1px solid #767d87;
    --a2ui-choicepicker-chip-padding: 12px 18px; --a2ui-choicepicker-chip-font-size: 14px; --a2ui-choicepicker-gap: 8px; }
  /* Focus rings: the controls draw inside shadow roots, but their hosts are reachable here. */
  aside :is(a2ui-basic-button, a2ui-choicepicker):focus-within { outline: 2px solid #80c8ff; outline-offset: 2px; border-radius: 4px; }
  aside p { margin: 0; color: #b8bec6; }
</style>
<iframe title="시안" src="/__viewer/candidate-viewer.html?${escapeHtml(query)}"></iframe>
<aside aria-label="시안 선택"><p id="loading">보드를 불러오는 중…</p><div id="panel"></div></aside>
<script>window.BOARD = ${config};</script>
<script type="module" src="/__panel.js"></script>
</html>
`;
}

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function serveStatic(dir, pathname, res) {
  const root = resolve(dir);
  const full = resolve(root, "." + pathname);
  const lexical = relative(root, full);
  if (lexical.startsWith("..") || isAbsolute(lexical)) return send(res, 403, "outside the board directory");
  // Dot segments hold the board's own state (.board/) and anything the author hid.
  const hidden = rel => rel.split(sep).some(part => part.startsWith("."));
  if (hidden(lexical)) return send(res, 404, "not found");
  let real;
  try {
    real = realpathSync(full);
  } catch {
    return send(res, 404, "not found");
  }
  const resolved = relative(realpathSync(root), real);
  if (resolved.startsWith("..") || isAbsolute(resolved)) return send(res, 403, "outside the board directory");
  if (hidden(resolved) || !statSync(real).isFile()) return send(res, 404, "not found");
  send(res, 200, readFileSync(real), TYPES[extname(real).toLowerCase()] ?? "application/octet-stream");
}

/**
 * Serves one round of the board and resolves once it is listening. `closed` settles when
 * the server has stopped and its state file is gone; the answer file stays behind.
 */
export async function startBoard({
  dir, board, messages, panel, viewer = VIEWER,
  afterAnswerMs = 30_000, idleMs = 30 * 60_000, listenTimeoutMs = 10_000, beforeListen,
}) {
  const round = randomBytes(6).toString("hex");
  const token = randomBytes(32).toString("hex");
  const query = viewerQuery(board);
  const count = board.candidates.length;
  mkdirSync(join(dir, ".board"), { recursive: true });
  let port;
  let origin;
  let answered = false;
  let bundle;
  let stopping;
  const timers = new Set();
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });

  const server = createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, "wrong host");
    const target = req.url.split("?")[0];
    let pathname;
    try {
      pathname = decodeURIComponent(target);
    } catch {
      return send(res, 400, "bad path");
    }
    if (pathname.includes("\0")) return send(res, 400, "bad path");
    const authorized = sameToken(req.headers["x-board-token"], token);
    if (req.method === "GET" && pathname === "/") return send(res, 200, wrapperPage({ token, round, query }), TYPES[".html"]);
    if (req.method === "GET" && pathname === "/__viewer/candidate-viewer.html") return send(res, 200, readFileSync(viewer), TYPES[".html"]);
    if (req.method === "GET" && pathname === "/__surface.json") return send(res, 200, JSON.stringify(messages), TYPES[".json"]);
    if (req.method === "GET" && pathname === "/__panel.js") {
      bundle ??= panel();
      bundle.then(code => send(res, 200, code, TYPES[".js"]), error => send(res, 500, `panel bundle failed: ${error.message}`));
      return;
    }
    if (pathname === "/__ping") return authorized ? send(res, 200, JSON.stringify({ round }), TYPES[".json"]) : send(res, 403, "token");
    if (req.method === "POST" && pathname === "/__stop") {
      if (!authorized) return send(res, 403, "token");
      send(res, 200, "stopping");
      return void close();
    }
    if (req.method === "POST" && pathname === "/__action") {
      if (!authorized || req.headers.origin !== origin) return send(res, 403, "token or origin");
      const chunks = [];
      let size = 0;
      req.on("data", chunk => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
      });
      req.on("end", () => {
        if (size > MAX_BODY) return send(res, 413, "too large");
        let action;
        try {
          action = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(res, 400, "not JSON");
        }
        if (answered) return send(res, 409, status("이미 전송했습니다."), TYPES[".json"]);
        const problem = validateAction(action, count);
        if (problem) return send(res, 400, problem);
        // Claimed synchronously, before any await, so a second request cannot also pass.
        answered = true;
        try {
          writeAtomic(answerPath(dir, round), JSON.stringify({ ...action, round }) + "\n");
        } catch (error) {
          answered = false;
          return send(res, 500, `could not save the answer: ${error.message}`);
        }
        send(res, 200, sentSummary(action), TYPES[".json"]);
        schedule(afterAnswerMs);
      });
      return;
    }
    if (req.method === "GET" && !pathname.startsWith("/__")) return serveStatic(dir, pathname, res);
    send(res, 404, "not found");
  });

  function schedule(ms) {
    const timer = setTimeout(close, ms);
    timer.unref();
    timers.add(timer);
  }

  function close() {
    stopping ??= new Promise(resolveStop => {
      for (const timer of timers) clearTimeout(timer);
      rmSync(statePath(dir, round), { force: true });
      server.close(() => resolveStop());
      server.closeAllConnections();
    }).then(resolveClosed);
    return closed;
  }

  if (beforeListen) await beforeListen();
  await new Promise((resolveListen, rejectListen) => {
    const timer = setTimeout(() => {
      server.close();
      rejectListen(new BoardError(`could not listen within ${listenTimeoutMs}ms`));
    }, listenTimeoutMs);
    server.once("error", error => {
      clearTimeout(timer);
      rejectListen(new BoardError(`could not listen: ${error.message}`));
    });
    server.listen(0, "127.0.0.1", () => {
      clearTimeout(timer);
      resolveListen();
    });
  });
  port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/`;
  writeAtomic(statePath(dir, round), JSON.stringify({ pid: process.pid, port, url, round, token }));
  schedule(idleMs);
  return { round, token, port, origin, url, close, closed };
}

async function request(url, { token, method = "GET", timeoutMs }) {
  try {
    const response = await fetch(url, {
      method, headers: { "x-board-token": token }, signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    await response.arrayBuffer();
    return { status: response.status, timedOut: false };
  } catch (error) {
    return { status: 0, timedOut: error?.name === "TimeoutError" };
  }
}

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

/**
 * Resolves with {code: 0, answer}, {code: 3} when the timeout passes with the round still
 * open, or {code: 5} when the round ended without an answer.
 */
export async function waitForAnswer({ dir, round, timeoutMs = 540_000, pollMs = 200, afterMiss }) {
  const deadline = Date.now() + timeoutMs;
  const answerFile = answerPath(dir, round);
  const stateFile = statePath(dir, round);
  const answer = () => readJson(answerFile);
  // The answer may have landed while the round was being checked.
  const closedRound = state => {
    const late = answer();
    if (late) return { code: 0, answer: late };
    if (state) rmSync(stateFile, { force: true });
    return { code: 5 };
  };
  let missed = false;
  for (;;) {
    const found = answer();
    if (found) return { code: 0, answer: found };
    if (!missed && afterMiss) {
      missed = true;
      await afterMiss();
    }
    const state = readJson(stateFile);
    const remaining = deadline - Date.now();
    if (state && remaining > 0) {
      const budget = Math.min(2000, remaining);
      const ping = await request(`${state.url}__ping`, { token: state.token, timeoutMs: budget });
      // A ping cut short by our own deadline says nothing about the server: still open.
      const cutByDeadline = ping.timedOut && budget === remaining;
      if (ping.status !== 200 && !cutByDeadline) return closedRound(state);
    } else if (!state) {
      return closedRound(state);
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      const last = answer();
      return last ? { code: 0, answer: last } : { code: 3 };
    }
    await sleep(Math.min(pollMs, left));
  }
}

export async function stopRound({ dir, round }) {
  const stateFile = statePath(dir, round);
  const state = readJson(stateFile);
  if (!state) return { stopped: false };
  const { status } = await request(`${state.url}__stop`, { token: state.token, method: "POST", timeoutMs: 2000 });
  if (status !== 200) rmSync(stateFile, { force: true });
  return { stopped: status === 200 };
}
