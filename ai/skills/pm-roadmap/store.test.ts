// Tests for store.ts. Run: ./node_modules/.bin/tsx store.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir, stat, utimes } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import {
  type Block, parseBlocks, serializeBlocks, getField, setField,
  parseFrontmatter, serializeFrontmatter, getFmField,
  acquireLock, releaseLock, lockPath, tasksDir,
  readStamped, writeCAS, ensureGitignore, LockError, inboxPath,
} from "./store.ts";
import * as ops from "./ops.ts";
import { ensureManagedWorktree } from "../../lib/worktree.mjs";

const NOW = 1_750_000_000_000;

async function main() {
  const root = await mkdtemp(join(tmpdir(), "store-test-"));
  try {
    // ── round-trip: block-list with an unknown key preserved ──
    const backlog = `# PM_SKILLS — Backlog\n\n- **a-item** — Title here\n  - Priority: P1\n  - Status: open\n  - Weird: keep me\n  - Note: hi\n`;
    const parsed = parseBlocks(backlog);
    assert.equal(parsed.title, "PM_SKILLS — Backlog");
    assert.equal(parsed.blocks.length, 1);
    assert.equal(parsed.blocks[0].id, "a-item");
    assert.equal(parsed.blocks[0].title, "Title here");
    assert.equal(getField(parsed.blocks[0], "weird"), "keep me"); // unknown key kept
    assert.deepEqual(parseBlocks(serializeBlocks(parsed.title, parsed.blocks)), parsed); // round-trip stable

    // closed.md form (no title) round-trips
    const closed = parseBlocks(`# K — Closed\n\n- **x** — t\n  - Status: done\n  - Plan: .agents/plans/p.md\n  - Reason: (migrated)\n  - Closed: 2026-06-10\n`);
    assert.equal(getField(closed.blocks[0], "reason"), "(migrated)");
    assert.deepEqual(parseBlocks(serializeBlocks(closed.title, closed.blocks)), closed);

    // links.md + memory.md (same grammar) round-trip
    const links = parseBlocks(`# K — Links\n\n- **Wiki** — \n  - URL: https://x\n  - Triggers: a, b\n  - Summary: s\n`);
    assert.deepEqual(parseBlocks(serializeBlocks(links.title, links.blocks)), links);
    const mem = parseBlocks(`# K — Memory\n\n- **decision** — \n  - Note: keep it\n  - Date: 2026-06-10\n`);
    assert.deepEqual(parseBlocks(serializeBlocks(mem.title, mem.blocks)), mem);

    // ── orphans: content the parser drops, which the next write would destroy ──
    // A well-formed document reports none, so the guard never fires on ordinary data.
    assert.deepEqual(parsed.orphans, []);
    assert.deepEqual(closed.orphans, []);
    assert.deepEqual(links.orphans, []);

    // A multi-line value: only the first line lands in the field, the rest is stranded.
    const stranded = parseBlocks(`# K — Backlog\n\n- **a** — t\n  - Note: one\n\nSTRANDED\n`);
    assert.equal(getField(stranded.blocks[0], "note"), "one");
    assert.deepEqual(stranded.orphans, [{ line: 6, text: "STRANDED" }]);
    // and serializing the parsed model is exactly what erases it
    assert.ok(!serializeBlocks(stranded.title, stranded.blocks).includes("STRANDED"));

    // A field line before any block head has nowhere to attach (`sub && cur`).
    const early = parseBlocks(`# K — Backlog\n\n  - Note: nowhere\n\n- **a** — t\n  - Note: one\n`);
    assert.deepEqual(early.orphans, [{ line: 3, text: "  - Note: nowhere" }]);
    assert.equal(early.blocks.length, 1);
    assert.equal(getField(early.blocks[0], "note"), "one");

    // A later H1 silently replaces the earlier one, so the earlier line is lost too.
    const twoH1 = parseBlocks(`# first\n# second\n\n- **a** — t\n  - Note: one\n`);
    assert.equal(twoH1.title, "second");
    assert.deepEqual(twoH1.orphans, [{ line: 1, text: "# first" }]);

    // orphans stay in line order even though a superseded H1 is discovered later
    const mixed = parseBlocks(`# first\nLOOSE\n# second\n\n- **a** — t\n  - Note: one\n`);
    assert.deepEqual(mixed.orphans.map((o) => o.line), [1, 2]);

    // blank lines are not orphans (they are re-emitted by the serializer)
    assert.deepEqual(parseBlocks(`# K — Backlog\n\n\n- **a** — t\n  - Note: one\n\n`).orphans, []);

    // ── serializeBlocks refuses any model it cannot write back losslessly ──
    // Escapes, never literals: a literal U+2028 pasted into a source file or a shell command
    // is easily normalized to a space in transit, and the test would then assert nothing.
    const one = (fields: [string, string][]) => [{ id: "a", title: "t", fields }];
    const refuses = (t: string, bs: Block[], why: RegExp, label: string) =>
      assert.throws(() => serializeBlocks(t, bs), why, label);

    refuses("K", one([["Note", "a\nb"]]), /field 'Note' must be single-line/, "newline in a value");
    refuses("K", one([["Note", "a\r\nb"]]), /field 'Note' must be single-line/, "CRLF in a value");
    // the injection shape: the continuation line would parse as a real field
    refuses("K", one([["Note", "x\n  - Owner: evil"]]), /field 'Note' must be single-line/, "field injection via a note");
    // no newline at all — these are the cases a character blacklist would let through
    refuses("K", one([["Note", "a\u2028b"]]), /cannot be represented/, "U+2028 line separator");
    refuses("K", one([["Note", "a\u2029b"]]), /cannot be represented/, "U+2029 paragraph separator");
    refuses("K", one([["Note", "  padded  "]]), /cannot be represented/, "edge whitespace the parser would trim");
    refuses("K\nX", [], /file title must be single-line/, "newline in the file title");
    refuses("K", [{ id: "", title: "t", fields: [] }], /block id must not be empty/, "empty id");
    refuses("K", [{ id: "   ", title: "t", fields: [] }], /block id must not be empty/, "whitespace-only id");
    refuses("K", [{ id: "a*b", title: "t", fields: [] }], /must not contain '\*'/, "'*' in an id (breaks the head grammar)");
    refuses("K", [{ id: "a", title: "x\ny", fields: [] }], /title must be single-line/, "newline in a block title");
    refuses("K", one([["Bad Key", "v"]]), /field key .* must match/, "field key outside the parser's pattern");

    // and the accepted shapes still round-trip, including ones that look risky
    for (const [label, t, bs] of [
      ["empty document", "K — Backlog", [] as Block[]],
      ["'**' inside a title", "K", [{ id: "a", title: "has **bold** text", fields: [] }]],
      ["'—' inside a title", "K", [{ id: "a", title: "x — y", fields: [] }]],
      ["empty title", "K", [{ id: "a", title: "", fields: [["Note", ""]] as [string, string][] }]],
      ["duplicate keys", "K", [{ id: "a", title: "t", fields: [["Note", "1"], ["Note", "2"]] as [string, string][] }]],
    ] as const) {
      const text = serializeBlocks(t, bs as Block[]);
      const back = parseBlocks(text);
      assert.deepEqual(back.orphans, [], `${label}: no orphans`);
      assert.equal(serializeBlocks(back.title, back.blocks), text, `${label}: round-trip is a fixed point`);
    }

    // setField updates in place / appends
    setField(mem.blocks[0], "Note", "changed");
    assert.equal(getField(mem.blocks[0], "note"), "changed");
    setField(mem.blocks[0], "New", "v");
    assert.equal(getField(mem.blocks[0], "new"), "v");

    // ── round-trip: frontmatter (task.md), unknown key preserved ──
    const taskMd = `---\nkey: PM_SKILLS\ntitle: pm system\nstatus: active\nextra: x\n---\n\n# PM_SKILLS — pm system\n\ngoal line\n`;
    const fm = parseFrontmatter(taskMd);
    assert.equal(getFmField(fm.fields, "status"), "active");
    assert.equal(getFmField(fm.fields, "extra"), "x"); // unknown key kept
    const fmRound = parseFrontmatter(serializeFrontmatter(fm.fields, fm.body));
    assert.deepEqual(fmRound.fields, fm.fields);
    assert.equal(fmRound.body.trim(), fm.body.trim());

    // ── lock: writers serialize (second acquire blocked while held) ──
    const firstOwner = await acquireLock(root, "a", { retries: 0, nowMs: NOW });
    await assert.rejects(() => acquireLock(root, "b", { retries: 0, nowMs: NOW }), LockError);
    assert.equal(await releaseLock({ ...firstOwner, token: "not-the-owner" }), false);
    assert.equal((await readdir(lockPath(root))).length, 1, "foreign release leaves the owner directory intact");
    await releaseLock(firstOwner);
    const nextOwner = await acquireLock(root, "c", { retries: 0, nowMs: NOW }); // free again
    await releaseLock(nextOwner);

    // ── lock: a LIVE pid is never broken (even when stale by time) ──
    const liveToken = "live-owner";
    await mkdir(lockPath(root), { recursive: true });
    await writeFile(join(lockPath(root), `owner-${liveToken}.json`), JSON.stringify({
      pid: process.pid, host: hostname(), token: liveToken, started: new Date(NOW - 9_999_999).toISOString(), operation: "held",
    }));
    await assert.rejects(
      () => acquireLock(root, "intruder", { retries: 0, nowMs: NOW, staleMs: 1000 }),
      LockError, "live-pid lock must not be broken",
    );
    await rm(lockPath(root), { recursive: true, force: true });

    // ── lock: a valid DEAD local owner is reclaimed with the shared owner protocol ──
    const deadToken = "dead-owner";
    await mkdir(lockPath(root), { recursive: true });
    await writeFile(join(lockPath(root), `owner-${deadToken}.json`), JSON.stringify({
      pid: 2_147_483_646, host: hostname(), token: deadToken, started: new Date(NOW - 9_999_999).toISOString(), operation: "crashed",
    }));
    const recoveredOwner = await acquireLock(root, "recover", { retries: 0, nowMs: NOW, staleMs: 1000 });
    assert.equal(recoveredOwner.owner.pid, process.pid);
    assert.deepEqual(await readdir(lockPath(root)), [`owner-${recoveredOwner.token}.json`]);
    await releaseLock(recoveredOwner);

    // ── CAS: a changed-under-window write is aborted; a matching one succeeds ──
    const p = join(root, ".agents", "tasks", "K", "backlog.md");
    await writeCAS(p, "v1", null);
    const st = await readStamped(p);
    assert.ok(st);
    await writeFile(p, "v2-external");
    await utimes(p, new Date(), new Date(st!.mtimeMs + 5000)); // force a distinct mtime
    await assert.rejects(() => writeCAS(p, "v3", st!.mtimeMs), LockError, "stale CAS must abort");
    const st2 = await readStamped(p);
    await writeCAS(p, "v4", st2!.mtimeMs); // matching mtime → ok
    assert.equal((await readStamped(p))!.content, "v4");

    // inbox is part of the shared tasks store, never a root-level file.
    assert.equal(inboxPath(root), join(root, ".agents", "tasks", "_inbox.md"));

    // ── gitignore ensure (idempotent) ──
    await ensureGitignore(root, ["tasks/", "plans/", "state/", "inbox.md"]);
    let gi = await readFile(join(root, ".agents", ".gitignore"), "utf-8");
    for (const e of ["tasks/", "plans/", "state/", "inbox.md"]) assert.ok(gi.includes(e), `gitignore has ${e}`);
    await ensureGitignore(root, ["tasks/"]); // no dup
    gi = await readFile(join(root, ".agents", ".gitignore"), "utf-8");
    assert.equal(gi.split("\n").filter((l) => l.trim() === "tasks/").length, 1, "tasks/ not duplicated");

    // Two managed worktrees serialize inbox writes through the one shared tasks/.lock.
    const gitRoot = await mkdtemp(join(tmpdir(), "store-worktrees-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: gitRoot, encoding: "utf8" });
      git("init", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      await writeFile(join(gitRoot, "README.md"), "x\n");
      git("add", "README.md");
      git("commit", "-m", "init");
      const a = await ensureManagedWorktree({ root: gitRoot, id: "inbox-a", base: "main" });
      const b = await ensureManagedWorktree({ root: gitRoot, id: "inbox-b", base: "main" });
      await Promise.all([
        ops.itemAdd(a.execution_root, { inbox: true }, { id: "from-a", title: "A" }),
        ops.itemAdd(b.execution_root, { inbox: true }, { id: "from-b", title: "B" }),
      ]);
      const shared = parseBlocks(await readFile(join(gitRoot, ".agents", "tasks", "_inbox.md"), "utf8"));
      assert.deepEqual(shared.blocks.map((entry) => entry.id).sort(), ["from-a", "from-b"]);
      assert.equal(await stat(join(gitRoot, ".agents", "inbox.md")).then(() => true).catch(() => false), false);
    } finally {
      await rm(gitRoot, { recursive: true, force: true });
    }

    console.log("store.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
