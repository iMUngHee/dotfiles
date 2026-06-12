// Retro-owned per-task memory store: <git-root>/.agents/memory/<KEY>.md.
// Same bullet grammar as the legacy task-context `## Memory` section
// (`- **<title>**` / `  - Note:` / `  - Date:`), but notes are top-level under
// an H1 `# <KEY>`. Reads union the new file with any legacy section
// (back-compat); writes go to the new file only.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join as pathJoin } from "node:path";

// Owned here (retro's store); join.ts re-exports for its readers.
export interface TaskMemory { title: string; note: string; date: string; }

export function memoryFilePath(root: string, key: string): string {
  return pathJoin(root, ".agents", "memory", `${key}.md`);
}

// The memory dir may hold internal decisions — keep it out of git like
// task-context/. Idempotent: appends the line only when missing.
export async function ensureMemoryIgnored(root: string): Promise<void> {
  const path = pathJoin(root, ".agents", ".gitignore");
  const cur = await readFile(path, "utf-8").catch(() => "");
  if (cur.split("\n").some((l) => l.trim() === "memory/")) return;
  await writeFile(path, cur ? `${cur.replace(/\n?$/, "\n")}memory/\n` : "memory/\n");
}

export function parseMemoryFile(md: string): TaskMemory[] {
  const memory: TaskMemory[] = [];
  let mem: TaskMemory | null = null;
  const flush = () => { if (mem && mem.title) memory.push(mem); mem = null; };
  for (const line of md.split("\n")) {
    const top = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (top) { flush(); mem = { title: top[1].trim(), note: "", date: "" }; continue; }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
    if (sub && mem) {
      const k = sub[1].toLowerCase(), v = sub[2].trim();
      if (k === "note") mem.note = v; else if (k === "date") mem.date = v;
    }
  }
  flush();
  return memory;
}

export function serializeMemoryFile(key: string, notes: TaskMemory[]): string {
  const out: string[] = [`# ${key}`, ""];
  for (const m of notes) {
    out.push(`- **${m.title}**`);
    if (m.note) out.push(`  - Note: ${m.note}`);
    if (m.date) out.push(`  - Date: ${m.date}`);
  }
  if (notes.length) out.push("");
  return out.join("\n");
}

// Union read: new memory file first, then legacy `## Memory` notes (parsed by
// the caller from its task-context md), skipping titles the file already has.
export async function readTaskMemory(root: string, key: string, legacy: TaskMemory[] = []): Promise<TaskMemory[]> {
  const fileMd = await readFile(memoryFilePath(root, key), "utf-8").catch(() => null);
  const fromFile = fileMd ? parseMemoryFile(fileMd) : [];
  const seen = new Set(fromFile.map((m) => m.title));
  return [...fromFile, ...legacy.filter((m) => !seen.has(m.title))];
}

// Atomic write of the full memory state for a task (temp+rename, mkdir -p).
export async function writeTaskMemory(root: string, key: string, notes: TaskMemory[]): Promise<void> {
  const path = memoryFilePath(root, key);
  await mkdir(pathJoin(root, ".agents", "memory"), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, serializeMemoryFile(key, notes));
  await rename(tmp, path);
}

// Strip a legacy `## Memory` section from task-context md (post-migration).
export function stripMemorySection(taskMd: string): string {
  const lines = taskMd.split("\n");
  const out: string[] = [];
  let inMemory = false;
  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { inMemory = h[1].trim().toLowerCase().startsWith("memory"); if (inMemory) continue; }
    if (!inMemory) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
