import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const skip = process.platform === "win32" ? "POSIX executable fixtures; native Windows smoke pending" : false;

async function fixture(t, { alias = "teva", mode = "ok", currentName = "other", pagerOutput = "pager-output\n" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pager-name-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const log = join(root, "calls");
  const requests = [];
  const sockets = new Set();
  const server = createServer();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    if (mode === "timeout") return;
    if (mode === "unavailable") return socket.destroy();
    const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const shortLength = pending[1] & 127;
        if (shortLength === 126 && pending.length < 4) return;
        const length = shortLength === 126 ? pending.readUInt16BE(2) : shortLength;
        const offset = shortLength === 126 ? 4 : 2;
        if (pending.length < offset + 4 + length) return;
        const opcode = pending[0] & 15;
        const mask = pending.subarray(offset, offset + 4);
        const body = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
        pending = pending.subarray(offset + 4 + length);
        if (opcode !== 1) continue;
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
        const message = JSON.parse(body.toString());
        requests.push(message);
        if (message.id === undefined) continue;
        const response = Buffer.from(JSON.stringify(mode === "error" && message.method === "thread/name/set"
          ? { id: message.id, error: { message: "test refusal" } }
          : { id: message.id, result: message.method === "thread/read" ? { thread: { id: message.params.threadId, name: currentName } } : {} }));
        assert.ok(response.length < 126);
        socket.write(Buffer.concat([Buffer.from([129, response.length]), response]));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await writeFile(join(bin, "pager"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'hook') {
  fs.appendFileSync(${JSON.stringify(log)}, fs.readFileSync(0, 'utf8') + '\\n');
  process.stdout.write(${JSON.stringify(pagerOutput)});
} else console.log(${JSON.stringify(`name:    ${alias || "none — it is assigned once a hook runs with the host detected"}\r`)});
`, { mode: 0o755 });
  await writeFile(join(bin, "codex"), `#!/usr/bin/env node
const socket = require('node:net').connect(${server.address().port}, '127.0.0.1');
process.stdin.pipe(socket); socket.pipe(process.stdout);
socket.on('error', () => process.exit(1));
`, { mode: 0o755 });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return {
    requests,
    async run(payload, wrapper = false) {
      const child = spawn(wrapper ? "bash" : process.execPath, [join(here, wrapper ? "pager-hook.sh" : "pager-session-name.mjs")], {
        env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}` },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (data) => stdout += data);
      child.stderr.on("data", (data) => stderr += data);
      child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      const code = await new Promise((resolve) => child.on("close", resolve));
      return { code, stdout, stderr, calls: await readFile(log, "utf8").catch(() => "") };
    },
  };
}

test("SessionStart preserves pager delivery and renames the exact hook session", { skip }, async (t) => {
  const f = await fixture(t);
  const payload = { hook_event_name: "SessionStart", session_id: "exact-hook-session" };
  const result = await f.run(payload, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "pager-output\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(result.calls.trim().split("\n").map(JSON.parse), [
    ["hook"], payload, ["whoami", "--session", "exact-hook-session"],
  ]);
  assert.deepEqual(f.requests.map((r) => r.method), ["initialize", "initialized", "thread/read", "thread/name/set"]);
  assert.deepEqual(f.requests.at(-1).params, { threadId: "exact-hook-session", name: "teva" });
});

test("other events and missing session IDs never rename", { skip }, async (t) => {
  const f = await fixture(t);
  for (const payload of [
    { hook_event_name: "PostToolUse", session_id: "other" },
    { hook_event_name: "Stop", session_id: "other" },
    { hook_event_name: "SessionStart" },
  ]) {
    assert.equal((await f.run(payload)).code, 0);
  }
  assert.deepEqual(f.requests, []);
});

test("the next prompt restores a renamed thread and preserves mail", { skip }, async (t) => {
  const f = await fixture(t, { currentName: "renamed-by-user" });
  const result = await f.run({ hook_event_name: "UserPromptSubmit", session_id: "s" }, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "pager-output\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(f.requests.at(-1)?.params, { threadId: "s", name: "teva" });
});

test("an already matching name needs no write or adapter output", { skip }, async (t) => {
  const f = await fixture(t, { currentName: "teva" });
  const result = await f.run({ hook_event_name: "UserPromptSubmit", session_id: "s" });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(f.requests.map((r) => r.method), ["initialize", "initialized", "thread/read"]);
});

test("a consumed poke keeps its exact block JSON and does not run the adapter", { skip }, async (t) => {
  const pagerOutput = JSON.stringify({ decision: "block", reason: "already handled" }) + "\n";
  const f = await fixture(t, { pagerOutput });
  const result = await f.run({ hook_event_name: "UserPromptSubmit", session_id: "s" }, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, pagerOutput);
  assert.equal(result.stderr, "");
  assert.deepEqual(f.requests, []);
  assert.equal(result.calls.includes("whoami"), false);
});

test("custom aliases retain spaces and quotes", { skip }, async (t) => {
  const alias = "my session 'quoted'";
  const f = await fixture(t, { alias });
  const result = await f.run({ hook_event_name: "SessionStart", session_id: "s" });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(f.requests.at(-1).params, { threadId: "s", name: alias });
});

test("an unassigned pager name does not replace the thread name", { skip }, async (t) => {
  const f = await fixture(t, { alias: "" });
  assert.equal((await f.run({ hook_event_name: "SessionStart", session_id: "s" })).code, 0);
  assert.deepEqual(f.requests, []);
});

test("server errors remain nonfatal and visible", { skip }, async (t) => {
  const f = await fixture(t, { mode: "error" });
  const result = await f.run({ hook_event_name: "SessionStart", session_id: "s" }, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "pager-output\n");
  assert.match(result.stderr, /test refusal/);
});

test("an unresponsive server cannot hold startup indefinitely", { skip }, async (t) => {
  const f = await fixture(t, { mode: "timeout" });
  const start = Date.now();
  const result = await f.run({ hook_event_name: "SessionStart", session_id: "s" });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /timed out/);
  assert.ok(Date.now() - start < 5000);
});

test("an unavailable server does not block pager delivery", { skip }, async (t) => {
  const f = await fixture(t, { mode: "unavailable" });
  const result = await f.run({ hook_event_name: "SessionStart", session_id: "s" }, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "pager-output\n");
  assert.match(result.stderr, /pager session name: local app-server (connection failed|proxy closed)/);
});

test("malformed hook input fails open", { skip }, async (t) => {
  const f = await fixture(t);
  const result = await f.run("{");
  assert.equal(result.code, 0);
  assert.match(result.stderr, /pager session name:/);
});

test("the registered startup command invokes the non-executable wrapper with Bash", async () => {
  const template = await readFile(join(here, "..", "config.toml.template"), "utf8");
  const startup = template.split("[[hooks.SessionStart.hooks]]")[1].split("[[hooks.SessionStart.hooks]]")[0];
  assert.match(startup, /command = "bash /);
  assert.match(startup, /pager-hook\.sh/);
  assert.match(template, /status_line = \[\s*"thread-name"/);
  assert.equal(template.match(/command = "bash .*pager-hook/g)?.length, 2);
});
