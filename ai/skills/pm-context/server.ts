import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, writeFile, unlink, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap, serializeRoadmap } from "../pm-roadmap/roadmap.ts";
import { resolveJoin, resolveClosedJoin, buildNextPrompt, selectTarget, inboxCount } from "../pm-roadmap/join.ts";
import { validateRoadmap } from "../pm-roadmap/validate.ts";
import { readTaskMemory, writeTaskMemory, memoryFilePath, ensureMemoryIgnored } from "../pm-roadmap/memory.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Project-scoped storage: tasks live at <git-root>/.agents/task-context/,
// where the git root is passed via TASK_CONTEXT_ROOT (captured by the launcher
// BEFORE it cd's into this skill dir). No global fallback — refuse if unset.
const PROJECT_ROOT = process.env.TASK_CONTEXT_ROOT;
if (!PROJECT_ROOT) {
  console.error(
    "TASK_CONTEXT_ROOT is not set. Launch via `/pm-context manage` or `/pm-roadmap manage` from inside a git repo.",
  );
  process.exit(1);
}
const TASKS_DIR = join(PROJECT_ROOT, ".agents", "task-context");
const CURRENT_FILE = join(TASKS_DIR, ".current");
const ROADMAP_FILE = join(PROJECT_ROOT, ".agents", "ROADMAP.md");
const PORT = 8484;

await mkdir(TASKS_DIR, { recursive: true });

interface Link {
  label: string;
  url: string;
  triggers: string[];
  summary: string;
}

// A task's per-task memory: decisions / things to remember, treated as context
// alongside external links (the ## Memory section of a task-context file).
interface Memory {
  title: string;
  note: string;
  date: string;
}

// A task-context file = external Links (top-level blocks) + a ## Memory section.
function parseTask(content: string): { links: Link[]; memory: Memory[] } {
  const links: Link[] = [];
  const memory: Memory[] = [];
  let inMemory = false;
  let link: Link | null = null;
  let mem: Memory | null = null;
  const flushLink = () => { if (link) links.push(link); link = null; };
  const flushMem = () => { if (mem) memory.push(mem); mem = null; };

  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const h = line.match(/^##\s+(.*)$/);
    if (h) { flushLink(); flushMem(); inMemory = h[1].trim().toLowerCase().startsWith("memory"); continue; }
    const top = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (top) {
      flushLink(); flushMem();
      if (inMemory) mem = { title: top[1].trim(), note: "", date: "" };
      else link = { label: top[1].trim(), url: "", triggers: [], summary: "" };
      continue;
    }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
    if (sub) {
      const key = sub[1].toLowerCase();
      const value = sub[2].trim();
      if (inMemory && mem) {
        if (key === "note") mem.note = value;
        else if (key === "date") mem.date = value;
      } else if (link) {
        if (key === "url") link.url = value;
        else if (key === "triggers") link.triggers = value ? value.split(",").map((t) => t.trim()).filter(Boolean) : [];
        else if (key === "summary") link.summary = value;
      }
    }
  }
  flushLink(); flushMem();
  return { links, memory };
}

function toTaskMd(key: string, links: Link[], memory: Memory[]): string {
  const lines = [`# ${key}`, ""];
  for (const l of links) {
    lines.push(`- **${l.label}**`, `  - URL: ${l.url}`, `  - Triggers: ${l.triggers.join(", ")}`, `  - Summary: ${l.summary}`);
  }
  if (links.length) lines.push("");
  if (memory.length) {
    lines.push("## Memory", "");
    for (const m of memory) {
      lines.push(`- **${m.title}**`, `  - Note: ${m.note}`);
      if (m.date) lines.push(`  - Date: ${m.date}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function validate(links: Link[]): string | null {
  const labels = new Set<string>();
  const urls = new Set<string>();
  for (const l of links) {
    if (!l.label.trim()) return "Label is required";
    if (!l.url.trim()) return "URL is required";
    if (!/^https?:\/\//i.test(l.url)) return `Invalid URL: ${l.url}`;
    const lk = l.label.trim().toLowerCase();
    if (labels.has(lk)) return `Duplicate label: ${l.label}`;
    labels.add(lk);
    if (urls.has(l.url)) return `Duplicate URL: ${l.url}`;
    urls.add(l.url);
  }
  return null;
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function readCurrent(): Promise<string | null> {
  try {
    const v = (await readFile(CURRENT_FILE, "utf-8")).trim();
    return v || null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const method = req.method!;

  // Unified Editorial Ledger dashboard (Backlog + Tasks + inline link editing).
  // The standalone link editor (index.html) is retired — editing is inline.
  if (url.pathname === "/" || url.pathname === "/roadmap") {
    const html = await readFile(join(__dirname, "roadmap.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  // ── Roadmap (read-only except the sanctioned planless-drop write below;
  //    all other mutations stay on the skill/design/retro markdown path) ──
  if (url.pathname === "/api/roadmap" && method === "GET") {
    const md = await readFile(ROADMAP_FILE, "utf-8").catch(() => null);
    if (md == null) {
      return json(res, 200, { missing: true, project: "", focus: null, updated: "", open: [], recentlyClosed: [] });
    }
    return json(res, 200, parseRoadmap(md));
  }

  if (url.pathname === "/api/roadmap/validate" && method === "GET") {
    return json(res, 200, await validateRoadmap(PROJECT_ROOT));
  }

  if (url.pathname === "/api/roadmap/next" && method === "GET") {
    const md = await readFile(ROADMAP_FILE, "utf-8").catch(() => null);
    if (md == null) return json(res, 404, { error: "no roadmap" });
    const rm = parseRoadmap(md);
    const target = selectTarget(rm);
    if (!target) return json(res, 404, { error: "no open items" });
    const view = await resolveJoin(PROJECT_ROOT, rm, target.id);
    if (!view || view.closed) return json(res, 404, { error: "no open items" });
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(buildNextPrompt(view, inboxCount(rm)));
  }

  const rmMatch = url.pathname.match(/^\/api\/roadmap\/([a-z0-9-]+)\/(join|next)$/);
  if (rmMatch && method === "GET") {
    const md = await readFile(ROADMAP_FILE, "utf-8").catch(() => null);
    if (md == null) return json(res, 404, { error: "no roadmap" });
    const rm = parseRoadmap(md);
    // ?scope=closed targets the Recently Closed record directly — open-wins
    // resolution would otherwise shadow a closed row sharing an open item's id.
    const view = rmMatch[2] === "join" && url.searchParams.get("scope") === "closed"
      ? await resolveClosedJoin(PROJECT_ROOT, rm, rmMatch[1])
      : await resolveJoin(PROJECT_ROOT, rm, rmMatch[1]);
    if (!view) return json(res, 404, { error: "item not found" });
    if (rmMatch[2] === "join") return json(res, 200, view);
    // next is open-only: buildNextPrompt assumes an open RoadmapItem (title/priority/task)
    if (view.closed) return json(res, 404, { error: "closed item — next unavailable" });
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(buildNextPrompt(view, inboxCount(rm)));
  }

  // Drop a PLANLESS backlog item from the GUI (the only roadmap write the GUI does).
  // Plan-linked items are refused — they must close via /retro so the plan stays in sync.
  const dropMatch = url.pathname.match(/^\/api\/roadmap\/([a-z0-9-]+)\/drop$/);
  if (dropMatch && method === "POST") {
    const md = await readFile(ROADMAP_FILE, "utf-8").catch(() => null);
    if (md == null) return json(res, 404, { error: "no roadmap" });
    const rm = parseRoadmap(md);
    const idx = rm.open.findIndex((i) => i.id === dropMatch[1]);
    if (idx < 0) return json(res, 404, { error: "item not found" });
    const it = rm.open[idx];
    if (it.plan) return json(res, 409, { error: "plan-linked — close via /retro" });
    rm.open.splice(idx, 1);
    rm.recentlyClosed.unshift({ id: it.id, plan: null, status: "dropped", note: it.note, task: it.task });
    rm.recentlyClosed = rm.recentlyClosed.slice(0, 10);
    if (rm.focus === it.id) rm.focus = null; // focus-clear rule: focus never dangles on a closed item
    const tmp = `${ROADMAP_FILE}.tmp`; // atomic write
    await writeFile(tmp, serializeRoadmap(rm));
    await rename(tmp, ROADMAP_FILE);
    return json(res, 200, { id: it.id, dropped: true });
  }

  if (url.pathname === "/api/current") {
    if (method === "GET") {
      return json(res, 200, { current: await readCurrent() });
    }
    if (method === "PUT") {
      let body: { current: string | null };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "Invalid JSON" });
      }
      const next = (body.current ?? "").trim();
      if (next) {
        // KEY grammar gate BEFORE any path resolution (skill rule: ^[A-Z0-9_-]+$)
        if (!/^[A-Z0-9_-]+$/.test(next)) return json(res, 400, { error: "Invalid task key (expected ^[A-Z0-9_-]+$)" });
        const exists = await readFile(join(TASKS_DIR, `${next}.md`), "utf-8")
          .then(() => true)
          .catch(() => false);
        if (!exists) return json(res, 404, { error: "Task not found" });
        await writeFile(CURRENT_FILE, next);
      } else {
        await writeFile(CURRENT_FILE, "");
      }
      return json(res, 200, { current: next || null });
    }
  }

  if (url.pathname === "/api/tasks" && method === "GET") {
    const files = await readdir(TASKS_DIR);
    const tasks = await Promise.all(
      files
        .filter((f) => f.endsWith(".md") && !f.endsWith(".meta.md"))
        .map(async (f) => {
          const key = f.replace(/\.md$/, "");
          const content = await readFile(join(TASKS_DIR, f), "utf-8");
          const { links, memory } = parseTask(content);
          const mem = await readTaskMemory(PROJECT_ROOT, key, memory); // union: memory file + legacy section
          return { key, linkCount: links.length, memCount: mem.length };
        }),
    );
    tasks.sort((a, b) => a.key.localeCompare(b.key));
    return json(res, 200, tasks);
  }

  const m = url.pathname.match(/^\/api\/tasks\/([A-Z0-9_-]+)$/); // KEY grammar enforced at the route
  if (m) {
    const key = m[1];
    const filePath = join(TASKS_DIR, `${key}.md`);

    if (method === "GET") {
      try {
        const content = await readFile(filePath, "utf-8");
        const parsed = parseTask(content);
        const memory = await readTaskMemory(PROJECT_ROOT, key, parsed.memory); // union read
        return json(res, 200, { key, links: parsed.links, memory });
      } catch {
        return json(res, 404, { error: "Not found" });
      }
    }

    if (method === "PUT") {
      let body: { links?: Link[]; memory?: Memory[] };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "Invalid JSON" });
      }
      const links = (body.links ?? []).map((l) => ({
        label: (l.label ?? "").trim(),
        url: (l.url ?? "").trim(),
        triggers: Array.isArray(l.triggers)
          ? l.triggers.map((t) => String(t).trim()).filter(Boolean)
          : [],
        summary: (l.summary ?? "").trim(),
      }));
      const memory = (body.memory ?? [])
        .map((m) => ({ title: (m.title ?? "").trim(), note: (m.note ?? "").trim(), date: (m.date ?? "").trim() }))
        .filter((m) => m.title);
      const err = validate(links);
      if (err) return json(res, 409, { error: err });
      // Memory is retro-owned, stored separately; full-state PUT migrates any
      // legacy `## Memory` section out of the task md (links-only) implicitly.
      await ensureMemoryIgnored(PROJECT_ROOT);
      await writeTaskMemory(PROJECT_ROOT, key, memory);
      await writeFile(filePath, toTaskMd(key, links, []));
      return json(res, 200, { key, links, memory });
    }

    if (method === "DELETE") {
      try {
        await unlink(filePath);
        await unlink(memoryFilePath(PROJECT_ROOT, key)).catch(() => {}); // companion memory store
        const cur = await readCurrent();
        if (cur === key) await writeFile(CURRENT_FILE, "");
        res.writeHead(204);
        return res.end();
      } catch {
        return json(res, 404, { error: "Not found" });
      }
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () =>
  console.log(`Task Context server: http://localhost:${PORT}`),
);

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
