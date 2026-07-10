// Filesystem primitives for the task-first model (.agents/tasks/<KEY>/*, inbox.md).
// The ONLY module that touches the filesystem. Provides:
//   - lossless block parser/serializer (round-trips unknown sub-bullet keys + order)
//   - frontmatter parse/serialize (task.md)
//   - a repo-level advisory lock (.agents/tasks/.lock, O_EXCL + pid/host/start/op)
//   - mtime-CAS temp+rename writes
//   - gitignore-ensure
// ops.ts builds atomic lifecycle transitions on top of these; nothing else writes files.
import { open, readFile, writeFile, rename, stat, unlink, mkdir } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { hostname } from "node:os";

// ── block grammar (shared by backlog/closed/links/memory/inbox) ──
// `- **id** — title` (title optional) opens a block; `  - Key: Value` are its
// ordered fields. Unknown keys and their order are preserved for lossless round-trip.
export interface Block {
  id: string;
  title: string;
  fields: [string, string][];
}

export function parseBlocks(md: string): { title: string; blocks: Block[] } {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  let h1 = "";
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  for (const line of lines) {
    const h = line.match(/^#\s+(.*)$/);
    if (h) { h1 = h[1].trim(); continue; }
    const head = line.match(/^-\s+\*\*([^*]+)\*\*(?:\s*—\s*(.*))?$/);
    if (head) { flush(); cur = { id: head[1].trim(), title: (head[2] ?? "").trim(), fields: [] }; continue; }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z][\w-]*):\s*(.*)$/);
    if (sub && cur) { cur.fields.push([sub[1], sub[2].trim()]); continue; }
  }
  flush();
  return { title: h1, blocks };
}

export function serializeBlocks(title: string, blocks: Block[]): string {
  const out: string[] = [`# ${title}`, ""];
  for (const b of blocks) {
    out.push(b.title ? `- **${b.id}** — ${b.title}` : `- **${b.id}**`);
    for (const [k, v] of b.fields) out.push(`  - ${k}: ${v}`);
  }
  if (blocks.length) out.push("");
  return out.join("\n");
}

export function getField(b: Block, key: string): string | null {
  const k = key.toLowerCase();
  for (const [fk, fv] of b.fields) if (fk.toLowerCase() === k) return fv;
  return null;
}

export function setField(b: Block, key: string, val: string): void {
  const k = key.toLowerCase();
  for (const f of b.fields) if (f[0].toLowerCase() === k) { f[1] = val; return; }
  b.fields.push([key, val]);
}

// Parse a comma-id field (e.g. DependsOn) into a trimmed, de-duplicated array preserving
// first-occurrence order. Empty / "-" ⇒ []. Shared by join (read), ops (write), validate (scan).
export function parseIdList(raw: string | null): string[] {
  if (!raw || raw.trim() === "-") return [];
  const out: string[] = [];
  for (const s of raw.split(",").map((x) => x.trim()).filter(Boolean)) if (!out.includes(s)) out.push(s);
  return out;
}

// ── frontmatter (task.md) ──
export function parseFrontmatter(md: string): { fields: [string, string][]; body: string } {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { fields: [], body: md };
  const fields: [string, string][] = [];
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === "---") { i++; break; }
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) fields.push([m[1], m[2].trim()]);
  }
  return { fields, body: lines.slice(i).join("\n").replace(/^\n+/, "") };
}

export function serializeFrontmatter(fields: [string, string][], body: string): string {
  return ["---", ...fields.map(([k, v]) => `${k}: ${v}`), "---", "", body.replace(/^\n+/, "")].join("\n");
}

export function getFmField(fields: [string, string][], key: string): string | null {
  const k = key.toLowerCase();
  for (const [fk, fv] of fields) if (fk.toLowerCase() === k) return fv;
  return null;
}

// Collaboration-mode coercion — absence/blank `mode:` → "solo". Single source shared by
// join.taskMode (read path) and ops.taskModeOf (write-gate) so the absence→solo rule can't drift.
export function coerceMode(raw: string | null): string {
  return (raw && raw.trim()) || "solo";
}

// ── paths ──
const TASK_KEY_RE = /^[A-Z0-9_-]+$/;
export const tasksDir = (root: string) => pathJoin(root, ".agents", "tasks");
// Single chokepoint for key→path construction (taskFile routes through here): reject a
// malformed / path-bearing key so `../x` etc. can never escape tasks/ on any read or write.
export const taskDir = (root: string, key: string) => {
  if (!TASK_KEY_RE.test(key)) throw new Error(`invalid task key '${key}' — must match ${TASK_KEY_RE.source}`);
  return pathJoin(tasksDir(root), key);
};
export const taskFile = (root: string, key: string, name: string) => pathJoin(taskDir(root, key), name);
export const inboxPath = (root: string) => pathJoin(root, ".agents", "inbox.md");
export const lockPath = (root: string) => pathJoin(tasksDir(root), ".lock");

// ── advisory lock ──
export interface LockInfo { pid: number; host: string; start: string; op: string; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e?.code === "EPERM"; } // EPERM = exists but not ours → alive; ESRCH = dead
}

export class LockError extends Error {}

// Acquire the repo-level advisory lock. O_EXCL create wins. On contention:
//  - same host + dead pid + past staleMs → break (the holder crashed) and retry
//  - same host + live pid → active holder; retry then fail (never break a live lock)
//  - different host → liveness unverifiable → abort (conservative; no split-brain)
export async function acquireLock(
  root: string,
  op: string,
  opts: { staleMs?: number; nowMs?: number; retries?: number; retryMs?: number } = {},
): Promise<void> {
  const staleMs = opts.staleMs ?? 30_000;
  const retries = opts.retries ?? 50;
  const retryMs = opts.retryMs ?? 100;
  const nowMs = opts.nowMs ?? Date.now();
  await mkdir(tasksDir(root), { recursive: true });
  const path = lockPath(root);
  const info: LockInfo = { pid: process.pid, host: hostname(), start: new Date(nowMs).toISOString(), op };

  for (let attempt = 0; ; attempt++) {
    try {
      const fh = await open(path, "wx"); // O_CREAT | O_EXCL
      await fh.writeFile(JSON.stringify(info));
      await fh.close();
      return;
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
    }
    // contention — inspect the holder
    let held: LockInfo | null = null;
    try { held = JSON.parse(await readFile(path, "utf-8")); } catch { held = null; }
    if (held) {
      const sameHost = held.host === info.host;
      const ageMs = nowMs - Date.parse(held.start);
      if (sameHost && !pidAlive(held.pid) && ageMs > staleMs) {
        await unlink(path).catch(() => {}); // crashed holder → break, then retry immediately
        continue;
      }
      if (!sameHost) throw new LockError(`lock held by another host (${held.host}, pid ${held.pid}); refusing to break`);
    }
    if (attempt >= retries) throw new LockError(`could not acquire lock after ${retries} retries (held by pid ${held?.pid ?? "?"})`);
    await sleep(retryMs);
  }
}

export async function releaseLock(root: string): Promise<void> {
  await unlink(lockPath(root)).catch(() => {});
}

export async function withLock<T>(
  root: string,
  op: string,
  fn: () => Promise<T>,
  opts: { staleMs?: number; nowMs?: number; retries?: number; retryMs?: number } = {},
): Promise<T> {
  await acquireLock(root, op, opts);
  try { return await fn(); }
  finally { await releaseLock(root); }
}

// ── CAS read/write ──
export interface Stamped { content: string; mtimeMs: number; }

export async function readStamped(path: string): Promise<Stamped | null> {
  try {
    const s = await stat(path);
    return { content: await readFile(path, "utf-8"), mtimeMs: s.mtimeMs };
  } catch { return null; }
}

// Write via temp+rename. If expectMtimeMs is given, abort when the file changed
// since it was read (compare-and-swap) — defence-in-depth under the lock window.
export async function writeCAS(path: string, content: string, expectMtimeMs: number | null): Promise<void> {
  if (expectMtimeMs != null) {
    const s = await stat(path).catch(() => null);
    if (s && s.mtimeMs !== expectMtimeMs) {
      throw new LockError(`CAS conflict: ${path} changed since read (expected mtime ${expectMtimeMs}, found ${s.mtimeMs})`);
    }
  }
  await mkdir(pathJoin(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

// ── gitignore ──
export async function ensureGitignore(root: string, entries: string[]): Promise<void> {
  const path = pathJoin(root, ".agents", ".gitignore");
  await mkdir(pathJoin(root, ".agents"), { recursive: true });
  const cur = await readFile(path, "utf-8").catch(() => "");
  const have = new Set(cur.split("\n").map((l) => l.trim()).filter(Boolean));
  const add = entries.filter((e) => !have.has(e));
  if (!add.length) return;
  await writeFile(path, (cur && !cur.endsWith("\n") ? cur + "\n" : cur) + add.join("\n") + "\n");
}
