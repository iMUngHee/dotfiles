// Tests for store.ts. Run: ./node_modules/.bin/tsx store.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, mkdir, stat, utimes } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import {
  parseBlocks, serializeBlocks, getField, setField,
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
    await acquireLock(root, "a", { retries: 0, nowMs: NOW });
    await assert.rejects(() => acquireLock(root, "b", { retries: 0, nowMs: NOW }), LockError);
    await releaseLock(root);
    await acquireLock(root, "c", { retries: 0, nowMs: NOW }); // free again
    await releaseLock(root);

    // ── lock: a LIVE pid is never broken (even when stale by time) ──
    await mkdir(tasksDir(root), { recursive: true });
    await writeFile(lockPath(root), JSON.stringify({
      pid: process.pid, host: hostname(), start: new Date(NOW - 9_999_999).toISOString(), op: "held",
    }));
    await assert.rejects(
      () => acquireLock(root, "intruder", { retries: 0, nowMs: NOW, staleMs: 1000 }),
      LockError, "live-pid lock must not be broken",
    );
    await releaseLock(root);

    // ── lock: a DEAD pid past staleMs IS broken, then acquired ──
    await writeFile(lockPath(root), JSON.stringify({
      pid: 2_147_483_646, host: hostname(), start: new Date(NOW - 9_999_999).toISOString(), op: "crashed",
    }));
    await acquireLock(root, "recover", { retries: 0, nowMs: NOW, staleMs: 1000 });
    assert.equal(JSON.parse(await readFile(lockPath(root), "utf-8")).pid, process.pid);
    await releaseLock(root);

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
