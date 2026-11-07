// Copy the pager alias into the local daemon's thread name at startup/prompts.
// Keep pager delivery independent of this optional, bounded UI update.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!["SessionStart", "UserPromptSubmit"].includes(input.hook_event_name) || !input.session_id) process.exit(0);
  const identity = execFileSync("pager", ["whoami", "--session", input.session_id], {
    encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "pipe"],
  });
  const name = /^name:[ \t]+([\s\S]*)/m.exec(identity)?.[1].trim();
  if (!name || name === "none — it is assigned once a hook runs with the host detected") process.exit(0);

  let finished = false;
  let ws;
  const sockets = new Set();
  const children = new Set();
  const token = randomUUID();
  // The CLI proxy carries raw WebSocket bytes over stdio. Bridge one loopback
  // connection so Node's built-in WebSocket can handle framing without a package.
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", (error) => finish(error.message));
    let header = "";
    socket.on("data", (chunk) => {
      header += chunk.toString();
      if (header.length > 16384) return socket.destroy();
      if (!header.includes("\r\n\r\n")) return;
      if (!header.startsWith(`GET /${token} HTTP/1.1\r\n`)) return socket.destroy();
      server.close();
      socket.removeAllListeners("data");
      const stdio = ["pipe", "pipe", "pipe"];
      // Windows: the npm-installed codex is a codex.cmd shim, which spawn cannot
      // run without a shell (ENOENT). One command string, not shell + args,
      // which Node deprecates (DEP0190); the arguments are fixed. cmd.exe looks
      // in its working directory before PATH, so run it from this hook's own
      // directory, not the session's repository, where a codex.cmd would win.
      const child = process.platform === "win32"
        ? spawn("codex app-server proxy", { shell: true, stdio, cwd: fileURLToPath(new URL(".", import.meta.url)) })
        : spawn("codex", ["app-server", "proxy"], { stdio });
      children.add(child);
      child.stdin.write(header);
      socket.pipe(child.stdin);
      child.stdout.pipe(socket);
      child.stderr.resume();
      child.stdin.on("error", (error) => finish(error.message));
      child.on("error", (error) => finish(error.message));
      child.on("exit", () => finish("local app-server proxy closed"));
    });
  });
  const timer = setTimeout(() => finish("local app-server timed out"), 3000);
  // This callback is shared by transport, protocol and timeout completion paths.
  function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (error) console.error(`pager session name: ${error}`);
    ws?.close();
    for (const socket of sockets) socket.destroy();
    // Close the pipes before the kill: on Windows the kill reaches only the
    // shell, and a proxy that outlived it would hold this process open.
    for (const child of children) {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.kill();
    }
    server.close();
  }
  server.on("error", (error) => finish(error.message));
  server.listen(0, "127.0.0.1", () => {
    ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/${token}`);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: "initialize",
      params: { clientInfo: { name: "pager-session-name", version: "1.0.0" } },
    }));
    ws.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.error) return finish(message.error.message ?? "name update failed");
        if (message.id === 1) {
          ws.send(JSON.stringify({ method: "initialized" }));
          ws.send(JSON.stringify({
            id: 2, method: "thread/read", params: { threadId: input.session_id, includeTurns: false },
          }));
        } else if (message.id === 2) {
          const thread = message.result?.thread;
          if (!thread || thread.id !== input.session_id) return finish("thread metadata unavailable");
          if (thread.name === name) return finish();
          ws.send(JSON.stringify({
            id: 3, method: "thread/name/set", params: { threadId: input.session_id, name },
          }));
        } else if (message.id === 3) finish();
      } catch (error) {
        finish(error.message);
      }
    };
    ws.onerror = () => finish("local app-server connection failed");
    ws.onclose = () => finish("local app-server connection closed");
  });
} catch (error) {
  console.error(`pager session name: ${error.message}`);
}
