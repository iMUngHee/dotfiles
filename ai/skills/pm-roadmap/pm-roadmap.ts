// CLI entry the pm-* skills call — the single deterministic write path (no
// hand-edited markdown). Read subcmds (list/tree/get/next/recent/validate) +
// write subcmds routed to ops.ts. root = $PM_ROOT or `git rev-parse --show-toplevel`.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ops from "./ops.ts";
import { nextCandidates, resolveCurrentPlan, resolveItem, buildNextPrompt, recentClosed, listActiveTasks, section, taskMode, myItems, boardByOwner, type Candidate } from "./join.ts";
import { validateRoadmap, formatReport } from "./validate.ts";
import { requireActor, resolveActor, resolveActorSource } from "./actor.ts";
import { parseBlocks, parseFrontmatter, getField, getFmField, taskFile, readStamped } from "./store.ts";
import { migrate } from "./migrate.ts";
import { stat } from "node:fs/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  adoptPlan,
  assertPlanRoot,
  assertReservationRoot,
  bindSession,
  ensureManagedWorktree,
  pruneManagedWorktree,
  resolveCurrent,
  readReservation,
  validateManagedWorktrees,
} from "../../lib/worktree.mjs";

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

async function assertLifecycleRoot(root: string, plan: string): Promise<void> {
  const stamped = await readStamped(join(root, plan));
  if (!stamped) throw new Error(`plan not found: ${plan}`);
  const fields = parseFrontmatter(stamped.content).fields;
  if (getFmField(fields, "worktree") || getFmField(fields, "branch")) {
    await assertPlanRoot({ root, plan });
  }
}

async function assertPersistRoot(root: string, id: string, plan: string): Promise<void> {
  let reservation = null;
  try { reservation = await readReservation(root, id); } catch { reservation = null; }
  if (reservation) {
    await assertReservationRoot({ root, id });
    return;
  }
  // A successful persist removes its reservation. Retries still have to execute from
  // the canonical plan owner; otherwise main could become an accidental execution root.
  await assertLifecycleRoot(root, plan);
}

// collab badge: @owner when assigned, (unassigned) otherwise; nothing on solo items.
function ownerBadge(c: Candidate): string {
  if (c.mode !== "collab") return "";
  return c.owner ? `  @${c.owner}` : "  (unassigned)";
}
function fmtCandidates(cs: Candidate[]): string {
  if (!cs.length) return "  (none)";
  return cs.map((c) => `  [${c.priority}] ${c.key}/${c.id} — ${c.title}${c.plan ? " *" : ""}${ownerBadge(c)}`).join("\n");
}
// Pure CLI-side collab filter (identity never enters join). Solo items always pass; collab items
// pass when unassigned or owned by `actor`. Used by list/next default (me+unassigned) view.
function filterForActor(cs: Candidate[], actor: string): Candidate[] {
  return cs.filter((c) => c.mode !== "collab" || !c.owner || c.owner === actor);
}

// legacy repo = old ROADMAP.md present but no tasks/ — read paths nudge to migrate.
async function isLegacy(root: string): Promise<boolean> {
  const has = (p: string) => stat(p).then(() => true).catch(() => false);
  return !(await has(join(root, ".agents", "tasks"))) && (await has(join(root, ".agents", "ROADMAP.md")));
}
const READ_CMDS = new Set(["list", "tree", "get", "next", "recent", "validate"]);

export const SESSION_BINDING_PARTIAL_EXIT = 2;
export const SESSION_BINDING_FAILURES = [
  "invalid_tool",
  "missing_session_id",
  "missing_plan",
  "terminal",
  "invalid_plan_status",
  "invalid_mapping",
  "missing_worktree",
  "branch_mismatch",
  "binding_store_unsafe",
  "binding_store_error",
] as const;
const SESSION_BINDING_FAILURE_SET = new Set<string>(SESSION_BINDING_FAILURES);

async function bindLifecyclePlan(root: string, plan: string, operation: "persist" | "select"): Promise<{ line: string; code: number }> {
  const tool = process.env.PM_SESSION_TOOL;
  const sessionId = process.env.PM_SESSION_ID;
  if (!tool && !sessionId) return { line: "session_binding: not_requested", code: 0 };
  const result = await bindSession({ root, tool, sessionId, plan });
  if (result.status === "ok" && result.binding_status === "bound") {
    return { line: "session_binding: bound", code: 0 };
  }
  const reason = SESSION_BINDING_FAILURE_SET.has(result.status) ? result.status : "binding_internal_error";
  return {
    line: `session_binding: unbound (${reason}); do not retry ${operation}`,
    code: SESSION_BINDING_PARTIAL_EXIT,
  };
}

async function lifecycleResult(out: string, root: string, plan: string, operation: "persist" | "select") {
  const binding = await bindLifecyclePlan(root, plan, operation);
  return { out: `${out}\n${binding.line}`, code: binding.code };
}

// By/ClosedBy attribution is stamped ONLY on collab tasks. solo → undefined (no field, no error).
// collab + unresolvable identity → requireActor throws (stop, don't write an anonymous note).
async function collabBy(root: string, key: string, opts: Record<string, string | true>): Promise<string | undefined> {
  if ((await taskMode(root, key)) !== "collab") return undefined;
  return requireActor(root, opts, "collab attribution");
}

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
      // collab default filter: me + unassigned; --all shows everything; --owner X overrides "me".
      const ownerArg = str(opts.owner);
      const actor = ownerArg ?? resolveActor(root, opts);
      const flt = (cs: Candidate[]) => (opts.all || !actor) ? cs : filterForActor(cs, actor);
      const elig = flt(nc.eligible), blk = flt(nc.blocked);
      const out = ["## Eligible (next candidates)", fmtCandidates(elig),
        blk.length ? "\n## Blocked (dependency or earlier-Order sibling)" : "",
        blk.length ? blk.map((c) => `  [${c.priority}] ${c.key}/${c.id} — blocked by ${c.blockedBy}${ownerBadge(c)}`).join("\n") : "",
        nc.inbox ? `\n> inbox: ${nc.inbox} awaiting triage` : ""].filter(Boolean).join("\n");
      return { out, code: 0 };
    }
    case "tree": {
      const lines: string[] = [];
      for (const key of await listActiveTasks(root)) {
        const s = await readStamped(taskFile(root, key, "backlog.md"));
        const bl = s ? parseBlocks(s.content).blocks : [];
        const collab = (await taskMode(root, key)) === "collab";
        lines.push(`${key} (${bl.length} open)${collab ? "  [collab]" : ""}`);
        for (const b of bl) {
          const badge = collab ? ((getField(b, "Owner") ?? "") ? `  @${getField(b, "Owner")}` : "  (unassigned)") : "";
          lines.push(`  - ${b.id} [${getField(b, "Status")}] ${b.title}${badge}`);
        }
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
      const id = pos[0];
      if (!id) {
        // An explicit id bypasses the filter; only the candidate-list path is filtered.
        const ownerArg = str(opts.owner);
        const actor = ownerArg ?? resolveActor(root, opts);
        const elig = (opts.all || !actor) ? nc.eligible : filterForActor(nc.eligible, actor);
        return { out: "## Choose a candidate (nothing is selected automatically):\n" + fmtCandidates(elig), code: 0 };
      }
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
      if (sub === "create") await ops.taskCreate(root, key, str(opts.title) ?? key, { mode: str(opts.mode) });
      else if (sub === "done") await ops.taskDone(root, key);
      else if (sub === "archive") await ops.taskArchive(root, key);
      else if (sub === "restore") await ops.taskRestore(root, key);
      else if (sub === "set-mode") { // ops enforces the actor precondition on solo→collab
        const { actor, source } = resolveActorSource(root, opts);
        const r = await ops.taskSetMode(root, key, pos[2], actor);
        let out = `task ${key}: mode → ${r.mode}`;
        if (r.assigned > 0) out += ` — assigned ${r.assigned} unowned item${r.assigned === 1 ? "" : "s"} to ${r.actor}`;
        if (r.assigned > 0 && source === "git user.email") out += `\n⚠ owner '${r.actor}' resolved from git user.email — if that's a personal address, undo with 'pm task set-mode ${key} solo' or reassign owners; set identity via --actor / PM_ACTOR / 'pm whoami <name>'`;
        return { out, code: 0 };
      }
      else if (sub === "collaborators") { // set the roster (comma list); empty clears it
        await ops.taskSetCollaborators(root, key, pos.slice(2).join(" "));
        return { out: `task ${key}: collaborators → ${pos.slice(2).join(" ") || "(cleared)"}`, code: 0 };
      }
      else return { out: `unknown task subcmd '${sub}'`, code: 1 };
      return { out: `task ${key}: ${sub} ok`, code: 0 };
    }
    case "add": {
      const id = pos[0], title = str(opts.title) ?? (pos.slice(1).join(" ") || id);
      const target = opts.inbox ? { inbox: true as const } : { task: str(opts.task)! };
      if (!opts.inbox && !str(opts.task)) return { out: "add needs --task <KEY> or --inbox", code: 1 };
      await ops.itemAdd(root, target, { id, title, priority: str(opts.p), order: str(opts.o), note: str(opts.note) });
      return { out: `added ${id}`, code: 0 };
    }
    case "plan": { await ops.itemSetPlan(root, pos[0], pos[1], pos[2]); return { out: `linked ${pos[1]} → ${pos[2]}`, code: 0 }; }
    case "reprioritize": { await ops.itemSetPriority(root, pos[0], pos[1], pos[2]); return { out: `reprioritized ${pos[1]} → ${pos[2]}`, code: 0 }; }
    case "reorder": { await ops.itemSetOrder(root, pos[0], pos[1], pos[2]); return { out: `reordered ${pos[1]} → ${pos[2]}`, code: 0 }; }
    // dependency edges: `depend <KEY> <id> <csv|->` sets the full DependsOn list; `-` clears.
    case "depend": {
      const [key, id, targets] = pos;
      if (!key || !id || targets === undefined) return { out: "depend needs <KEY> <id> <csv|->", code: 1 };
      const deps = targets === "-" ? [] : targets.split(",").map((s) => s.trim()).filter(Boolean);
      await ops.itemSetDeps(root, key, id, deps);
      return { out: deps.length ? `depend ${key}/${id} → ${deps.join(", ")}` : `cleared deps on ${key}/${id}`, code: 0 };
    }
    case "approve": {
      if (opts.standalone) {
        const plan = str(opts.plan) ?? pos[0];
        if (!plan) return { out: "approve --standalone needs --plan <path>", code: 1 };
        await assertLifecycleRoot(root, plan);
        await ops.standaloneApprove(root, plan);
        return { out: `approved standalone ${plan}`, code: 0 };
      }
      const approvedView = await resolveItem(root, pos[0], pos[1]);
      if (approvedView?.plan) await assertLifecycleRoot(root, approvedView.plan.path);
      await ops.itemApprove(root, pos[0], pos[1]);
      return { out: `approved ${pos[1]}`, code: 0 };
    }
    case "close": {
      const status = str(opts.status) ?? "done";
      if (status !== "done" && status !== "dropped") return { out: `close --status must be done|dropped (got '${status}')`, code: 1 };
      await ops.itemClose(root, pos[0], pos[1], { status, reason: str(opts.reason), plan: str(opts.plan), closedBy: await collabBy(root, pos[0], opts) });
      return { out: `closed ${pos[1]}`, code: 0 };
    }
    case "drop": { await ops.dropItem(root, pos[0], pos[1], { reason: str(opts.reason) ?? "", closedBy: await collabBy(root, pos[0], opts) }); return { out: `dropped ${pos[1]}`, code: 0 }; }
    case "triage": { await ops.triage(root, pos[0], pos[1]); return { out: `triaged ${pos[0]} → ${pos[1]}`, code: 0 }; }
    case "migrate": {
      const r = await migrate(root, { apply: !!opts.apply, yes: !!opts.yes });
      return { out: r.out, code: r.ok ? 0 : 1 };
    }
    // design persist hook: create+link the item AND point current.txt, one transaction.
    case "persist": {
      const plan = str(opts.plan) ?? pos[2];
      if (!plan) return { out: "persist needs a plan path (--plan or 3rd arg)", code: 1 };
      if (opts.standalone) {
        const id = str(opts.id) ?? pos[0];
        if (!id) return { out: "persist --standalone needs --id <id>", code: 1 };
        await assertPersistRoot(root, id, plan);
        const persisted = await ops.createStandalonePlan(root, id, plan);
        return lifecycleResult(`${persisted.outcome} standalone ${id} → ${plan}`, root, plan, "persist");
      }
      const [key, id] = pos;
      await assertPersistRoot(root, id, plan);
      const persisted = await ops.createPlanAndBacklogItem(root, key, { id, title: str(opts.title) ?? id }, plan);
      return lifecycleResult(`${persisted.outcome} ${id} → ${plan}`, root, plan, "persist");
    }
    // retro close hook: plan→terminal + item→closed + structured ## Deferred harvest, atomic.
    case "complete": {
      const plan = str(opts.plan);
      if (!plan) return { out: "complete needs --plan <path>", code: 1 };
      const status = str(opts.status) ?? "done";
      if (status !== "done" && status !== "dropped") return { out: `complete --status must be done|dropped (got '${status}')`, code: 1 };
      await assertLifecycleRoot(root, plan);
      if (opts.standalone) {
        await ops.standaloneComplete(root, plan, status);
        return { out: `completed standalone ${plan} (${status})`, code: 0 };
      }
      const [key, id] = pos;
      const s = await readStamped(join(root, plan));
      const deferred = s
        ? parseBlocks(section(s.content, "Deferred")).blocks.map((b) => ({
            id: b.id, title: b.title,
            priority: getField(b, "Priority") ?? undefined,
            order: getField(b, "Order") ?? undefined, // raw string preserved; ops assertOrder validates (no lossy Number())
            note: getField(b, "Note") ?? undefined,
          }))
        : [];
      await ops.completePlanFromRetro(root, key, id, {
        planPath: plan, terminalStatus: status,
        reason: str(opts.reason), deferred,
        closedBy: await collabBy(root, key, opts),
      });
      return { out: `completed ${id} (${status})${deferred.length ? `, harvested ${deferred.length} deferred` : ""}`, code: 0 };
    }
    case "reclassify": {
      const [key, id] = pos;
      const plan = str(opts.plan);
      if (!key || !id || !plan) return { out: "reclassify needs <KEY> <id> --plan <path> --status done|dropped [--reason <text>]", code: 1 };
      const status = str(opts.status);
      if (status !== "done" && status !== "dropped") return { out: `reclassify --status must be done|dropped (got '${status ?? ""}')`, code: 1 };
      const reason = str(opts.reason);
      if (status === "done" && opts.reason !== undefined) return { out: "reclassify --status done does not accept --reason", code: 1 };
      if (status === "dropped" && !reason?.trim()) return { out: "reclassify --status dropped requires a non-empty --reason", code: 1 };
      const result = await ops.reclassifyClosedPlan(root, key, id, {
        planPath: plan, terminalStatus: status, reason,
      });
      if (result.outcome === "unchanged") return { out: `unchanged ${id} (${status})`, code: 0 };
      return { out: `reclassified ${id} (plan ${result.planFrom}→${status}, item ${result.itemFrom}→${status})`, code: 0 };
    }
    case "plan-step": {
      const [action, plan, rawStep] = pos;
      if (action !== "check" && action !== "uncheck") return { out: "plan-step needs check|uncheck <plan> <step>", code: 1 };
      await assertLifecycleRoot(root, plan);
      await ops.planStep(root, plan, Number(rawStep), action === "check");
      return { out: `plan-step ${action} ${plan} ${rawStep}`, code: 0 };
    }
    case "select": {
      const plan = str(opts.plan) ?? pos[0];
      if (!plan) return { out: "select needs --plan <path>", code: 1 };
      const result = await ops.selectPlan(root, plan);
      if (!result.selected) return { out: result.reason, code: 1 };
      return lifecycleResult(`selected ${plan}`, root, plan, "select");
    }
    case "worktree": {
      const [sub] = pos;
      let result: unknown;
      if (sub === "resolve") result = await resolveCurrent(root);
      else if (sub === "ensure") result = await ensureManagedWorktree({ root, id: str(opts.id), base: str(opts.base), baseCommit: str(opts["base-commit"]), start: str(opts.start), branch: str(opts.branch), worktree: str(opts.path) });
      else if (sub === "adopt") result = await adoptPlan({ root, plan: str(opts.plan), base: str(opts.base), baseCommit: str(opts["base-commit"]), start: str(opts.start), branch: str(opts.branch), worktree: str(opts.path), select: !!opts.select });
      else if (sub === "validate") result = await validateManagedWorktrees(root, { all: Boolean(opts.all) });
      else if (sub === "prune") result = await pruneManagedWorktree({ root, plan: str(opts.plan) });
      else return { out: "worktree needs resolve|ensure|adopt|validate|prune", code: 1 };
      return { out: JSON.stringify(result, null, 2), code: 0 };
    }
    // retro durable-decision sink: upsert one note in tasks/<KEY>/memory.md via ops.
    case "memory": {
      const [key, sub] = pos;
      if (sub !== "add") return { out: "memory subcmd must be 'add'", code: 1 };
      const title = str(opts.title) ?? pos.slice(2).join(" ");
      if (!key || !title) return { out: "memory add needs <KEY> <title> [--note <text>] [--date YYYY-MM-DD]", code: 1 };
      await ops.addTaskMemory(root, key, { title, note: str(opts.note), date: str(opts.date), by: await collabBy(root, key, opts) });
      return { out: `memory ${key}: + ${title}`, code: 0 };
    }
    // pm-context link writes route here (single write path; lock+CAS via ops).
    case "links": {
      const [key, sub] = pos;
      if (sub === "add") {
        const label = str(opts.label) ?? pos[2];
        const url = str(opts.url);
        if (!key || !label || !url) return { out: "links add needs <KEY> <label> --url <url> [--triggers <csv>] [--summary <text>]", code: 1 };
        await ops.addTaskLink(root, key, { label, url, triggers: str(opts.triggers), summary: str(opts.summary), by: await collabBy(root, key, opts) });
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
    // collab ownership: assign sets an explicit owner ('-' unassigns); claim self-assigns the resolved actor.
    case "assign": {
      const [key, id, owner] = pos;
      if (!key || !id || !owner) return { out: "assign needs <KEY> <id> <owner|->  [--note <text>] [--force]", code: 1 };
      await ops.itemSetOwner(root, key, id, owner, { note: str(opts.note), force: !!opts.force });
      return { out: owner === "-" ? `unassigned ${key}/${id}` : `assign ${key}/${id} → ${owner}`, code: 0 };
    }
    case "claim": {
      const [key, id] = pos;
      if (!key || !id) return { out: "claim needs <KEY> <id> [--note <text>] [--force]", code: 1 };
      const actor = requireActor(root, opts, "claim");
      await ops.itemSetOwner(root, key, id, actor, { note: str(opts.note), force: !!opts.force });
      return { out: `claim ${key}/${id} → ${actor}`, code: 0 };
    }
    // collab cross-task views: `mine` = my open owned items; `who` = per-owner board.
    case "mine": {
      const actor = requireActor(root, opts, "mine");
      const items = await myItems(root, actor);
      return { out: items.length ? items.map((c) => `  [${c.priority}] ${c.key}/${c.id} — ${c.title}`).join("\n") : `(no open items owned by ${actor})`, code: 0 };
    }
    case "who": {
      const board = await boardByOwner(root);
      if (!board.length) return { out: "(no collab tasks)", code: 0 };
      const lines: string[] = [];
      for (const e of board) { lines.push(`${e.owner} (${e.items.length})`); for (const c of e.items) lines.push(`  [${c.priority}] ${c.key}/${c.id} — ${c.title}`); }
      return { out: lines.join("\n"), code: 0 };
    }
    // collab identity: `whoami` prints resolved actor + source; `whoami <name>` writes state/actor.txt (worktree-local).
    case "whoami": {
      const name = pos[0];
      if (name) {
        const dir = join(root, ".agents", "state");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "actor.txt"), `${name.trim()}\n`);
        return { out: `actor.txt → ${name.trim()}`, code: 0 };
      }
      const { actor, source } = resolveActorSource(root, opts);
      return { out: actor ? `${actor}  (source: ${source})` : "(no actor — set PM_ACTOR, run 'pm whoami <name>', or set git user.email)", code: 0 };
    }
    // Read-only launcher/dashboard projection for the checkout-local selected plan.
    case "current-task": {
      const current = await resolveCurrentPlan(root);
      return { out: current.state === "linked" ? current.item.key : "", code: 0 };
    }
    default:
      return { out: `pm-roadmap <list|tree|get|next|recent|validate|migrate|task|add|plan|reprioritize|reorder|depend|approve|close|drop|triage|memory|links|current-task|persist|complete|reclassify|plan-step|select|worktree|whoami|assign|claim|mine|who>`, code: cmd ? 1 : 0 };
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
