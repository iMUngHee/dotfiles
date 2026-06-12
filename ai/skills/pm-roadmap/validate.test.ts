// Violation fixtures for validate.ts. Run: ./node_modules/.bin/tsx validate.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRoadmap } from "./validate.ts";

const PLAN_DRAFT = `---\nid: p1\ntitle: t\nstatus: draft\n---\n\n## Goal\n`;
const PLAN_DONE = `---\nid: p2\ntitle: t\nstatus: done\n---\n\n## Goal\n`;

function roadmap(open: string, closed = "", focus = ""): string {
  return `---\nproject: demo\nfocus: ${focus}\nupdated: 2026-06-10\n---\n\n# demo — Backlog\n\n## Open\n\n${open}\n## Recently Closed\n\n${closed}`;
}

const item = (id: string, fields: Record<string, string>): string =>
  `- **${id}** — title of ${id}\n` + Object.entries(fields).map(([k, v]) => `  - ${k}: ${v}`).join("\n") + "\n";

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pmval-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

const checksOf = (vs: { check: string }[]) => vs.map((v) => v.check).sort();

// ── green fixture: everything consistent ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(
      item("a-item", { Priority: "P1", Status: "draft", Task: "TK", Plan: ".agents/plans/p1.md", Note: "n" }) +
        item("b-item", { Priority: "P2", Status: "open", Task: "TK", Plan: "-", Note: "n" }),
      "- **old** → .agents/plans/p2.md (done)\n",
    ),
    ".agents/plans/p1.md": PLAN_DRAFT,
    ".agents/plans/p2.md": PLAN_DONE,
    ".agents/state/current.txt": ".agents/plans/p1.md\n",
    ".agents/task-context/TK.md": "# TK\n",
  });
  const r = await validateRoadmap(root);
  assert.equal(r.missingRoadmap, false);
  assert.deepEqual(r.errors, [], `green fixture must have no errors: ${JSON.stringify(r.errors)}`);
  assert.deepEqual(r.warns, []);
}

// ── missing roadmap ──
{
  const root = await makeRoot({});
  const r = await validateRoadmap(root);
  assert.equal(r.missingRoadmap, true);
  assert.deepEqual(r.errors, []);
}

// ── V1 duplicate plan link + V3 mirror mismatch ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(
      item("a-item", { Status: "active", Plan: ".agents/plans/p1.md", Note: "n" }) +
        item("b-item", { Status: "draft", Plan: ".agents/plans/p1.md", Note: "n" }),
    ),
    ".agents/plans/p1.md": PLAN_DRAFT,
  });
  const r = await validateRoadmap(root);
  assert.deepEqual(checksOf(r.errors), ["V1", "V3"], JSON.stringify(r.errors));
}

// ── V2 missing plan path ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(item("a-item", { Status: "draft", Plan: ".agents/plans/nope.md", Note: "n" })),
  });
  const r = await validateRoadmap(root);
  assert.deepEqual(checksOf(r.errors), ["V2"], JSON.stringify(r.errors));
}

// ── V4 closed bad status is unrepresentable post-parse; V4 fires via open-section status — covered by parser defaults.
// ── V5 planless active + planless closed done ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(
      item("a-item", { Status: "active", Plan: "-", Note: "n" }),
      "- **ghost** → done · was never planned\n",
    ),
  });
  const r = await validateRoadmap(root);
  assert.ok(checksOf(r.errors).includes("V5"), JSON.stringify(r.errors));
}

// ── V6 dangling focus ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(item("a-item", { Status: "open", Plan: "-", Note: "n" }), "", "gone-item"),
  });
  const r = await validateRoadmap(root);
  assert.deepEqual(checksOf(r.errors), ["V6"], JSON.stringify(r.errors));
}

// ── V7 pointer → terminal plan ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(item("a-item", { Status: "open", Plan: "-", Note: "n" })),
    ".agents/plans/p2.md": PLAN_DONE,
    ".agents/state/current.txt": ".agents/plans/p2.md\n",
  });
  const r = await validateRoadmap(root);
  assert.deepEqual(checksOf(r.errors), ["V7"], JSON.stringify(r.errors));
}

// ── V8 duplicate id + bad kebab ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(
      item("dup", { Status: "open", Plan: "-", Note: "n" }) +
        item("dup", { Status: "open", Plan: "-", Note: "n" }) +
        item("Bad_Id", { Status: "open", Plan: "-", Note: "n" }),
    ),
  });
  const r = await validateRoadmap(root);
  assert.deepEqual(checksOf(r.errors), ["V8", "V8"], JSON.stringify(r.errors));
}

// ── V9 warn: bad task grammar + missing task file ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(
      item("a-item", { Status: "open", Task: "bad key", Plan: "-", Note: "n" }) +
        item("b-item", { Status: "open", Task: "NOFILE", Plan: "-", Note: "n" }),
    ),
  });
  const r = await validateRoadmap(root);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(checksOf(r.warns), ["V9", "V9"], JSON.stringify(r.warns));
}

// ── V9 (closed) warn: bad task grammar + missing task file; legacy null exempt ──
{
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(
      item("a-item", { Status: "open", Plan: "-", Note: "n" }),
      "- **c1** → dropped · gone · Task: bad key\n" + // suffix with bad grammar stays note-side? no — KEY grammar fails → stays in note, no warn
        "- **c2** → dropped · gone · Task: NOFILE\n" +
        "- **c3** → dropped · legacy no task\n",
    ),
  });
  const r = await validateRoadmap(root);
  assert.deepEqual(r.errors, []);
  // c1: `Task: bad key` does not match the suffix regex (space in KEY) → parsed as note tail, task null, exempt.
  // c2: NOFILE matches grammar but task-context missing → one V9 warn. c3: legacy → exempt.
  assert.deepEqual(checksOf(r.warns), ["V9"], JSON.stringify(r.warns));
}

// ── V10 warn: closed > 10 ──
{
  const closed = Array.from({ length: 11 }, (_, i) => `- **c${i}** → dropped · old\n`).join("");
  const root = await makeRoot({
    ".agents/ROADMAP.md": roadmap(item("a-item", { Status: "open", Plan: "-", Note: "n" }), closed),
  });
  const r = await validateRoadmap(root);
  assert.ok(checksOf(r.warns).includes("V10"), JSON.stringify(r.warns));
}

console.log("validate.test.ts: all fixtures PASS");
