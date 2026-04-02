import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TASKS_DIR = join(__dirname, "tasks");
const PORT = 8484;

await mkdir(TASKS_DIR, { recursive: true });

function parseTaskMd(content: string): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^-\s+\[([^\]]+)\]\s+(.+)$/);
    if (m) links.push({ label: m[1], url: m[2].trim() });
  }
  return links;
}

function toTaskMd(
  key: string,
  links: { label: string; url: string }[],
): string {
  const lines = [`# ${key}`, ""];
  for (const l of links) lines.push(`- [${l.label}] ${l.url}`);
  if (links.length) lines.push("");
  return lines.join("\n");
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const method = req.method!;

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(join(__dirname, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (url.pathname === "/api/tasks" && method === "GET") {
    const files = await readdir(TASKS_DIR);
    const tasks = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
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
      let body: { links: { label: string; url: string }[] };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "Invalid JSON" });
      }
      await writeFile(filePath, toTaskMd(key, body.links));
      return json(res, 200, { key, links: body.links });
    }

    if (method === "DELETE") {
      try {
        await unlink(filePath);
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
