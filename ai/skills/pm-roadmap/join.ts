// Read-time join: a backlog item → its task's context (links + memory) + plan
// + same-task siblings. No copying; everything resolved fresh from files.
import { readFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import type { Roadmap, RoadmapItem } from "./roadmap.ts";
import { type TaskMemory, readTaskMemory } from "./memory.ts";

export type { TaskMemory };

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function frontmatterField(md: string, field: string): string {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return "";
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const m = lines[i].match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m && m[1].toLowerCase() === field.toLowerCase()) return m[2].trim();
  }
  return "";
}

export function section(md: string, heading: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

export interface PlanInfo { path: string; status: string; goal: string; nextStep: string | null; }

export function planInfo(path: string, md: string): PlanInfo {
  const goal = section(md, "Goal").split(/\n\s*\n/)[0]?.trim() ?? "";
  const next = section(md, "Implementation Steps").split("\n").find((l) => /^-\s+\[ \]/.test(l.trim()));
  return { path, status: frontmatterField(md, "status"), goal, nextStep: next ? next.trim().replace(/^-\s+\[ \]\s*/, "") : null };
}
export function postImplNotes(md: string): string {
  return section(md, "Post-Implementation Notes").replace(/<!--[\s\S]*?-->/g, "").trim();
}

export interface TaskLink { label: string; url: string; summary: string; }

// Parse a task-context file into links (top-level blocks with URL) + memory (## Memory blocks).
export function parseTaskContext(md: string): { links: TaskLink[]; memory: TaskMemory[] } {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  const links: TaskLink[] = [];
  const memory: TaskMemory[] = [];
  let inMemory = false;
  let link: TaskLink | null = null;
  let mem: TaskMemory | null = null;
  const flushLink = () => { if (link && link.url) links.push(link); link = null; };
  const flushMem = () => { if (mem && mem.title) memory.push(mem); mem = null; };

  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      flushLink(); flushMem();
      inMemory = h[1].trim().toLowerCase().startsWith("memory");
      continue;
    }
    const top = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (top) {
      flushLink(); flushMem();
      if (inMemory) mem = { title: top[1].trim(), note: "", date: "" };
      else link = { label: top[1].trim(), url: "", summary: "" };
      continue;
    }
    const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
    if (sub) {
      const k = sub[1].toLowerCase(), v = sub[2].trim();
      if (inMemory && mem) { if (k === "note") mem.note = v; else if (k === "date") mem.date = v; }
      else if (link) { if (k === "url") link.url = v; else if (k === "summary") link.summary = v; }
    }
  }
  flushLink(); flushMem();
  return { links, memory };
}

// "Next to work on": explicit id → focus → eligible item.
// Eligibility respects per-task work sequence: an item is blocked while an
// earlier-Order item in the SAME task is still open. Among eligible, sort by
// priority (P0→P3), then Order, then file order (stable).
export function selectTarget(rm: Roadmap, id?: string): RoadmapItem | null {
  if (id) return rm.open.find((i) => i.id === id) ?? null;
  if (rm.focus) { const f = rm.open.find((i) => i.id === rm.focus); if (f) return f; }
  // _INBOX (task: null) items are not designable until triaged → never auto-selected
  const candidates = rm.open.filter((it) => it.task != null);
  const blocked = (it: RoadmapItem) =>
    it.order > 0 &&
    rm.open.some((o) => o.task === it.task && o.order > 0 && o.order < it.order);
  const eligible = candidates.filter((it) => !blocked(it));
  const pool = eligible.length ? eligible : candidates;
  return [...pool].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
    (a.order || 1e9) - (b.order || 1e9),
  )[0] ?? null;
}

// Items awaiting triage in the virtual _INBOX (task: null).
export function inboxCount(rm: Roadmap): number {
  return rm.open.filter((it) => it.task == null).length;
}

export interface SiblingNote { id: string; status: string; notes: string; }
export interface OpenJoinView {
  closed: false;
  item: RoadmapItem;
  plan: PlanInfo | null;
  task: string | null;
  contextLinks: TaskLink[];
  contextMemory: TaskMemory[];
  siblings: SiblingNote[];
  note: string;
}
// Reduced join for a Recently Closed entry: ClosedEntry carries no
// title/priority, so the view is the record (incl. its close-time task, null
// for legacy rows) + plan + post-impl notes only.
// buildNextPrompt accepts OpenJoinView exclusively — closed never reaches it.
export interface ClosedJoinView {
  closed: true;
  item: { id: string; status: string; plan: string | null; note: string; task: string | null };
  plan: PlanInfo | null;
  postImplNotes: string;
}
export type JoinView = OpenJoinView | ClosedJoinView;

async function tryRead(path: string): Promise<string | null> {
  try { return await readFile(path, "utf-8"); } catch { return null; }
}

export async function resolveJoin(root: string, rm: Roadmap, id: string): Promise<JoinView | null> {
  const item = rm.open.find((i) => i.id === id);
  if (!item) return resolveClosedJoin(root, rm, id); // open wins; closed is the fallback

  let plan: PlanInfo | null = null;
  if (item.plan) { const md = await tryRead(pathJoin(root, item.plan)); if (md) plan = planInfo(item.plan, md); }

  let contextLinks: TaskLink[] = [], contextMemory: TaskMemory[] = [];
  if (item.task) {
    const md = await tryRead(pathJoin(root, ".agents", "task-context", `${item.task}.md`));
    const parsed = md ? parseTaskContext(md) : { links: [], memory: [] };
    contextLinks = parsed.links;
    contextMemory = await readTaskMemory(root, item.task, parsed.memory); // union: memory file + legacy section
  }

  // siblings = same-task open items; plus done items from recently-closed (best-effort, carry plan notes)
  const siblings: SiblingNote[] = [];
  for (const sib of rm.open) {
    if (sib.id === item.id || item.task == null || sib.task !== item.task) continue;
    siblings.push({ id: sib.id, status: sib.status, notes: "" });
  }
  for (const c of rm.recentlyClosed) {
    if (c.status === "done" && c.plan) {
      // task-exact when the closed record carries a task; legacy (task: null)
      // rows keep the historical best-effort inclusion.
      if (c.task != null && c.task !== item.task) continue;
      const md = await tryRead(pathJoin(root, c.plan));
      if (md) { const notes = postImplNotes(md); if (notes) siblings.push({ id: c.id, status: "done", notes }); }
    }
  }

  return { closed: false, item, plan, task: item.task, contextLinks, contextMemory, siblings, note: item.note };
}

// Exported: the server's `?scope=closed` route calls this directly so a closed
// row stays reachable even when an open item shares the same id (open wins in resolveJoin).
export async function resolveClosedJoin(root: string, rm: Roadmap, id: string): Promise<ClosedJoinView | null> {
  const c = rm.recentlyClosed.find((e) => e.id === id);
  if (!c) return null;
  let plan: PlanInfo | null = null, notes = "";
  if (c.plan) {
    const md = await tryRead(pathJoin(root, c.plan));
    if (md) { plan = planInfo(c.plan, md); notes = postImplNotes(md); }
  }
  return { closed: true, item: { id: c.id, status: c.status, plan: c.plan, note: c.note, task: c.task }, plan, postImplNotes: notes };
}

export function buildNextPrompt(j: OpenJoinView, inbox = 0): string {
  const L: string[] = [];
  L.push(`# Next: ${j.item.id} — ${j.item.title}  (${j.item.priority})`, "");
  L.push("## What", j.note || j.item.title, "");
  if (j.task) L.push(`> task: ${j.task}`, "");
  if (j.contextMemory.length) {
    L.push("## Task memory (decisions / things to remember)");
    for (const m of j.contextMemory) L.push(`- ${m.title}${m.note ? `: ${m.note}` : ""}`);
    L.push("");
  }
  if (j.siblings.some((s) => s.notes)) {
    L.push("## Inherited (done siblings)");
    for (const s of j.siblings.filter((x) => x.notes)) L.push(`- [${s.id}] ${s.notes.split("\n")[0]}`);
    L.push("");
  }
  if (j.task) {
    L.push(`## External refs (task-context: ${j.task})`);
    if (j.contextLinks.length) for (const l of j.contextLinks) L.push(`- ${l.label}: ${l.url}${l.summary ? ` — ${l.summary}` : ""}`);
    else L.push(`- (run \`/pm-context get ${j.task}\`)`);
    L.push("");
  }
  L.push("## Prior plan state");
  if (j.plan) L.push(`- ${j.plan.path} (${j.plan.status})${j.plan.nextStep ? ` → next step: ${j.plan.nextStep}` : ""}`);
  else L.push(`- no plan yet — start with /design ${j.item.id}`);
  L.push("", "## Start here", j.plan ? "resume at the next unchecked step above" : `/design ${j.item.id}`);
  if (inbox > 0) L.push("", `> inbox: ${inbox} item${inbox > 1 ? "s" : ""} awaiting triage (assign a Task via \`link <id> Task <KEY>\`)`);
  return L.join("\n");
}
