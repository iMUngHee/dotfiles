// lifecycle.test.ts — exercises the two /design + /retro lifecycle paths through the
// REAL CLI (runCli → ops), proving the documented hooks produce coherent end-states and
// leave the validator clean. Run: ./node_modules/.bin/tsx lifecycle.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./pm-roadmap.ts";

async function writePlan(root: string, rel: string, opts: { status?: string; deferred?: string } = {}): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  const body = `---\nid: p\nstatus: ${opts.status ?? "draft"}\npm_loop: true\n---\n# p\n\n## Post-Implementation Notes\n\n- done\n${opts.deferred ?? ""}`;
  await writeFile(join(root, rel), body);
}
const read = (root: string, p: string) => readFile(join(root, p), "utf8").catch(() => "");

async function main() {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-test-"));
  const cli = (...a: string[]) => runCli(root, a);
  try {
    assert.equal((await cli("task", "create", "TKA", "--title", "Task A")).code, 0);

    // ── Path A: /design persist → 승인(approve) → /retro complete(done) + ## Deferred harvest ──
    const planA = ".agents/plans/2026-06-22-feat-a.md";
    await writePlan(root, planA, {
      deferred: "\n## Deferred\n\n- **feat-a-followup** — A follow-up\n  - Priority: P2\n  - Note: harvested by retro\n",
    });
    // persist: create+link the item AND point current.txt, one transaction
    assert.equal((await cli("persist", "TKA", "feat-a", planA, "--title", "Feature A")).code, 0);
    assert.equal((await read(root, ".agents/state/current.txt")).trim(), planA, "persist pointed current.txt");
    assert.ok((await read(root, ".agents/tasks/TKA/backlog.md")).includes("Status: draft"), "persisted item mirrors plan = draft");
    assert.equal((await cli("validate")).code, 0, "validate clean after persist");

    // 승인: approve mirrors the backlog item to active
    assert.equal((await cli("approve", "TKA", "feat-a")).code, 0);
    assert.ok((await read(root, ".agents/tasks/TKA/backlog.md")).includes("Status: active"), "approved item is active");

    // /retro complete: plan→done + item→closed + ## Deferred harvest + current.txt cleared, all-or-nothing
    assert.equal((await cli("complete", "TKA", "feat-a", "--plan", planA, "--status", "done")).code, 0);
    assert.ok((await read(root, planA)).includes("status: done"), "complete set the plan → done");
    assert.ok((await read(root, ".agents/tasks/TKA/closed.md")).includes("feat-a"), "item moved to closed.md");
    assert.ok((await read(root, ".agents/tasks/TKA/backlog.md")).includes("feat-a-followup"), "## Deferred harvested into backlog");
    assert.equal((await read(root, ".agents/state/current.txt")).trim(), "", "complete cleared current.txt");
    assert.equal((await cli("validate")).code, 0, "validate clean after complete");

    // ── Path B: /design persist → 취소(close --status dropped) ──
    const planB = ".agents/plans/2026-06-22-feat-b.md";
    await writePlan(root, planB);
    assert.equal((await cli("persist", "TKA", "feat-b", planB, "--title", "Feature B")).code, 0);
    // 취소: close the item dropped (Reason required). The close op clears focus; design then
    // truncates current.txt + edits the plan status — mirrored below.
    assert.equal((await cli("close", "TKA", "feat-b", "--status", "dropped", "--reason", "abandoned")).code, 0);
    const closed = await read(root, ".agents/tasks/TKA/closed.md");
    assert.ok(closed.includes("feat-b") && closed.includes("Status: dropped") && closed.includes("Reason: abandoned"), "feat-b closed dropped with reason");
    await writeFile(join(root, ".agents/state/current.txt"), ""); // design's 취소 step (close op leaves current.txt)
    assert.equal((await cli("validate")).code, 0, "validate clean after 취소/drop");

    console.log("lifecycle.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
