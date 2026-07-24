// One-shot, gated migration of a repo's legacy .agents/ (ROADMAP.md + task-context/
// + memory/) to the task-first model (tasks/<KEY>/* + inbox.md). General: handles
// multiple tasks, taskless→inbox, legacy `## Memory` sections, Context:/Parent: fields,
// missing ROADMAP (no-op), and is idempotent (tasks/ exists → no-op). Self-contained
// legacy parsers (no roadmap.ts dependency, so roadmap.ts can be deleted afterward).
// CLI: tsx migrate.ts <root> [--apply] [--yes]  (default = dry-run, writes nothing).
import { cp, rm, readdir, readFile, writeFile, mkdir, stat, lstat, readlink, realpath } from "node:fs/promises";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Block, serializeBlocks, serializeFrontmatter, taskFile, taskDir, tasksDir, inboxPath, ensureGitignore, parseBlocks, withLock } from "./store.ts";
import { validateRoadmap, formatReport } from "./validate.ts";
import { absentDescriptor, listTransactions, makeTarget, recoverTransactions, regularDescriptor, runTransaction } from "./transaction.ts";
import { listGitWorktrees, mainCheckout } from "../../lib/worktree.mjs";

const SUPERSEDE_NOTE = "single-file-roadmap-verdict";
const today = () => new Date().toISOString().slice(0, 10);
async function exists(p: string): Promise<boolean> { return stat(p).then(() => true).catch(() => false); }

// ── legacy parsers ──
interface LItem { id: string; title: string; priority: string; status: string; order: number; task: string | null; plan: string | null; note: string; }
interface LClosed { id: string; status: "done" | "dropped"; plan: string | null; note: string; task: string | null; }

function taskless(t: string | null): boolean { return t == null || t === "-" || t === "_INBOX"; }

function parseLegacyRoadmap(md: string): { open: LItem[]; closed: LClosed[] } {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  let i = 0;
  if (lines[0]?.trim() === "---") {
    for (i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") { i++; break; }
    }
  }
  let section: "open" | "closed" | null = null, cur: LItem | null = null;
  const open: LItem[] = [], closed: LClosed[] = [];
  const flush = () => { if (cur) open.push(cur); cur = null; };
  for (; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^##\s+(.*)$/);
    if (h) { flush(); const t = h[1].trim().toLowerCase(); section = t.startsWith("open") ? "open" : t.startsWith("recently") ? "closed" : null; continue; }
    if (section === "open") {
      const head = line.match(/^-\s+\*\*([^*]+)\*\*\s*—\s*(.*)$/);
      if (head) { flush(); cur = { id: head[1].trim(), title: head[2].trim(), priority: "P2", status: "open", order: 0, task: null, plan: null, note: "" }; continue; }
      const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
      if (sub && cur) {
        const k = sub[1].toLowerCase(), v = sub[2].trim();
        if (k === "priority") cur.priority = v;
        else if (k === "status") cur.status = v;
        else if (k === "order") cur.order = parseInt(v, 10) || 0;
        else if (k === "task") cur.task = v;
        else if ((k === "context" || k === "parent") && cur.task == null) cur.task = v; // legacy → Task
        else if (k === "plan") cur.plan = v && v !== "-" ? v : null;
        else if (k === "note") cur.note = v;
      }
    } else if (section === "closed") {
      const m = line.match(/^-\s+\*\*([^*]+)\*\*\s*→\s*(.*)$/);
      if (!m) continue;
      const id = m[1].trim();
      let rest = m[2].trim(), task: string | null = null;
      const ts = rest.match(/\s*·\s*Task:\s*([A-Z0-9_-]+)\s*$/);
      if (ts) { task = ts[1]; rest = rest.slice(0, ts.index).trim(); }
      const dropped = rest.match(/^dropped(?:\s*·\s*(.*))?$/);
      if (dropped) closed.push({ id, status: "dropped", plan: null, note: (dropped[1] ?? "").trim(), task });
      else { const lk = rest.match(/^(.*?)\s*\((done|dropped)\)\s*$/); if (lk) closed.push({ id, status: lk[2] as "done" | "dropped", plan: lk[1].trim(), note: "", task }); }
    }
  }
  flush();
  return { open, closed };
}

interface LLink { label: string; url: string; triggers: string; summary: string; }
interface LMem { title: string; note: string; date: string; }
function parseLegacyTaskContext(md: string): { links: LLink[]; memory: LMem[] } {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  const links: LLink[] = [], memory: LMem[] = [];
  let inMem = false, link: LLink | null = null, mem: LMem | null = null;
  const fl = () => { if (link && link.url) links.push(link); link = null; };
  const fm = () => { if (mem && mem.title) memory.push(mem); mem = null; };
  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { fl(); fm(); inMem = h[1].trim().toLowerCase().startsWith("memory"); continue; }
    const top = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (top) { fl(); fm(); if (inMem) mem = { title: top[1].trim(), note: "", date: "" }; else link = { label: top[1].trim(), url: "", triggers: "", summary: "" }; continue; }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
    if (sub) {
      const k = sub[1].toLowerCase(), v = sub[2].trim();
      if (inMem && mem) { if (k === "note") mem.note = v; else if (k === "date") mem.date = v; }
      else if (link) { if (k === "url") link.url = v; else if (k === "triggers") link.triggers = v; else if (k === "summary") link.summary = v; }
    }
  }
  fl(); fm();
  return { links, memory };
}
function parseLegacyMemoryFile(md: string): LMem[] {
  const out: LMem[] = []; let mem: LMem | null = null;
  const fm = () => { if (mem && mem.title) out.push(mem); mem = null; };
  for (const line of md.split("\n")) {
    const top = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (top) { fm(); mem = { title: top[1].trim(), note: "", date: "" }; continue; }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
    if (sub && mem) { const k = sub[1].toLowerCase(), v = sub[2].trim(); if (k === "note") mem.note = v; else if (k === "date") mem.date = v; }
  }
  fm();
  return out;
}

function planDate(rel: string): string { const m = basename(rel).match(/^(\d{4}-\d{2}-\d{2})-/); return m ? m[1] : ""; }

// ── block builders ──
function backlogBlock(it: LItem): Block {
  const f: [string, string][] = [["Priority", it.priority || "P2"], ["Status", it.status || "open"]];
  if (it.order > 0) f.push(["Order", String(it.order)]);
  f.push(["Plan", it.plan ?? "-"], ["Note", it.note || ""]);
  return { id: it.id, title: it.title, fields: f };
}
function inboxBlock(it: LItem): Block {
  return { id: it.id, title: it.title, fields: [["Priority", it.priority || "P2"], ["Status", "open"], ["Note", it.note || ""]] };
}
function closedBlock(c: LClosed): Block {
  const reason = c.status === "dropped" ? (c.note || "(migrated)") : "(migrated)";
  const date = c.plan ? planDate(c.plan) : "";
  return { id: c.id, title: c.id, fields: [["Status", c.status], ["Plan", c.plan ?? "-"], ["Reason", reason], ["Closed", date || "unknown"], ["ClosedSource", c.plan ? "migrated-plan-filename" : "migrated"]] };
}
function linkBlock(l: LLink): Block { return { id: l.label, title: "", fields: [["URL", l.url], ["Triggers", l.triggers], ["Summary", l.summary]] }; }
function memBlock(m: LMem): Block {
  const note = m.title === SUPERSEDE_NOTE ? `${m.note}  | Superseded by pm-task-first-redesign (2026-06-22)` : m.note;
  const f: [string, string][] = [["Note", note]]; if (m.date) f.push(["Date", m.date]);
  return { id: m.title, title: "", fields: f };
}

export interface MigrateResult { out: string; applied: boolean; ok: boolean; noop?: string; }

async function migrateLegacyRoadmap(root: string, opts: { apply?: boolean; yes?: boolean; today?: string; runid?: string } = {}): Promise<MigrateResult> {
  const agents = join(root, ".agents");
  const roadmapPath = join(agents, "ROADMAP.md");
  if (!(await exists(roadmapPath))) return { out: "no .agents/ROADMAP.md — nothing to migrate (no-op)", applied: false, ok: true, noop: "no-legacy" };

  const legacy = parseLegacyRoadmap(await readFile(roadmapPath, "utf-8"));
  const nowDate = opts.today ?? today();

  // group by task
  const tcDir = join(agents, "task-context"), memDir = join(agents, "memory");
  const tcFiles = (await readdir(tcDir).catch(() => [])).filter((f) => f.endsWith(".md"));
  const taskKeys = new Set<string>();
  for (const it of legacy.open) if (!taskless(it.task)) taskKeys.add(it.task!);
  for (const c of legacy.closed) if (!taskless(c.task)) taskKeys.add(c.task!);
  for (const f of tcFiles) taskKeys.add(f.replace(/\.md$/, ""));

  const inboxItems = [...legacy.open.filter((it) => taskless(it.task))];
  const lines: string[] = [`migration plan for ${root}:`];

  // build per-task bundles
  interface Bundle { key: string; backlog: Block[]; closed: Block[]; links: Block[]; memory: Block[]; status: string; }
  const bundles: Bundle[] = [];
  for (const key of [...taskKeys].sort()) {
    const backlog = legacy.open.filter((it) => it.task === key).map(backlogBlock);
    const closed = legacy.closed.filter((c) => c.task === key).map(closedBlock);
    const tcRaw = await readFile(join(tcDir, `${key}.md`), "utf-8").catch(() => "");
    const tc = parseLegacyTaskContext(tcRaw);
    const memRaw = await readFile(join(memDir, `${key}.md`), "utf-8").catch(() => "");
    const memFile = parseLegacyMemoryFile(memRaw);
    const seen = new Set(memFile.map((m) => m.title));
    const memUnion = [...memFile, ...tc.memory.filter((m) => !seen.has(m.title))]; // file ∪ legacy section
    bundles.push({ key, backlog, closed, links: tc.links.map(linkBlock), memory: memUnion.map(memBlock), status: backlog.length ? "active" : "done" });
    lines.push(`  task ${key} [${backlog.length ? "active" : "done"}]: ${backlog.length} open, ${closed.length} closed, ${tc.links.length} links, ${memUnion.length} memory`);
  }
  if (inboxItems.length) lines.push(`  inbox.md: ${inboxItems.length} untriaged (${inboxItems.map((i) => i.id).join(", ")})`);
  if (!opts.apply) { lines.push("", "DRY-RUN — nothing written. Re-run with --apply to migrate (after review)."); return { out: lines.join("\n"), applied: false, ok: true }; }

  // ── APPLY ──
  const runid = opts.runid ?? String(Date.now());
  const backup = join(root, `.agents.backup-${runid}`); // OUTSIDE .agents (cp can't copy a dir into itself)
  await cp(agents, backup, { recursive: true });

  for (const b of bundles) {
    await mkdir(taskDir(root, b.key), { recursive: true });
    await writeFile(taskFile(root, b.key, "task.md"), serializeFrontmatter([["key", b.key], ["title", b.key], ["status", b.status], ["created", nowDate], ["updated", nowDate]], `# ${b.key}\n`));
    await writeFile(taskFile(root, b.key, "backlog.md"), serializeBlocks(`${b.key} — Backlog`, b.backlog));
    await writeFile(taskFile(root, b.key, "closed.md"), serializeBlocks(`${b.key} — Closed`, b.closed));
    await writeFile(taskFile(root, b.key, "links.md"), serializeBlocks(`${b.key} — Links`, b.links));
    await writeFile(taskFile(root, b.key, "memory.md"), serializeBlocks(`${b.key} — Memory`, b.memory));
  }
  if (inboxItems.length) await writeFile(inboxPath(root), serializeBlocks("_INBOX — Inbox", inboxItems.map(inboxBlock)));
  // stamp pm_loop:true on the in-flight plan (current.txt)
  const cur = (await readFile(join(agents, "state", "current.txt"), "utf-8").catch(() => "")).trim();
  if (cur && await exists(join(root, cur))) {
    let pmd = await readFile(join(root, cur), "utf-8");
    if (!/^pm_loop:/m.test(pmd)) pmd = pmd.replace(/^---\n/, "---\npm_loop: true\n");
    await writeFile(join(root, cur), pmd);
  }

  // validate the new tree BEFORE removing anything
  const report = await validateRoadmap(root);
  if (report.errors.length) {
    // FULL rollback: restore the entire pre-migration .agents/ from the backup. A partial
    // cleanup would leave an empty .agents/tasks/ root, and the line-134 guard would then
    // treat the repo as "already migrated" and refuse to re-run. Restoring wholesale also
    // reverts the in-place pm_loop stamp.
    await rm(agents, { recursive: true, force: true });
    await cp(backup, agents, { recursive: true });
    return { out: `${lines.join("\n")}\n\nVALIDATION FAILED — fully rolled back from backup (legacy intact, re-runnable). backup kept: ${backup}\n${formatReport(report)}`, applied: false, ok: false };
  }

  // clean → switch gitignore + remove legacy
  await ensureGitignore(root, ["tasks/", "plans/", "state/", "inbox.md"]);
  await rm(roadmapPath, { force: true });
  await rm(tcDir, { recursive: true, force: true });
  await rm(memDir, { recursive: true, force: true });
  return { out: `${lines.join("\n")}\n\nAPPLIED ✓ — legacy removed (backup: ${backup}). ${formatReport(report)}`, applied: true, ok: true };
}

async function canonicalRoot(root: string): Promise<string> {
  try { return mainCheckout(root); }
  catch { return resolve(root); }
}

async function hasUnsafeTaskRoot(root: string): Promise<boolean> {
  const info = await lstat(tasksDir(root)).catch(() => null);
  return Boolean(info && !info.isDirectory());
}

async function hasTaskFirstData(root: string): Promise<boolean> {
  const authoritativeFiles = new Set(["task.md", "backlog.md", "closed.md", "links.md", "memory.md", "_inbox.md"]);
  const taskRoot = tasksDir(root);
  const rootInfo = await lstat(taskRoot).catch(() => null);
  if (!rootInfo) return false;
  if (!rootInfo.isDirectory()) return true;
  const visit = async (dir: string): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const entryPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) return true;
      if (authoritativeFiles.has(entry.name) && await lstat(entryPath).catch(() => null)) return true;
      if (entry.isDirectory()) {
        if (await visit(join(dir, entry.name))) return true;
      } else if (!entry.isFile()) return true;
    }
    return false;
  };
  return visit(taskRoot);
}

async function managedCheckouts(root: string): Promise<string[]> {
  try { return listGitWorktrees(root).map((entry: { path: string }) => resolve(entry.path)); }
  catch { return [resolve(root)]; }
}

type TransactionFailure = { crashAfter?: number; crashAt?: "prepared" | "applying" | "committed" };

async function relocateInbox(root: string, runid: string, transaction: TransactionFailure = {}): Promise<{ applied: boolean; out: string }> {
  const oldPath = join(root, ".agents", "inbox.md");
  const newPath = inboxPath(root);
  const oldInfo = await lstat(oldPath).catch(() => null);
  if (oldInfo && !oldInfo.isFile()) throw new Error("legacy main inbox must be a regular file");

  const legacyLinks: { checkout: string; path: string }[] = [];
  for (const checkout of await managedCheckouts(root)) {
    if (checkout === resolve(root)) continue;
    const candidate = join(checkout, ".agents", "inbox.md");
    const info = await lstat(candidate).catch(() => null);
    if (!info) continue;
    if (!info.isSymbolicLink()) throw new Error(`inbox migration conflict: ${candidate} is not a symlink`);
    const raw = await readlink(candidate);
    const normalizedTarget = await realpath(resolve(dirname(candidate), raw)).catch(() => resolve(dirname(candidate), raw));
    const normalizedSource = await realpath(oldPath).catch(() => oldPath);
    if (normalizedTarget !== normalizedSource) throw new Error(`inbox migration conflict: ${candidate} targets ${raw}`);
    legacyLinks.push({ checkout, path: candidate });
  }
  if (!oldInfo && !legacyLinks.length) return { applied: false, out: "inbox relocation: already migrated" };

  const targets = [];
  if (oldInfo) {
    const oldRaw = await readFile(oldPath, "utf8");
    const newRaw = await readFile(newPath, "utf8").catch(() => "");
    const oldParsed = parseBlocks(oldRaw);
    const newParsed = parseBlocks(newRaw);
    const newIds = new Set(newParsed.blocks.map((block) => block.id));
    const collisions = oldParsed.blocks.map((block) => block.id).filter((id) => newIds.has(id));
    if (collisions.length) throw new Error(`inbox migration collision: ${collisions.join(", ")}`);
    const merged = serializeBlocks(newParsed.title || oldParsed.title || "_INBOX — Inbox", [...newParsed.blocks, ...oldParsed.blocks]);
    const backup = join(tasksDir(root), `_inbox.legacy-${runid}.md`);
    if (await exists(backup)) throw new Error(`inbox migration backup exists: ${backup}`);
    targets.push(await makeTarget(root, newPath, regularDescriptor(merged)));
    targets.push(await makeTarget(root, backup, regularDescriptor(oldRaw, oldInfo.mode)));
    targets.push(await makeTarget(root, oldPath, absentDescriptor()));
  }
  for (const link of legacyLinks) targets.push(await makeTarget(link.checkout, link.path, absentDescriptor()));
  await runTransaction(root, "migrate-inbox", targets, { id: `migrate-inbox-${runid}`, ...transaction });
  return { applied: true, out: `inbox relocation: ${oldInfo ? "moved to tasks/_inbox.md" : "source already absent"}; removed ${legacyLinks.length} legacy worktree link(s)` };
}

export async function migrate(root: string, opts: { apply?: boolean; yes?: boolean; today?: string; runid?: string; transaction?: TransactionFailure } = {}): Promise<MigrateResult> {
  const main = await canonicalRoot(root);
  const pending = await listTransactions(main);
  if (!opts.apply && pending.length) {
    return { out: `recovery_required: ${pending.join(", ")}`, applied: false, ok: true, noop: "recovery-required" };
  }

  const roadmapPath = join(main, ".agents", "ROADMAP.md");
  const hasRoadmap = await exists(roadmapPath);
  const unsafeTaskRoot = await hasUnsafeTaskRoot(main);
  const taskData = await hasTaskFirstData(main);
  const oldInbox = await exists(join(main, ".agents", "inbox.md"));
  if (unsafeTaskRoot) {
    return { out: "migration conflict: canonical .agents/tasks root must be a real directory", applied: false, ok: false, noop: "reconciliation-conflict" };
  }
  if (hasRoadmap && taskData) {
    return { out: "migration conflict: legacy ROADMAP.md and task-first task.md data both exist", applied: false, ok: false, noop: "reconciliation-conflict" };
  }
  if (!hasRoadmap && !oldInbox && pending.length === 0) {
    const already = await exists(tasksDir(main));
    return {
      out: already ? "task-first store already migrated (no-op)" : "no .agents/ROADMAP.md or legacy inbox — nothing to migrate (no-op)",
      applied: false,
      ok: true,
      noop: already ? "already-migrated" : "no-legacy",
    };
  }

  if (!opts.apply) {
    const parts: string[] = [];
    if (hasRoadmap) parts.push((await migrateLegacyRoadmap(main, { ...opts, apply: false })).out);
    if (oldInbox) parts.push("inbox relocation: .agents/inbox.md → .agents/tasks/_inbox.md");
    parts.push("DRY-RUN — nothing written. Apply re-reads under tasks/.lock.");
    return { out: parts.join("\n\n"), applied: false, ok: true };
  }

  return withLock(main, "migrate", async () => {
    if (await hasUnsafeTaskRoot(main)) {
      return { out: "migration conflict after lock: canonical .agents/tasks root must be a real directory", applied: false, ok: false, noop: "reconciliation-conflict" };
    }
    await recoverTransactions(main);
    const parts: string[] = [];
    let applied = false;
    if (await exists(roadmapPath)) {
      if (await hasTaskFirstData(main)) return { out: "migration conflict after lock: legacy and task-first data coexist", applied: false, ok: false, noop: "reconciliation-conflict" };
      const legacy = await migrateLegacyRoadmap(main, { ...opts, apply: true });
      parts.push(legacy.out);
      if (!legacy.ok) return legacy;
      applied ||= legacy.applied;
    }
    const inbox = await relocateInbox(main, opts.runid ?? String(Date.now()), opts.transaction);
    parts.push(inbox.out);
    applied ||= inbox.applied;
    return { out: parts.join("\n\n"), applied, ok: true, noop: applied ? undefined : "already-migrated" };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--")) || process.cwd();
  const r = await migrate(root, { apply: args.includes("--apply"), yes: args.includes("--yes") });
  console.log(r.out);
  process.exit(r.ok ? 0 : 1);
}
