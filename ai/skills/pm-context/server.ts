// pm dashboard server over the task-first model. ALL writes go through ops.ts
// (no direct fs writes). The legacy JSON shapes are reproduced from tasks/* so
// roadmap.html needs only minimal rewiring. `handle()` is pure (takes root) for testing.
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";
import * as ops from "../pm-roadmap/ops.ts";
import { nextCandidates, recentClosed, resolveItem, buildNextPrompt, listActiveTasks } from "../pm-roadmap/join.ts";
import { validateRoadmap } from "../pm-roadmap/validate.ts";
import { type Block, parseBlocks, getField, taskFile, readStamped } from "../pm-roadmap/store.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = 8484;

export interface Resp { status: number; json?: unknown; text?: string; }

async function exists(p: string): Promise<boolean> { return stat(p).then(() => true).catch(() => false); }
async function blocksOf(path: string): Promise<Block[]> { const s = await readStamped(path); return s ? parseBlocks(s.content).blocks : []; }
async function findTask(root: string, id: string): Promise<string | null> {
  for (const key of await listActiveTasks(root)) {
    for (const f of ["backlog.md", "closed.md"]) if ((await blocksOf(taskFile(root, key, f))).some((b) => b.id === id)) return key;
  }
  return null;
}

// Pure request handler (root injected) — the http layer below just adapts to it.
export async function handle(root: string, method: string, pathname: string, params: URLSearchParams, body: any): Promise<Resp> {
  // ── derived roadmap view (legacy shape) ──
  if (pathname === "/api/roadmap" && method === "GET") {
    const nc = await nextCandidates(root);
    const open = [...nc.eligible, ...nc.blocked].map((c) => ({ id: c.id, title: c.title, priority: c.priority, status: c.status, order: c.order, task: c.key, plan: c.plan, note: c.note, blockedBy: c.blockedBy }));
    const recentlyClosed = (await recentClosed(root, 50)).map((r) => ({ id: r.id, plan: r.plan, status: r.status, note: r.reason, task: r.key, closed: r.closed }));
    return { status: 200, json: { project: basename(root), focus: nc.focus, updated: "", open, recentlyClosed } };
  }
  if (pathname === "/api/roadmap/validate" && method === "GET") return { status: 200, json: await validateRoadmap(root) };

  // ── next-candidate list (eligible / blocked / focus / inbox), unflattened ──
  if (pathname === "/api/next" && method === "GET") return { status: 200, json: await nextCandidates(root) };

  const rm = pathname.match(/^\/api\/roadmap\/([a-z0-9-]+)\/(join|next)$/);
  if (rm && method === "GET") {
    const key = await findTask(root, rm[1]);
    if (!key) return { status: 404, json: { error: "item not found" } };
    // ?cap=N caps inherited siblings (default 5); ?cap=0 ⇒ all (show-older)
    const capRaw = params.get("cap");
    const cap = capRaw != null && capRaw !== "" && Number.isFinite(Number(capRaw)) ? Number(capRaw) : undefined;
    const v = await resolveItem(root, key, rm[1], cap);
    if (!v) return { status: 404, json: { error: "item not found" } };
    if (rm[2] === "join") {
      // adapt the flat ItemView → showItem's nested shape (item / task / contextLinks / contextMemory),
      // reusing the same Block→object projection as GET /api/tasks. resolveItem stays flat for buildNextPrompt.
      const contextLinks = v.links.map((b) => ({ label: b.id, url: getField(b, "URL") ?? "", triggers: (getField(b, "Triggers") ?? "").split(",").map((s) => s.trim()).filter(Boolean), summary: getField(b, "Summary") ?? "" }));
      const contextMemory = v.memory.map((b) => ({ title: b.id, note: getField(b, "Note") ?? "", date: getField(b, "Date") ?? "" }));
      return { status: 200, json: {
        item: { id: v.id, title: v.title, priority: v.priority, note: v.note, status: v.status, plan: v.plan?.path ?? null, task: v.key },
        closed: v.closed, task: v.key, plan: v.plan,
        contextLinks, contextMemory,
        siblings: v.siblings.map((s) => ({ ...s, status: "done" })), // doneSiblings are all done
        siblingsTotal: v.siblingsTotal,
        postImplNotes: v.plan?.postImplNotes || null, // PlanInfo.postImplNotes; || normalizes placeholder-only "" → null
      } };
    }
    if (v.closed) return { status: 404, json: { error: "closed item — next unavailable" } };
    return { status: 200, text: buildNextPrompt(v, (await nextCandidates(root)).inbox) };
  }

  const drop = pathname.match(/^\/api\/roadmap\/([a-z0-9-]+)\/drop$/);
  if (drop && method === "POST") {
    const key = await findTask(root, drop[1]);
    if (!key) return { status: 404, json: { error: "item not found" } };
    try { await ops.dropItem(root, key, drop[1], { reason: (body && body.reason) || "dropped via GUI" }); return { status: 200, json: { id: drop[1], dropped: true } }; }
    catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
  }

  // ── tasks ──
  if (pathname === "/api/tasks" && method === "GET") {
    const tasks = [];
    for (const key of await listActiveTasks(root)) {
      tasks.push({ key, linkCount: (await blocksOf(taskFile(root, key, "links.md"))).length, memCount: (await blocksOf(taskFile(root, key, "memory.md"))).length });
    }
    return { status: 200, json: tasks };
  }

  const tm = pathname.match(/^\/api\/tasks\/([A-Z0-9_-]+)$/);
  if (tm) {
    const key = tm[1];
    if (method === "GET") {
      if (!(await exists(taskFile(root, key, "task.md")))) return { status: 404, json: { error: "Not found" } };
      const links = (await blocksOf(taskFile(root, key, "links.md"))).map((b) => ({ label: b.id, url: getField(b, "URL") ?? "", triggers: (getField(b, "Triggers") ?? "").split(",").map((s) => s.trim()).filter(Boolean), summary: getField(b, "Summary") ?? "" }));
      const memory = (await blocksOf(taskFile(root, key, "memory.md"))).map((b) => ({ title: b.id, note: getField(b, "Note") ?? "", date: getField(b, "Date") ?? "" }));
      return { status: 200, json: { key, links, memory } };
    }
    if (method === "PUT") {
      const linkBlocks: Block[] = (body?.links ?? []).map((l: any) => ({ id: (l.label ?? "").trim(), title: "", fields: [["URL", (l.url ?? "").trim()], ["Triggers", Array.isArray(l.triggers) ? l.triggers.join(", ") : ""], ["Summary", (l.summary ?? "").trim()]] }));
      const memBlocks: Block[] = (body?.memory ?? []).filter((m: any) => (m.title ?? "").trim()).map((m: any) => ({ id: m.title.trim(), title: "", fields: m.date ? [["Note", (m.note ?? "").trim()], ["Date", m.date]] : [["Note", (m.note ?? "").trim()]] }));
      try {
        if (!(await exists(taskFile(root, key, "task.md")))) await ops.taskCreate(root, key, key);
        await ops.updateTaskLinks(root, key, linkBlocks);
        await ops.updateTaskMemory(root, key, memBlocks);
        return { status: 200, json: { key, links: body?.links ?? [], memory: body?.memory ?? [] } };
      } catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
    }
    if (method === "DELETE") { // delete → archive (data preserved; refuses if open items remain)
      try { await ops.taskArchive(root, key); return { status: 204 }; }
      catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
    }
  }

  // ── focus pointer (item-level): set via ops.focusSet, clear with empty id ──
  if (pathname === "/api/focus" && method === "POST") {
    const id = body && typeof body.id === "string" ? body.id.trim() : "";
    try {
      if (id) await ops.focusSet(root, id); else await ops.focusClear(root);
      return { status: 200, json: { focus: id || null } };
    } catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
  }

  // ── current task: derived from focus (no .current pointer in the new model) ──
  if (pathname === "/api/current") {
    if (method === "GET") {
      const focus = (await readStamped(join(root, ".agents", "state", "focus.txt")))?.content.trim();
      return { status: 200, json: { current: focus ? await findTask(root, focus) : null } };
    }
    if (method === "PUT") return { status: 200, json: { current: (body && body.current) || null } }; // no-op: task is derived
  }

  return { status: 404, text: "Not found" };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { const c: Buffer[] = []; req.on("data", (x) => c.push(x)); req.on("end", () => resolve(Buffer.concat(c).toString())); req.on("error", reject); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = process.env.TASK_CONTEXT_ROOT;
  if (!ROOT) { console.error("TASK_CONTEXT_ROOT not set. Launch via `/pm-context manage` or `/pm-roadmap manage`."); process.exit(1); }
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    if (url.pathname === "/" || url.pathname === "/roadmap") {
      const html = await readFile(join(__dirname, "roadmap.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(html);
    }
    let body: any;
    if (req.method === "PUT" || req.method === "POST") { const raw = await readBody(req); try { body = raw ? JSON.parse(raw) : undefined; } catch { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Invalid JSON" })); } }
    const r = await handle(ROOT, req.method!, url.pathname, url.searchParams, body);
    if (r.text !== undefined) { res.writeHead(r.status, { "Content-Type": "text/plain; charset=utf-8" }); return res.end(r.text); }
    res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(r.json !== undefined ? JSON.stringify(r.json) : "");
  });
  server.listen(PORT, () => console.log(`pm dashboard: http://localhost:${PORT}`));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
