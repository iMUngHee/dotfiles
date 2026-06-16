// Fixtures for archive.ts. Run: ./node_modules/.bin/tsx archive.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archivePlans } from "./archive.ts";
import { resolveClosedJoin } from "./join.ts";
import { parseRoadmap } from "./roadmap.ts";

const TODAY = "2026-06-15"; // boundary anchor: 05-16 = 30d, 05-17 = 29d, 05-15 = 31d
const plan = (status: string) => `---\nid: x\ntitle: t\nstatus: ${status}\n---\n\n## Goal\ng\n\n## Post-Implementation Notes\nlanded.\n`;
const roadmap = (open: string, closed: string) =>
  `---\nproject: d\nfocus:\nupdated: 2026-06-15\n---\n\n# d — Backlog\n\n<!-- keep me verbatim -->\n\n## Open\n\n${open}\n## Recently Closed\n\n${closed}`;

async function exists(p: string): Promise<boolean> { try { await stat(p); return true; } catch { return false; } }

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pmarch-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

// ── boundary 29/30/31d + ROADMAP rewrite + byte-stable + resolveClosedJoin reads archived ──
{
  const root = await makeRoot({
    ".agents/plans/2026-05-17-young.md": plan("done"),
    ".agents/plans/2026-05-16-edge.md": plan("done"),
    ".agents/plans/2026-05-15-old.md": plan("done"),
    ".agents/ROADMAP.md": roadmap("",
      "- **young** → .agents/plans/2026-05-17-young.md (done)\n" +
      "- **edge** → .agents/plans/2026-05-16-edge.md (done)\n" +
      "- **old** → .agents/plans/2026-05-15-old.md (done)\n"),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.moved.map((m) => m.plan).sort(),
    [".agents/plans/2026-05-15-old.md", ".agents/plans/2026-05-16-edge.md"], JSON.stringify(r));
  assert.ok(await exists(join(root, ".agents/plans/archive/2026-05-16-edge.md")), "edge (30d) moved");
  assert.ok(await exists(join(root, ".agents/plans/2026-05-17-young.md")), "young (29d) stays");
  const rmText = await readFile(join(root, ".agents/ROADMAP.md"), "utf-8");
  assert.ok(rmText.includes("<!-- keep me verbatim -->"), "unrelated content byte-stable");
  assert.ok(rmText.includes(".agents/plans/archive/2026-05-16-edge.md"), "edge path rewritten");
  assert.ok(rmText.includes(".agents/plans/2026-05-17-young.md") && !rmText.includes("archive/2026-05-17-young"), "young path untouched");
  const view = await resolveClosedJoin(root, parseRoadmap(rmText), "edge");
  assert.ok(view?.plan?.path.includes("archive/2026-05-16-edge.md"), "resolveClosedJoin reads archived plan: " + JSON.stringify(view?.plan));
  assert.ok(view?.postImplNotes.includes("landed"), "archived plan post-impl notes still readable");
}

// ── non-terminal (draft/active) skipped even when old ──
{
  const root = await makeRoot({
    ".agents/plans/2026-01-01-draft.md": plan("draft"),
    ".agents/plans/2026-01-01-active.md": plan("active"),
    ".agents/ROADMAP.md": roadmap("", ""),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.moved, [], "non-terminal not moved: " + JSON.stringify(r));
  assert.equal(r.skipped.filter((s) => s.reason.includes("non-terminal")).length, 2);
}

// ── reference protection: current.txt + ## Open Plan: ──
{
  const root = await makeRoot({
    ".agents/plans/2026-01-01-cur.md": plan("done"),
    ".agents/plans/2026-01-01-openref.md": plan("done"),
    ".agents/state/current.txt": ".agents/plans/2026-01-01-cur.md\n",
    ".agents/ROADMAP.md": roadmap(
      "- **o** — t\n  - Priority: P2\n  - Status: active\n  - Plan: .agents/plans/2026-01-01-openref.md\n", ""),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.moved, [], "referenced plans protected: " + JSON.stringify(r));
  assert.ok(r.skipped.some((s) => s.reason.includes("current.txt")), "current.txt skip");
  assert.ok(r.skipped.some((s) => s.reason.includes("## Open")), "open-ref skip");
}

// ── destination collision → skip ──
{
  const root = await makeRoot({
    ".agents/plans/2026-01-01-dup.md": plan("done"),
    ".agents/plans/archive/2026-01-01-dup.md": plan("done"),
    ".agents/ROADMAP.md": roadmap("", "- **dup** → .agents/plans/2026-01-01-dup.md (done)\n"),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.moved, [], "collision skipped: " + JSON.stringify(r));
  assert.ok(r.skipped.some((s) => s.reason.includes("collision")), JSON.stringify(r.skipped));
}

// ── idempotent recovery: file already in archive/, ROADMAP still points to plans/ ──
{
  const root = await makeRoot({
    ".agents/plans/archive/2026-01-01-moved.md": plan("done"),
    ".agents/ROADMAP.md": roadmap("", "- **moved** → .agents/plans/2026-01-01-moved.md (done)\n"),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.recovered, [".agents/plans/2026-01-01-moved.md"], "recovery: " + JSON.stringify(r));
  const rmText = await readFile(join(root, ".agents/ROADMAP.md"), "utf-8");
  assert.ok(rmText.includes(".agents/plans/archive/2026-01-01-moved.md"), "stale pointer rewritten to archive/");
}

// ── malformed filename (no leading date) → skipped, never moved ──
{
  const root = await makeRoot({
    ".agents/plans/notes.md": plan("done"),
    ".agents/ROADMAP.md": roadmap("", ""),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.moved, [], "malformed name not moved");
  assert.ok(r.skipped.some((s) => s.reason.includes("malformed")), JSON.stringify(r.skipped));
}

// ── dry-run: plans the move but touches nothing on disk ──
{
  const root = await makeRoot({
    ".agents/plans/2026-01-01-old.md": plan("done"),
    ".agents/ROADMAP.md": roadmap("", "- **old** → .agents/plans/2026-01-01-old.md (done)\n"),
  });
  const r = await archivePlans(root, { today: TODAY, dryRun: true });
  assert.equal(r.moved.length, 1, "dry-run plans the move");
  assert.ok(await exists(join(root, ".agents/plans/2026-01-01-old.md")), "dry-run leaves file in place");
  assert.ok(!(await exists(join(root, ".agents/plans/archive/2026-01-01-old.md"))), "dry-run creates no archive copy");
  const rmText = await readFile(join(root, ".agents/ROADMAP.md"), "utf-8");
  assert.ok(!rmText.includes("archive/"), "dry-run leaves ROADMAP untouched");
}

// ── boundary-aware rewrite: a substring open path is NOT over-replaced ──
{
  const root = await makeRoot({
    ".agents/plans/2026-01-01-a.md": plan("done"),
    ".agents/ROADMAP.md": roadmap(
      "- **keep** — t\n  - Priority: P2\n  - Status: active\n  - Plan: .agents/plans/2026-01-01-a.md-extra.md\n",
      "- **a** → .agents/plans/2026-01-01-a.md (done)\n"),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.moved.map((m) => m.plan), [".agents/plans/2026-01-01-a.md"], JSON.stringify(r));
  const rmText = await readFile(join(root, ".agents/ROADMAP.md"), "utf-8");
  assert.ok(rmText.includes(".agents/plans/2026-01-01-a.md-extra.md") && !rmText.includes("archive/2026-01-01-a.md-extra.md"), "substring open path untouched");
  assert.ok(rmText.includes(".agents/plans/archive/2026-01-01-a.md (done)"), "closed path rewritten");
}

// ── calendar-invalid date (02-31) is skipped, not rolled over by Date.UTC ──
{
  const root = await makeRoot({
    ".agents/plans/2026-02-31-bad.md": plan("done"),
    ".agents/ROADMAP.md": roadmap("", "- **bad** → .agents/plans/2026-02-31-bad.md (done)\n"),
  });
  const r = await archivePlans(root, { today: TODAY });
  assert.deepEqual(r.moved, [], "calendar-invalid date not moved");
  assert.ok(r.skipped.some((s) => s.reason.includes("malformed")), JSON.stringify(r.skipped));
}

// ── invalid --today (calendar-invalid / malformed / empty) throws ──
{
  const root = await makeRoot({ ".agents/ROADMAP.md": roadmap("", "") });
  await assert.rejects(() => archivePlans(root, { today: "2026-02-31" }), /invalid today/, "calendar-invalid today");
  await assert.rejects(() => archivePlans(root, { today: "nope" }), /invalid today/, "malformed today");
  await assert.rejects(() => archivePlans(root, { today: "" }), /invalid today/, "empty today");
}

console.log("archive.test.ts: all fixtures PASS");
