// Memory store fixtures. Run: ./node_modules/.bin/tsx memory.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMemoryFile, serializeMemoryFile, readTaskMemory, writeTaskMemory, stripMemorySection, memoryFilePath, ensureMemoryIgnored } from "./memory.ts";
import { parseTaskContext } from "./join.ts";

const NOTES = [
  { title: "decision-a", note: "use X over Y", date: "2026-06-10" },
  { title: "gotcha-b", note: "Z breaks on empty input", date: "" },
];

// round-trip
const ser = serializeMemoryFile("TK", NOTES);
assert.ok(ser.startsWith("# TK\n"));
assert.deepEqual(parseMemoryFile(ser), NOTES, "memory file round-trip");

// union read: file + legacy section, file wins on title collision
{
  const root = await mkdtemp(join(tmpdir(), "pmmem-"));
  await mkdir(join(root, ".agents", "task-context"), { recursive: true });
  const legacy = `# TK\n\n- **Wiki**\n  - URL: https://x/y\n\n## Memory\n\n- **gotcha-b**\n  - Note: legacy stale version\n- **legacy-only**\n  - Note: still here\n  - Date: 2026-06-01\n`;
  await writeFile(join(root, ".agents", "task-context", "TK.md"), legacy);
  await writeTaskMemory(root, "TK", NOTES);

  const union = await readTaskMemory(root, "TK", parseTaskContext(legacy).memory);
  assert.equal(union.length, 3, JSON.stringify(union));
  assert.equal(union.find((m) => m.title === "gotcha-b")?.note, "Z breaks on empty input", "file wins over legacy");
  assert.equal(union.find((m) => m.title === "legacy-only")?.note, "still here");

  // migration: strip legacy section, union must stay identical
  const stripped = stripMemorySection(legacy);
  assert.ok(!stripped.includes("## Memory"), "section removed");
  assert.ok(stripped.includes("- **Wiki**"), "links untouched");
  await writeTaskMemory(root, "TK", union);
  await writeFile(join(root, ".agents", "task-context", "TK.md"), stripped);
  const after = await readTaskMemory(root, "TK", parseTaskContext(stripped).memory);
  assert.deepEqual(after.map((m) => m.title).sort(), union.map((m) => m.title).sort(), "union identical post-migration");

  // file path + atomicity artifact absent
  assert.ok((await readFile(memoryFilePath(root, "TK"), "utf-8")).includes("legacy-only"));

  // gitignore enforce: idempotent append
  await ensureMemoryIgnored(root);
  await ensureMemoryIgnored(root);
  const gi = await readFile(join(root, ".agents", ".gitignore"), "utf-8");
  assert.equal(gi.split("\n").filter((l) => l.trim() === "memory/").length, 1, gi);
}

// no file, no legacy → empty
{
  const root = await mkdtemp(join(tmpdir(), "pmmem-"));
  assert.deepEqual(await readTaskMemory(root, "NONE"), []);
}

console.log("memory.test.ts: all fixtures PASS");
