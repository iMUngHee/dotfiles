// Read-only invariant validator for .agents/ROADMAP.md and its joins
// (plans, state/current.txt, task-context). Never mutates — violations are
// reported and fixed via the owning paths (/retro, design triggers, manual close).
// CLI: ./node_modules/.bin/tsx validate.ts [project-root]   (exit 1 on errors)
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap, type Roadmap } from "./roadmap.ts";
import { frontmatterField } from "./join.ts";

export interface Violation {
  level: "error" | "warn";
  check: string; // V1..V10
  id: string; // item id or "-" for file-level
  message: string;
}

export interface ValidationReport {
  missingRoadmap: boolean;
  errors: Violation[];
  warns: Violation[];
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TASK_KEY = /^[A-Z0-9_-]+$/;
const OPEN_STATUSES = new Set(["open", "draft", "active"]);

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export async function validateRoadmap(root: string): Promise<ValidationReport> {
  const errors: Violation[] = [];
  const warns: Violation[] = [];
  const err = (check: string, id: string, message: string) => errors.push({ level: "error", check, id, message });
  const warn = (check: string, id: string, message: string) => warns.push({ level: "warn", check, id, message });

  const md = await readFile(join(root, ".agents", "ROADMAP.md"), "utf-8").catch(() => null);
  if (md == null) return { missingRoadmap: true, errors, warns };
  const rm: Roadmap = parseRoadmap(md);

  // V8 — id uniqueness + kebab grammar (open items)
  const seen = new Set<string>();
  for (const it of rm.open) {
    if (seen.has(it.id)) err("V8", it.id, "duplicate item id in ## Open");
    seen.add(it.id);
    if (!KEBAB.test(it.id)) err("V8", it.id, "item id is not kebab-case");
  }

  // V1 — Plan: 1:1 among open items
  const planRefs = new Map<string, string[]>();
  for (const it of rm.open) {
    if (it.plan) planRefs.set(it.plan, [...(planRefs.get(it.plan) ?? []), it.id]);
  }
  for (const [plan, ids] of planRefs) {
    if (ids.length > 1) err("V1", ids.join(","), `plan ${plan} is linked by ${ids.length} items (must be 1:1)`);
  }

  // Per-item checks over ## Open
  for (const it of rm.open) {
    // V4 — section membership
    if (!OPEN_STATUSES.has(it.status)) err("V4", it.id, `status '${it.status}' not allowed in ## Open (open|draft|active)`);

    if (it.plan) {
      // V2 — plan path exists
      const planPath = join(root, it.plan);
      if (!(await exists(planPath))) {
        err("V2", it.id, `plan path missing on disk: ${it.plan}`);
      } else {
        // V3 — status mirrors plan frontmatter verbatim
        const planMd = await readFile(planPath, "utf-8");
        const planStatus = frontmatterField(planMd, "status");
        if (planStatus !== it.status) err("V3", it.id, `item status '${it.status}' ≠ plan status '${planStatus}' (verbatim mirror)`);
      }
    } else {
      // V5 — planless items own only 'open'
      if (it.status !== "open") err("V5", it.id, `planless item has status '${it.status}' (only 'open' allowed)`);
    }

    // V9 — Task KEY grammar + task-context file existence
    if (it.task != null) {
      if (!TASK_KEY.test(it.task)) {
        warn("V9", it.id, `Task '${it.task}' violates KEY grammar ^[A-Z0-9_-]+$`);
      } else if (!(await exists(join(root, ".agents", "task-context", `${it.task}.md`)))) {
        warn("V9", it.id, `task-context file missing for Task '${it.task}'`);
      }
    }
  }

  // Recently Closed checks
  for (const c of rm.recentlyClosed) {
    if (c.status !== "done" && c.status !== "dropped") err("V4", c.id, `closed status '${c.status}' not allowed (done|dropped)`);
    if (!c.plan && c.status === "done") err("V5", c.id, "planless closed entry recorded as done (impossible — no work artifact)");
    // V9 (closed) — same warn-only grade as open; legacy task:null rows are exempt
    if (c.task != null) {
      if (!TASK_KEY.test(c.task)) {
        warn("V9", c.id, `closed Task '${c.task}' violates KEY grammar ^[A-Z0-9_-]+$`);
      } else if (!(await exists(join(root, ".agents", "task-context", `${c.task}.md`)))) {
        warn("V9", c.id, `task-context file missing for closed Task '${c.task}'`);
      }
    }
  }
  // V10 — trim to most recent 10
  if (rm.recentlyClosed.length > 10) warn("V10", "-", `## Recently Closed holds ${rm.recentlyClosed.length} entries (trim to 10)`);

  // V6 — focus is empty or names an ## Open item
  if (rm.focus && !rm.open.some((i) => i.id === rm.focus)) {
    err("V6", rm.focus, "focus names no ## Open item (Focus-clear rule violated)");
  }

  // V7 — current.txt consistency
  const pointerRaw = await readFile(join(root, ".agents", "state", "current.txt"), "utf-8").catch(() => "");
  const pointer = pointerRaw.trim();
  if (pointer) {
    const planPath = join(root, pointer);
    if (!(await exists(planPath))) {
      err("V7", "-", `current.txt points to missing plan: ${pointer}`);
    } else {
      const planStatus = frontmatterField(await readFile(planPath, "utf-8"), "status");
      if (planStatus !== "draft" && planStatus !== "active") {
        err("V7", "-", `current.txt points to '${planStatus}' plan (pointer must be empty unless draft|active)`);
      }
      if (rm.recentlyClosed.some((c) => c.plan === pointer)) {
        err("V7", "-", `current.txt points to a plan recorded in ## Recently Closed: ${pointer}`);
      }
    }
  }

  return { missingRoadmap: false, errors, warns };
}

export function formatReport(report: ValidationReport): string {
  if (report.missingRoadmap) return "no roadmap — run `/pm-roadmap init`";
  const lines = [
    ...report.errors.map((v) => `[error] ${v.check} ${v.id}: ${v.message}`),
    ...report.warns.map((v) => `[warn]  ${v.check} ${v.id}: ${v.message}`),
  ];
  lines.push(
    report.errors.length === 0 && report.warns.length === 0
      ? "roadmap valid — 0 errors, 0 warnings"
      : `${report.errors.length} error(s), ${report.warns.length} warning(s)`,
  );
  return lines.join("\n");
}

// CLI entry: tsx validate.ts [root]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] || process.env.TASK_CONTEXT_ROOT || process.cwd();
  const report = await validateRoadmap(root);
  console.log(formatReport(report));
  process.exit(report.errors.length > 0 ? 1 : 0);
}
