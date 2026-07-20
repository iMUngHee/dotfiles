// Tests for ops.ts. Run: ./node_modules/.bin/tsx ops.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as ops from "./ops.ts";
import { taskFile, inboxPath, parseBlocks, serializeBlocks, parseFrontmatter, getField, setField, getFmField, readStamped } from "./store.ts";
import { listTransactions } from "./transaction.ts";
import { ensureManagedWorktree, reservationPaths, stagePlan } from "../../lib/worktree.mjs";

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
async function makePlan(root: string, rel: string, status = "draft", id = "p", pmLoop = "true"): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: ${id}\nstatus: ${status}\npm_loop: ${pmLoop}\nfiles_affected:\n  - a.ts\n  - b.ts\n---\n# ${id}\n`);
}

function testBlock(id: string, status = "open", plan = "-") {
  const block = { id, title: `Injected ${id}`, fields: [] as [string, string][] };
  setField(block, "Priority", "P2");
  setField(block, "Status", status);
  setField(block, "Plan", plan);
  setField(block, "Note", "injected");
  return block;
}

async function withInjectedBlock(path: string, fallbackTitle: string, block: ReturnType<typeof testBlock>, run: () => Promise<void>): Promise<void> {
  const before = await readStamped(path);
  const parsed = before ? parseBlocks(before.content) : { title: fallbackTitle, blocks: [] };
  parsed.blocks.push(block);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeBlocks(parsed.title || fallbackTitle, parsed.blocks));
  try {
    await run();
  } finally {
    if (before) await writeFile(path, before.content);
    else await rm(path, { force: true });
  }
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

    // Interrupted approve recovers before the retry, so plan and item cannot remain split.
    const crashPlan = ".agents/plans/2026-06-22-approve-crash.md";
    await makePlan(root, crashPlan);
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "approve-crash", title: "Crash" }, O);
    await ops.itemSetPlan(root, "ALPHA", "approve-crash", crashPlan, O);
    await assert.rejects(
      ops.itemApprove(root, "ALPHA", "approve-crash", { ...O, transaction: { crashAfter: 1 } }),
      /simulated process crash/,
    );
    await ops.itemApprove(root, "ALPHA", "approve-crash", O);
    assert.equal(await planStatus(root, crashPlan), "active");
    assert.equal(await field(BL("ALPHA"), "approve-crash", "Status"), "active");

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
    await mkdir(join(root, ".agents", "state"), { recursive: true });
    await writeFile(join(root, ".agents", "state", "focus.txt"), "stale-selector\n");
    await ops.itemClose(root, "ALPHA", "a-one", { status: "done", plan: ".agents/plans/2026-06-22-a-one.md", closedDate: "2026-06-22", ...O });
    assert.deepEqual((await ids(BL("ALPHA"))).sort(), ["approve-crash", "untriaged-x"]);
    assert.deepEqual(await ids(CL("ALPHA")), ["a-one"]);
    assert.equal(await field(CL("ALPHA"), "a-one", "Status"), "done");
    await assert.rejects(() => ops.itemAdd(root, { task: "ALPHA" }, { id: "a-one", title: "reuse" }, O), ops.OpError); // closed id reserved
    assert.equal((await readStamped(join(root, ".agents", "state", "focus.txt")))!.content, "stale-selector\n", "item close ignores stale selector files");

    // ── createPlanAndBacklogItem transaction: item+plan+current together ──
    await makePlan(root, ".agents/plans/2026-06-22-a-two.md");
    await ops.createPlanAndBacklogItem(root, "ALPHA", { id: "a-two", title: "Two" }, ".agents/plans/2026-06-22-a-two.md", O);
    assert.equal(await field(BL("ALPHA"), "a-two", "Plan"), ".agents/plans/2026-06-22-a-two.md");
    assert.equal((await readStamped(join(root, ".agents", "state", "current.txt")))!.content.trim(), ".agents/plans/2026-06-22-a-two.md");

    // Existing Plan:- items remain rejected on the legacy (reservation-free) persist path.
    const legacyExistingPlan = ".agents/plans/2026-06-22-legacy-existing.md";
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "legacy-existing", title: "Legacy existing" }, O);
    await makePlan(root, legacyExistingPlan, "draft", "legacy-existing");
    const legacyBefore = (await readStamped(BL("ALPHA")))!.content;
    await assert.rejects(
      () => ops.createPlanAndBacklogItem(root, "ALPHA", { id: "legacy-existing", title: "Legacy existing" }, legacyExistingPlan, O),
      /reservation|already used/,
    );
    assert.equal((await readStamped(BL("ALPHA")))!.content, legacyBefore, "legacy refusal leaves backlog byte-identical");

    // Reservation-backed persist links one exact open/Plan:- owner, preserves its block,
    // rejects owners in every reserved domain, and rolls back both transaction targets.
    const mappedRoot = await mkdtemp(join(tmpdir(), "ops-mapped-persist-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: mappedRoot, encoding: "utf8" });
      git("init", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      await writeFile(join(mappedRoot, "README.md"), "x\n");
      git("add", "README.md");
      git("commit", "-m", "init");

      await ops.taskCreate(mappedRoot, "MAP", "Mapped", O);
      await ops.taskCreate(mappedRoot, "OTHER", "Other", O);
      await ops.itemAdd(mappedRoot, { task: "OTHER" }, { id: "mapped-dependency", title: "Dependency" }, O);
      await ops.itemAdd(mappedRoot, { task: "MAP" }, {
        id: "mapped-existing",
        title: "Original title",
        priority: "P1",
        order: "7",
        note: "preserve me",
      }, O);
      const mappedBacklogPath = taskFile(mappedRoot, "MAP", "backlog.md");
      const mappedBacklog = parseBlocks((await readStamped(mappedBacklogPath))!.content);
      const mappedItem = mappedBacklog.blocks.find((block) => block.id === "mapped-existing")!;
      setField(mappedItem, "Owner", "alice");
      setField(mappedItem, "DependsOn", "mapped-dependency");
      setField(mappedItem, "AuditNote", "unknown-field");
      await writeFile(mappedBacklogPath, serializeBlocks(mappedBacklog.title, mappedBacklog.blocks));

      const ensured = await ensureManagedWorktree({ root: mappedRoot, id: "mapped-existing", base: "main" });
      const mappedPlan = ".agents/plans/2026-07-15-mapped-existing.md";
      const staged = `---\nid: mapped-existing\nstatus: draft\npm_loop: true\nbase_branch: main\nbase_commit: ${ensured.base_commit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n# Mapped existing\n`;
      await stagePlan({ root: mappedRoot, id: "mapped-existing", content: staged });
      const mappedBefore = (await readStamped(mappedBacklogPath))!.content;
      const input = { id: "mapped-existing", title: "CLI title must not replace the block" };
      const persist = (extra: Parameters<typeof ops.createPlanAndBacklogItem>[4] = O) =>
        ops.createPlanAndBacklogItem(ensured.execution_root, "MAP", input, mappedPlan, extra);

      const duplicateDomains = [
        [taskFile(mappedRoot, "OTHER", "backlog.md"), "Other — Backlog"],
        [taskFile(mappedRoot, "OTHER", "closed.md"), "Other — Closed"],
        [join(mappedRoot, ".agents", "tasks", "archive", "OLD", "backlog.md"), "Old — Backlog"],
        [inboxPath(mappedRoot), "Inbox"],
      ] as const;
      for (const [ownerPath, title] of duplicateDomains) {
        await withInjectedBlock(ownerPath, title, testBlock("mapped-existing"), async () => {
          await assert.rejects(persist(), /duplicate id owner/);
          assert.equal(await readFile(join(mappedRoot, mappedPlan), "utf8").catch(() => ""), "", "owner conflict creates no canonical plan");
          assert.equal((await readStamped(mappedBacklogPath))!.content, mappedBefore, "owner conflict leaves target byte-identical");
        });
      }
      await withInjectedBlock(
        taskFile(mappedRoot, "OTHER", "backlog.md"),
        "Other — Backlog",
        testBlock("other-plan-owner", "draft", mappedPlan),
        async () => assert.rejects(persist(), /plan.*linked|duplicate plan owner/),
      );

      await assert.rejects(
        persist({ ...O, transaction: { failAfter: 1 } }),
        /injected transaction failure after 1/,
      );
      assert.equal(await readFile(join(mappedRoot, mappedPlan), "utf8").catch(() => ""), "", "rollback removes canonical target");
      assert.equal((await readStamped(mappedBacklogPath))!.content, mappedBefore, "rollback restores backlog target");
      assert.notEqual(await readFile(reservationPaths(mappedRoot, "mapped-existing").json, "utf8").catch(() => ""), "", "rollback keeps reservation for retry");

      assert.equal((await persist()).outcome, "persisted_selected");
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "Status"), "draft");
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "Plan"), mappedPlan);
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "Priority"), "P1");
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "Order"), "7");
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "Note"), "preserve me");
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "Owner"), "alice");
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "DependsOn"), "mapped-dependency");
      assert.equal(await field(mappedBacklogPath, "mapped-existing", "AuditNote"), "unknown-field");
      assert.match((await readStamped(mappedBacklogPath))!.content, /\*\*mapped-existing\*\* — Original title/);

      await withInjectedBlock(taskFile(mappedRoot, "OTHER", "backlog.md"), "Other — Backlog", testBlock("mapped-existing"), async () => {
        await assert.rejects(persist(), /duplicate id owner/, "reservation-free exact retry still rejects another id owner");
      });
      await withInjectedBlock(
        taskFile(mappedRoot, "OTHER", "backlog.md"),
        "Other — Backlog",
        testBlock("retry-plan-owner", "draft", mappedPlan),
        async () => assert.rejects(persist(), /plan.*linked|duplicate plan owner/, "reservation-free exact retry still rejects another Plan owner"),
      );
      assert.equal((await persist()).outcome, "persisted_selected", "clean reservation-free exact retry converges");
    } finally {
      await rm(mappedRoot, { recursive: true, force: true });
    }

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

    await assert.rejects(
      ops.completePlanFromRetro(root, "ALPHA", "a-two", {
        planPath: ".agents/plans/2026-06-22-a-two.md", terminalStatus: "done",
        closedDate: "2026-06-22", ...O, transaction: { crashAfter: 2 },
      }),
      /simulated process crash/,
    );
    await ops.reservedIds(root, O); // the next mutator recovers before reading authoritative state
    assert.equal(await planStatus(root, ".agents/plans/2026-06-22-a-two.md"), "draft", "interrupted complete rolled back plan status");
    assert.ok((await ids(BL("ALPHA"))).includes("a-two"), "interrupted complete restored backlog item");
    assert.ok(!(await ids(CL("ALPHA"))).includes("a-two"), "interrupted complete did not leave a closed item");

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

    // ── reclassifyClosedPlan: terminal-only desired-state correction + exact preservation ──
    await ops.taskCreate(root, "RECLASS", "Reclassification", O);
    await ops.itemAdd(root, { task: "RECLASS" }, { id: "reclass-one", title: "Reclass One" }, O);
    const reclassPlan = ".agents/plans/2026-06-22-reclass-one.md";
    await makePlan(root, reclassPlan, "draft", "reclass-one");
    await ops.itemSetPlan(root, "RECLASS", "reclass-one", reclassPlan, O);
    await ops.itemApprove(root, "RECLASS", "reclass-one", O);
    const openBytes = await Promise.all([
      readFile(join(root, reclassPlan), "utf8"),
      readFile(BL("RECLASS"), "utf8"),
      readFile(CL("RECLASS"), "utf8"),
    ]);
    await assert.rejects(
      () => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "done", ...O }),
      /still in .* backlog/,
      "open items cannot be reclassified",
    );
    assert.deepEqual(
      await Promise.all([
        readFile(join(root, reclassPlan), "utf8"),
        readFile(BL("RECLASS"), "utf8"),
        readFile(CL("RECLASS"), "utf8"),
      ]),
      openBytes,
      "open-item refusal leaves the plan, backlog, and closed file byte-identical",
    );
    await ops.completePlanFromRetro(root, "RECLASS", "reclass-one", {
      planPath: reclassPlan, terminalStatus: "done", closedDate: "2026-06-23", closedBy: "alice", ...O,
    });
    await ops.itemAdd(root, { task: "RECLASS" }, { id: "reclass-sibling", title: "Sibling" }, O);
    await ops.itemClose(root, "RECLASS", "reclass-sibling", { status: "dropped", reason: "unrelated", closedDate: "2026-06-24", ...O });
    const reclassClosedStamped = (await readStamped(CL("RECLASS")))!;
    const reclassClosed = parseBlocks(reclassClosedStamped.content);
    const reclassBlock = reclassClosed.blocks.find((block) => block.id === "reclass-one")!;
    setField(reclassBlock, "AuditNote", "preserve-me");
    await writeFile(CL("RECLASS"), serializeBlocks(reclassClosed.title, reclassClosed.blocks));
    const closedOrderBefore = await ids(CL("RECLASS"));
    await mkdir(join(root, ".agents", "state"), { recursive: true });
    await writeFile(join(root, ".agents", "state", "current.txt"), "other-plan\n");
    await writeFile(join(root, ".agents", "state", "focus.txt"), "other-focus\n");
    const pointerBefore = await Promise.all([
      readFile(join(root, ".agents", "state", "current.txt"), "utf8"),
      readFile(join(root, ".agents", "state", "focus.txt"), "utf8"),
    ]);

    const toDropped = await ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", {
      planPath: reclassPlan, terminalStatus: "dropped", reason: "  superseded  ", ...O,
    });
    assert.deepEqual(toDropped, { outcome: "changed", planFrom: "done", itemFrom: "done", status: "dropped" });
    assert.equal(await planStatus(root, reclassPlan), "dropped");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Status"), "dropped");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Reason"), "superseded");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Closed"), "2026-06-23");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "ClosedSource"), "op");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "ClosedBy"), "alice");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "AuditNote"), "preserve-me");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Plan"), reclassPlan, "reclassify preserves the exact plan mapping");
    assert.deepEqual(await ids(CL("RECLASS")), closedOrderBefore, "reclassify preserves closed block order");
    assert.deepEqual(await Promise.all([
      readFile(join(root, ".agents", "state", "current.txt"), "utf8"),
      readFile(join(root, ".agents", "state", "focus.txt"), "utf8"),
    ]), pointerBefore, "reclassify leaves current/focus byte-identical");

    const droppedBytes = await Promise.all([readFile(join(root, reclassPlan), "utf8"), readFile(CL("RECLASS"), "utf8")]);
    const noChange = await ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", {
      planPath: reclassPlan, terminalStatus: "dropped", reason: "superseded", ...O,
    });
    assert.deepEqual(noChange, { outcome: "unchanged", planFrom: "dropped", itemFrom: "dropped", status: "dropped" });
    assert.deepEqual(await Promise.all([readFile(join(root, reclassPlan), "utf8"), readFile(CL("RECLASS"), "utf8")]), droppedBytes, "true no-op preserves both files byte-for-byte");

    const reasonChange = await ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", {
      planPath: reclassPlan, terminalStatus: "dropped", reason: "new evidence", ...O,
    });
    assert.equal(reasonChange.outcome, "changed", "same status with a different Reason mutates desired state");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Reason"), "new evidence");
    const toDone = await ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", {
      planPath: reclassPlan, terminalStatus: "done", ...O,
    });
    assert.equal(toDone.outcome, "changed");
    assert.equal(await planStatus(root, reclassPlan), "done");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Status"), "done");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Reason"), null, "done removes stale Reason");
    assert.equal((await ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", {
      planPath: reclassPlan, terminalStatus: "done", ...O,
    })).outcome, "unchanged");

    const driftedClosed = parseBlocks((await readStamped(CL("RECLASS")))!.content);
    const driftedItem = driftedClosed.blocks.find((block) => block.id === "reclass-one")!;
    setField(driftedItem, "Status", "dropped");
    setField(driftedItem, "Reason", "stale drift reason");
    await writeFile(CL("RECLASS"), serializeBlocks(driftedClosed.title, driftedClosed.blocks));
    const repairedDrift = await ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", {
      planPath: reclassPlan, terminalStatus: "done", ...O,
    });
    assert.deepEqual(repairedDrift, { outcome: "changed", planFrom: "done", itemFrom: "dropped", status: "done" });
    assert.equal(await planStatus(root, reclassPlan), "done");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Status"), "done");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Reason"), null, "drift repair removes stale Reason for done");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Plan"), reclassPlan);
    assert.deepEqual(await ids(CL("RECLASS")), closedOrderBefore, "drift repair preserves block order");

    // Every refusal happens before either target changes.
    const terminalBefore = await Promise.all([readFile(join(root, reclassPlan), "utf8"), readFile(CL("RECLASS"), "utf8")]);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "cancelled" as "done", ...O }), /status must be/);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "done", reason: "not allowed", ...O }), /done.*Reason/);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "dropped", ...O }), /Reason/);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "dropped", reason: "   ", ...O }), /Reason/);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "missing", { planPath: reclassPlan, terminalStatus: "done", ...O }), /closed/);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: ".agents/plans/other.md", terminalStatus: "done", ...O }), /linked/);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "MISSING", "reclass-one", { planPath: reclassPlan, terminalStatus: "done", ...O }), /does not exist/);
    await ops.taskCreate(root, "ARCHIVED", "Archived", O);
    await ops.taskArchive(root, "ARCHIVED", O);
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "ARCHIVED", "reclass-one", { planPath: reclassPlan, terminalStatus: "done", ...O }), /archived/);
    await writeFile(join(root, reclassPlan), terminalBefore[0].replace("pm_loop: true", "pm_loop: false"));
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "dropped", reason: "x", ...O }), /pm_loop/);
    await writeFile(join(root, reclassPlan), terminalBefore[0].replace("id: reclass-one", "id: other-id"));
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "dropped", reason: "x", ...O }), /id/);
    await writeFile(join(root, reclassPlan), terminalBefore[0].replace("status: done", "status: active"));
    await assert.rejects(() => ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", { planPath: reclassPlan, terminalStatus: "dropped", reason: "x", ...O }), /terminal/);
    await writeFile(join(root, reclassPlan), terminalBefore[0]);
    assert.deepEqual(await Promise.all([readFile(join(root, reclassPlan), "utf8"), readFile(CL("RECLASS"), "utf8")]), terminalBefore, "refused transitions leave both targets unchanged");

    // Simulated process crash leaves a journal/partial state; the next lock recovers both bytes.
    await assert.rejects(
      ops.reclassifyClosedPlan(root, "RECLASS", "reclass-one", {
        planPath: reclassPlan, terminalStatus: "dropped", reason: "crash", ...O,
        transaction: { id: "reclass-crash", crashAfter: 1 },
      }),
      /simulated process crash/,
    );
    assert.equal(await planStatus(root, reclassPlan), "dropped", "first transaction target applied before simulated crash");
    assert.equal(await field(CL("RECLASS"), "reclass-one", "Status"), "done", "second target not yet applied");
    assert.deepEqual(await listTransactions(root), ["reclass-crash.json"]);
    await ops.reservedIds(root, O);
    assert.deepEqual(await Promise.all([readFile(join(root, reclassPlan), "utf8"), readFile(CL("RECLASS"), "utf8")]), terminalBefore, "next locked op rolls both targets back");
    assert.deepEqual(await listTransactions(root), [], "recovery removes transaction journal");

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
    await makePlan(root, ".agents/plans/2026-06-22-sw-act.md");
    await ops.itemSetPlan(root, "SWT", "sw-act", ".agents/plans/2026-06-22-sw-act.md", O);
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
    await assert.rejects(
      () => ops.itemSetOwner(root, "COLT", "c-itm", "-", { expectedOwner: "carol", ...O }),
      /owner changed.*expected 'carol'.*current 'dave'/,
      "release refuses a stale expected owner",
    );
    assert.equal(await field(BL("COLT"), "c-itm", "Owner"), "dave", "owner survives a stale release");
    await ops.itemSetOwner(root, "COLT", "c-itm", "erin", { expectedOwner: "dave", note: "handoff", ...O });
    assert.equal(await field(BL("COLT"), "c-itm", "Owner"), "erin", "expected-owner handoff reassigns without force");
    assert.equal(await field(BL("COLT"), "c-itm", "OwnerNote"), "handoff", "handoff note is preserved");
    await ops.itemSetOwner(root, "COLT", "c-itm", "-", { expectedOwner: "erin", ...O });
    assert.equal(await field(BL("COLT"), "c-itm", "Owner"), null, "expected-owner release drops Owner");
    assert.equal(await field(BL("COLT"), "c-itm", "OwnerNote"), null, "expected-owner release drops OwnerNote");
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
