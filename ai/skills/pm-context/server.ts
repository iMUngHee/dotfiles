// pm dashboard server over the task-first model. ALL writes go through ops.ts
// (no direct fs writes). The legacy JSON shapes are reproduced from tasks/* so
// roadmap.html needs only minimal rewiring. `handle()` is pure (takes root) for testing.
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";
import * as ops from "../pm-roadmap/ops.ts";
import { nextCandidates, recentClosed, resolveCurrentPlan, resolveItem, buildNextPrompt, listActiveTasks, planInfo } from "../pm-roadmap/join.ts";
import { requireActor, resolveActorSource } from "../pm-roadmap/actor.ts";
import { validateRoadmap } from "../pm-roadmap/validate.ts";
import { type Block, parseBlocks, parseFrontmatter, getField, getFmField, taskFile, readStamped, inboxPath } from "../pm-roadmap/store.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PORT = 8484;

export interface Resp { status: number; json?: unknown; text?: string; }

async function exists(p: string): Promise<boolean> { return stat(p).then(() => true).catch(() => false); }
async function blocksOf(path: string): Promise<Block[]> { const s = await readStamped(path); return s ? parseBlocks(s.content).blocks : []; }
function resolvePort(): number {
  const raw = process.env.TASK_CONTEXT_PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}
async function findTask(root: string, id: string): Promise<string | null> {
  for (const key of await listActiveTasks(root)) {
    for (const f of ["backlog.md", "closed.md"]) if ((await blocksOf(taskFile(root, key, f))).some((b) => b.id === id)) return key;
  }
  return null;
}

// Pure request handler (root injected) — the http layer below just adapts to it.
export async function handle(root: string, method: string, pathname: string, params: URLSearchParams, body: any): Promise<Resp> {
  if (pathname === "/api/actor" && method === "GET") return { status: 200, json: resolveActorSource(root) };

  // ── derived roadmap view ──
  if (pathname === "/api/roadmap" && method === "GET") {
    const nc = await nextCandidates(root);
    // open[] additive plan projection: next action plus the immutable-base/worktree mapping, so the
    // dock can show where an existing plan resumes without a per-item join. Missing/unreadable plans
    // degrade to empty mapping fields. join remains authoritative for the full PlanInfo object.
    const open = await Promise.all([...nc.eligible, ...nc.blocked].map(async (c) => {
      let info = null;
      if (c.plan) { try { info = planInfo(c.plan, await readFile(join(root, c.plan), "utf-8")); } catch { info = null; } }
      return {
        id: c.id, title: c.title, priority: c.priority, status: c.status, order: c.order,
        task: c.key, plan: c.plan, nextStep: info?.nextStep ?? null,
        baseBranch: info?.baseBranch ?? "", baseCommit: info?.baseCommit ?? "",
        branch: info?.branch ?? "", worktree: info?.worktree ?? "",
        note: c.note, blockedBy: c.blockedBy, dependsOn: c.dependsOn,
        owner: c.owner, ownerNote: c.ownerNote, mode: c.mode,
      };
    }));
    const recentlyClosed = (await recentClosed(root, 50)).map((r) => ({ id: r.id, plan: r.plan, status: r.status, note: r.reason, task: r.key, closed: r.closed }));
    const current = await resolveCurrentPlan(root, nc);
    const currentPlan = current.state === "linked"
      ? { ...current, item: { ...current.item, task: current.item.key } }
      : current;
    return { status: 200, json: { project: basename(root), currentPlan, updated: "", open, recentlyClosed } };
  }
  if (pathname === "/api/roadmap/validate" && method === "GET") return { status: 200, json: await validateRoadmap(root) };

  // ── next-candidate list (eligible / blocked / inbox), unflattened ──
  if (pathname === "/api/next" && method === "GET") return { status: 200, json: await nextCandidates(root) };

  if (pathname === "/api/current-plan/next" && method === "GET") {
    const nc = await nextCandidates(root);
    const current = await resolveCurrentPlan(root, nc);
    if (current.state === "linked") {
      const item = await resolveItem(root, current.item.key, current.item.id);
      return item ? { status: 200, text: buildNextPrompt(item, nc.inbox) } : { status: 409, json: { error: "current plan item is unavailable" } };
    }
    if (current.state === "standalone") {
      const plan = current.plan;
      return { status: 200, text: [
        `# Resume: ${plan.title || plan.id}`,
        `> plan: ${plan.path}`,
        `> branch: ${plan.branch} · worktree: ${plan.worktree}`,
        "",
        plan.nextStep ? `Next step: ${plan.nextStep}` : "No unchecked implementation step.",
        "",
        `codex -C ${plan.worktree}`,
        `cd ${plan.worktree} && claude`,
        "/design continue",
      ].join("\n") };
    }
    return current.state === "empty"
      ? { status: 404, json: { error: "no current plan" } }
      : { status: 409, json: { error: `current plan is stale: ${current.reason}` } };
  }

  // ── inbox contents (read-only; /api/next carries only the count). Triage stays CLI-only. ──
  if (pathname === "/api/inbox" && method === "GET") {
    const items = (await blocksOf(inboxPath(root))).map((b) => ({ id: b.id, title: b.title, priority: getField(b, "Priority") ?? "", note: getField(b, "Note") ?? "" }));
    return { status: 200, json: items };
  }

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
      const contextLinks = v.links.map((b) => ({ label: b.id, url: getField(b, "URL") ?? "", triggers: (getField(b, "Triggers") ?? "").split(",").map((s) => s.trim()).filter(Boolean), summary: getField(b, "Summary") ?? "", by: getField(b, "By") ?? "" }));
      const contextMemory = v.memory.map((b) => ({ title: b.id, note: getField(b, "Note") ?? "", date: getField(b, "Date") ?? "", by: getField(b, "By") ?? "" }));
      return { status: 200, json: {
        item: { id: v.id, title: v.title, priority: v.priority, note: v.note, status: v.status, plan: v.plan?.path ?? null, task: v.key, owner: v.owner, ownerNote: v.ownerNote, mode: v.mode, dependsOn: v.dependsOn },
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

  const organize = pathname.match(/^\/api\/roadmap\/([a-z0-9-]+)\/(reprioritize|reorder|depend)$/);
  if (organize && method === "POST") {
    const id = organize[1], action = organize[2];
    const key = await findTask(root, id);
    if (!key) return { status: 404, json: { error: "item not found" } };
    try {
      if (action === "reprioritize") {
        if (typeof body?.priority !== "string") return { status: 400, json: { error: "priority is required" } };
        await ops.itemSetPriority(root, key, id, body.priority);
        return { status: 200, json: { id, priority: body.priority } };
      }
      if (action === "reorder") {
        if (typeof body?.order !== "string" && typeof body?.order !== "number") return { status: 400, json: { error: "order is required" } };
        const order = String(body.order);
        await ops.itemSetOrder(root, key, id, order);
        return { status: 200, json: { id, order } };
      }
      if (!Array.isArray(body?.dependsOn) || body.dependsOn.some((value: unknown) => typeof value !== "string")) {
        return { status: 400, json: { error: "dependsOn must be a string array" } };
      }
      await ops.itemSetDeps(root, key, id, body.dependsOn);
      return { status: 200, json: { id, dependsOn: body.dependsOn } };
    } catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
  }

  const ownership = pathname.match(/^\/api\/roadmap\/([a-z0-9-]+)\/(claim|release|handoff)$/);
  if (ownership && method === "POST") {
    const id = ownership[1], action = ownership[2];
    const key = await findTask(root, id);
    if (!key) return { status: 404, json: { error: "item not found" } };
    try {
      if (action === "claim") {
        const actor = requireActor(root, {}, "claim");
        await ops.itemSetOwner(root, key, id, actor);
        return { status: 200, json: { id, owner: actor } };
      }
      const expectedOwner = typeof body?.expectedOwner === "string" ? body.expectedOwner.trim() : "";
      if (!expectedOwner) return { status: 400, json: { error: "expectedOwner is required" } };
      if (action === "release") {
        await ops.itemSetOwner(root, key, id, "-", { expectedOwner });
        return { status: 200, json: { id, owner: null } };
      }
      const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
      if (!owner || owner === "-") return { status: 400, json: { error: "handoff owner is required" } };
      await ops.itemSetOwner(root, key, id, owner, { expectedOwner, note: typeof body?.note === "string" ? body.note : undefined });
      return { status: 200, json: { id, owner } };
    } catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
  }

  // ── tasks ──
  if (pathname === "/api/tasks" && method === "POST") {
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!/^[A-Z0-9_-]+$/.test(key)) return { status: 400, json: { error: "key must match [A-Z0-9_-]+" } };
    try {
      await ops.taskCreate(root, key, title || key);
      return { status: 201, json: { key, title: title || key } };
    } catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
  }

  if (pathname === "/api/tasks" && method === "GET") {
    const tasks = [];
    for (const key of await listActiveTasks(root)) {
      const meta = await readStamped(taskFile(root, key, "task.md"));
      const fields = meta ? parseFrontmatter(meta.content).fields : [];
      tasks.push({
        key,
        title: getFmField(fields, "title") ?? key,
        status: getFmField(fields, "status") ?? "active",
        mode: getFmField(fields, "mode") || "solo",
        collaborators: (getFmField(fields, "collaborators") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
        openCount: (await blocksOf(taskFile(root, key, "backlog.md"))).length,
        closedCount: (await blocksOf(taskFile(root, key, "closed.md"))).length,
        linkCount: (await blocksOf(taskFile(root, key, "links.md"))).length,
        memCount: (await blocksOf(taskFile(root, key, "memory.md"))).length,
      });
    }
    return { status: 200, json: tasks };
  }

  const itemCreate = pathname.match(/^\/api\/tasks\/([A-Z0-9_-]+)\/items$/);
  if (itemCreate && method === "POST") {
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !title) return { status: 400, json: { error: "valid id and title are required" } };
    try {
      await ops.itemAdd(root, { task: itemCreate[1] }, { id, title, priority: body?.priority, order: body?.order == null ? undefined : String(body.order), note: body?.note });
      return { status: 201, json: { id, task: itemCreate[1] } };
    } catch (e: any) { return { status: 409, json: { error: e?.message ?? String(e) } }; }
  }

  const tm = pathname.match(/^\/api\/tasks\/([A-Z0-9_-]+)$/);
  if (tm) {
    const key = tm[1];
    if (method === "GET") {
      if (!(await exists(taskFile(root, key, "task.md")))) return { status: 404, json: { error: "Not found" } };
      const closedRaw = params.get("closed");
      const closedLimit = closedRaw == null ? null : Number(closedRaw);
      if (closedRaw != null && (!/^\d+$/.test(closedRaw) || !Number.isSafeInteger(closedLimit))) {
        return { status: 400, json: { error: "closed must be a non-negative integer" } };
      }
      const links = (await blocksOf(taskFile(root, key, "links.md"))).map((b) => ({ label: b.id, url: getField(b, "URL") ?? "", triggers: (getField(b, "Triggers") ?? "").split(",").map((s) => s.trim()).filter(Boolean), summary: getField(b, "Summary") ?? "", by: getField(b, "By") ?? "" }));
      const memory = (await blocksOf(taskFile(root, key, "memory.md"))).map((b) => ({ title: b.id, note: getField(b, "Note") ?? "", date: getField(b, "Date") ?? "", by: getField(b, "By") ?? "" }));
      const meta = await readStamped(taskFile(root, key, "task.md"));
      const fields = meta ? parseFrontmatter(meta.content).fields : [];
      const open = (await blocksOf(taskFile(root, key, "backlog.md"))).map((b) => ({
        id: b.id, title: b.title, priority: getField(b, "Priority") ?? "P2", status: getField(b, "Status") ?? "open",
        order: Number(getField(b, "Order") ?? 0), plan: getField(b, "Plan") ?? null, note: getField(b, "Note") ?? "",
        owner: getField(b, "Owner") ?? "", ownerNote: getField(b, "OwnerNote") ?? "",
        dependsOn: (getField(b, "DependsOn") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      }));
      let closedProjection = {};
      if (closedLimit != null) {
        const allClosed = (await blocksOf(taskFile(root, key, "closed.md"))).map((b) => ({
          id: b.id, title: b.title, status: getField(b, "Status") ?? "", plan: getField(b, "Plan") ?? null,
          closed: getField(b, "Closed") ?? "", reason: getField(b, "Reason") ?? "",
        })).sort((a, b) => b.closed.localeCompare(a.closed));
        closedProjection = { closed: closedLimit === 0 ? allClosed : allClosed.slice(0, closedLimit), closedTotal: allClosed.length };
      }
      return { status: 200, json: {
        key, title: getFmField(fields, "title") ?? key, status: getFmField(fields, "status") ?? "active",
        mode: getFmField(fields, "mode") || "solo",
        collaborators: (getFmField(fields, "collaborators") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
        open, links, memory, ...closedProjection,
      } };
    }
    if (method === "PUT") {
      // Preserve collab `By` attribution: the GUI doesn't author By, so re-attach it by id from
      // the on-disk blocks — otherwise a full-state PUT would erase every By field (data loss).
      const curLinks = await blocksOf(taskFile(root, key, "links.md"));
      const curMem = await blocksOf(taskFile(root, key, "memory.md"));
      const byOf = (blocks: Block[], id: string): string | null => { const b = blocks.find((x) => x.id.toLowerCase() === id.toLowerCase()); return b ? getField(b, "By") : null; };
      const linkBlocks: Block[] = (body?.links ?? []).map((l: any) => {
        const id = (l.label ?? "").trim();
        const fields: [string, string][] = [["URL", (l.url ?? "").trim()], ["Triggers", Array.isArray(l.triggers) ? l.triggers.join(", ") : ""], ["Summary", (l.summary ?? "").trim()]];
        const by = byOf(curLinks, id); if (by) fields.push(["By", by]);
        return { id, title: "", fields };
      });
      const memBlocks: Block[] = (body?.memory ?? []).filter((m: any) => (m.title ?? "").trim()).map((m: any) => {
        const id = m.title.trim();
        const fields: [string, string][] = m.date ? [["Note", (m.note ?? "").trim()], ["Date", m.date]] : [["Note", (m.note ?? "").trim()]];
        const by = byOf(curMem, id); if (by) fields.push(["By", by]);
        return { id, title: "", fields };
      });
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

  return { status: 404, text: "Not found" };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { const c: Buffer[] = []; req.on("data", (x) => c.push(x)); req.on("end", () => resolve(Buffer.concat(c).toString())); req.on("error", reject); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = process.env.TASK_CONTEXT_ROOT;
  if (!ROOT) { console.error("TASK_CONTEXT_ROOT not set. Launch via `/pm-context manage` or `/pm-roadmap manage`."); process.exit(1); }
  const port = resolvePort();
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://localhost:${port}`);
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
  server.listen(port, () => console.log(`pm dashboard: http://localhost:${port}`));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
