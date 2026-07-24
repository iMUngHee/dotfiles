// Read-only invariant validator for the task-first model. Full-task scan over
// tasks/<KEY>/{task,backlog,closed}.md + inbox.md + archive + state pointers.
// Never mutates — fix via ops. CLI: tsx validate.ts [root]  (exit 1 on errors).
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join as pathJoin, relative, resolve, sep } from "node:path";
import { type Block, parseBlocks, getField, parseFrontmatter, getFmField, coerceMode, parseIdList, taskFile, tasksDir, inboxPath, readStamped } from "./store.ts";
import { listActiveTasks } from "./join.ts";
import { mainCheckout } from "../../lib/worktree.mjs";

// DFS 3-colour cycle detection over a DependsOn graph (id → targets). Returns the cycle path
// (…→ x → … → x) or null. Targets that are not graph nodes are leaves (no outgoing edges).
function findDepCycle(g: Map<string, string[]>): string[] | null {
  const color = new Map<string, number>(); // 0 white / 1 grey / 2 black
  const stack: string[] = [];
  const dfs = (n: string): string[] | null => {
    color.set(n, 1); stack.push(n);
    for (const t of g.get(n) ?? []) {
      const c = color.get(t) ?? 0;
      if (c === 1) return [...stack.slice(stack.indexOf(t)), t];
      if (c === 0) { const r = dfs(t); if (r) return r; }
    }
    stack.pop(); color.set(n, 2);
    return null;
  };
  for (const n of g.keys()) if ((color.get(n) ?? 0) === 0) { const r = dfs(n); if (r) return r; }
  return null;
}

export interface Violation { level: "error" | "warn"; check: string; id: string; message: string; }
export interface ValidationReport { errors: Violation[]; warns: Violation[]; }

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BACKLOG_STATUS = new Set(["open", "draft", "active"]);
const CLOSED_STATUS = new Set(["done", "dropped"]);
const TASK_STATUS = new Set(["active", "done", "archived"]);
const TASK_MODE = new Set(["solo", "collab"]);

async function canonicalExistingPath(path: string): Promise<string | null> {
  let existing = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(existing), ...missing.reverse());
    } catch (error: any) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") return null;
    }
    const parent = dirname(existing);
    if (parent === existing) return null;
    missing.push(basename(existing));
    existing = parent;
  }
}

function isStrictDescendant(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return !!rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function canonicalManagedRootIdentity(ownershipRoot: string, mainRoot: string, managedRoot: string): Promise<string | null> {
  const lexicalMain = resolve(ownershipRoot);
  const lexicalManaged = resolve(managedRoot);
  const managedRel = relative(lexicalMain, lexicalManaged);
  if (!managedRel || managedRel === ".." || managedRel.startsWith(`..${sep}`) || isAbsolute(managedRel)) return null;
  let cursor = lexicalMain;
  for (const component of managedRel.split(sep).filter(Boolean)) {
    cursor = pathJoin(cursor, component);
    const info = await lstat(cursor).catch((error: any) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!info) break;
    if (info.isSymbolicLink()) return null;
    const canonical = await realpath(cursor).catch(() => null);
    if (!canonical || !isStrictDescendant(mainRoot, canonical)) return null;
  }
  const canonical = await canonicalExistingPath(lexicalManaged);
  return canonical && isStrictDescendant(mainRoot, canonical) ? canonical : null;
}

async function exists(p: string): Promise<boolean> { return stat(p).then(() => true).catch(() => false); }
async function blocksOf(path: string): Promise<Block[]> { const s = await readStamped(path); return s ? parseBlocks(s.content).blocks : []; }
async function readState(root: string, name: string): Promise<string> { const s = await readStamped(pathJoin(root, ".agents", "state", name)); return s ? s.content.trim() : ""; }
async function listArchiveKeys(root: string): Promise<string[]> {
  const ents = await readdir(pathJoin(tasksDir(root), "archive"), { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function validateRoadmap(root: string): Promise<ValidationReport> {
  const errors: Violation[] = [], warns: Violation[] = [];
  const err = (c: string, id: string, m: string) => errors.push({ level: "error", check: c, id, message: m });
  const warn = (c: string, id: string, m: string) => warns.push({ level: "warn", check: c, id, message: m });

  const keys = await listActiveTasks(root);
  const archiveKeys = await listArchiveKeys(root);

  // gather all items (id-uniqueness spans active backlog+closed + inbox + archive)
  const idSeen = new Map<string, string>(); // id → where
  const planRefs = new Map<string, string[]>(); // plan → [where]
  const depEdges = new Map<string, string[]>(); // active-backlog id → DependsOn targets (for C14/C15)
  const noteId = (key: string, sec: string, id: string) => `${key}/${sec}/${id}`;

  const scan = async (key: string, dir: string, active: boolean) => {
    let taskModeVal = "solo";
    let roster: string[] = [];
    const meta = await readStamped(pathJoin(dir, key, "task.md"));
    if (meta) {
      const fm = parseFrontmatter(meta.content).fields;
      const st = getFmField(fm, "status") ?? "";
      if (!TASK_STATUS.has(st)) err("C11", key, `task.md status '${st}' invalid (active|done|archived)`);
      // C12 — mode, if present AND non-blank, must be solo|collab. Absence OR a blank `mode:`
      // value both read as solo (coerceMode), so a blank value is not an error; only a non-empty
      // invalid value (e.g. `mode: xyz`) errors.
      const mode = getFmField(fm, "mode");
      if (mode !== null && mode.trim() !== "" && !TASK_MODE.has(mode)) err("C12", key, `task.md mode '${mode}' invalid (solo|collab)`);
      taskModeVal = coerceMode(mode);
      roster = (getFmField(fm, "collaborators") || "").split(",").map((s) => s.trim()).filter(Boolean);
    }
    for (const sec of ["backlog", "closed"] as const) {
      const blocks = await blocksOf(pathJoin(dir, key, `${sec}.md`));
      for (const b of blocks) {
        // C1 — id unique (global) + kebab
        if (idSeen.has(b.id)) err("C1", b.id, `duplicate id (also at ${idSeen.get(b.id)})`);
        idSeen.set(b.id, noteId(key, sec, b.id));
        if (!KEBAB.test(b.id)) err("C1", b.id, "id is not kebab-case");
        const plan = getField(b, "Plan");
        const status = getField(b, "Status") ?? "";
        // C2 — Plan 1:1 (global)
        if (plan && plan !== "-") planRefs.set(plan, [...(planRefs.get(plan) ?? []), noteId(key, sec, b.id)]);
        if (sec === "backlog") {
          if (!BACKLOG_STATUS.has(status)) err("C5", b.id, `backlog status '${status}' invalid (open|draft|active)`);
          if (!plan || plan === "-") {
            if (status !== "open") err("C6", b.id, `planless backlog item status '${status}' (only open)`);
          } else if (active) {
            // C4 — status mirrors plan frontmatter (active tasks only)
            const pm = await readStamped(pathJoin(root, plan));
            if (!pm) err("C7", b.id, `plan path missing: ${plan}`);
            else {
              const ps = getFmField(parseFrontmatter(pm.content).fields, "status") ?? "";
              if (ps !== status) err("C4", b.id, `status '${status}' ≠ plan status '${ps}' (mirror)`);
            }
          }
          // C13 — collab task: an assigned Owner should be in a non-empty roster (warn; empty roster = opt-out)
          if (active && taskModeVal === "collab" && roster.length) {
            const owner = (getField(b, "Owner") ?? "").trim();
            if (owner && !roster.includes(owner)) warn("C13", b.id, `owner '${owner}' not in ${key} collaborators roster`);
          }
          // C14/C15 — collect DependsOn edges (active backlog only; closed items carry none)
          if (active) { const deps = parseIdList(getField(b, "DependsOn")); if (deps.length) depEdges.set(b.id, deps); }
          // C10 — duplicate Order within a task (warn)
        } else {
          if (!CLOSED_STATUS.has(status)) err("C5", b.id, `closed status '${status}' invalid (done|dropped)`);
          if ((!plan || plan === "-") && status === "done") err("C6", b.id, "planless closed entry recorded as done");
          if (plan && plan !== "-" && !(await exists(pathJoin(root, plan)))) err("C7", b.id, `closed plan path missing: ${plan}`);
        }
      }
      // C10 — duplicate Order within this task's backlog
      if (sec === "backlog") {
        const orders = new Map<number, string>();
        for (const b of blocks) {
          const o = parseInt(getField(b, "Order") ?? "0", 10) || 0;
          if (o > 0) { if (orders.has(o)) warn("C10", b.id, `Order ${o} duplicated in task ${key} (also ${orders.get(o)})`); else orders.set(o, b.id); }
        }
      }
    }
  };

  for (const key of keys) await scan(key, tasksDir(root), true);
  for (const key of archiveKeys) await scan(key, pathJoin(tasksDir(root), "archive"), false);
  // inbox ids count toward uniqueness (no plan/status invariants there)
  for (const b of await blocksOf(inboxPath(root))) {
    if (idSeen.has(b.id)) err("C1", b.id, `duplicate id (also at ${idSeen.get(b.id)})`);
    idSeen.set(b.id, `_INBOX/${b.id}`);
  }

  // C2 — plan 1:1
  for (const [plan, refs] of planRefs) if (refs.length > 1) err("C2", refs.join(","), `plan ${plan} linked by ${refs.length} items (must be 1:1)`);

  // C14 — every DependsOn target is a reserved id (idSeen spans active backlog+closed + inbox + archive).
  for (const [id, targets] of depEdges) for (const t of targets) {
    if (t === id) err("C15", id, "depends on itself");
    else if (!idSeen.has(t)) err("C14", id, `DependsOn target '${t}' is not a known item id`);
  }
  // C15 — no cycle in the backlog dependency graph.
  const cyc = findDepCycle(depEdges);
  if (cyc) err("C15", cyc[0], `dependency cycle: ${cyc.join(" → ")}`);

  // C3/C9 — current.txt points to a draft|active plan linked by exactly one backlog item (unless pm_loop:false)
  const current = await readState(root, "current.txt");
  if (current) {
    const pm = await readStamped(pathJoin(root, current));
    if (!pm) err("C9", "-", `current.txt points to missing plan: ${current}`);
    else {
      const fm = parseFrontmatter(pm.content).fields;
      const ps = getFmField(fm, "status") ?? "";
      const pmLoop = (getFmField(fm, "pm_loop") ?? "true").toLowerCase() !== "false";
      if (ps !== "draft" && ps !== "active") err("C9", "-", `current.txt plan status '${ps}' (must be draft|active)`);
      const linked = (planRefs.get(current) ?? []).length;
      if (pmLoop && linked === 0) err("C3", "-", `in-flight plan ${current} is not linked by any backlog item (orphan; set pm_loop:false if intentional)`);
    }
  }

  // C16 — a non-terminal mapped plan owns one dedicated (never-main) worktree.
  const worktreeOwners = new Map<string, string>();
  let ownershipRoot = root;
  try { ownershipRoot = mainCheckout(root); } catch { /* Non-Git validation fixtures are already canonical. */ }
  const mainRoot = await realpath(resolve(ownershipRoot)).catch(() => resolve(ownershipRoot));
  const managedRoot = resolve(ownershipRoot, ".agents", "worktrees");
  const canonicalManagedRoot = await canonicalManagedRootIdentity(ownershipRoot, mainRoot, managedRoot);
  const planEntries = await readdir(pathJoin(ownershipRoot, ".agents", "plans"), { withFileTypes: true }).catch(() => []);
  for (const entry of planEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const stamped = await readStamped(pathJoin(ownershipRoot, ".agents", "plans", entry.name));
    if (!stamped) continue;
    const fm = parseFrontmatter(stamped.content).fields;
    const status = getFmField(fm, "status") ?? "";
    if (status !== "draft" && status !== "active") continue;
    const worktree = getFmField(fm, "worktree");
    if (!worktree) continue; // legacy unmapped plans remain adoptable
    const normalized = resolve(ownershipRoot, worktree);
    const canonical = await canonicalExistingPath(normalized);
    if (!canonicalManagedRoot || !canonical) {
      err("C16", entry.name, `worktree '${worktree}' has an unresolvable filesystem identity`);
      continue;
    }
    const managedRel = relative(canonicalManagedRoot, canonical);
    if (canonical === mainRoot || !managedRel || managedRel === ".." || managedRel.startsWith(`..${sep}`)) {
      err("C16", entry.name, `worktree '${worktree}' must resolve below .agents/worktrees and never to main`);
      continue;
    }
    const prior = worktreeOwners.get(canonical);
    if (prior) err("C16", entry.name, `worktree '${worktree}' already owned by ${prior}`);
    else worktreeOwners.set(canonical, entry.name);
  }

  return { errors, warns };
}

export function formatReport(r: ValidationReport): string {
  const lines = [
    ...r.errors.map((v) => `[error] ${v.check} ${v.id}: ${v.message}`),
    ...r.warns.map((v) => `[warn]  ${v.check} ${v.id}: ${v.message}`),
  ];
  lines.push(r.errors.length === 0 && r.warns.length === 0 ? "roadmap valid — 0 errors, 0 warnings" : `${r.errors.length} error(s), ${r.warns.length} warning(s)`);
  return lines.join("\n");
}

if (process.argv[1] && (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] || process.env.TASK_CONTEXT_ROOT || process.cwd();
  const report = await validateRoadmap(root);
  console.log(formatReport(report));
  process.exit(report.errors.length > 0 ? 1 : 0);
}
