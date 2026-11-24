import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readBoard, prepareSurface, viewerQuery, startBoard, waitForAnswer, stopRound, SURFACE_ID,
} from "./board-core.mjs";

const surface = [{
  version: "1.0",
  createSurface: {
    surfaceId: SURFACE_ID,
    catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    components: [
      { id: "root", component: "Column", children: ["choice", "comment", "decide", "none"] },
      { id: "choice", component: "ChoicePicker", options: [], value: { "@path": "/feedback/choice" } },
      { id: "comment", component: "TextField", label: "코멘트", value: { "@path": "/feedback/comment" } },
      { id: "decide", component: "Button", child: "decideLabel", action: { event: { name: "candidate.decide" } } },
      { id: "none", component: "Button", child: "noneLabel", action: { event: { name: "candidate.none" } } },
    ],
  },
}];

async function board(candidates = [{ path: "one.html" }, { path: "two.html" }], extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "board-test-"));
  for (const c of candidates) await writeFile(join(dir, c.path), `<p>${c.path}</p>`);
  await writeFile(join(dir, "surface.json"), JSON.stringify(surface));
  await writeFile(join(dir, "board.json"), JSON.stringify({ candidates, surface: "surface.json", ...extra }));
  return dir;
}

async function serve(dir, options = {}) {
  const config = readBoard(dir);
  const messages = prepareSurface(JSON.parse(await readFile(join(dir, config.surface), "utf8")), config.candidates.length);
  return startBoard({ dir, board: config, messages, panel: async () => "/* panel */", afterAnswerMs: 50, idleMs: 60_000, ...options });
}

function post(running, body, headers = {}) {
  return fetch(`${running.url}__action`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: running.origin, "x-board-token": running.token, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const decide = (choice, comment = "") => ({
  name: "candidate.decide", surfaceId: SURFACE_ID, sourceComponentId: "decide",
  timestamp: new Date().toISOString(), context: { choice, comment, extra: {} },
});
const none = comment => ({
  name: "candidate.none", surfaceId: SURFACE_ID, sourceComponentId: "none",
  timestamp: new Date().toISOString(), context: { comment },
});

test("board.json maps candidates to viewer parameters and keeps empty reference slots", async t => {
  const dir = await board([{ path: "one.html", reference: "one.png" }, { path: "two.html" }]);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const query = new URLSearchParams(viewerQuery(readBoard(dir)));
  assert.deepEqual(query.getAll("c"), ["/one.html", "/two.html"]);
  assert.deepEqual(query.getAll("reference"), ["/one.png", ""]);
});

test("a shared reference is passed once; mixing shared and per-candidate references is rejected", async t => {
  const shared = await board([{ path: "one.html" }, { path: "two.html" }], { reference: "ref.png" });
  const mixed = await board([{ path: "one.html", reference: "a.png" }, { path: "two.html" }], { reference: "ref.png" });
  t.after(() => Promise.all([shared, mixed].map(d => rm(d, { recursive: true, force: true }))));
  assert.deepEqual(new URLSearchParams(viewerQuery(readBoard(shared))).getAll("reference"), ["/ref.png"]);
  assert.throws(() => readBoard(mixed), { code: 2 });
});

test("prepareSurface numbers the choice options and requires the reserved ids", () => {
  const prepared = prepareSurface(structuredClone(surface), 3);
  const choice = prepared[0].createSurface.components.find(c => c.id === "choice");
  assert.deepEqual(choice.options.map(o => o.value), ["1", "2", "3"]);
  const missing = structuredClone(surface);
  missing[0].createSurface.components = missing[0].createSurface.components.filter(c => c.id !== "none");
  assert.throws(() => prepareSurface(missing, 2), { code: 2 });
});

test("the first valid answer closes the round; later posts get 409; wait returns it", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  t.after(() => running.close());
  assert.equal((await post(running, decide("2", "리스트는 1처럼"))).status, 200);
  assert.equal((await post(running, decide("1"))).status, 409);
  const result = await waitForAnswer({ dir, round: running.round, timeoutMs: 1000 });
  assert.equal(result.code, 0);
  assert.equal(result.answer.context.choice, "2");
  assert.equal(result.answer.context.comment, "리스트는 1처럼");
});

test("two concurrent valid posts: exactly one is accepted and it is the stored answer", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  t.after(() => running.close());
  const responses = await Promise.all([post(running, decide("1", "a")), post(running, decide("2", "b"))]);
  const statuses = responses.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = responses.findIndex(r => r.status === 200) === 0 ? "1" : "2";
  const { answer } = await waitForAnswer({ dir, round: running.round, timeoutMs: 1000 });
  assert.equal(answer.context.choice, winner);
});

test("the state file holding the token is readable only by its owner", { skip: process.platform === "win32" && "no mode bits on Windows" }, async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  t.after(() => running.close());
  const { mode } = await (await import("node:fs/promises")).stat(join(dir, ".board", `state-${running.round}.json`));
  assert.equal(mode & 0o777, 0o600);
});

test("an answer submitted before wait starts is returned at once, and again after the server exits", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  await post(running, decide("1"));
  await running.closed;
  assert.equal(existsSync(join(dir, ".board", `state-${running.round}.json`)), false);
  const again = await waitForAnswer({ dir, round: running.round, timeoutMs: 1000 });
  assert.equal(again.code, 0);
  const next = await serve(dir);
  t.after(() => next.close());
  assert.notEqual(next.round, running.round);
  assert.equal((await waitForAnswer({ dir, round: running.round, timeoutMs: 500 })).answer.context.choice, "1");
  assert.equal((await waitForAnswer({ dir, round: next.round, timeoutMs: 300 })).code, 3);
});

test("two boards in one directory keep separate rounds; stop touches only its own", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  const slowStart = serve(dir, { beforeListen: () => paused });
  const fast = await serve(dir, { afterAnswerMs: 60_000 });
  t.after(() => fast.close());
  release();
  const slow = await slowStart;
  t.after(() => slow.close());
  assert.notEqual(slow.round, fast.round);
  await post(fast, decide("2"));
  assert.equal((await waitForAnswer({ dir, round: slow.round, timeoutMs: 200 })).code, 3);
  assert.deepEqual(await stopRound({ dir, round: fast.round }), { stopped: true });
  await fast.closed;
  assert.deepEqual(await stopRound({ dir, round: fast.round }), { stopped: false }, "a stopped round has no state left");
  assert.equal((await fetch(`${slow.url}__ping`, { headers: { "x-board-token": slow.token } })).status, 200);
});

test("wait times out with 3, and ends with 5 when the round closed without an answer", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  assert.equal((await waitForAnswer({ dir, round: running.round, timeoutMs: 200 })).code, 3);
  await running.close();
  assert.equal((await waitForAnswer({ dir, round: running.round, timeoutMs: 1000 })).code, 5);
});

test("a dead server whose state file remains ends wait with 5 and removes the stale state", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".board"), { recursive: true });
  const statePath = join(dir, ".board", "state-dead.json");
  await writeFile(statePath, JSON.stringify({ pid: 1, port: 9, url: "http://127.0.0.1:9/", round: "dead", token: "x" }));
  assert.equal((await waitForAnswer({ dir, round: "dead", timeoutMs: 2000 })).code, 5);
  assert.equal(existsSync(statePath), false);
});

test("an answer saved between the miss and the liveness check is returned, not reported as closed", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  const result = await waitForAnswer({
    dir, round: running.round, timeoutMs: 2000,
    afterMiss: async () => { await post(running, decide("2")); await running.closed; },
  });
  assert.equal(result.code, 0);
  assert.equal(result.answer.context.choice, "2");
});

test("a ping that never answers cannot hold wait past its timeout", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const silent = createServer(() => {});
  await new Promise(resolve => silent.listen(0, "127.0.0.1", resolve));
  t.after(() => silent.close());
  const { port } = silent.address();
  await mkdir(join(dir, ".board"), { recursive: true });
  await writeFile(join(dir, ".board", "state-hang.json"),
    JSON.stringify({ pid: process.pid, port, url: `http://127.0.0.1:${port}/`, round: "hang", token: "x" }));
  const started = Date.now();
  const result = await waitForAnswer({ dir, round: "hang", timeoutMs: 1200 });
  assert.ok(Date.now() - started < 2500, `wait took ${Date.now() - started}ms`);
  assert.equal(result.code, 3, "a ping cut short by the deadline leaves the round open");
  const long = await waitForAnswer({ dir, round: "hang", timeoutMs: 5000 });
  assert.equal(long.code, 5, "two seconds without a reply before the deadline means the server is gone");
});

test("the server stops on its own after an answer and after the idle limit", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const answered = await serve(dir, { afterAnswerMs: 30 });
  await post(answered, decide("1"));
  await answered.closed;
  const idle = await serve(dir, { idleMs: 50 });
  await idle.closed;
  assert.equal(existsSync(join(dir, ".board", `state-${idle.round}.json`)), false);
  assert.equal(existsSync(join(dir, ".board", `answer-${answered.round}.json`)), true);
});

test("/__action requires the round token, the board origin and a body under 64KB", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  t.after(() => running.close());
  assert.equal((await post(running, decide("1"), { "x-board-token": "wrong" })).status, 403);
  assert.equal((await post(running, decide("1"), { origin: "http://evil.example" })).status, 403);
  assert.equal((await post(running, "x".repeat(70_000))).status, 413);
});

test("the server validates the action before closing the round", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  t.after(() => running.close());
  assert.equal((await post(running, decide("3"))).status, 400);
  for (const loose of ["0x2", "2e0", " 2 ", "02", "0"]) assert.equal((await post(running, decide(loose))).status, 400, loose);
  assert.equal((await post(running, none("   "))).status, 400);
  assert.equal((await post(running, { ...decide("1"), name: "candidate.other" })).status, 400);
  assert.equal((await post(running, { ...decide("1"), surfaceId: "elsewhere" })).status, 400);
  assert.equal((await post(running, "not json")).status, 400);
  assert.equal((await post(running, none("둘 다 너무 차가움"))).status, 200);
});

test("static files stay inside the board directory and never expose internal files", async t => {
  const dir = await board();
  const outside = await mkdtemp(join(tmpdir(), "board-outside-"));
  t.after(() => Promise.all([dir, outside].map(d => rm(d, { recursive: true, force: true }))));
  await writeFile(join(outside, "secret.txt"), "secret");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "style.css"), "p{color:red}");
  await writeFile(join(dir, ".hidden"), "hidden");
  await symlink(join(outside, "secret.txt"), join(dir, "escape.txt"));
  const running = await serve(dir);
  t.after(() => running.close());
  await symlink(join(dir, ".board", `state-${running.round}.json`), join(dir, "peek.json"));
  const get = path => fetch(`${running.url}${path}`);
  // fetch normalises dot segments before sending, so traversal goes out byte for byte.
  const { request } = await import("node:http");
  const raw = path => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: running.port, path }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.end();
  });
  assert.equal((await get("assets/style.css")).status, 200);
  assert.equal((await get("one.html")).status, 200);
  assert.equal(await raw("/../secret.txt"), 403);
  assert.equal(await raw("/%2e%2e/secret.txt"), 403);
  assert.equal((await get("escape.txt")).status, 403);
  assert.equal((await get(`.board/state-${running.round}.json`)).status, 404);
  assert.equal((await get(".hidden")).status, 404);
  assert.equal((await get("peek.json")).status, 404);
});

test("requests for another host name are refused", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  t.after(() => running.close());
  const { request } = await import("node:http");
  const status = await new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: running.port, path: "/", headers: { host: "attacker.example" } },
      res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("the wrapper page carries the round token and the viewer address", async t => {
  const dir = await board();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const running = await serve(dir);
  t.after(() => running.close());
  const html = await (await fetch(running.url)).text();
  assert.match(html, new RegExp(running.token));
  assert.match(html, /__viewer\/candidate-viewer\.html\?c=%2Fone\.html&amp;c=%2Ftwo\.html|__viewer\/candidate-viewer\.html\?c=%2Fone\.html&c=%2Ftwo\.html/);
  assert.equal((await fetch(`${running.url}__viewer/candidate-viewer.html`)).status, 200);
});
