// CLI entry the pm-* skills call — the single deterministic write path (no
// hand-edited markdown). Read subcmds (list/tree/get/next/recent/validate) +
// write subcmds routed to ops.ts. root = $PM_ROOT or `git rev-parse --show-toplevel`.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ops from "./ops.ts";
import { nextCandidates, resolveItem, buildNextPrompt, recentClosed, listActiveTasks, section, type Candidate } from "./join.ts";
import { validateRoadmap, formatReport } from "./validate.ts";
import { parseBlocks, getField, taskFile, readStamped } from "./store.ts";
import { migrate } from "./migrate.ts";
import { stat } from "node:fs/promises";
import { join } from "node:path";

interface Parsed { pos: string[]; opts: Record<string, string | true>; }
function parseArgs(rest: string[]): Parsed {
  const pos: string[] = [], opts: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--") || (a.startsWith("-") && a.length === 2 && !/^-\d/.test(a))) {
      const key = a.replace(/^-+/, "");
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) opts[key] = true;
      else { opts[key] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opts };
}

async function findTask(root: string, id: string): Promise<string | null> {
  for (const key of await listActiveTasks(root)) {
    for (const f of ["backlog.md", "closed.md"]) {
      const s = await readStamped(taskFile(root, key, f));
      if (s && parseBlocks(s.content).blocks.some((b) => b.id === id)) return key;
    }
  }
  return null;
}

function fmtCandidates(cs: Candidate[]): string {
  if (!cs.length) return "  (none)";
  return cs.map((c) => `  [${c.priority}] ${c.key}/${c.id} — ${c.title}${c.plan ? " *" : ""}`).join("\n");
}

// legacy repo = old ROADMAP.md present but no tasks/ — read paths nudge to migrate.
async function isLegacy(root: string): Promise<boolean> {
  const has = (p: string) => stat(p).then(() => true).catch(() => false);
  return !(await has(join(root, ".agents", "tasks"))) && (await has(join(root, ".agents", "ROADMAP.md")));
}
const READ_CMDS = new Set(["list", "tree", "get", "next", "recent", "validate"]);

export async function runCli(root: string, argv: string[]): Promise<{ out: string; code: number }> {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  const str = (v: string | true | undefined): string | undefined => (typeof v === "string" ? v : undefined);

  if (READ_CMDS.has(cmd) && (await isLegacy(root))) {
    return { out: "⚠ legacy roadmap detected — run `/pm-roadmap migrate` to convert .agents/ROADMAP.md to the task-first model", code: 0 };
  }

  switch (cmd) {
    case "list": {
      const nc = await nextCandidates(root);
      const out = ["## Eligible (next candidates)", fmtCandidates(nc.eligible),
        nc.blocked.length ? "\n## Blocked (earlier-Order sibling open)" : "",
        nc.blocked.length ? nc.blocked.map((c) => `  [${c.priority}] ${c.key}/${c.id} — blocked by ${c.blockedBy}`).join("\n") : "",
        nc.inbox ? `\n> inbox: ${nc.inbox} awaiting triage` : "",
        nc.focus ? `\n> focus: ${nc.focus}` : ""].filter(Boolean).join("\n");
      return { out, code: 0 };
    }
    case "tree": {
      const lines: string[] = [];
      for (const key of await listActiveTasks(root)) {
        const s = await readStamped(taskFile(root, key, "backlog.md"));
        const bl = s ? parseBlocks(s.content).blocks : [];
        lines.push(`${key} (${bl.length} open)`);
        for (const b of bl) lines.push(`  - ${b.id} [${getField(b, "Status")}] ${b.title}`);
      }
      return { out: lines.join("\n") || "(no tasks)", code: 0 };
    }
    case "get": {
      const id = pos[0];
      const key = str(opts.task) ?? (await findTask(root, id));
      if (!key) return { out: `item '${id}' not found`, code: 1 };
      const v = await resolveItem(root, key, id);
      return v ? { out: JSON.stringify(v, null, 2), code: 0 } : { out: `item '${id}' not found in ${key}`, code: 1 };
    }
    case "next": {
      const nc = await nextCandidates(root);
      const id = pos[0] ?? nc.focus ?? undefined;
      if (!id) return { out: "## Choose a candidate (no focus set):\n" + fmtCandidates(nc.eligible), code: 0 };
      const key = str(opts.task) ?? (await findTask(root, id));
      if (!key) return { out: `item '${id}' not found`, code: 1 };
      const v = await resolveItem(root, key, id);
      if (!v) return { out: `item '${id}' not found in ${key}`, code: 1 };
      return { out: buildNextPrompt(v, nc.inbox), code: 0 };
    }
    case "recent": {
      const rows = await recentClosed(root, Number(str(opts.limit) ?? 20));
      return { out: rows.map((r) => `${r.closed}  [${r.status}] ${r.key}/${r.id} — ${r.title}`).join("\n") || "(none)", code: 0 };
    }
    case "validate": {
      const r = await validateRoadmap(root);
      return { out: formatReport(r), code: r.errors.length ? 1 : 0 };
    }
    case "task": {
      const sub = pos[0], key = pos[1];
      if (sub === "create") await ops.taskCreate(root, key, str(opts.title) ?? key);
      else if (sub === "done") await ops.taskDone(root, key);
      else if (sub === "archive") await ops.taskArchive(root, key);
      else if (sub === "restore") await ops.taskRestore(root, key);
      else return { out: `unknown task subcmd '${sub}'`, code: 1 };
      return { out: `task ${key}: ${sub} ok`, code: 0 };
    }
    case "add": {
      const id = pos[0], title = str(opts.title) ?? (pos.slice(1).join(" ") || id);
      const target = opts.inbox ? { inbox: true as const } : { task: str(opts.task)! };
      if (!opts.inbox && !str(opts.task)) return { out: "add needs --task <KEY> or --inbox", code: 1 };
      await ops.itemAdd(root, target, { id, title, priority: str(opts.p), order: opts.o ? Number(str(opts.o)) : undefined });
      return { out: `added ${id}`, code: 0 };
    }
    case "plan": { await ops.itemSetPlan(root, pos[0], pos[1], pos[2]); return { out: `linked ${pos[1]} → ${pos[2]}`, code: 0 }; }
    case "approve": { await ops.itemApprove(root, pos[0], pos[1]); return { out: `approved ${pos[1]}`, code: 0 }; }
    case "close": {
      const status = str(opts.status) ?? "done";
      if (status !== "done" && status !== "dropped") return { out: `close --status must be done|dropped (got '${status}')`, code: 1 };
      await ops.itemClose(root, pos[0], pos[1], { status, reason: str(opts.reason), plan: str(opts.plan) });
      return { out: `closed ${pos[1]}`, code: 0 };
    }
    case "drop": { await ops.dropItem(root, pos[0], pos[1], { reason: str(opts.reason) ?? "" }); return { out: `dropped ${pos[1]}`, code: 0 }; }
    case "triage": { await ops.triage(root, pos[0], pos[1]); return { out: `triaged ${pos[0]} → ${pos[1]}`, code: 0 }; }
    case "focus": {
      if (opts.clear) { await ops.focusClear(root); return { out: "focus cleared", code: 0 }; }
      await ops.focusSet(root, pos[0]); return { out: `focus → ${pos[0]}`, code: 0 };
    }
    case "migrate": {
      const r = await migrate(root, { apply: !!opts.apply, yes: !!opts.yes });
      return { out: r.out, code: r.ok ? 0 : 1 };
    }
    // design persist hook: create+link the item AND point current.txt, one transaction.
    case "persist": {
      const [key, id] = pos;
      const plan = str(opts.plan) ?? pos[2];
      if (!plan) return { out: "persist needs a plan path (--plan or 3rd arg)", code: 1 };
      await ops.createPlanAndBacklogItem(root, key, { id, title: str(opts.title) ?? id }, plan);
      return { out: `persisted ${id} → ${plan}`, code: 0 };
    }
    // retro close hook: plan→terminal + item→closed + structured ## Deferred harvest, atomic.
    case "complete": {
      const [key, id] = pos;
      const plan = str(opts.plan);
      if (!plan) return { out: "complete needs --plan <path>", code: 1 };
      const status = str(opts.status) ?? "done";
      if (status !== "done" && status !== "dropped") return { out: `complete --status must be done|dropped (got '${status}')`, code: 1 };
      const s = await readStamped(join(root, plan));
      const deferred = s
        ? parseBlocks(section(s.content, "Deferred")).blocks.map((b) => ({
            id: b.id, title: b.title,
            priority: getField(b, "Priority") ?? undefined,
            order: getField(b, "Order") ? Number(getField(b, "Order")) : undefined,
            note: getField(b, "Note") ?? undefined,
          }))
        : [];
      await ops.completePlanFromRetro(root, key, id, {
        planPath: plan, terminalStatus: status,
        reason: str(opts.reason), deferred,
      });
      return { out: `completed ${id} (${status})${deferred.length ? `, harvested ${deferred.length} deferred` : ""}`, code: 0 };
    }
    // retro durable-decision sink: upsert one note in tasks/<KEY>/memory.md via ops.
    case "memory": {
      const [key, sub] = pos;
      if (sub !== "add") return { out: "memory subcmd must be 'add'", code: 1 };
      const title = str(opts.title) ?? pos.slice(2).join(" ");
      if (!key || !title) return { out: "memory add needs <KEY> <title> [--note <text>] [--date YYYY-MM-DD]", code: 1 };
      await ops.addTaskMemory(root, key, { title, note: str(opts.note), date: str(opts.date) });
      return { out: `memory ${key}: + ${title}`, code: 0 };
    }
    // pm-context link writes route here (single write path; lock+CAS via ops).
    case "links": {
      const [key, sub] = pos;
      if (sub === "add") {
        const label = str(opts.label) ?? pos[2];
        const url = str(opts.url);
        if (!key || !label || !url) return { out: "links add needs <KEY> <label> --url <url> [--triggers <csv>] [--summary <text>]", code: 1 };
        await ops.addTaskLink(root, key, { label, url, triggers: str(opts.triggers), summary: str(opts.summary) });
        return { out: `links ${key}: + ${label}`, code: 0 };
      }
      if (sub === "remove") {
        const match = str(opts.match) ?? pos[2];
        if (!key || !match) return { out: "links remove needs <KEY> <match>", code: 1 };
        await ops.removeTaskLink(root, key, match);
        return { out: `links ${key}: - ${match}`, code: 0 };
      }
      return { out: "links subcmd must be 'add' or 'remove'", code: 1 };
    }
    // read-only resolver: the task owning the focus item (pm-context's default-KEY source). Empty if no focus.
    case "current-task": {
      const nc = await nextCandidates(root);
      if (!nc.focus) return { out: "", code: 0 };
      return { out: (await findTask(root, nc.focus)) ?? "", code: 0 };
    }
    default:
      return { out: `pm-roadmap <list|tree|get|next|recent|validate|migrate|task|add|plan|approve|close|drop|triage|focus|memory|links|current-task|persist|complete>`, code: cmd ? 1 : 0 };
  }
}

function resolveRoot(): string {
  if (process.env.PM_ROOT) return process.env.PM_ROOT;
  return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { out, code } = await runCli(resolveRoot(), process.argv.slice(2));
    console.log(out);
    process.exit(code);
  } catch (e: any) {
    console.error(`error: ${e?.message ?? e}`);
    process.exit(1);
  }
}
