import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TASKS_DIR = join(__dirname, "tasks");
const CURRENT_FILE = join(TASKS_DIR, ".current");
const PORT = 8484;

await mkdir(TASKS_DIR, { recursive: true });

interface Link {
  label: string;
  url: string;
  triggers: string[];
  summary: string;
}

function parseTaskMd(content: string): Link[] {
  const links: Link[] = [];
  const lines = content.split("\n");
  let cur: Link | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const top = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (top) {
      if (cur) links.push(cur);
      cur = { label: top[1].trim(), url: "", triggers: [], summary: "" };
      continue;
    }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
    if (sub && cur) {
      const key = sub[1].toLowerCase();
      const value = sub[2].trim();
      if (key === "url") cur.url = value;
      else if (key === "triggers") {
        cur.triggers = value
          ? value.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
      } else if (key === "summary") cur.summary = value;
    }
  }
  if (cur) links.push(cur);
  return links;
}

function toTaskMd(key: string, links: Link[]): string {
  const lines = [`# ${key}`, ""];
  for (const l of links) {
    lines.push(`- **${l.label}**`);
    lines.push(`  - URL: ${l.url}`);
    lines.push(`  - Triggers: ${l.triggers.join(", ")}`);
    lines.push(`  - Summary: ${l.summary}`);
  }
  if (links.length) lines.push("");
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

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(join(__dirname, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
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
          return { key, linkCount: parseTaskMd(content).length };
        }),
    );
    tasks.sort((a, b) => a.key.localeCompare(b.key));
    return json(res, 200, tasks);
  }

  const m = url.pathname.match(/^\/api\/tasks\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const key = m[1];
    const filePath = join(TASKS_DIR, `${key}.md`);

    if (method === "GET") {
      try {
        const content = await readFile(filePath, "utf-8");
        return json(res, 200, { key, links: parseTaskMd(content) });
      } catch {
        return json(res, 404, { error: "Not found" });
      }
    }

    if (method === "PUT") {
      let body: { links: Link[] };
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
      const err = validate(links);
      if (err) return json(res, 409, { error: err });
      await writeFile(filePath, toTaskMd(key, links));
      return json(res, 200, { key, links });
    }

    if (method === "DELETE") {
      try {
        await unlink(filePath);
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
