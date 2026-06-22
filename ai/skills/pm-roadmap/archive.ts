// Archive terminal plan FILES (plans/*.md) older than 30 days into plans/archive/,
// rewriting each task's closed.md `Plan:` pointer so closed-join resolution keeps working.
// Reference-protected: never moves a plan named by current.txt or by any backlog item's Plan.
// Idempotent recovery: a closed.md pointer to plans/X whose file already lives in archive/
// is rewritten on the next run. (Task-directory archive/restore lives in ops.ts.)
// CLI: tsx archive.ts <root> [--today=YYYY-MM-DD] [--dry-run]
import { readdir, readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBlocks, serializeBlocks, getField, setField, tasksDir, parseFrontmatter, getFmField, readStamped } from "./store.ts";
import { listActiveTasks } from "./join.ts";

const AGE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ArchiveResult { moved: { plan: string; to: string }[]; recovered: string[]; skipped: { plan: string; reason: string }[]; dryRun: boolean; }

async function exists(p: string): Promise<boolean> { return stat(p).then(() => true).catch(() => false); }

function planDateMs(name: string): number | null {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})-/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], ms = Date.UTC(y, mo - 1, d), back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}
function dayMs(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return NaN;
  const ms = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)), back = new Date(ms);
  return back.toISOString().slice(0, 10) === ymd ? ms : NaN;
}

async function blocksOf(path: string) { const s = await readStamped(path); return s ? parseBlocks(s.content) : { title: "", blocks: [] }; }
async function archiveTaskKeys(root: string): Promise<string[]> {
  const ents = await readdir(join(tasksDir(root), "archive"), { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory()).map((e) => e.name);
}
// every plan referenced by a backlog item (active or archived task) — these are protected.
async function backlogPlanRefs(root: string): Promise<Set<string>> {
  const refs = new Set<string>();
  const scan = async (dir: string, keys: string[]) => {
    for (const k of keys) for (const b of (await blocksOf(join(dir, k, "backlog.md"))).blocks) {
      const p = getField(b, "Plan"); if (p && p !== "-") refs.add(p);
    }
  };
  await scan(tasksDir(root), await listActiveTasks(root));
  await scan(join(tasksDir(root), "archive"), await archiveTaskKeys(root));
  return refs;
}

// rewrite Plan: oldRel → newRel in every task's closed.md (active + archived).
async function rewriteClosedPointer(root: string, oldRel: string, newRel: string): Promise<void> {
  const apply = async (dir: string, keys: string[]) => {
    for (const k of keys) {
      const path = join(dir, k, "closed.md");
      const { title, blocks } = await blocksOf(path);
      let changed = false;
      for (const b of blocks) if (getField(b, "Plan") === oldRel) { setField(b, "Plan", newRel); changed = true; }
      if (changed) await writeFile(path, serializeBlocks(title, blocks));
    }
  };
  await apply(tasksDir(root), await listActiveTasks(root));
  await apply(join(tasksDir(root), "archive"), await archiveTaskKeys(root));
}

export async function archivePlans(root: string, opts: { today?: string; dryRun?: boolean } = {}): Promise<ArchiveResult> {
  const plansDir = join(root, ".agents", "plans");
  const archiveDir = join(plansDir, "archive");
  const result: ArchiveResult = { moved: [], recovered: [], skipped: [], dryRun: !!opts.dryRun };
  const todayMs = opts.today !== undefined ? dayMs(opts.today) : (() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); })();
  if (Number.isNaN(todayMs)) throw new Error(`invalid today (expected YYYY-MM-DD): ${JSON.stringify(opts.today)}`);

  const current = (await readFile(join(root, ".agents", "state", "current.txt"), "utf-8").catch(() => "")).trim();
  const protectedPlans = await backlogPlanRefs(root);

  // ── idempotent recovery: closed.md → plans/X but file already in archive/ ──
  const recoverScan = async (dir: string, keys: string[]) => {
    for (const k of keys) for (const b of (await blocksOf(join(dir, k, "closed.md"))).blocks) {
      const rel = getField(b, "Plan");
      if (!rel || !rel.startsWith(".agents/plans/") || rel.startsWith(".agents/plans/archive/")) continue;
      const bn = basename(rel);
      if (!(await exists(join(root, rel))) && (await exists(join(archiveDir, bn)))) {
        if (!result.dryRun) await rewriteClosedPointer(root, rel, `.agents/plans/archive/${bn}`);
        if (!result.recovered.includes(rel)) result.recovered.push(rel);
      }
    }
  };
  await recoverScan(tasksDir(root), await listActiveTasks(root));
  await recoverScan(join(tasksDir(root), "archive"), await archiveTaskKeys(root));

  // ── scan plans/*.md (skip archive/ subdir) ──
  const entries = (await exists(plansDir)) ? await readdir(plansDir, { withFileTypes: true }) : [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const dateMs = planDateMs(e.name);
    if (dateMs == null) { result.skipped.push({ plan: e.name, reason: "malformed filename" }); continue; }
    const ageDays = Math.floor((todayMs - dateMs) / DAY_MS);
    if (ageDays < AGE_DAYS) { result.skipped.push({ plan: e.name, reason: `age ${ageDays}d < ${AGE_DAYS}d` }); continue; }
    const status = getFmField(parseFrontmatter(await readFile(join(plansDir, e.name), "utf-8")).fields, "status");
    if (status !== "done" && status !== "dropped") { result.skipped.push({ plan: e.name, reason: `non-terminal '${status}'` }); continue; }
    const rel = `.agents/plans/${e.name}`;
    if (rel === current) { result.skipped.push({ plan: e.name, reason: "current.txt" }); continue; }
    if (protectedPlans.has(rel)) { result.skipped.push({ plan: e.name, reason: "referenced by a backlog item" }); continue; }
    if (await exists(join(archiveDir, e.name))) { result.skipped.push({ plan: e.name, reason: "archive collision" }); continue; }
    result.moved.push({ plan: rel, to: `.agents/plans/archive/${e.name}` });
  }

  if (opts.dryRun) return result;

  if (result.moved.length) {
    await mkdir(archiveDir, { recursive: true });
    for (const m of result.moved) {
      await rename(join(root, m.plan), join(root, m.to));   // move file first
      await rewriteClosedPointer(root, m.plan, m.to);        // then fix pointers (crash → recovery next run)
    }
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--")) || process.cwd();
  const todayEq = args.find((a) => a.startsWith("--today="));
  const r = await archivePlans(root, { today: todayEq ? todayEq.slice(8) : undefined, dryRun: args.includes("--dry-run") });
  const tag = r.dryRun ? "[dry-run] " : "";
  for (const m of r.moved) console.log(`${tag}archived: ${m.plan} → ${m.to}`);
  for (const rec of r.recovered) console.log(`${tag}recovered: ${rec} → archive/`);
  if (!r.moved.length && !r.recovered.length) console.log(`${tag}nothing to archive (need ≥${AGE_DAYS}d, terminal, unreferenced)`);
  if (r.skipped.length) console.log(`${tag}skipped ${r.skipped.length}`);
}
