// ops.ts — deterministic atomic lifecycle transitions on top of store.ts.
// Every mutating op runs under the repo lock; illegal transitions throw OpError.
// The CLI (pm-roadmap.ts), design, retro, and the GUI all call these — nothing
// hand-edits markdown. Internal _impl helpers assume the lock is already held;
// public ops wrap them in withLock so composites reuse one lock (no re-entrancy).
import { readdir, mkdir, rename, stat } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import {
  type Block, parseBlocks, serializeBlocks, getField, setField,
  parseFrontmatter, serializeFrontmatter, getFmField,
  taskDir, taskFile, tasksDir, inboxPath, withLock, readStamped, writeCAS,
} from "./store.ts";

export class OpError extends Error {}

const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const TASK_KEY = /^[A-Z0-9_-]+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ItemInput { id: string; title: string; priority?: string; order?: number; note?: string; plan?: string; }
export interface Deferred { id: string; title: string; priority?: string; order?: number; note?: string; }
export interface MemoryInput { title: string; note?: string; date?: string; }
export interface LinkInput { label: string; url: string; triggers?: string; summary?: string; }

const today = () => new Date().toISOString().slice(0, 10);
const archiveDir = (root: string) => pathJoin(tasksDir(root), "archive");
const statePath = (root: string, name: string) => pathJoin(root, ".agents", "state", name);

async function exists(p: string): Promise<boolean> { return stat(p).then(() => true).catch(() => false); }

async function loadBlocks(path: string): Promise<{ title: string; blocks: Block[] }> {
  const s = await readStamped(path);
  return s ? parseBlocks(s.content) : { title: "", blocks: [] };
}
async function writeBlocks(path: string, title: string, blocks: Block[]): Promise<void> {
  await writeCAS(path, serializeBlocks(title, blocks), null); // serialized by the lock
}

function setFm(fields: [string, string][], key: string, val: string): void {
  const k = key.toLowerCase();
  for (const f of fields) if (f[0].toLowerCase() === k) { f[1] = val; return; }
  fields.push([key, val]);
}

function backlogBlock(it: ItemInput, status: string): Block {
  const b: Block = { id: it.id, title: it.title, fields: [] };
  setField(b, "Priority", it.priority && PRIORITIES.has(it.priority) ? it.priority : "P2");
  setField(b, "Status", status);
  if (it.order && it.order > 0) setField(b, "Order", String(it.order));
  setField(b, "Plan", it.plan ?? "-");
  setField(b, "Note", it.note ?? "");
  return b;
}

// ── directory scans ──
async function listTaskKeys(root: string): Promise<string[]> {
  const ents = await readdir(tasksDir(root), { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory() && e.name !== "archive").map((e) => e.name);
}
async function listArchiveKeys(root: string): Promise<string[]> {
  const ents = await readdir(archiveDir(root), { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory()).map((e) => e.name);
}

// every id ever used (backlog + closed) across active tasks + inbox + archive.
async function reservedIdsImpl(root: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const add = (bs: Block[]) => bs.forEach((b) => ids.add(b.id));
  add((await loadBlocks(inboxPath(root))).blocks);
  for (const key of await listTaskKeys(root)) {
    add((await loadBlocks(taskFile(root, key, "backlog.md"))).blocks);
    add((await loadBlocks(taskFile(root, key, "closed.md"))).blocks);
  }
  for (const key of await listArchiveKeys(root)) {
    add((await loadBlocks(pathJoin(archiveDir(root), key, "backlog.md"))).blocks);
    add((await loadBlocks(pathJoin(archiveDir(root), key, "closed.md"))).blocks);
  }
  return ids;
}

async function planInUse(root: string, planPath: string): Promise<boolean> {
  const scan = async (dir: string, keys: string[]) => {
    for (const key of keys) for (const f of ["backlog.md", "closed.md"]) {
      const { blocks } = await loadBlocks(pathJoin(dir, key, f));
      if (blocks.some((b) => getField(b, "Plan") === planPath)) return true;
    }
    return false;
  };
  return (await scan(tasksDir(root), await listTaskKeys(root))) || (await scan(archiveDir(root), await listArchiveKeys(root)));
}

// ── pointers ──
async function writeState(root: string, name: string, val: string): Promise<void> {
  await mkdir(pathJoin(root, ".agents", "state"), { recursive: true });
  await writeCAS(statePath(root, name), val ? `${val}\n` : "", null);
}
async function readState(root: string, name: string): Promise<string> {
  const s = await readStamped(statePath(root, name));
  return s ? s.content.trim() : "";
}
async function clearFocusIfNames(root: string, id: string): Promise<void> {
  if ((await readState(root, "focus.txt")) === id) await writeState(root, "focus.txt", "");
}
async function clearCurrentIfNames(root: string, planPath: string): Promise<void> {
  if ((await readState(root, "current.txt")) === planPath) await writeState(root, "current.txt", "");
}

// ── task meta ──
async function loadTaskMeta(root: string, key: string): Promise<{ fields: [string, string][]; body: string } | null> {
  const s = await readStamped(taskFile(root, key, "task.md"));
  return s ? parseFrontmatter(s.content) : null;
}
async function writeTaskMeta(root: string, key: string, fields: [string, string][], body: string, nowDate: string): Promise<void> {
  setFm(fields, "updated", nowDate);
  await writeCAS(taskFile(root, key, "task.md"), serializeFrontmatter(fields, body), null);
}
async function reopenIfDone(root: string, key: string, nowDate: string): Promise<void> {
  const meta = await loadTaskMeta(root, key);
  if (meta && getFmField(meta.fields, "status") === "done") {
    setFm(meta.fields, "status", "active");
    await writeTaskMeta(root, key, meta.fields, meta.body, nowDate);
  }
}
async function assertActiveTask(root: string, key: string): Promise<void> {
  if (await exists(pathJoin(archiveDir(root), key))) throw new OpError(`task '${key}' is archived; restore it first`);
  if (!(await exists(taskFile(root, key, "task.md")))) throw new OpError(`task '${key}' does not exist`);
}

// ── transitions (impl: lock already held) ──
async function _taskCreate(root: string, key: string, title: string, nowDate: string): Promise<void> {
  if (!TASK_KEY.test(key)) throw new OpError(`task key '${key}' violates ^[A-Z0-9_-]+$`);
  if (await exists(taskFile(root, key, "task.md"))) throw new OpError(`task '${key}' already exists`);
  if (await exists(pathJoin(archiveDir(root), key))) throw new OpError(`task '${key}' exists in archive; restore it`);
  await mkdir(taskDir(root, key), { recursive: true });
  const fm: [string, string][] = [["key", key], ["title", title], ["status", "active"], ["created", nowDate], ["updated", nowDate]];
  await writeCAS(taskFile(root, key, "task.md"), serializeFrontmatter(fm, `# ${key} — ${title}\n`), null);
  await writeBlocks(taskFile(root, key, "backlog.md"), `${key} — Backlog`, []);
  await writeBlocks(taskFile(root, key, "closed.md"), `${key} — Closed`, []);
}

async function _itemAdd(root: string, target: { task: string } | { inbox: true }, it: ItemInput, nowDate: string): Promise<void> {
  if (!KEBAB.test(it.id)) throw new OpError(`item id '${it.id}' is not kebab-case`);
  if ((await reservedIdsImpl(root)).has(it.id)) throw new OpError(`id '${it.id}' already used (reserved, no reuse)`);
  if ("inbox" in target) {
    const f = await loadBlocks(inboxPath(root));
    f.blocks.push(backlogBlock({ ...it, plan: undefined }, "open"));
    await writeBlocks(inboxPath(root), f.title || "_INBOX — Inbox", f.blocks);
    return;
  }
  await assertActiveTask(root, target.task);
  if (it.plan && it.plan !== "-" && (await planInUse(root, it.plan))) throw new OpError(`plan '${it.plan}' already linked (1:1)`);
  const f = await loadBlocks(taskFile(root, target.task, "backlog.md"));
  f.blocks.push(backlogBlock(it, it.plan && it.plan !== "-" ? "draft" : "open"));
  await writeBlocks(taskFile(root, target.task, "backlog.md"), f.title || `${target.task} — Backlog`, f.blocks);
  await reopenIfDone(root, target.task, nowDate);
}

function findItem(blocks: Block[], id: string): Block | undefined { return blocks.find((b) => b.id === id); }

async function _itemSetPlan(root: string, key: string, id: string, planPath: string): Promise<void> {
  await assertActiveTask(root, key);
  if (await planInUse(root, planPath)) throw new OpError(`plan '${planPath}' already linked (1:1)`);
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  const it = findItem(f.blocks, id);
  if (!it) throw new OpError(`item '${id}' not in ${key} backlog`);
  setField(it, "Plan", planPath);
  setField(it, "Status", "draft");
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
}

async function _itemSetStatus(root: string, key: string, id: string, status: string): Promise<void> {
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  const it = findItem(f.blocks, id);
  if (!it) throw new OpError(`item '${id}' not in ${key} backlog`);
  setField(it, "Status", status);
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
}

async function _itemClose(root: string, key: string, id: string, o: { status: "done" | "dropped"; reason?: string; closedDate: string; plan?: string }): Promise<void> {
  if (o.status !== "done" && o.status !== "dropped") throw new OpError(`close status must be 'done' or 'dropped' (got '${o.status}')`);
  if (o.status === "dropped" && !o.reason) throw new OpError("drop requires a Reason");
  const bl = await loadBlocks(taskFile(root, key, "backlog.md"));
  const idx = bl.blocks.findIndex((b) => b.id === id);
  if (idx < 0) throw new OpError(`item '${id}' not in ${key} backlog`);
  const it = bl.blocks[idx];
  const plan = o.plan ?? getField(it, "Plan") ?? "-";
  if (o.status === "done" && (plan === "-" || !plan)) throw new OpError(`planless item '${id}' cannot be done`);
  bl.blocks.splice(idx, 1);
  const cl = await loadBlocks(taskFile(root, key, "closed.md"));
  const cb: Block = { id, title: it.title, fields: [] };
  setField(cb, "Status", o.status);
  setField(cb, "Plan", plan);
  if (o.reason) setField(cb, "Reason", o.reason);
  setField(cb, "Closed", o.closedDate);
  setField(cb, "ClosedSource", "op");
  cl.blocks.unshift(cb); // newest first
  await writeBlocks(taskFile(root, key, "backlog.md"), bl.title, bl.blocks);
  await writeBlocks(taskFile(root, key, "closed.md"), cl.title, cl.blocks);
  await clearFocusIfNames(root, id);
}

async function _harvestApply(root: string, key: string, deferred: Deferred[], nowDate: string): Promise<void> {
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  for (const d of deferred) f.blocks.push(backlogBlock({ ...d }, "open"));
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title || `${key} — Backlog`, f.blocks);
  await reopenIfDone(root, key, nowDate);
}
async function _harvestPreflight(root: string, deferred: Deferred[]): Promise<void> {
  const reserved = await reservedIdsImpl(root);
  const seen = new Set<string>();
  for (const d of deferred) {
    if (!KEBAB.test(d.id)) throw new OpError(`deferred id '${d.id}' is not kebab-case`);
    if (reserved.has(d.id) || seen.has(d.id)) throw new OpError(`deferred id '${d.id}' collides — aborting whole harvest`);
    seen.add(d.id);
  }
}

async function _triage(root: string, id: string, toKey: string): Promise<void> {
  await assertActiveTask(root, toKey);
  const inbox = await loadBlocks(inboxPath(root));
  const idx = inbox.blocks.findIndex((b) => b.id === id);
  if (idx < 0) throw new OpError(`item '${id}' not in inbox`);
  const [it] = inbox.blocks.splice(idx, 1);
  const bl = await loadBlocks(taskFile(root, toKey, "backlog.md"));
  bl.blocks.push(it);
  await writeBlocks(inboxPath(root), inbox.title || "_INBOX — Inbox", inbox.blocks);
  await writeBlocks(taskFile(root, toKey, "backlog.md"), bl.title || `${toKey} — Backlog`, bl.blocks);
}

async function _focusSet(root: string, id: string): Promise<void> {
  if ((await loadBlocks(inboxPath(root))).blocks.some((b) => b.id === id)) {
    throw new OpError(`cannot focus inbox item '${id}' — triage it to a task first`);
  }
  let found = false;
  for (const key of await listTaskKeys(root)) {
    if (findItem((await loadBlocks(taskFile(root, key, "backlog.md"))).blocks, id)) { found = true; break; }
  }
  if (!found) throw new OpError(`focus target '${id}' is not an open backlog item`);
  await writeState(root, "focus.txt", id);
}

async function _setPlanStatus(root: string, planRel: string, status: string): Promise<void> {
  const s = await readStamped(pathJoin(root, planRel));
  if (!s) throw new OpError(`plan not found: ${planRel}`);
  // Surgically replace ONLY the `status:` line inside the frontmatter block; preserve the rest
  // verbatim. A parse→serialize round-trip would drop multi-line list values (e.g. design's
  // `files_affected:` list), since the frontmatter parser handles only `key: value` scalars.
  const fm = s.content.match(/^(---\n)([\s\S]*?\n)(---\n?)/);
  if (!fm) throw new OpError(`plan ${planRel} has no frontmatter`);
  const block = /^status:.*$/m.test(fm[2])
    ? fm[2].replace(/^status:.*$/m, `status: ${status}`)
    : `status: ${status}\n${fm[2]}`;
  await writeCAS(pathJoin(root, planRel), fm[1] + block + fm[3] + s.content.slice(fm[0].length), null);
}

// ── public ops (each takes the lock; composites reuse one lock) ──
type LockOpts = { nowMs?: number; staleMs?: number; retries?: number; retryMs?: number };

export const taskCreate = (root: string, key: string, title: string, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "taskCreate", () => _taskCreate(root, key, title, o.nowDate ?? today()), o);

export const taskDone = (root: string, key: string, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "taskDone", async () => {
    const meta = await loadTaskMeta(root, key);
    if (!meta) throw new OpError(`task '${key}' does not exist`);
    const open = (await loadBlocks(taskFile(root, key, "backlog.md"))).blocks;
    if (open.length) throw new OpError(`task '${key}' has ${open.length} open item(s); close them first`);
    setFm(meta.fields, "status", "done");
    await writeTaskMeta(root, key, meta.fields, meta.body, o.nowDate ?? today());
  }, o);

export const taskArchive = (root: string, key: string, o: LockOpts = {}) =>
  withLock(root, "taskArchive", async () => {
    await assertActiveTask(root, key);
    const open = (await loadBlocks(taskFile(root, key, "backlog.md"))).blocks;
    if (open.length) throw new OpError(`task '${key}' has ${open.length} open item(s); cannot archive`);
    await mkdir(archiveDir(root), { recursive: true });
    await rename(taskDir(root, key), pathJoin(archiveDir(root), key));
  }, o);

export const taskRestore = (root: string, key: string, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "taskRestore", async () => {
    if (!(await exists(pathJoin(archiveDir(root), key)))) throw new OpError(`task '${key}' not in archive`);
    if (await exists(taskDir(root, key))) throw new OpError(`task '${key}' already active`);
    await rename(pathJoin(archiveDir(root), key), taskDir(root, key));
    const meta = await loadTaskMeta(root, key);
    if (meta) { setFm(meta.fields, "status", "active"); await writeTaskMeta(root, key, meta.fields, meta.body, o.nowDate ?? today()); }
  }, o);

export const itemAdd = (root: string, target: { task: string } | { inbox: true }, it: ItemInput, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "itemAdd", () => _itemAdd(root, target, it, o.nowDate ?? today()), o);

export const itemApprove = (root: string, key: string, id: string, o: LockOpts = {}) =>
  withLock(root, "itemApprove", () => _itemSetStatus(root, key, id, "active"), o);

export const itemSetPlan = (root: string, key: string, id: string, planPath: string, o: LockOpts = {}) =>
  withLock(root, "itemSetPlan", () => _itemSetPlan(root, key, id, planPath), o);

export const itemClose = (root: string, key: string, id: string, opt: { status: "done" | "dropped"; reason?: string; closedDate?: string; plan?: string } & LockOpts) =>
  withLock(root, "itemClose", () => _itemClose(root, key, id, { status: opt.status, reason: opt.reason, closedDate: opt.closedDate ?? today(), plan: opt.plan }), opt);

export const dropItem = (root: string, key: string, id: string, opt: { reason: string } & LockOpts) =>
  withLock(root, "dropItem", () => _itemClose(root, key, id, { status: "dropped", reason: opt.reason, closedDate: today() }), opt);

export const harvest = (root: string, key: string, deferred: Deferred[], o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "harvest", async () => { await _harvestPreflight(root, deferred); await _harvestApply(root, key, deferred, o.nowDate ?? today()); }, o);

export const triage = (root: string, id: string, toKey: string, o: LockOpts = {}) =>
  withLock(root, "triage", () => _triage(root, id, toKey), o);

export const focusSet = (root: string, id: string, o: LockOpts = {}) => withLock(root, "focusSet", () => _focusSet(root, id), o);
export const focusClear = (root: string, o: LockOpts = {}) => withLock(root, "focusClear", () => writeState(root, "focus.txt", ""), o);
export const setFocus = focusSet;

export const reservedIds = (root: string, o: LockOpts = {}) => withLock(root, "reservedIds", () => reservedIdsImpl(root), o);

// design persist transaction: create+link the item AND point current.txt together.
export const createPlanAndBacklogItem = (root: string, key: string, it: ItemInput, planPath: string, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "createPlanAndBacklogItem", async () => {
    await _itemAdd(root, { task: key }, { ...it, plan: planPath }, o.nowDate ?? today());
    await writeState(root, "current.txt", planPath);
  }, o);

// retro close transaction: plan→terminal + item backlog→closed + harvest + clear pointers, all-or-nothing.
export const completePlanFromRetro = (
  root: string,
  key: string,
  id: string,
  opt: { planPath: string; terminalStatus: "done" | "dropped"; reason?: string; deferred?: Deferred[]; closedDate?: string; nowDate?: string } & LockOpts,
) => withLock(root, "completePlanFromRetro", async () => {
  const deferred = opt.deferred ?? [];
  // preconditions — EVERY check BEFORE any write, so the transaction is all-or-nothing.
  if (opt.terminalStatus !== "done" && opt.terminalStatus !== "dropped") throw new OpError(`complete status must be 'done' or 'dropped' (got '${opt.terminalStatus}')`); // before _setPlanStatus, else the plan goes terminal then _itemClose throws (partial write)
  if (opt.terminalStatus === "dropped" && !opt.reason) throw new OpError("drop requires a Reason"); // same: before any write
  await _harvestPreflight(root, deferred);
  const item = findItem((await loadBlocks(taskFile(root, key, "backlog.md"))).blocks, id);
  if (!item) throw new OpError(`item '${id}' not in ${key} backlog`);
  const itemPlan = getField(item, "Plan") ?? "-";
  if (itemPlan !== opt.planPath) throw new OpError(`item '${id}' is linked to plan '${itemPlan}', not '${opt.planPath}' — refusing to complete the wrong plan`);
  if (!(await exists(pathJoin(root, opt.planPath)))) throw new OpError(`plan not found: ${opt.planPath}`);
  // writes
  await _setPlanStatus(root, opt.planPath, opt.terminalStatus);
  await _itemClose(root, key, id, { status: opt.terminalStatus, reason: opt.reason, closedDate: opt.closedDate ?? today(), plan: opt.planPath });
  if (deferred.length) await _harvestApply(root, key, deferred, opt.nowDate ?? today());
  await clearCurrentIfNames(root, opt.planPath);
}, opt);

// pm-context link write: upsert a single link by label (lock-held).
// Block shape mirrors migrate's linkBlock: id = label, no inline title, URL + Triggers + Summary.
async function _addTaskLink(root: string, key: string, l: LinkInput): Promise<void> {
  const label = l.label.trim();
  if (!label || /[*\n\r]/.test(label)) throw new OpError("link label must be non-empty and free of '*' or newlines (it becomes the block id)");
  if (!/^https?:\/\//.test(l.url)) throw new OpError(`link URL must be http(s): '${l.url}'`);
  await assertActiveTask(root, key); // task must exist (refuses bare links.md / archived task)
  const f = await loadBlocks(taskFile(root, key, "links.md"));
  let b = f.blocks.find((x) => x.id.toLowerCase() === label.toLowerCase()); // labels are case-insensitive unique (upsert)
  const dupUrl = f.blocks.find((x) => x !== b && (getField(x, "URL") ?? "").toLowerCase() === l.url.toLowerCase());
  if (dupUrl) throw new OpError(`URL already linked under '${dupUrl.id}' (URL must be unique per task)`);
  if (!b) { b = { id: label, title: "", fields: [] }; f.blocks.push(b); }
  setField(b, "URL", l.url);
  setField(b, "Triggers", l.triggers ?? "");
  setField(b, "Summary", l.summary ?? "");
  await writeBlocks(taskFile(root, key, "links.md"), f.title || `${key} — Links`, f.blocks);
}

// pm-context link removal: drop every link whose label or URL contains `match` (lock-held).
async function _removeTaskLink(root: string, key: string, match: string): Promise<void> {
  await assertActiveTask(root, key);
  const f = await loadBlocks(taskFile(root, key, "links.md"));
  const m = match.toLowerCase();
  const kept = f.blocks.filter((b) => !(b.id.toLowerCase().includes(m) || (getField(b, "URL") ?? "").toLowerCase().includes(m)));
  if (kept.length === f.blocks.length) throw new OpError(`no link matching '${match}' in ${key}`);
  await writeBlocks(taskFile(root, key, "links.md"), f.title || `${key} — Links`, kept);
}

// retro memory write: upsert a single durable-decision note by title (lock-held).
// Block shape mirrors migrate's memBlock: id = title, no inline title, Note + Date.
async function _addTaskMemory(root: string, key: string, m: MemoryInput, nowDate: string): Promise<void> {
  const title = m.title.trim();
  if (!title || /[*\n\r]/.test(title)) throw new OpError("memory note title must be non-empty and free of '*' or newlines (it becomes the block id)");
  await assertActiveTask(root, key); // done tasks allowed; archived refused
  const f = await loadBlocks(taskFile(root, key, "memory.md"));
  let b = findItem(f.blocks, title);
  if (!b) { b = { id: title, title: "", fields: [] }; f.blocks.push(b); }
  setField(b, "Note", m.note ?? "");
  setField(b, "Date", m.date ?? nowDate);
  await writeBlocks(taskFile(root, key, "memory.md"), f.title || `${key} — Memory`, f.blocks);
}

// GUI write ops (links/memory full-state write through the same lock).
export const updateTaskLinks = (root: string, key: string, links: Block[], o: LockOpts = {}) =>
  withLock(root, "updateTaskLinks", () => writeBlocks(taskFile(root, key, "links.md"), `${key} — Links`, links), o);
// pm-context's single-link writers (the CLI `links <KEY> add|remove` surface).
export const addTaskLink = (root: string, key: string, l: LinkInput, o: LockOpts = {}) =>
  withLock(root, "addTaskLink", () => _addTaskLink(root, key, l), o);
export const removeTaskLink = (root: string, key: string, match: string, o: LockOpts = {}) =>
  withLock(root, "removeTaskLink", () => _removeTaskLink(root, key, match), o);
export const updateTaskMemory = (root: string, key: string, memory: Block[], o: LockOpts = {}) =>
  withLock(root, "updateTaskMemory", () => writeBlocks(taskFile(root, key, "memory.md"), `${key} — Memory`, memory), o);
// retro's single-note memory writer (the CLI `memory <KEY> add` surface).
export const addTaskMemory = (root: string, key: string, m: MemoryInput, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "addTaskMemory", () => _addTaskMemory(root, key, m, o.nowDate ?? today()), o);
