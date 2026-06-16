// Archive terminal plan files older than 30 days into .agents/plans/archive/,
// rewriting any Recently Closed pointer in ROADMAP.md so closed-join resolution
// (resolveClosedJoin / GUI) keeps working. Reference-protected: never moves a plan
// that is draft/active, pointed at by current.txt, or linked by an ## Open item.
//
// Run: tsx archive.ts <repo_root> [--today=YYYY-MM-DD] [--dry-run]
import { readdir, readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap } from "./roadmap.ts";
import { frontmatterField } from "./join.ts";

const AGE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ArchiveResult {
  moved: { plan: string; to: string }[];
  recovered: string[]; // ROADMAP paths rewritten by the idempotent recovery pass
  skipped: { plan: string; reason: string }[];
  dryRun: boolean;
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

// Parse the leading YYYY-MM-DD of a plan filename → UTC ms, or null if malformed
// or calendar-invalid (Date.UTC silently rolls 02-31 → 03-03, so round-trip check).
function planDateMs(name: string): number | null {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})-/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

// Same round-trip validation as planDateMs, but for an explicit --today (full match).
function dayMs(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return NaN;
  const y = Number(ymd.slice(0, 4)), mo = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10));
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
  return ms;
}

// Targeted, byte-stable path rewrite — never reserializes the roadmap, so comments,
// unknown sections, and sub-bullets are preserved verbatim. Boundary-aware: oldRel is
// replaced only when NOT followed by a path char, so `.../a.md` never matches inside
// `.../a.md-extra.md` or any longer filename (would otherwise corrupt an open Plan:).
function rewritePath(text: string, oldRel: string, newRel: string): string {
  const re = new RegExp(oldRel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w./-])", "g");
  return text.replace(re, newRel);
}

export async function archivePlans(
  root: string,
  opts: { today?: string; dryRun?: boolean } = {},
): Promise<ArchiveResult> {
  const plansDir = join(root, ".agents", "plans");
  const archiveDir = join(plansDir, "archive");
  const roadmapPath = join(root, ".agents", "ROADMAP.md");
  const currentPath = join(root, ".agents", "state", "current.txt");

  const result: ArchiveResult = { moved: [], recovered: [], skipped: [], dryRun: !!opts.dryRun };
  const todayMs = opts.today !== undefined ? dayMs(opts.today) : (() => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  })();
  if (Number.isNaN(todayMs)) throw new Error(`invalid today (expected YYYY-MM-DD): ${JSON.stringify(opts.today)}`);

  let roadmapText: string | null = (await exists(roadmapPath)) ? await readFile(roadmapPath, "utf-8") : null;
  const rm = roadmapText != null ? parseRoadmap(roadmapText) : null;
  const currentPlan = (await exists(currentPath)) ? (await readFile(currentPath, "utf-8")).trim() : "";
  const openPlanPaths = new Set((rm?.open ?? []).map((it) => it.plan).filter((p): p is string => !!p));

  // ── idempotent recovery: ROADMAP closed points to plans/X but the file already lives
  //    in archive/ (a prior run crashed between rename and ROADMAP rewrite). ──
  if (rm && roadmapText != null) {
    for (const c of rm.recentlyClosed) {
      const rel = c.plan;
      if (!rel || !rel.startsWith(".agents/plans/") || rel.startsWith(".agents/plans/archive/")) continue;
      const bn = basename(rel);
      if (!(await exists(join(root, rel))) && (await exists(join(archiveDir, bn)))) {
        roadmapText = rewritePath(roadmapText, rel, `.agents/plans/archive/${bn}`);
        result.recovered.push(rel);
      }
    }
  }

  // ── scan plans/*.md (archive/ subdir excluded: only plain files are considered) ──
  const entries = (await exists(plansDir)) ? await readdir(plansDir, { withFileTypes: true }) : [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const name = e.name;
    const dateMs = planDateMs(name);
    if (dateMs == null) { result.skipped.push({ plan: name, reason: "malformed filename (no leading YYYY-MM-DD)" }); continue; }
    const ageDays = Math.floor((todayMs - dateMs) / DAY_MS);
    if (ageDays < AGE_DAYS) { result.skipped.push({ plan: name, reason: `age ${ageDays}d < ${AGE_DAYS}d` }); continue; }
    const status = frontmatterField(await readFile(join(plansDir, name), "utf-8"), "status");
    if (status !== "done" && status !== "dropped") { result.skipped.push({ plan: name, reason: `non-terminal status '${status}'` }); continue; }
    const rel = `.agents/plans/${name}`;
    if (rel === currentPlan) { result.skipped.push({ plan: name, reason: "referenced by current.txt" }); continue; }
    if (openPlanPaths.has(rel)) { result.skipped.push({ plan: name, reason: "referenced by an ## Open item" }); continue; }
    if (await exists(join(archiveDir, name))) { result.skipped.push({ plan: name, reason: "destination collision in archive/" }); continue; }
    result.moved.push({ plan: rel, to: `.agents/plans/archive/${name}` });
    if (roadmapText != null) roadmapText = rewritePath(roadmapText, rel, `.agents/plans/archive/${name}`);
  }

  if (opts.dryRun) return result;

  // apply — order: mkdir → rename plan files → rewrite ROADMAP (temp+rename).
  // Renaming before the ROADMAP write means the file always exists at the archived
  // path before any pointer names it; a crash in between is fixed by recovery next run.
  if (result.moved.length) {
    await mkdir(archiveDir, { recursive: true });
    for (const m of result.moved) await rename(join(root, m.plan), join(root, m.to));
  }
  if (roadmapText != null && (result.moved.length || result.recovered.length)) {
    const tmp = `${roadmapPath}.tmp`;
    await writeFile(tmp, roadmapText);
    await rename(tmp, roadmapPath);
  }
  return result;
}

// ── CLI ──
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--")) || process.cwd();
  const todayEq = args.find((a) => a.startsWith("--today="));
  const today = todayEq ? todayEq.slice("--today=".length) : undefined; // --today=YYYY-MM-DD only (space form would be misread as root)
  const dryRun = args.includes("--dry-run");
  const r = await archivePlans(root, { today, dryRun });
  const tag = r.dryRun ? "[dry-run] " : "";
  for (const m of r.moved) console.log(`${tag}archived: ${m.plan} → ${m.to}`);
  for (const rec of r.recovered) console.log(`${tag}recovered path: ${rec} → archive/`);
  if (!r.moved.length && !r.recovered.length) console.log(`${tag}nothing to archive (need >= ${AGE_DAYS}d old, terminal, unreferenced)`);
  if (r.skipped.length) console.log(`${tag}skipped ${r.skipped.length}: ${r.skipped.map((s) => `${s.plan} (${s.reason})`).join(", ")}`);
}
