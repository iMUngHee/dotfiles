// Roadmap SSOT parser/serializer for .agents/ROADMAP.md.
// Separate from task-context's parseTaskMd. Backlog items belong to a task
// (Task: field) — that task's links+memory (task-context) are the item's context.

export type Priority = "P0" | "P1" | "P2" | "P3";
export type Status = "open" | "draft" | "active" | "done" | "dropped";

export interface RoadmapItem {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  order: number; // explicit work sequence within a task (1=first); 0 = unordered → falls back to file order
  task: string | null; // owning task-context KEY; its links+memory = this item's context; same-task items are siblings
  plan: string | null; // pointer to a plan file; at most one item per plan
  note: string;
}

// Recently Closed has two record forms, each optionally ending with a
// ` · Task: <KEY>` suffix (the owning task at close time; omitted when null):
//   (a) plan-linked:      - **id** → <plan-path> (done|dropped)[ · Task: KEY]
//   (b) planless dropped: - **id** → dropped[ · <note>][ · Task: KEY]
export interface ClosedEntry {
  id: string;
  plan: string | null;
  status: "done" | "dropped";
  note: string;
  task: string | null; // null = legacy record or inbox item (never written as `Task: _INBOX`)
}

export interface Roadmap {
  project: string;
  focus: string | null;
  updated: string;
  open: RoadmapItem[];
  recentlyClosed: ClosedEntry[];
}

const DASH = "-";
const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];
const STATUSES: Status[] = ["open", "draft", "active", "done", "dropped"];

function dashToNull(v: string): string | null {
  const t = v.trim();
  return t === "" || t === DASH ? null : t;
}
function nullToDash(v: string | null): string {
  return v == null || v === "" ? DASH : v;
}
// Taskless items live in the virtual _INBOX (no task-context file, not designable
// until triaged to a real task). Reads accept legacy `-` and `_INBOX` as the same
// null; writes emit `_INBOX` only.
export const INBOX = "_INBOX";
function taskToNull(v: string): string | null {
  const t = dashToNull(v);
  return t === INBOX ? null : t;
}

export function parseRoadmap(content: string): Roadmap {
  const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));

  const fm: Record<string, string> = {};
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") { bodyStart = i + 1; break; }
      const m = lines[i].match(/^([A-Za-z_]+):\s*(.*)$/);
      if (m) fm[m[1].toLowerCase()] = m[2].trim();
    }
  }

  const rm: Roadmap = {
    project: fm.project ?? "",
    focus: dashToNull(fm.focus ?? ""),
    updated: fm.updated ?? "",
    open: [],
    recentlyClosed: [],
  };

  let section: "open" | "closed" | null = null;
  let cur: RoadmapItem | null = null;
  const flush = () => { if (cur) rm.open.push(cur); cur = null; };

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      flush();
      const h = heading[1].trim().toLowerCase();
      section = h.startsWith("open") ? "open" : h.startsWith("recently") ? "closed" : null;
      continue;
    }

    if (section === "open") {
      const head = line.match(/^-\s+\*\*([^*]+)\*\*\s*—\s*(.*)$/);
      if (head) {
        flush();
        cur = { id: head[1].trim(), title: head[2].trim(), priority: "P2", status: "open", order: 0, task: null, plan: null, note: "" };
        continue;
      }
      const sub = line.match(/^\s{2,}-\s+([A-Za-z]+):\s*(.*)$/);
      if (sub && cur) {
        const key = sub[1].toLowerCase();
        const val = sub[2].trim();
        if (key === "priority" && (PRIORITIES as string[]).includes(val)) cur.priority = val as Priority;
        else if (key === "status" && (STATUSES as string[]).includes(val)) cur.status = val as Status;
        else if (key === "order") cur.order = parseInt(val, 10) || 0;
        else if (key === "task") cur.task = taskToNull(val);
        else if (key === "context" && cur.task == null) cur.task = taskToNull(val); // back-compat: pre-task-model `Context:` → Task
        else if (key === "plan") cur.plan = dashToNull(val);
        else if (key === "note") cur.note = val;
        // unknown keys (incl. legacy `Parent:`) ignored (forward compatibility)
      }
      continue;
    }

    if (section === "closed") {
      const m = line.match(/^-\s+\*\*([^*]+)\*\*\s*→\s*(.*)$/);
      if (!m) continue;
      const id = m[1].trim();
      let rest = m[2].trim();
      // Strip the trailing Task suffix BEFORE matching the two record forms —
      // a note may itself contain `·`, so only the anchored tail is the suffix.
      let task: string | null = null;
      const ts = rest.match(/\s*·\s*Task:\s*([A-Z0-9_-]+)\s*$/);
      if (ts) { task = ts[1]; rest = rest.slice(0, ts.index).trim(); }
      const dropped = rest.match(/^dropped(?:\s*·\s*(.*))?$/);
      if (dropped) rm.recentlyClosed.push({ id, plan: null, status: "dropped", note: (dropped[1] ?? "").trim(), task });
      else {
        const linked = rest.match(/^(.*?)\s*\((done|dropped)\)\s*$/);
        if (linked) rm.recentlyClosed.push({ id, plan: linked[1].trim(), status: linked[2] as "done" | "dropped", note: "", task });
      }
    }
  }
  flush();
  return rm;
}

export function serializeRoadmap(rm: Roadmap): string {
  const out: string[] = [];
  out.push("---", `project: ${rm.project}`, `focus: ${nullToDash(rm.focus)}`, `updated: ${rm.updated}`, "---", "");
  out.push(`# ${rm.project} — Backlog`, "", "## Open", "");
  for (const it of rm.open) {
    out.push(`- **${it.id}** — ${it.title}`);
    out.push(`  - Priority: ${it.priority}`);
    out.push(`  - Status: ${it.status}`);
    if (it.order > 0) out.push(`  - Order: ${it.order}`);
    out.push(`  - Task: ${it.task ?? INBOX}`);
    out.push(`  - Plan: ${nullToDash(it.plan)}`);
    out.push(`  - Note: ${it.note}`);
  }
  if (rm.open.length) out.push("");
  out.push("## Recently Closed", "");
  for (const c of rm.recentlyClosed) {
    // Conditional assembly — no empty segments (`dropped ·  · Task: K` is forbidden).
    const suffix = c.task ? ` · Task: ${c.task}` : "";
    if (c.plan) out.push(`- **${c.id}** → ${c.plan} (${c.status})${suffix}`);
    else out.push(`- **${c.id}** → dropped${c.note ? ` · ${c.note}` : ""}${suffix}`);
  }
  if (rm.recentlyClosed.length) out.push("");
  return out.join("\n");
}
