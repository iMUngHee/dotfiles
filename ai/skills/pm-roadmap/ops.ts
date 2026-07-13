// ops.ts — deterministic atomic lifecycle transitions on top of store.ts.
// Every mutating op runs under the repo lock; illegal transitions throw OpError.
// The CLI (pm-roadmap.ts), design, retro, and the GUI all call these — nothing
// hand-edits markdown. Internal _impl helpers assume the lock is already held;
// public ops wrap them in withLock so composites reuse one lock (no re-entrancy).
import { readdir, mkdir, rename, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join as pathJoin } from "node:path";
import {
  type Block, parseBlocks, serializeBlocks, getField, setField,
  parseFrontmatter, serializeFrontmatter, getFmField, coerceMode, parseIdList,
  taskDir, taskFile, tasksDir, inboxPath, withLock, readStamped, writeCAS,
} from "./store.ts";
import { makeTarget, regularDescriptor, runTransaction, type TransactionOptions } from "./transaction.ts";
import { listGitWorktrees, mainCheckout, readReservation, withReservationLock, writeCurrentCAS } from "../../lib/worktree.mjs";

export class OpError extends Error {}

const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const TASK_KEY = /^[A-Z0-9_-]+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MODES = new Set(["solo", "collab"]);

export interface ItemInput { id: string; title: string; priority?: string; order?: string; note?: string; plan?: string; }
export interface Deferred { id: string; title: string; priority?: string; order?: string; note?: string; }
export interface MemoryInput { title: string; note?: string; date?: string; by?: string; }
export interface LinkInput { label: string; url: string; triggers?: string; summary?: string; by?: string; }

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

// Shared Order policy: a positive-integer string (no lossy parse). Used by reorder, add, and harvest.
function assertOrder(s: string): void {
  if (!/^[1-9]\d*$/.test(s)) throw new OpError(`order must be a positive integer (got '${s}')`);
}

function backlogBlock(it: ItemInput, status: string): Block {
  const b: Block = { id: it.id, title: it.title, fields: [] };
  setField(b, "Priority", it.priority && PRIORITIES.has(it.priority) ? it.priority : "P2");
  setField(b, "Status", status);
  if (it.order !== undefined) { assertOrder(it.order); setField(b, "Order", it.order); }
  setField(b, "Plan", it.plan ?? "-");
  setField(b, "Note", it.note ?? "");
  return b;
}

// ── directory scans ──
async function listTaskKeys(root: string): Promise<string[]> {
  const ents = await readdir(tasksDir(root), { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory() && TASK_KEY.test(e.name)).map((e) => e.name);
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

// Dependency edges (id → DependsOn targets) over every active task's backlog. Closed items carry
// no DependsOn (dropped on close), so the dependency graph is backlog-only.
async function backlogDepGraph(root: string): Promise<Map<string, string[]>> {
  const g = new Map<string, string[]>();
  for (const key of await listTaskKeys(root)) {
    for (const b of (await loadBlocks(taskFile(root, key, "backlog.md"))).blocks) g.set(b.id, parseIdList(getField(b, "DependsOn")));
  }
  return g;
}
// Can `from` reach `target` by following DependsOn edges? DFS with a visited guard (the pre-existing
// graph is acyclic by C15, but the guard also makes this safe on a corrupt cyclic graph).
function reaches(g: Map<string, string[]>, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === target) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const t of g.get(n) ?? []) stack.push(t);
  }
  return false;
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
  let checkouts: string[];
  try { checkouts = listGitWorktrees(root).map((entry: { path: string }) => entry.path); }
  catch { checkouts = [root]; }
  for (const checkout of checkouts) {
    const current = await readState(checkout, "current.txt");
    if (current === planPath) await writeCurrentCAS(checkout, planPath, "");
  }
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

// Collaboration mode (task.md `mode:`). Absence → solo (legacy task.md keeps working).
async function taskModeOf(root: string, key: string): Promise<string> {
  const meta = await loadTaskMeta(root, key);
  return coerceMode(meta ? getFmField(meta.fields, "mode") : null);
}
async function assertCollab(root: string, key: string): Promise<void> {
  await assertActiveTask(root, key);
  if ((await taskModeOf(root, key)) !== "collab") throw new OpError(`task '${key}' is solo; switch to collab first (pm task set-mode ${key} collab)`);
}

// ── transitions (impl: lock already held) ──
async function _taskCreate(root: string, key: string, title: string, nowDate: string, mode: string): Promise<void> {
  if (!TASK_KEY.test(key)) throw new OpError(`task key '${key}' violates ^[A-Z0-9_-]+$`);
  if (!MODES.has(mode)) throw new OpError(`mode must be solo|collab (got '${mode}')`);
  if (await exists(taskFile(root, key, "task.md"))) throw new OpError(`task '${key}' already exists`);
  if (await exists(pathJoin(archiveDir(root), key))) throw new OpError(`task '${key}' exists in archive; restore it`);
  await mkdir(taskDir(root, key), { recursive: true });
  // mode is always written going forward (absence stays solo only for pre-existing task.md).
  const fm: [string, string][] = [["key", key], ["title", title], ["status", "active"], ["mode", mode], ["created", nowDate], ["updated", nowDate]];
  await writeCAS(taskFile(root, key, "task.md"), serializeFrontmatter(fm, `# ${key} — ${title}\n`), null);
  await writeBlocks(taskFile(root, key, "backlog.md"), `${key} — Backlog`, []);
  await writeBlocks(taskFile(root, key, "closed.md"), `${key} — Closed`, []);
}

// solo↔collab switch. solo→collab assigns the switcher (actor) as Owner to every backlog.md
// item lacking one — across all statuses (open|draft|active), since the solo worker owned all
// in-flight work. closed.md untouched; collab→solo keeps attribution fields (lossless).
// All-or-nothing: the actor precondition is checked BEFORE any write.
async function _taskSetMode(root: string, key: string, mode: string, actor: string, nowDate: string): Promise<{ mode: string; assigned: number; actor: string }> {
  if (!MODES.has(mode)) throw new OpError(`mode must be solo|collab (got '${mode}')`);
  const meta = await loadTaskMeta(root, key);
  if (!meta) throw new OpError(`task '${key}' does not exist`);
  if (await exists(pathJoin(archiveDir(root), key))) throw new OpError(`task '${key}' is archived; restore it first`);
  const cur = getFmField(meta.fields, "mode") || "solo";
  if (mode === "collab" && cur !== "collab") {
    if (!actor) throw new OpError(`collab switch requires an actor — set PM_ACTOR, pass --actor, run 'pm whoami <name>', or set git user.email`);
    const f = await loadBlocks(taskFile(root, key, "backlog.md"));
    let assigned = 0;
    for (const b of f.blocks) if (!(getField(b, "Owner") ?? "").trim()) { setField(b, "Owner", actor); assigned++; }
    setFm(meta.fields, "mode", mode);
    await writeBlocks(taskFile(root, key, "backlog.md"), f.title || `${key} — Backlog`, f.blocks);
    await writeTaskMeta(root, key, meta.fields, meta.body, nowDate);
    return { mode, assigned, actor };
  }
  setFm(meta.fields, "mode", mode);
  await writeTaskMeta(root, key, meta.fields, meta.body, nowDate);
  return { mode, assigned: 0, actor: "" };
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

async function _itemSetPriority(root: string, key: string, id: string, priority: string): Promise<void> {
  await assertActiveTask(root, key);
  if (!PRIORITIES.has(priority)) throw new OpError(`priority must be one of P0|P1|P2|P3 (got '${priority}')`);
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  const it = findItem(f.blocks, id);
  if (!it) throw new OpError(`item '${id}' not in ${key} backlog`);
  setField(it, "Priority", priority);
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
}

async function _itemSetOrder(root: string, key: string, id: string, order: string): Promise<void> {
  await assertActiveTask(root, key);
  assertOrder(order); // shared positive-integer-string policy (no lossy parseInt: 1.5/1abc/1e2 rejected)
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  const it = findItem(f.blocks, id);
  if (!it) throw new OpError(`item '${id}' not in ${key} backlog`);
  setField(it, "Order", order);
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
}

// Set an item's DependsOn edges (comma id list). deps=[] (or "-" from the CLI) clears the field.
// Preflight — ALL checks before any write (ops all-or-nothing): trim+dedup → subject is a backlog
// item → no self-dep → each target is a reserved id (typo guard; closed/inbox/archive ids are
// legal but non-blocking) → no cycle (no target may already reach the subject via the backlog
// dependency graph). Cross-task targets are allowed.
async function _itemSetDeps(root: string, key: string, id: string, deps: string[]): Promise<void> {
  await assertActiveTask(root, key);
  const targets = parseIdList(deps.join(",")); // trim + de-dup, first-occurrence order; ["-"] ⇒ []
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  const it = findItem(f.blocks, id);
  if (!it) throw new OpError(`item '${id}' not in ${key} backlog`);
  if (targets.includes(id)) throw new OpError(`item '${id}' cannot depend on itself`);
  const reserved = await reservedIdsImpl(root);
  for (const t of targets) if (!reserved.has(t)) throw new OpError(`DependsOn target '${t}' is not a known item id`);
  const g = await backlogDepGraph(root);
  g.set(id, []); // drop the subject's OLD edges; a new edge cycles iff a target already reaches the subject
  for (const t of targets) if (reaches(g, t, id)) throw new OpError(`DependsOn '${t}' would create a dependency cycle back to '${id}'`);
  if (targets.length) setField(it, "DependsOn", targets.join(", "));
  else it.fields = it.fields.filter(([k]) => k.toLowerCase() !== "dependson"); // clear
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
}

// Owner attribution (collab only). owner === "-" unassigns (drops Owner + OwnerNote).
// Double-claim guard: refuse overwriting a different existing owner unless force.
async function _itemSetOwner(root: string, key: string, id: string, owner: string, opts: { note?: string; force?: boolean }): Promise<void> {
  await assertCollab(root, key);
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  const it = findItem(f.blocks, id);
  if (!it) throw new OpError(`item '${id}' not in ${key} backlog`);
  const cur = (getField(it, "Owner") ?? "").trim();
  if (owner === "-") { // unassign — drop attribution fields
    it.fields = it.fields.filter(([k]) => k.toLowerCase() !== "owner" && k.toLowerCase() !== "ownernote");
    await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
    return;
  }
  const next = owner.trim();
  if (!next) throw new OpError("owner must be non-empty (or '-' to unassign)");
  if (cur && cur !== next && !opts.force) throw new OpError(`item '${id}' already owned by '${cur}'; pass --force to reassign`);
  setField(it, "Owner", next);
  if (opts.note !== undefined) setField(it, "OwnerNote", opts.note);
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
}

async function _itemSetStatus(root: string, key: string, id: string, status: string): Promise<void> {
  const f = await loadBlocks(taskFile(root, key, "backlog.md"));
  const it = findItem(f.blocks, id);
  if (!it) throw new OpError(`item '${id}' not in ${key} backlog`);
  setField(it, "Status", status);
  await writeBlocks(taskFile(root, key, "backlog.md"), f.title, f.blocks);
}

async function _itemClose(root: string, key: string, id: string, o: { status: "done" | "dropped"; reason?: string; closedDate: string; plan?: string; closedBy?: string }): Promise<void> {
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
  if (o.closedBy) setField(cb, "ClosedBy", o.closedBy); // collab attribution (CLI passes only on collab tasks)
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
    if (d.order !== undefined) assertOrder(d.order); // raw Order validated before any write (backlogBlock throw in _harvestApply would be a partial write)
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

function planContentWithStatus(content: string, status: string): string {
  const fm = content.match(/^(---\n)([\s\S]*?\n)(---\n?)/);
  if (!fm) throw new OpError("plan has no frontmatter");
  const block = /^status:.*$/m.test(fm[2])
    ? fm[2].replace(/^status:.*$/m, `status: ${status}`)
    : `status: ${status}\n${fm[2]}`;
  return fm[1] + block + fm[3] + content.slice(fm[0].length);
}

async function _approvePlanAndItem(root: string, key: string, id: string, transaction: TransactionOptions = {}): Promise<void> {
  const backlogPath = taskFile(root, key, "backlog.md");
  const backlogStamped = await readStamped(backlogPath);
  if (!backlogStamped) throw new OpError(`task '${key}' has no backlog`);
  const backlog = parseBlocks(backlogStamped.content);
  const item = findItem(backlog.blocks, id);
  if (!item) throw new OpError(`item '${id}' not in ${key} backlog`);
  const planRel = getField(item, "Plan") ?? "-";
  if (planRel === "-") throw new OpError(`item '${id}' has no plan`);
  const planStamped = await readStamped(pathJoin(root, planRel));
  if (!planStamped) throw new OpError(`plan not found: ${planRel}`);
  const planStatus = getFmField(parseFrontmatter(planStamped.content).fields, "status");
  if (planStatus !== "draft" && planStatus !== "active") throw new OpError(`plan status '${planStatus}' cannot be approved`);
  setField(item, "Status", "active");
  const targets = [
    await makeTarget(root, pathJoin(root, planRel), regularDescriptor(planContentWithStatus(planStamped.content, "active"))),
    await makeTarget(root, backlogPath, regularDescriptor(serializeBlocks(backlog.title, backlog.blocks))),
  ];
  await runTransaction(root, "approve-plan", targets, transaction);
}

async function _setStandalonePlanStatus(root: string, planRel: string, status: "active" | "done" | "dropped", transaction: TransactionOptions = {}): Promise<void> {
  const path = pathJoin(root, planRel);
  const stamped = await readStamped(path);
  if (!stamped) throw new OpError(`plan not found: ${planRel}`);
  const fm = parseFrontmatter(stamped.content).fields;
  if ((getFmField(fm, "pm_loop") ?? "false") !== "false") throw new OpError(`plan ${planRel} is not standalone`);
  await runTransaction(root, `standalone-${status}`, [
    await makeTarget(root, path, regularDescriptor(planContentWithStatus(stamped.content, status))),
  ], transaction);
}

// ── public ops (each takes the lock; composites reuse one lock) ──
type LockOpts = { nowMs?: number; staleMs?: number; retries?: number; retryMs?: number; transaction?: TransactionOptions };

export const taskCreate = (root: string, key: string, title: string, o: { nowDate?: string; mode?: string } & LockOpts = {}) =>
  withLock(root, "taskCreate", () => _taskCreate(root, key, title, o.nowDate ?? today(), o.mode ?? "solo"), o);

export const taskSetMode = (root: string, key: string, mode: string, actor: string, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "taskSetMode", () => _taskSetMode(root, key, mode, actor, o.nowDate ?? today()), o);

// collaborators roster (task.md `collaborators:`), a normalized comma list. Empty csv clears it.
async function _taskSetCollaborators(root: string, key: string, csv: string, nowDate: string): Promise<void> {
  const meta = await loadTaskMeta(root, key);
  if (!meta) throw new OpError(`task '${key}' does not exist`);
  if (await exists(pathJoin(archiveDir(root), key))) throw new OpError(`task '${key}' is archived; restore it first`);
  setFm(meta.fields, "collaborators", csv.split(",").map((s) => s.trim()).filter(Boolean).join(", "));
  await writeTaskMeta(root, key, meta.fields, meta.body, nowDate);
}
export const taskSetCollaborators = (root: string, key: string, csv: string, o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "taskSetCollaborators", () => _taskSetCollaborators(root, key, csv, o.nowDate ?? today()), o);

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

export const itemSetOwner = (root: string, key: string, id: string, owner: string, o: { note?: string; force?: boolean } & LockOpts = {}) =>
  withLock(root, "itemSetOwner", () => _itemSetOwner(root, key, id, owner, { note: o.note, force: o.force }), o);

export const itemApprove = (root: string, key: string, id: string, o: LockOpts = {}) =>
  withLock(root, "itemApprove", () => _approvePlanAndItem(root, key, id, o.transaction), o);

export const itemSetPlan = (root: string, key: string, id: string, planPath: string, o: LockOpts = {}) =>
  withLock(root, "itemSetPlan", () => _itemSetPlan(root, key, id, planPath), o);

export const itemSetPriority = (root: string, key: string, id: string, priority: string, o: LockOpts = {}) =>
  withLock(root, "itemSetPriority", () => _itemSetPriority(root, key, id, priority), o);

export const itemSetOrder = (root: string, key: string, id: string, order: string, o: LockOpts = {}) =>
  withLock(root, "itemSetOrder", () => _itemSetOrder(root, key, id, order), o);

export const itemSetDeps = (root: string, key: string, id: string, deps: string[], o: LockOpts = {}) =>
  withLock(root, "itemSetDeps", () => _itemSetDeps(root, key, id, deps), o);

export const itemClose = (root: string, key: string, id: string, opt: { status: "done" | "dropped"; reason?: string; closedDate?: string; plan?: string; closedBy?: string } & LockOpts) =>
  withLock(root, "itemClose", () => _itemClose(root, key, id, { status: opt.status, reason: opt.reason, closedDate: opt.closedDate ?? today(), plan: opt.plan, closedBy: opt.closedBy }), opt);

export const dropItem = (root: string, key: string, id: string, opt: { reason: string; closedBy?: string } & LockOpts) =>
  withLock(root, "dropItem", () => _itemClose(root, key, id, { status: "dropped", reason: opt.reason, closedDate: today(), closedBy: opt.closedBy }), opt);

export const harvest = (root: string, key: string, deferred: Deferred[], o: { nowDate?: string } & LockOpts = {}) =>
  withLock(root, "harvest", async () => { await _harvestPreflight(root, deferred); await _harvestApply(root, key, deferred, o.nowDate ?? today()); }, o);

export const triage = (root: string, id: string, toKey: string, o: LockOpts = {}) =>
  withLock(root, "triage", () => _triage(root, id, toKey), o);

export const focusSet = (root: string, id: string, o: LockOpts = {}) => withLock(root, "focusSet", () => _focusSet(root, id), o);
export const focusClear = (root: string, o: LockOpts = {}) => withLock(root, "focusClear", () => writeState(root, "focus.txt", ""), o);
export const setFocus = focusSet;

export const reservedIds = (root: string, o: LockOpts = {}) => withLock(root, "reservedIds", () => reservedIdsImpl(root), o);

async function reconcileMappedPlanOwner(root: string, id: string, planPath: string, key?: string): Promise<{ outcome: "persisted_selected" | "persisted_parked" }> {
  const canonical = await readStamped(pathJoin(root, planPath));
  if (!canonical) throw new OpError(`plan not found: ${planPath}`);
  const fields = parseFrontmatter(canonical.content).fields;
  const worktree = getFmField(fields, "worktree");
  const branch = getFmField(fields, "branch");
  if (getFmField(fields, "id") !== id || getFmField(fields, "status") !== "draft" || !worktree || !branch) {
    throw new OpError(`canonical mapped owner is not a retryable draft: ${planPath}`);
  }
  const pmLoop = (getFmField(fields, "pm_loop") ?? "true").toLowerCase() !== "false";
  if (!!key !== pmLoop) throw new OpError(`canonical plan pm_loop does not match persist mode: ${planPath}`);
  if (key) {
    const item = findItem((await loadBlocks(taskFile(root, key, "backlog.md"))).blocks, id);
    if (!item || getField(item, "Plan") !== planPath || getField(item, "Status") !== "draft") {
      throw new OpError(`canonical mapped owner has no exact draft backlog item: ${key}/${id}`);
    }
  }
  const targetRoot = pathJoin(root, worktree);
  const targetEntry = listGitWorktrees(root).find((entry: { path: string; branch: string }) => pathJoin(entry.path) === pathJoin(targetRoot));
  if (!targetEntry || targetEntry.branch !== branch) throw new OpError(`mapped worktree/branch is unavailable: ${worktree} (${branch})`);
  const targetObserved = await readState(targetRoot, "current.txt");
  if (targetObserved && targetObserved !== planPath) throw new OpError(`target current conflict: ${targetObserved}`);
  await writeCurrentCAS(targetRoot, targetObserved, planPath);
  const mainCurrent = await readState(root, "current.txt");
  return { outcome: mainCurrent === planPath ? "persisted_selected" : "persisted_parked" };
}

// design persist transaction: create+link the item AND point current.txt together.
async function _createPlanAndBacklogItem(
  root: string,
  key: string,
  it: ItemInput,
  planPath: string,
  nowDate: string,
  reservationPaths?: { json: string; stage: string },
): Promise<{ outcome: "persisted_selected" | "persisted_parked" | "persisted_legacy" }> {
    await assertActiveTask(root, key);
    const backlogPath = taskFile(root, key, "backlog.md");
    const backlog = await loadBlocks(backlogPath);
    const existing = findItem(backlog.blocks, it.id);
    if (existing && getField(existing, "Plan") !== planPath) throw new OpError(`id '${it.id}' already used by another plan`);
    if (!existing && (await reservedIdsImpl(root)).has(it.id)) throw new OpError(`id '${it.id}' already used (reserved, no reuse)`);
    if (!existing && await planInUse(root, planPath)) throw new OpError(`plan '${planPath}' already linked (1:1)`);

    const targets = [];
    let reservation: any = null;
    if (reservationPaths) {
      const reservationStamped = await readStamped(reservationPaths.json);
      const stageStamped = await readStamped(reservationPaths.stage);
      if (!reservationStamped) throw new OpError(`reservation '${it.id}' is missing its JSON`);
      reservation = JSON.parse(reservationStamped.content);
      const canonical = await readStamped(pathJoin(root, planPath));
      const ownerContent = stageStamped?.content ?? canonical?.content;
      if (!ownerContent) throw new OpError(`reservation '${it.id}' has neither a staged nor canonical plan`);
      const ownerHash = createHash("sha256").update(ownerContent).digest("hex");
      if (reservation.id !== it.id || reservation.stage_sha256 !== ownerHash) throw new OpError(`reservation '${it.id}' owner hash mismatch`);
      const stagedFm = parseFrontmatter(ownerContent).fields;
      for (const [field, expected] of [["id", it.id], ["status", "draft"], ["branch", reservation.branch], ["worktree", reservation.worktree], ["base_commit", reservation.base_commit]] as [string, string][]) {
        if (getFmField(stagedFm, field) !== expected) throw new OpError(`staged plan ${field} does not match reservation`);
      }
      if (stageStamped && canonical && canonical.content !== stageStamped.content) throw new OpError(`canonical plan conflict: ${planPath}`);
      if (!canonical) targets.push(await makeTarget(root, pathJoin(root, planPath), regularDescriptor(ownerContent)));
      const targetRoot = pathJoin(root, reservation.worktree);
      const targetCurrent = await readState(targetRoot, "current.txt");
      if (targetCurrent && targetCurrent !== planPath) throw new OpError(`target current conflict: ${targetCurrent}`);
    } else if (!(await exists(pathJoin(root, planPath)))) throw new OpError(`plan not found: ${planPath}`);

    if (!existing) {
      backlog.blocks.push(backlogBlock({ ...it, plan: planPath }, "draft"));
      targets.push(await makeTarget(root, backlogPath, regularDescriptor(serializeBlocks(backlog.title || `${key} — Backlog`, backlog.blocks))));
    }
    if (targets.length) await runTransaction(root, "persist-plan", targets);

    if (reservation) {
      const targetRoot = pathJoin(root, reservation.worktree);
      const targetObserved = await readState(targetRoot, "current.txt");
      const targetSeed = await writeCurrentCAS(targetRoot, targetObserved, planPath);
      if (!targetSeed.updated && targetSeed.current !== planPath) throw new OpError(`target pointer reconciliation failed: ${targetSeed.current}`);
      const mainResult = await writeCurrentCAS(root, reservation.expected_main_current ?? "", planPath);
      const outcome = mainResult.updated || mainResult.current === planPath ? "persisted_selected" : "persisted_parked";
      await unlink(reservationPaths!.stage).catch(() => {});
      await unlink(reservationPaths!.json).catch(() => {});
      return { outcome };
    }
    const observed = await readState(root, "current.txt");
    await writeCurrentCAS(root, observed, planPath);
    return { outcome: "persisted_legacy" };
}

export const createPlanAndBacklogItem = async (root: string, key: string, it: ItemInput, planPath: string, o: { nowDate?: string } & LockOpts = {}) => {
  let reservation: any = null;
  let canonicalRoot = root;
  try {
    canonicalRoot = mainCheckout(root);
    reservation = await readReservation(canonicalRoot, it.id);
  } catch {
    reservation = null;
  }
  if (!reservation) {
    return withLock(canonicalRoot, "createPlanAndBacklogItem", async () => {
      const canonical = await readStamped(pathJoin(canonicalRoot, planPath));
      const fields = canonical ? parseFrontmatter(canonical.content).fields : [];
      if (canonical && getFmField(fields, "worktree") && getFmField(fields, "branch")) {
        return reconcileMappedPlanOwner(canonicalRoot, it.id, planPath, key);
      }
      return _createPlanAndBacklogItem(canonicalRoot, key, it, planPath, o.nowDate ?? today());
    }, o);
  }
  return withReservationLock(canonicalRoot, it.id, ({ json, stage }: { json: string; stage: string }) =>
    withLock(canonicalRoot, "createPlanAndBacklogItem", () => _createPlanAndBacklogItem(canonicalRoot, key, it, planPath, o.nowDate ?? today(), { json, stage }), o));
};

export const createStandalonePlan = async (root: string, id: string, planPath: string, o: LockOpts = {}) => {
  const main = mainCheckout(root);
  const reservation = await readReservation(main, id);
  if (!reservation) return withLock(main, "createStandalonePlan", () => reconcileMappedPlanOwner(main, id, planPath), o);
  return withReservationLock(main, id, ({ json, stage }: { json: string; stage: string }) =>
    withLock(main, "createStandalonePlan", async () => {
      const reservationStamped = await readStamped(json);
      const stageStamped = await readStamped(stage);
      if (!reservationStamped) throw new OpError(`reservation '${id}' is missing its JSON`);
      const data = JSON.parse(reservationStamped.content);
      const canonical = await readStamped(pathJoin(main, planPath));
      const ownerContent = stageStamped?.content ?? canonical?.content;
      if (!ownerContent) throw new OpError(`reservation '${id}' has neither a staged nor canonical plan`);
      const ownerHash = createHash("sha256").update(ownerContent).digest("hex");
      const fm = parseFrontmatter(ownerContent).fields;
      if (data.stage_sha256 !== ownerHash || getFmField(fm, "id") !== id || getFmField(fm, "pm_loop") !== "false") {
        throw new OpError(`standalone plan owner does not match reservation '${id}'`);
      }
      if (stageStamped && canonical && canonical.content !== stageStamped.content) throw new OpError(`canonical plan conflict: ${planPath}`);
      const targetRoot = pathJoin(main, data.worktree);
      const targetObserved = await readState(targetRoot, "current.txt");
      if (targetObserved && targetObserved !== planPath) throw new OpError(`target current conflict: ${targetObserved}`);
      if (!canonical) await runTransaction(main, "persist-standalone", [
        await makeTarget(main, pathJoin(main, planPath), regularDescriptor(ownerContent)),
      ]);
      await writeCurrentCAS(targetRoot, targetObserved, planPath);
      const mainResult = await writeCurrentCAS(main, data.expected_main_current ?? "", planPath);
      const outcome = mainResult.updated || mainResult.current === planPath ? "persisted_selected" : "persisted_parked";
      await unlink(stage).catch(() => {});
      await unlink(json).catch(() => {});
      return { outcome };
    }, o));
};

// retro close transaction: plan→terminal + item backlog→closed + harvest + clear pointers, all-or-nothing.
export const completePlanFromRetro = (
  root: string,
  key: string,
  id: string,
  opt: { planPath: string; terminalStatus: "done" | "dropped"; reason?: string; deferred?: Deferred[]; closedDate?: string; nowDate?: string; closedBy?: string } & LockOpts,
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
  const planPath = pathJoin(root, opt.planPath);
  const planStamped = await readStamped(planPath);
  if (!planStamped) throw new OpError(`plan not found: ${opt.planPath}`);
  const backlogPath = taskFile(root, key, "backlog.md");
  const closedPath = taskFile(root, key, "closed.md");
  const backlog = await loadBlocks(backlogPath);
  const index = backlog.blocks.findIndex((block) => block.id === id);
  if (index < 0) throw new OpError(`item '${id}' not in ${key} backlog`);
  const [closing] = backlog.blocks.splice(index, 1);
  for (const d of deferred) backlog.blocks.push(backlogBlock({ ...d }, "open"));
  const closed = await loadBlocks(closedPath);
  const closedBlock: Block = { id, title: closing.title, fields: [] };
  setField(closedBlock, "Status", opt.terminalStatus);
  setField(closedBlock, "Plan", opt.planPath);
  if (opt.reason) setField(closedBlock, "Reason", opt.reason);
  setField(closedBlock, "Closed", opt.closedDate ?? today());
  setField(closedBlock, "ClosedSource", "op");
  if (opt.closedBy) setField(closedBlock, "ClosedBy", opt.closedBy);
  closed.blocks.unshift(closedBlock);
  await runTransaction(root, "complete-plan", [
    await makeTarget(root, planPath, regularDescriptor(planContentWithStatus(planStamped.content, opt.terminalStatus))),
    await makeTarget(root, backlogPath, regularDescriptor(serializeBlocks(backlog.title, backlog.blocks))),
    await makeTarget(root, closedPath, regularDescriptor(serializeBlocks(closed.title, closed.blocks))),
  ], opt.transaction);
  await clearFocusIfNames(root, id);
  await clearCurrentIfNames(root, opt.planPath);
}, opt);

export const standaloneApprove = (root: string, planPath: string, o: LockOpts = {}) =>
  withLock(root, "standaloneApprove", () => _setStandalonePlanStatus(root, planPath, "active", o.transaction), o);

export const standaloneComplete = (root: string, planPath: string, status: "done" | "dropped", o: LockOpts = {}) =>
  withLock(root, "standaloneComplete", async () => {
    await _setStandalonePlanStatus(root, planPath, status, o.transaction);
    await clearCurrentIfNames(root, planPath);
  }, o);

export const planStep = (root: string, planPath: string, step: number, checked: boolean, o: LockOpts = {}) =>
  withLock(root, "planStep", async () => {
    if (!Number.isInteger(step) || step < 1) throw new OpError("plan step must be a positive integer");
    const path = pathJoin(root, planPath);
    const stamped = await readStamped(path);
    if (!stamped) throw new OpError(`plan not found: ${planPath}`);
    let seen = 0;
    let found = false;
    const next = stamped.content.replace(/^- \[[ x]\] (\d+)\./gm, (line, number) => {
      seen++;
      if (Number(number) !== step) return line;
      found = true;
      return line.replace(/^- \[[ x]\]/, checked ? "- [x]" : "- [ ]");
    });
    if (!found) throw new OpError(`plan step ${step} not found (${seen} numbered steps scanned)`);
    await runTransaction(root, checked ? "plan-step-check" : "plan-step-uncheck", [
      await makeTarget(root, path, regularDescriptor(next)),
    ]);
  }, o);

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
  if (l.by) setField(b, "By", l.by); // collab publisher (CLI stamps only on collab tasks)
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
  if (m.by) setField(b, "By", m.by); // collab publisher (CLI stamps only on collab tasks)
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
