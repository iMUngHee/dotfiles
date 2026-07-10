// Read-time derivation over the task-first model (tasks/<KEY>/*). No writes.
// Cross-task "next" candidates (deterministic sort + per-task Order gate), capped
// same-task done-sibling inheritance, recent-closed merge, and an item join view.
// ops.ts owns all mutation; this module only reads.
import { readdir } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { type Block, parseBlocks, getField, parseFrontmatter, getFmField, coerceMode, parseIdList, taskFile, tasksDir, inboxPath, readStamped } from "./store.ts";

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const DEFAULT_INHERIT_CAP = 5;

async function read(path: string): Promise<string | null> {
  const s = await readStamped(path);
  return s ? s.content : null;
}
async function blocksOf(path: string): Promise<Block[]> {
  const md = await read(path);
  return md ? parseBlocks(md).blocks : [];
}

export async function listActiveTasks(root: string): Promise<string[]> {
  const ents = await readdir(tasksDir(root), { withFileTypes: true }).catch(() => []);
  return ents.filter((e) => e.isDirectory() && e.name !== "archive").map((e) => e.name).sort();
}

// Collaboration mode from task.md `mode:`. Absence → solo (legacy task.md keeps working).
export async function taskMode(root: string, key: string): Promise<string> {
  const md = await read(taskFile(root, key, "task.md"));
  return coerceMode(md ? frontmatterField(md, "mode") : null);
}
// collaborators roster from task.md `collaborators:` (comma list; empty when unset).
export async function taskCollaborators(root: string, key: string): Promise<string[]> {
  const md = await read(taskFile(root, key, "task.md"));
  const raw = md ? frontmatterField(md, "collaborators") : "";
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

// ── plan-file parsing (plans/*.md keep the design/Goal/Steps/Post-Impl format) ──
export function frontmatterField(md: string, field: string): string {
  return getFmField(parseFrontmatter(md).fields, field) ?? "";
}
export function section(md: string, heading: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) break; body.push(lines[i]); }
  return body.join("\n").trim();
}
export interface PlanInfo { path: string; status: string; goal: string; nextStep: string | null; postImplNotes: string; }
export function planInfo(path: string, md: string): PlanInfo {
  const goal = section(md, "Goal").split(/\n\s*\n/)[0]?.trim() ?? "";
  const next = section(md, "Implementation Steps").split("\n").find((l) => /^-\s+\[ \]/.test(l.trim()));
  return { path, status: frontmatterField(md, "status"), goal, nextStep: next ? next.trim().replace(/^-\s+\[ \]\s*/, "") : null, postImplNotes: postImplNotes(md) };
}
export function postImplNotes(md: string): string {
  return section(md, "Post-Implementation Notes").replace(/<!--[\s\S]*?-->/g, "").trim();
}

// ── next candidates ──
// owner/ownerNote/mode are additive (collab attribution); solo items carry empty owner + mode "solo".
export interface Candidate { key: string; id: string; title: string; priority: string; order: number; plan: string | null; note: string; status: string; owner: string; ownerNote: string; mode: string; dependsOn: string[]; blockedBy?: string; }

function toCandidate(key: string, b: Block, mode: string): Candidate {
  const plan = getField(b, "Plan");
  const orderRaw = getField(b, "Order");
  return {
    key, id: b.id, title: b.title,
    priority: getField(b, "Priority") ?? "P2",
    order: orderRaw ? parseInt(orderRaw, 10) || 0 : 0,
    plan: plan && plan !== "-" ? plan : null,
    note: getField(b, "Note") ?? "",
    status: getField(b, "Status") ?? "open",
    owner: getField(b, "Owner") ?? "",
    ownerNote: getField(b, "OwnerNote") ?? "",
    mode,
    dependsOn: parseIdList(getField(b, "DependsOn")),
  };
}

function candidateSort(a: Candidate, b: Candidate): number {
  return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
    || a.key.localeCompare(b.key)
    || (a.order || 1e9) - (b.order || 1e9)
    || a.id.localeCompare(b.id);
}

// Eligible = not blocked by (a) an unresolved DependsOn target still in some active backlog, or
// (b) an earlier-Order open sibling in the SAME task. A dependency blocker takes precedence; the
// first unresolved target (in DependsOn order) is reported. Cross-task: DependsOn targets resolve
// against every active task's backlog. A target that has left backlog (done/dropped/archived) or
// is an inbox/unknown id does not block.
// Returns sorted eligible + blocked (with blockedBy) + focus + inbox count. No auto-pick.
export async function nextCandidates(root: string): Promise<{ eligible: Candidate[]; blocked: Candidate[]; focus: string | null; inbox: number }> {
  const all: Candidate[] = [];
  for (const key of await listActiveTasks(root)) {
    const mode = await taskMode(root, key); // one read per task; attached to its candidates
    for (const b of await blocksOf(taskFile(root, key, "backlog.md"))) all.push(toCandidate(key, b, mode));
  }
  const backlogIds = new Set(all.map((c) => c.id)); // every item still in an active backlog.md (any status)
  const eligible: Candidate[] = [], blocked: Candidate[] = [];
  for (const c of all) {
    const depBlocker = c.dependsOn.find((t) => t !== c.id && backlogIds.has(t)); // first unresolved dep (list order)
    const earlier = all.find((o) => o.key === c.key && o.order > 0 && c.order > 0 && o.order < c.order);
    const blocker = depBlocker ?? (earlier ? earlier.id : undefined);
    if (blocker) { blocked.push({ ...c, blockedBy: blocker }); } else eligible.push(c);
  }
  eligible.sort(candidateSort);
  const focusRaw = await read(pathJoin(root, ".agents", "state", "focus.txt"));
  const inbox = (await blocksOf(inboxPath(root))).length;
  return { eligible, blocked, focus: focusRaw ? focusRaw.trim() || null : null, inbox };
}

// ── item join view ──
export interface SiblingNote { id: string; notes: string; }
export interface ItemView {
  key: string; id: string; title: string; priority: string; note: string; status: string; closed: boolean;
  owner: string; ownerNote: string; mode: string; dependsOn: string[];
  plan: PlanInfo | null; links: Block[]; memory: Block[]; siblings: SiblingNote[]; siblingsTotal: number;
}

function closedDateOf(b: Block): string { return getField(b, "Closed") ?? ""; }

// Recent same-task done siblings (by Closed date desc, capped) → their plan Post-Impl notes.
export async function doneSiblings(root: string, key: string, excludeId: string, cap = DEFAULT_INHERIT_CAP): Promise<SiblingNote[]> {
  const sorted = (await blocksOf(taskFile(root, key, "closed.md")))
    .filter((b) => b.id !== excludeId && getField(b, "Status") === "done" && getField(b, "Plan") && getField(b, "Plan") !== "-")
    .sort((a, b) => closedDateOf(b).localeCompare(closedDateOf(a)));
  const closed = cap > 0 ? sorted.slice(0, cap) : sorted; // cap<=0 ⇒ unlimited
  const out: SiblingNote[] = [];
  for (const b of closed) {
    const md = await read(pathJoin(root, getField(b, "Plan")!));
    if (md) { const n = postImplNotes(md); if (n) out.push({ id: b.id, notes: n }); }
  }
  return out;
}

export async function resolveItem(root: string, key: string, id: string, cap = DEFAULT_INHERIT_CAP): Promise<ItemView | null> {
  const backlog = await blocksOf(taskFile(root, key, "backlog.md"));
  let b = backlog.find((x) => x.id === id), closed = false;
  if (!b) { b = (await blocksOf(taskFile(root, key, "closed.md"))).find((x) => x.id === id); closed = true; }
  if (!b) return null;
  const planRel = getField(b, "Plan");
  let plan: PlanInfo | null = null;
  if (planRel && planRel !== "-") { const md = await read(pathJoin(root, planRel)); if (md) plan = planInfo(planRel, md); }
  const allSiblings = await doneSiblings(root, key, id, 0); // 0 ⇒ unlimited; slice locally so siblingsTotal is exact
  return {
    key, id, title: b.title,
    priority: getField(b, "Priority") ?? "P2",
    note: getField(b, "Note") ?? "",
    status: getField(b, "Status") ?? (closed ? "done" : "open"),
    closed,
    owner: getField(b, "Owner") ?? "",
    ownerNote: getField(b, "OwnerNote") ?? "",
    mode: await taskMode(root, key),
    dependsOn: parseIdList(getField(b, "DependsOn")),
    plan,
    links: await blocksOf(taskFile(root, key, "links.md")),
    memory: await blocksOf(taskFile(root, key, "memory.md")),
    siblings: cap > 0 ? allSiblings.slice(0, cap) : allSiblings,
    siblingsTotal: allSiblings.length,
  };
}

// Merge all tasks' closed history, newest first, capped — the derived "recent closed" view.
export interface ClosedRow { key: string; id: string; title: string; status: string; plan: string | null; closed: string; reason: string; }
export async function recentClosed(root: string, limit = 20): Promise<ClosedRow[]> {
  const rows: ClosedRow[] = [];
  for (const key of await listActiveTasks(root)) {
    for (const b of await blocksOf(taskFile(root, key, "closed.md"))) {
      rows.push({
        key, id: b.id, title: b.title,
        status: getField(b, "Status") ?? "", plan: getField(b, "Plan") ?? null,
        closed: getField(b, "Closed") ?? "", reason: getField(b, "Reason") ?? "",
      });
    }
  }
  rows.sort((a, b) => b.closed.localeCompare(a.closed));
  return rows.slice(0, limit);
}

// ── collab cross-task views (collab tasks only) ──
// `mine`: open items owned by `actor`. `who`: per-owner board (unassigned grouped under "(unassigned)").
export async function myItems(root: string, actor: string): Promise<Candidate[]> {
  const nc = await nextCandidates(root);
  return [...nc.eligible, ...nc.blocked].filter((c) => c.mode === "collab" && c.owner === actor).sort(candidateSort);
}
export interface BoardEntry { owner: string; items: Candidate[]; }
export async function boardByOwner(root: string): Promise<BoardEntry[]> {
  const nc = await nextCandidates(root);
  const all = [...nc.eligible, ...nc.blocked].filter((c) => c.mode === "collab");
  const map = new Map<string, Candidate[]>();
  for (const c of all) { const k = c.owner || "(unassigned)"; map.set(k, [...(map.get(k) ?? []), c]); }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([owner, items]) => ({ owner, items: items.sort(candidateSort) }));
}

// ── kickoff prompt ──
export function buildNextPrompt(v: ItemView, inbox = 0): string {
  const L: string[] = [];
  L.push(`# Next: ${v.id} — ${v.title}  (${v.priority})`, "");
  const ownerLine = v.mode === "collab" ? ` · owner: ${v.owner || "(unassigned)"}${v.ownerNote ? ` — ${v.ownerNote}` : ""}` : "";
  L.push("## What", v.note || v.title, "", `> task: ${v.key}${ownerLine}`, "");
  if (v.dependsOn.length) {
    L.push("## Depends on");
    for (const d of v.dependsOn) L.push(`- ${d}`);
    L.push("");
  }
  if (v.memory.length) {
    L.push("## Task memory (decisions / things to remember)");
    for (const m of v.memory) { const note = getField(m, "Note"); const by = getField(m, "By"); L.push(`- ${m.title}${note ? `: ${note}` : ""}${by ? ` _(by ${by})_` : ""}`); }
    L.push("");
  }
  if (v.siblings.length) {
    L.push("## Inherited (recent done siblings)");
    for (const s of v.siblings) L.push(`- [${s.id}] ${s.notes.split("\n")[0]}`);
    L.push("");
  }
  L.push(`## External refs (${v.key} links)`);
  if (v.links.length) for (const l of v.links) { const url = getField(l, "URL") ?? ""; const sum = getField(l, "Summary") ?? ""; const by = getField(l, "By"); L.push(`- ${l.title || l.id}: ${url}${sum ? ` — ${sum}` : ""}${by ? ` _(by ${by})_` : ""}`); }
  else L.push(`- (none yet)`);
  L.push("", "## Prior plan state");
  if (v.plan) L.push(`- ${v.plan.path} (${v.plan.status})${v.plan.nextStep ? ` → next step: ${v.plan.nextStep}` : ""}`);
  else L.push(`- no plan yet — start with /design ${v.id}`);
  L.push("", "## Start here", v.plan ? "resume at the next unchecked step above" : `/design ${v.id}`);
  if (inbox > 0) L.push("", `> inbox: ${inbox} item(s) awaiting triage (assign via \`triage <id> <KEY>\`)`);
  return L.join("\n");
}
