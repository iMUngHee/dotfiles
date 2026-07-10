// Tests for ops.ts. Run: ./node_modules/.bin/tsx ops.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ops from "./ops.ts";
import { taskFile, inboxPath, parseBlocks, parseFrontmatter, getField, getFmField, readStamped } from "./store.ts";

const O = { nowMs: 1_750_000_000_000, nowDate: "2026-06-22", retries: 0 as number };

async function ids(path: string): Promise<string[]> {
  const s = await readStamped(path);
  return s ? parseBlocks(s.content).blocks.map((b) => b.id) : [];
}
async function field(path: string, id: string, key: string): Promise<string | null> {
  const s = await readStamped(path);
  if (!s) return null;
  const b = parseBlocks(s.content).blocks.find((x) => x.id === id);
  return b ? getField(b, key) : null;
}
async function planStatus(root: string, rel: string): Promise<string | null> {
  const s = await readStamped(join(root, rel));
  return s ? getFmField(parseFrontmatter(s.content).fields, "status") : null;
}
async function makePlan(root: string, rel: string, status = "draft"): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: p\nstatus: ${status}\npm_loop: true\nfiles_affected:\n  - a.ts\n  - b.ts\n---\n# p\n`);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ops-test-"));
  const BL = (k: string) => taskFile(root, k, "backlog.md");
  const CL = (k: string) => taskFile(root, k, "closed.md");
  try {
    // ── task create (+ duplicate refusal, + key grammar) ──
    await ops.taskCreate(root, "ALPHA", "Alpha task", O);
    assert.equal(getFmField(parseFrontmatter((await readStamped(taskFile(root, "ALPHA", "task.md")))!.content).fields, "status"), "active");
    await assert.rejects(() => ops.taskCreate(root, "ALPHA", "dup", O), ops.OpError);
    await assert.rejects(() => ops.taskCreate(root, "bad key", "x", O), ops.OpError);

    // ── item add to task + duplicate-id (reserved) refusal + kebab refusal ──
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "a-one", title: "One" }, O);
    assert.deepEqual(await ids(BL("ALPHA")), ["a-one"]);
    await assert.rejects(() => ops.itemAdd(root, { task: "ALPHA" }, { id: "a-one", title: "dup" }, O), ops.OpError);
    await assert.rejects(() => ops.itemAdd(root, { task: "ALPHA" }, { id: "Bad_Id", title: "x" }, O), ops.OpError);

    // ── inbox add + reservedIds spans task+inbox ──
    await ops.itemAdd(root, { inbox: true }, { id: "untriaged-x", title: "U" }, O);
    const reserved = await ops.reservedIds(root, O);
    assert.ok(reserved.has("a-one") && reserved.has("untriaged-x"));

    // ── focus rejects an inbox item; accepts a real backlog item ──
    await assert.rejects(() => ops.focusSet(root, "untriaged-x", O), ops.OpError);
    await ops.focusSet(root, "a-one", O);
    assert.equal((await readStamped(join(root, ".agents", "state", "focus.txt")))!.content.trim(), "a-one");

    // ── triage: inbox → task ──
    await ops.triage(root, "untriaged-x", "ALPHA", O);
    assert.deepEqual((await ids(inboxPath(root))), []);
    assert.deepEqual((await ids(BL("ALPHA"))).sort(), ["a-one", "untriaged-x"]);

    // ── plan link (+ approve) + plan 1:1 refusal ──
    await makePlan(root, ".agents/plans/2026-06-22-a-one.md");
    await ops.itemSetPlan(root, "ALPHA", "a-one", ".agents/plans/2026-06-22-a-one.md", O);
    assert.equal(await field(BL("ALPHA"), "a-one", "Status"), "draft");
    await assert.rejects(() => ops.itemSetPlan(root, "ALPHA", "untriaged-x", ".agents/plans/2026-06-22-a-one.md", O), ops.OpError); // 1:1
    await ops.itemApprove(root, "ALPHA", "a-one", O);
    assert.equal(await field(BL("ALPHA"), "a-one", "Status"), "active");

    // ── reprioritize: changes Priority; rejects bad enum + missing id ──
    await ops.itemSetPriority(root, "ALPHA", "a-one", "P0", O);
    assert.equal(await field(BL("ALPHA"), "a-one", "Priority"), "P0");
    await assert.rejects(() => ops.itemSetPriority(root, "ALPHA", "a-one", "P9", O), ops.OpError); // bad enum
    await assert.rejects(() => ops.itemSetPriority(root, "ALPHA", "nope", "P1", O), ops.OpError); // missing id

    // ── reorder: sets Order (raw-string preflight, no lossy parseInt); rejects non-int / non-positive / missing id ──
    await ops.itemSetOrder(root, "ALPHA", "a-one", "3", O);
    assert.equal(await field(BL("ALPHA"), "a-one", "Order"), "3");
    await assert.rejects(() => ops.itemSetOrder(root, "ALPHA", "a-one", "0", O), ops.OpError); // zero
    await assert.rejects(() => ops.itemSetOrder(root, "ALPHA", "a-one", "-1", O), ops.OpError); // negative
    await assert.rejects(() => ops.itemSetOrder(root, "ALPHA", "a-one", "1.5", O), ops.OpError); // non-integer (parseInt would truncate to 1)
    await assert.rejects(() => ops.itemSetOrder(root, "ALPHA", "a-one", "1abc", O), ops.OpError); // trailing junk (parseInt would yield 1)
    await assert.rejects(() => ops.itemSetOrder(root, "ALPHA", "a-one", "1e2", O), ops.OpError); // exponent literal
    await assert.rejects(() => ops.itemSetOrder(root, "ALPHA", "nope", "1", O), ops.OpError); // missing id

    // ── close refusals: planless done; dropped without reason ──
    await assert.rejects(() => ops.itemClose(root, "ALPHA", "untriaged-x", { status: "done", closedDate: "2026-06-22", ...O }), ops.OpError);
    await assert.rejects(() => ops.dropItem(root, "ALPHA", "untriaged-x", { reason: "", ...O }), ops.OpError);

    // ── done close moves backlog → closed; id stays reserved (no reuse) ──
    await ops.itemClose(root, "ALPHA", "a-one", { status: "done", plan: ".agents/plans/2026-06-22-a-one.md", closedDate: "2026-06-22", ...O });
    assert.deepEqual(await ids(BL("ALPHA")), ["untriaged-x"]);
    assert.deepEqual(await ids(CL("ALPHA")), ["a-one"]);
    assert.equal(await field(CL("ALPHA"), "a-one", "Status"), "done");
    await assert.rejects(() => ops.itemAdd(root, { task: "ALPHA" }, { id: "a-one", title: "reuse" }, O), ops.OpError); // closed id reserved
    // focus on a-one was cleared by the close
    assert.equal((await readStamped(join(root, ".agents", "state", "focus.txt")))!.content.trim(), "");

    // ── createPlanAndBacklogItem transaction: item+plan+current together ──
    await makePlan(root, ".agents/plans/2026-06-22-a-two.md");
    await ops.createPlanAndBacklogItem(root, "ALPHA", { id: "a-two", title: "Two" }, ".agents/plans/2026-06-22-a-two.md", O);
    assert.equal(await field(BL("ALPHA"), "a-two", "Plan"), ".agents/plans/2026-06-22-a-two.md");
    assert.equal((await readStamped(join(root, ".agents", "state", "current.txt")))!.content.trim(), ".agents/plans/2026-06-22-a-two.md");

    // ── harvest preflight: one colliding deferred id aborts the WHOLE harvest ──
    const before = await ids(BL("ALPHA"));
    await assert.rejects(
      () => ops.harvest(root, "ALPHA", [{ id: "fresh-1", title: "F1" }, { id: "a-one", title: "collide" }], O),
      ops.OpError,
    );
    assert.deepEqual(await ids(BL("ALPHA")), before, "no deferred item written when one collides");

    // good harvest applies all
    await ops.harvest(root, "ALPHA", [{ id: "fresh-1", title: "F1" }, { id: "fresh-2", title: "F2" }], O);
    assert.ok((await ids(BL("ALPHA"))).includes("fresh-1") && (await ids(BL("ALPHA"))).includes("fresh-2"));

    // ── add: Order is a positive-int-string (shared assertOrder); malformed rejected; note forwarded ──
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "a-ord", title: "Ord", order: "2", note: "hi" }, O);
    assert.equal(await field(BL("ALPHA"), "a-ord", "Order"), "2");
    assert.equal(await field(BL("ALPHA"), "a-ord", "Note"), "hi");
    await assert.rejects(() => ops.itemAdd(root, { task: "ALPHA" }, { id: "a-b1", title: "X", order: "1.5" }, O), ops.OpError); // lossy non-integer
    await assert.rejects(() => ops.itemAdd(root, { task: "ALPHA" }, { id: "a-b2", title: "X", order: "0" }, O), ops.OpError); // non-positive

    // ── harvest: a malformed deferred Order aborts the WHOLE harvest before any write (all-or-nothing) ──
    const beforeOrd = await ids(BL("ALPHA"));
    await assert.rejects(
      () => ops.harvest(root, "ALPHA", [{ id: "ok-ord", title: "OK" }, { id: "bad-ord", title: "Bad", order: "1.5" }], O),
      ops.OpError,
    );
    assert.deepEqual(await ids(BL("ALPHA")), beforeOrd, "no deferred item written when one has a malformed Order");

    // ── completePlanFromRetro: all-or-nothing on a bad item id (no plan-status flip, no close) ──
    await assert.rejects(
      () => ops.completePlanFromRetro(root, "ALPHA", "does-not-exist", { planPath: ".agents/plans/2026-06-22-a-two.md", terminalStatus: "done", ...O }),
      ops.OpError,
    );
    assert.equal(await planStatus(root, ".agents/plans/2026-06-22-a-two.md"), "draft", "plan status untouched on aborted retro");

    // ── completePlanFromRetro #1: dropped without a Reason aborts BEFORE _setPlanStatus (no partial plan flip) ──
    await assert.rejects(
      () => ops.completePlanFromRetro(root, "ALPHA", "a-two", { planPath: ".agents/plans/2026-06-22-a-two.md", terminalStatus: "dropped", ...O }),
      ops.OpError,
    );
    assert.equal(await planStatus(root, ".agents/plans/2026-06-22-a-two.md"), "draft", "dropped-without-reason: plan NOT flipped (all-or-nothing)");
    assert.ok((await ids(BL("ALPHA"))).includes("a-two"), "dropped-without-reason: item stays open");

    // ── completePlanFromRetro #2: a --plan that the item is not linked to is refused before any write ──
    const aOneStatusBefore = await planStatus(root, ".agents/plans/2026-06-22-a-one.md");
    await assert.rejects(
      () => ops.completePlanFromRetro(root, "ALPHA", "a-two", { planPath: ".agents/plans/2026-06-22-a-one.md", terminalStatus: "done", ...O }),
      ops.OpError,
    );
    assert.equal(await planStatus(root, ".agents/plans/2026-06-22-a-one.md"), aOneStatusBefore, "wrong-plan: the mis-named plan is NOT flipped");
    assert.ok((await ids(BL("ALPHA"))).includes("a-two"), "wrong-plan: item stays open");

    // ── completePlanFromRetro #3: a non-{done,dropped} terminalStatus is refused in preflight (before _setPlanStatus) ──
    await assert.rejects(
      () => ops.completePlanFromRetro(root, "ALPHA", "a-two", { planPath: ".agents/plans/2026-06-22-a-two.md", terminalStatus: "bogus" as "done", ...O }),
      ops.OpError,
    );
    assert.equal(await planStatus(root, ".agents/plans/2026-06-22-a-two.md"), "draft", "bogus terminalStatus: plan NOT flipped (all-or-nothing)");

    // ── completePlanFromRetro success: plan→done + item closed + deferred harvested + current cleared ──
    await ops.completePlanFromRetro(root, "ALPHA", "a-two", {
      planPath: ".agents/plans/2026-06-22-a-two.md", terminalStatus: "done",
      deferred: [{ id: "followup-1", title: "Follow" }], closedDate: "2026-06-22", ...O,
    });
    assert.equal(await planStatus(root, ".agents/plans/2026-06-22-a-two.md"), "done");
    assert.match((await readStamped(join(root, ".agents/plans/2026-06-22-a-two.md")))!.content, /files_affected:\n  - a\.ts\n  - b\.ts/, "complete preserves multi-line frontmatter lists (no _setPlanStatus round-trip loss)");
    assert.ok((await ids(CL("ALPHA"))).includes("a-two"));
    assert.ok((await ids(BL("ALPHA"))).includes("followup-1"));
    assert.equal((await readStamped(join(root, ".agents", "state", "current.txt")))!.content.trim(), "");

    // ── addTaskMemory: upsert by title + reject block-breaking titles ──
    const MEM = taskFile(root, "ALPHA", "memory.md");
    await ops.addTaskMemory(root, "ALPHA", { title: "decision-x", note: "n1", date: "2026-06-22" }, O);
    assert.deepEqual(await ids(MEM), ["decision-x"]);
    await ops.addTaskMemory(root, "ALPHA", { title: "decision-x", note: "n2" }, O); // same title → upsert
    assert.deepEqual(await ids(MEM), ["decision-x"], "upsert keeps a single block");
    assert.equal(await field(MEM, "decision-x", "Note"), "n2", "upsert updated the note in place");
    assert.equal(await field(MEM, "decision-x", "Date"), "2026-06-22", "upsert with no date defaults to nowDate");
    await assert.rejects(() => ops.addTaskMemory(root, "ALPHA", { title: "bad*title" }, O), ops.OpError); // '*' breaks block id
    await assert.rejects(() => ops.addTaskMemory(root, "ALPHA", { title: "   " }, O), ops.OpError); // empty after trim

    // ── addTaskLink/removeTaskLink: case-insensitive label upsert + URL uniqueness + guards ──
    const LK = taskFile(root, "ALPHA", "links.md");
    await ops.addTaskLink(root, "ALPHA", { label: "Wiki", url: "https://w.example.com/a", triggers: "x,y", summary: "S" }, O);
    assert.deepEqual(await ids(LK), ["Wiki"]);
    await ops.addTaskLink(root, "ALPHA", { label: "wiki", url: "https://w.example.com/b" }, O); // case-insensitive → upsert
    assert.deepEqual(await ids(LK), ["Wiki"], "case-insensitive label upsert keeps a single block (no Wiki/wiki dup)");
    assert.equal(await field(LK, "Wiki", "URL"), "https://w.example.com/b", "upsert updated URL");
    await ops.addTaskLink(root, "ALPHA", { label: "Other", url: "https://other.example.com" }, O);
    await assert.rejects(() => ops.addTaskLink(root, "ALPHA", { label: "Third", url: "https://w.example.com/b" }, O), ops.OpError); // URL dup across labels
    await assert.rejects(() => ops.addTaskLink(root, "ALPHA", { label: "bad", url: "ftp://nope" }, O), ops.OpError); // non-http
    await assert.rejects(() => ops.addTaskLink(root, "ALPHA", { label: "a*b", url: "https://x.example.com" }, O), ops.OpError); // '*' in label
    await assert.rejects(() => ops.removeTaskLink(root, "ALPHA", "nomatch", O), ops.OpError); // nothing matches
    await ops.removeTaskLink(root, "ALPHA", "wiki", O); // case-insensitive remove
    assert.deepEqual(await ids(LK), ["Other"], "wiki removed (case-insensitive), Other kept");

    // ── close/complete status guard: a non-{done,dropped} status is refused before any write ──
    await assert.rejects(() => ops.itemClose(root, "ALPHA", "followup-1", { status: "bogus" as "done", closedDate: "2026-06-22", ...O }), ops.OpError);
    assert.ok((await ids(BL("ALPHA"))).includes("followup-1"), "bad-status close left the item open (all-or-nothing)");

    // ── task done refusal (open items) then archive refusal then success path ──
    await assert.rejects(() => ops.taskDone(root, "ALPHA", O), ops.OpError); // still has open items
    await assert.rejects(() => ops.taskArchive(root, "ALPHA", O), ops.OpError);

    // drain ALPHA's remaining open items, then done + archive + restore
    for (const id of await ids(BL("ALPHA"))) await ops.dropItem(root, "ALPHA", id, { reason: "cleanup", ...O });
    await ops.taskDone(root, "ALPHA", O);
    assert.equal(getFmField(parseFrontmatter((await readStamped(taskFile(root, "ALPHA", "task.md")))!.content).fields, "status"), "done");
    await ops.taskArchive(root, "ALPHA", O);
    // archived task refuses writes; ids still reserved
    await assert.rejects(() => ops.itemAdd(root, { task: "ALPHA" }, { id: "z", title: "z" }, O), ops.OpError);
    assert.ok((await ops.reservedIds(root, O)).has("a-one"), "archived ids stay reserved");
    await ops.taskRestore(root, "ALPHA", O);
    assert.equal(getFmField(parseFrontmatter((await readStamped(taskFile(root, "ALPHA", "task.md")))!.content).fields, "status"), "active");

    // ── done→active auto-reopen on new item ──
    for (const id of await ids(BL("ALPHA"))) await ops.dropItem(root, "ALPHA", id, { reason: "c", ...O });
    await ops.taskDone(root, "ALPHA", O);
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "revive-1", title: "R" }, O);
    assert.equal(getFmField(parseFrontmatter((await readStamped(taskFile(root, "ALPHA", "task.md")))!.content).fields, "status"), "active", "adding an item reopens a done task");

    // ── collaboration mode ──
    const FM = async (k: string, f: string) => getFmField(parseFrontmatter((await readStamped(taskFile(root, k, "task.md")))!.content).fields, f);
    await ops.taskCreate(root, "SOLOT", "Solo", O);
    assert.equal(await FM("SOLOT", "mode"), "solo", "create defaults mode solo");
    await ops.taskCreate(root, "COLT", "Collab", { ...O, mode: "collab" });
    assert.equal(await FM("COLT", "mode"), "collab");
    await assert.rejects(() => ops.taskCreate(root, "BADM", "x", { ...O, mode: "bogus" }), ops.OpError, "bad mode rejected at create");

    // solo→collab assigns switcher to ALL backlog items (open|draft|active), not just open
    await ops.taskCreate(root, "SWT", "Switch", O);
    await ops.itemAdd(root, { task: "SWT" }, { id: "sw-open", title: "O" }, O);
    await ops.itemAdd(root, { task: "SWT" }, { id: "sw-act", title: "A" }, O);
    await ops.itemApprove(root, "SWT", "sw-act", O); // Status → active
    const swr = await ops.taskSetMode(root, "SWT", "collab", "alice", O);
    assert.deepEqual({ assigned: swr.assigned, actor: swr.actor }, { assigned: 2, actor: "alice" }, "taskSetMode returns {assigned, actor} on solo→collab");
    assert.equal(await field(BL("SWT"), "sw-open", "Owner"), "alice");
    assert.equal(await field(BL("SWT"), "sw-act", "Owner"), "alice", "active item also owned on switch");
    // empty actor stops the collab switch (all-or-nothing)
    await ops.taskCreate(root, "SWT2", "S2", O);
    await ops.itemAdd(root, { task: "SWT2" }, { id: "sw2", title: "x" }, O);
    await assert.rejects(() => ops.taskSetMode(root, "SWT2", "collab", "", O), ops.OpError, "empty actor stops collab switch");
    assert.equal(await FM("SWT2", "mode"), "solo", "failed switch left mode solo (no partial write)");
    // collab→solo keeps Owner (lossless)
    const dsr = await ops.taskSetMode(root, "SWT", "solo", "alice", O);
    assert.equal(dsr.assigned, 0, "collab→solo assigns nothing");
    assert.equal(await field(BL("SWT"), "sw-open", "Owner"), "alice", "downgrade keeps Owner");

    // itemSetOwner: assign+note, double-claim guard, force, unassign, solo gate
    await ops.itemAdd(root, { task: "COLT" }, { id: "c-itm", title: "C" }, O);
    await ops.itemSetOwner(root, "COLT", "c-itm", "carol", { note: "ctx", ...O });
    assert.equal(await field(BL("COLT"), "c-itm", "Owner"), "carol");
    assert.equal(await field(BL("COLT"), "c-itm", "OwnerNote"), "ctx");
    await assert.rejects(() => ops.itemSetOwner(root, "COLT", "c-itm", "dave", O), ops.OpError, "double-claim guard");
    await ops.itemSetOwner(root, "COLT", "c-itm", "dave", { force: true, ...O });
    assert.equal(await field(BL("COLT"), "c-itm", "Owner"), "dave", "force reassigns");
    await ops.itemSetOwner(root, "COLT", "c-itm", "-", O);
    assert.equal(await field(BL("COLT"), "c-itm", "Owner"), null, "unassign drops Owner");
    assert.equal(await field(BL("COLT"), "c-itm", "OwnerNote"), null, "unassign drops OwnerNote");
    await ops.itemAdd(root, { task: "SOLOT" }, { id: "s-itm", title: "S" }, O);
    await assert.rejects(() => ops.itemSetOwner(root, "SOLOT", "s-itm", "x", O), ops.OpError, "owner gate refuses solo task");

    // By on memory/links; ClosedBy on drop
    await ops.addTaskMemory(root, "COLT", { title: "dec", note: "n", by: "alice" }, O);
    assert.equal(await field(taskFile(root, "COLT", "memory.md"), "dec", "By"), "alice");
    await ops.addTaskLink(root, "COLT", { label: "docs", url: "https://x.test", by: "bob" }, O);
    assert.equal(await field(taskFile(root, "COLT", "links.md"), "docs", "By"), "bob");
    await ops.itemAdd(root, { task: "COLT" }, { id: "cl-itm", title: "X" }, O);
    await ops.dropItem(root, "COLT", "cl-itm", { reason: "no", closedBy: "carol", ...O });
    assert.equal(await field(CL("COLT"), "cl-itm", "ClosedBy"), "carol");

    // roster
    await ops.taskSetCollaborators(root, "COLT", "carol, erin", O);
    assert.equal(await FM("COLT", "collaborators"), "carol, erin");

    // ── dependency edges (itemSetDeps): set/dedup, cross-task, self, dangling, cycle, clear, close-drops ──
    await ops.taskCreate(root, "DEP", "Deps", O);
    await ops.itemAdd(root, { task: "DEP" }, { id: "dep-a", title: "A" }, O);
    await ops.itemAdd(root, { task: "DEP" }, { id: "dep-b", title: "B" }, O);
    await ops.taskCreate(root, "DEP2", "Deps2", O);
    await ops.itemAdd(root, { task: "DEP2" }, { id: "dep-x", title: "X" }, O);
    await ops.itemSetDeps(root, "DEP", "dep-a", ["dep-b", "dep-b"], O); // dedup
    assert.equal(await field(BL("DEP"), "dep-a", "DependsOn"), "dep-b", "sets + dedups DependsOn");
    await ops.itemSetDeps(root, "DEP", "dep-a", ["dep-b", "dep-x"], O); // cross-task target allowed
    assert.equal(await field(BL("DEP"), "dep-a", "DependsOn"), "dep-b, dep-x", "cross-task targets allowed");
    await assert.rejects(() => ops.itemSetDeps(root, "DEP", "dep-a", ["dep-a"], O), ops.OpError, "self-dependency refused");
    await assert.rejects(() => ops.itemSetDeps(root, "DEP", "dep-a", ["nope-nope"], O), ops.OpError, "dangling target refused");
    await ops.itemSetDeps(root, "DEP", "dep-a", [], O); // clear
    assert.equal(await field(BL("DEP"), "dep-a", "DependsOn"), null, "empty list clears DependsOn");
    await ops.itemSetDeps(root, "DEP", "dep-b", ["dep-a"], O); // dep-b → dep-a
    await assert.rejects(() => ops.itemSetDeps(root, "DEP", "dep-a", ["dep-b"], O), ops.OpError, "cycle refused (dep-b already reaches dep-a)");
    await ops.dropItem(root, "DEP2", "dep-x", { reason: "gone", ...O }); // dep-x → closed (still reserved)
    await ops.itemSetDeps(root, "DEP", "dep-a", ["dep-x"], O);
    assert.equal(await field(BL("DEP"), "dep-a", "DependsOn"), "dep-x", "dep on a closed (reserved) id is legal");
    await ops.itemAdd(root, { inbox: true }, { id: "inb-dep", title: "I" }, O);
    await ops.itemSetDeps(root, "DEP", "dep-b", ["inb-dep"], O);
    assert.equal(await field(BL("DEP"), "dep-b", "DependsOn"), "inb-dep", "dep on an inbox (reserved) id is legal");
    await ops.dropItem(root, "DEP", "dep-b", { reason: "gone", ...O }); // _itemClose builds a fresh block
    assert.equal(await field(CL("DEP"), "dep-b", "DependsOn"), null, "closed item drops DependsOn");
    await assert.rejects(() => ops.itemSetDeps(root, "DEP", "missing-x", ["dep-a"], O), ops.OpError, "unknown subject refused");

    console.log("ops.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
