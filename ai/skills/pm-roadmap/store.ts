// Filesystem primitives for the task-first model (.agents/tasks/<KEY>/* + _inbox.md).
// The ONLY module that touches the filesystem. Provides:
//   - lossless block parser/serializer (round-trips unknown sub-bullet keys + order)
//   - frontmatter parse/serialize (task.md)
//   - a repo-level token-owned advisory lock (.agents/tasks/.lock owner directory)
//   - mtime-CAS temp+rename writes
//   - gitignore-ensure
// ops.ts builds atomic lifecycle transitions on top of these; nothing else writes files.
import { readFile, writeFile, rename, stat, mkdir } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { acquireOwnerLock, OwnerLockError, releaseOwnerLock } from "../../lib/owner-lock.mjs";

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
export const inboxPath = (root: string) => pathJoin(tasksDir(root), "_inbox.md");
export const lockPath = (root: string) => pathJoin(tasksDir(root), ".lock");

// ── advisory lock ──
export interface LockHandle {
  path: string;
  token: string;
  marker: string;
  owner: { host: string; pid: number; token: string; operation: string; started: string };
}

export class LockError extends Error {}

// Acquire the repo-level owner-directory lock shared with the worktree engine.
// Only a valid dead same-host owner is reclaimed; every release is token-bound.
export async function acquireLock(
  root: string,
  op: string,
  opts: { staleMs?: number; nowMs?: number; retries?: number; retryMs?: number } = {},
): Promise<LockHandle> {
  await mkdir(tasksDir(root), { recursive: true });
  try {
    return await acquireOwnerLock(lockPath(root), {
      operation: op,
      retries: opts.retries ?? 50,
      retryMs: opts.retryMs ?? 100,
    }) as LockHandle;
  } catch (error: any) {
    if (error instanceof OwnerLockError) throw new LockError(error.message);
    throw error;
  }
}

export async function releaseLock(handle: LockHandle): Promise<boolean> {
  return releaseOwnerLock(handle);
}

export async function withLock<T>(
  root: string,
  op: string,
  fn: () => Promise<T>,
  opts: { staleMs?: number; nowMs?: number; retries?: number; retryMs?: number } = {},
): Promise<T> {
  const owner = await acquireLock(root, op, opts);
  try {
    // Every mutating PM command enters through withLock. Recover a prior interrupted
    // multi-file transaction before the command reads authoritative state.
    const { recoverTransactions } = await import("./transaction.ts");
    await recoverTransactions(root);
    return await fn();
  }
  finally { await releaseLock(owner); }
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
