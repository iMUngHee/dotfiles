// Read-only invariant validator for the task-first model. Full-task scan over
// tasks/<KEY>/{task,backlog,closed}.md + inbox.md + archive + state pointers.
// Never mutates — fix via ops. CLI: tsx validate.ts [root]  (exit 1 on errors).
import { readdir, stat } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { type Block, parseBlocks, getField, parseFrontmatter, getFmField, taskFile, tasksDir, inboxPath, readStamped } from "./store.ts";
import { listActiveTasks } from "./join.ts";

export interface Violation { level: "error" | "warn"; check: string; id: string; message: string; }
export interface ValidationReport { errors: Violation[]; warns: Violation[]; }

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BACKLOG_STATUS = new Set(["open", "draft", "active"]);
const CLOSED_STATUS = new Set(["done", "dropped"]);
const TASK_STATUS = new Set(["active", "done", "archived"]);

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
  const noteId = (key: string, sec: string, id: string) => `${key}/${sec}/${id}`;

  const scan = async (key: string, dir: string, active: boolean) => {
    const meta = await readStamped(pathJoin(dir, key, "task.md"));
    if (meta) {
      const st = getFmField(parseFrontmatter(meta.content).fields, "status") ?? "";
      if (!TASK_STATUS.has(st)) err("C11", key, `task.md status '${st}' invalid (active|done|archived)`);
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

  // C8 — focus names a backlog item (some active task), not inbox
  const focus = await readState(root, "focus.txt");
  if (focus) {
    const inInbox = (await blocksOf(inboxPath(root))).some((b) => b.id === focus);
    if (inInbox) err("C8", focus, "focus names an _INBOX item (triage first)");
    else {
      let ok = false;
      for (const key of keys) if ((await blocksOf(taskFile(root, key, "backlog.md"))).some((b) => b.id === focus)) { ok = true; break; }
      if (!ok) err("C8", focus, "focus names no open backlog item");
    }
  }

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
