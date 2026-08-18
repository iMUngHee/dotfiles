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

// Content this parser drops. serializeBlocks only ever writes back the parsed model, so
// anything listed here is destroyed by the next write. Callers that merely read may ignore
// it; every writer must refuse (ops guard) and validate reports it as C17.
export interface Orphan {
  line: number; // 1-based
  text: string;
}

export function parseBlocks(md: string): { title: string; blocks: Block[]; orphans: Orphan[] } {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  let h1 = "";
  let h1Line = 0;
  const blocks: Block[] = [];
  const orphans: Orphan[] = [];
  let cur: Block | null = null;
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^#\s+(.*)$/);
    // A later H1 silently replaces the earlier one, so the earlier line is lost content too.
    if (h) { if (h1Line) orphans.push({ line: h1Line, text: lines[h1Line - 1] }); h1 = h[1].trim(); h1Line = i + 1; continue; }
    const head = line.match(/^-\s+\*\*([^*]+)\*\*(?:\s*—\s*(.*))?$/);
    if (head) { flush(); cur = { id: head[1].trim(), title: (head[2] ?? "").trim(), fields: [] }; continue; }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z][\w-]*):\s*(.*)$/);
    // A field line before any block head has nowhere to attach — it is dropped, not stored.
    if (sub && cur) { cur.fields.push([sub[1], sub[2].trim()]); continue; }
    if (line.trim()) orphans.push({ line: i + 1, text: line });
  }
  flush();
  orphans.sort((a, b) => a.line - b.line); // a superseded H1 is discovered out of order
  return { title: h1, blocks, orphans };
}

const FIELD_KEY = /^[A-Za-z][\w-]*$/;

// Named diagnostics for the cases people actually hit, so the error names the field instead
// of saying "does not round-trip". The comparison in serializeBlocks is the real contract;
// this only supplies the message.
function diagnose(title: string, blocks: Block[]): string | null {
  const multiline = (s: string) => /[\r\n]/.test(s);
  if (multiline(title)) return "file title must be single-line";
  for (const b of blocks) {
    if (!b.id.trim()) return "block id must not be empty";
    if (b.id.includes("*")) return `block id must not contain '*' (got ${JSON.stringify(b.id)})`;
    if (multiline(b.id)) return `block id must be single-line (got ${JSON.stringify(b.id)})`;
    if (multiline(b.title)) return `block '${b.id}' title must be single-line`;
    for (const [k, v] of b.fields) {
      if (!FIELD_KEY.test(k)) return `block '${b.id}' field key ${JSON.stringify(k)} must match ${FIELD_KEY.source}`;
      if (multiline(v)) return `block '${b.id}' field '${k}' must be single-line — put long prose in the plan file and keep a one-line summary here`;
    }
  }
  return null;
}

// Compare a reparsed document against the model it came from. `orphans` is checked
// separately by the caller, so only {title, blocks} are compared here — comparing the two
// full parse results would always differ once orphans exists.
function sameModel(back: { title: string; blocks: Block[] }, title: string, blocks: Block[]): boolean {
  if (back.title !== title || back.blocks.length !== blocks.length) return false;
  for (let i = 0; i < blocks.length; i++) {
    const want = blocks[i], got = back.blocks[i];
    if (want.id !== got.id || want.title !== got.title || want.fields.length !== got.fields.length) return false;
    for (let j = 0; j < want.fields.length; j++) {
      if (want.fields[j][0] !== got.fields[j][0] || want.fields[j][1] !== got.fields[j][1]) return false;
    }
  }
  return true;
}

function renderRaw(title: string, blocks: Block[]): string {
  const out: string[] = [`# ${title}`, ""];
  for (const b of blocks) {
    out.push(b.title ? `- **${b.id}** — ${b.title}` : `- **${b.id}**`);
    for (const [k, v] of b.fields) out.push(`  - ${k}: ${v}`);
  }
  if (blocks.length) out.push("");
  return out.join("\n");
}

// When no named diagnostic matches, probe each position with a minimal document to name the
// one that fails. This is how the message stays useful for the cases a character list can
// never enumerate — a Unicode line separator, or whitespace the parser trims away.
function locate(title: string, blocks: Block[]): string | null {
  const survives = (t: string, bs: Block[]) => {
    const back = parseBlocks(renderRaw(t, bs));
    return !back.orphans.length && sameModel(back, t, bs);
  };
  const hint = "check for leading/trailing whitespace or a Unicode line separator (U+2028/U+2029)";
  if (!survives(title, [])) return `file title ${JSON.stringify(title)} cannot be represented — ${hint}`;
  for (const b of blocks) {
    if (!survives("probe", [{ id: b.id, title: b.title, fields: [] }])) {
      return `block id ${JSON.stringify(b.id)} or its title cannot be represented — ${hint}`;
    }
    for (const [k, v] of b.fields) {
      if (!survives("probe", [{ id: "probe", title: "", fields: [[k, v]] }])) {
        return `block '${b.id}' field '${k}' value ${JSON.stringify(v)} cannot be represented — ${hint}`;
      }
    }
  }
  return null;
}

export function serializeBlocks(title: string, blocks: Block[]): string {
  const text = renderRaw(title, blocks);
  // The contract: these bytes must reparse to exactly the model we were handed. Enumerating
  // forbidden characters cannot be completed — U+2028/U+2029 defeat every `.`-based capture
  // in the parser and `.trim()` silently normalizes edge whitespace — so the property is
  // enforced rather than approximated, and it survives future grammar edits.
  const back = parseBlocks(text);
  if (back.orphans.length || !sameModel(back, title, blocks)) {
    const why = diagnose(title, blocks) ?? locate(title, blocks) ?? "the model cannot be represented in the block grammar without loss";
    throw new Error(`refusing to serialize: ${why}`);
  }
  return text;
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
