import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  absentDescriptor,
  listTransactions,
  makeTarget,
  recoverTransactions,
  regularDescriptor,
  runTransaction,
} from "./transaction.ts";
import { acquireOwnerLock, releaseOwnerLock } from "../../lib/owner-lock.mjs";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "transaction-test-"));
  try {
    await mkdir(join(root, ".agents", "tasks"), { recursive: true });
    const dangling = join(root, ".agents", "inbox-link.md");
    const regular = join(root, ".agents", "tasks", "value.md");
    await symlink("missing-target.md", dangling);
    await writeFile(regular, "before\n");
    const targets = [
      await makeTarget(root, dangling, absentDescriptor()),
      await makeTarget(root, regular, regularDescriptor("after\n")),
    ];

    await assert.rejects(
      runTransaction(root, "crash", targets, { id: "crash", crashAfter: 1 }),
      /simulated process crash/,
    );
    assert.deepEqual(await listTransactions(root), ["crash.json"], "crash retains journal");
    assert.equal((await lstat(dangling).catch(() => null)), null, "first target was removed");
    assert.equal(await readFile(regular, "utf8"), "before\n", "second target stayed before");

    const recovered = await recoverTransactions(root);
    assert.deepEqual(recovered.recovered, ["crash.json:rolled-back"]);
    assert.equal((await lstat(dangling)).isSymbolicLink(), true, "rollback restores node type");
    assert.equal(await readlink(dangling), "missing-target.md", "rollback restores raw dangling target");
    assert.equal(await readFile(regular, "utf8"), "before\n");
    assert.deepEqual(await listTransactions(root), []);

    const committed = [await makeTarget(root, regular, regularDescriptor("committed\n"))];
    await runTransaction(root, "commit", committed, { id: "commit" });
    assert.equal(await readFile(regular, "utf8"), "committed\n");
    assert.deepEqual(await listTransactions(root), []);

    // A target changed before apply is outside the applied prefix: earlier writes
    // roll back, while the external update survives.
    const raced = join(root, ".agents", "tasks", "raced.md");
    await writeFile(regular, "before\n");
    await writeFile(raced, "before-raced\n");
    await assert.rejects(
      runTransaction(root, "unapplied-race", [
        await makeTarget(root, regular, regularDescriptor("after\n")),
        await makeTarget(root, raced, regularDescriptor("after-raced\n")),
      ], {
        id: "unapplied-race",
        beforeApply: async (_target, index) => {
          if (index === 1) await writeFile(raced, "external\n");
        },
      }),
      /transaction precondition failed/,
    );
    assert.equal(await readFile(regular, "utf8"), "before\n", "applied target rolls back");
    assert.equal(await readFile(raced, "utf8"), "external\n", "unapplied external update survives");
    assert.deepEqual(await listTransactions(root), []);

    // Recovery observes the same checkout-local current lock protocol as writers.
    const pointer = join(root, ".agents", "state", "current.txt");
    const pointerCompanion = join(root, ".agents", "tasks", "pointer-companion.md");
    await mkdir(join(root, ".agents", "state"), { recursive: true });
    await writeFile(pointer, "before-current\n");
    await writeFile(pointerCompanion, "before-companion\n");
    await assert.rejects(
      runTransaction(root, "pointer-recovery", [
        await makeTarget(root, pointer, regularDescriptor("after-current\n")),
        await makeTarget(root, pointerCompanion, regularDescriptor("after-companion\n")),
      ], { id: "pointer-recovery", crashAfter: 1 }),
      /simulated process crash/,
    );
    const currentOwner = await acquireOwnerLock(join(root, ".agents", "state", "current.lock"), { operation: "current-writer", retries: 0 });
    const pointerRecovery = recoverTransactions(root);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await readFile(pointer, "utf8"), "after-current\n", "recovery waits while current.lock is owned");
    await releaseOwnerLock(currentOwner);
    assert.deepEqual((await pointerRecovery).recovered, ["pointer-recovery.json:rolled-back"]);
    assert.equal(await readFile(pointer, "utf8"), "before-current\n");

    // Persisted paths and roots are canonical; equivalent aliases and tampered
    // roots are rejected before recovery touches a target.
    for (const [label, alias] of [
      ["dotted", ".agents/state/./current.txt"],
      ["repeated-separator", ".agents//state/current.txt"],
      ["absolute-inside-root", join(await realpath(root), ".agents", "state", "current.txt")],
    ]) {
      await writeFile(pointer, "before-current\n");
      await writeFile(pointerCompanion, "before-companion\n");
      const id = `pointer-path-${label}`;
      await assert.rejects(
        runTransaction(root, "pointer-path", [
          await makeTarget(root, pointer, regularDescriptor("after-current\n")),
          await makeTarget(root, pointerCompanion, regularDescriptor("after-companion\n")),
        ], { id, crashAfter: 1 }),
        /simulated process crash/,
      );
      const journalPath = join(root, ".agents", "tasks", ".transactions", `${id}.json`);
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      const originalPath = journal.targets[0].path;
      journal.targets[0].path = alias;
      await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await assert.rejects(recoverTransactions(root), /non-canonical transaction path|unsafe transaction path/);
      assert.equal(await readFile(pointer, "utf8"), "after-current\n");
      journal.targets[0].path = originalPath;
      await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await recoverTransactions(root);
      assert.equal(await readFile(pointer, "utf8"), "before-current\n");
    }

    const outside = await realpath(await mkdtemp(join(tmpdir(), "transaction-physical-escape-")));
    try {
      await mkdir(join(root, ".agents", "escape-parent"), { recursive: true });
      await symlink(outside, join(root, ".agents", "escape-parent", "escape"), "dir");
      await assert.rejects(
        makeTarget(root, join(root, ".agents", "escape-parent", "escape", "outside.md"), regularDescriptor("outside\n")),
        /physical|allowed root|escapes/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }

    // Every journal phase is restartable: pre-apply phases roll back; committed finalizes.
    for (const crashAt of ["prepared", "applying", "committed"] as const) {
      const phaseRoot = await mkdtemp(join(tmpdir(), `transaction-${crashAt}-`));
      try {
        await mkdir(join(phaseRoot, ".agents", "tasks"), { recursive: true });
        const value = join(phaseRoot, ".agents", "tasks", "phase.md");
        await writeFile(value, "before\n");
        await assert.rejects(
          runTransaction(phaseRoot, `phase-${crashAt}`, [await makeTarget(phaseRoot, value, regularDescriptor("after\n"))], { id: crashAt, crashAt } as any),
          /simulated process crash/,
        );
        const phaseRecovery = await recoverTransactions(phaseRoot);
        assert.equal(await readFile(value, "utf8"), crashAt === "committed" ? "after\n" : "before\n");
        assert.deepEqual(phaseRecovery.recovered, [`${crashAt}.json:${crashAt === "committed" ? "finalized" : "rolled-back"}`]);
      } finally { await rm(phaseRoot, { recursive: true, force: true }); }
    }

    // Crash after every target rename returns a wholly-before or wholly-after state.
    for (const crashAfter of [1, 2]) {
      const boundaryRoot = await mkdtemp(join(tmpdir(), `transaction-boundary-${crashAfter}-`));
      try {
        await mkdir(join(boundaryRoot, ".agents", "tasks"), { recursive: true });
        const one = join(boundaryRoot, ".agents", "tasks", "one.md");
        const two = join(boundaryRoot, ".agents", "tasks", "two.md");
        await writeFile(one, "before-one\n");
        await writeFile(two, "before-two\n");
        const boundaryTargets = [
          await makeTarget(boundaryRoot, one, regularDescriptor("after-one\n")),
          await makeTarget(boundaryRoot, two, regularDescriptor("after-two\n")),
        ];
        await assert.rejects(runTransaction(boundaryRoot, "boundary", boundaryTargets, { id: "boundary", crashAfter }), /simulated process crash/);
        await recoverTransactions(boundaryRoot);
        const contents = [await readFile(one, "utf8"), await readFile(two, "utf8")];
        assert.deepEqual(contents, crashAfter === 2 ? ["after-one\n", "after-two\n"] : ["before-one\n", "before-two\n"]);
      } finally { await rm(boundaryRoot, { recursive: true, force: true }); }
    }

    // A shared task-store journal can span canonical Git worktree roots and
    // recover when the next mutator enters from the linked checkout.
    const gitRoot = await realpath(await mkdtemp(join(tmpdir(), "transaction-git-root-")));
    try {
      const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
      git(gitRoot, "init", "-b", "main");
      git(gitRoot, "config", "user.email", "test@example.com");
      git(gitRoot, "config", "user.name", "Test");
      await writeFile(join(gitRoot, "README.md"), "root\n");
      git(gitRoot, "add", "README.md");
      git(gitRoot, "commit", "-m", "init");
      await mkdir(join(gitRoot, ".agents", "tasks"), { recursive: true });
      const linkedRoot = join(gitRoot, ".agents", "worktrees", "linked");
      git(gitRoot, "worktree", "add", "-b", "agent/linked", linkedRoot, "main");
      await mkdir(join(linkedRoot, ".agents", "state"), { recursive: true });
      await symlink(join(gitRoot, ".agents", "tasks"), join(linkedRoot, ".agents", "tasks"), "dir");
      const shared = join(gitRoot, ".agents", "tasks", "shared.md");
      const linkedPointer = join(linkedRoot, ".agents", "state", "current.txt");
      await writeFile(shared, "before-shared\n");
      await writeFile(linkedPointer, "before-linked\n");
      await assert.rejects(
        runTransaction(gitRoot, "cross-root", [
          await makeTarget(gitRoot, shared, regularDescriptor("after-shared\n")),
          await makeTarget(linkedRoot, linkedPointer, regularDescriptor("after-linked\n")),
        ], { id: "cross-root", crashAfter: 1 }),
        /simulated process crash/,
      );
      assert.deepEqual((await recoverTransactions(linkedRoot)).recovered, ["cross-root.json:rolled-back"]);
      assert.equal(await readFile(shared, "utf8"), "before-shared\n");
      assert.equal(await readFile(linkedPointer, "utf8"), "before-linked\n");

      const tamperedOriginTarget = await makeTarget(gitRoot, shared, regularDescriptor("tampered\n"));
      await assert.rejects(
        runTransaction(gitRoot, "tampered-origin", [tamperedOriginTarget], { id: "tampered-origin", crashAt: "prepared" }),
        /simulated process crash/,
      );
      const tamperedJournalPath = join(gitRoot, ".agents", "tasks", ".transactions", "tampered-origin.json");
      const tamperedJournal = JSON.parse(await readFile(tamperedJournalPath, "utf8"));
      const originalOrigin = tamperedJournal.root;
      const unrelatedRoot = await realpath(await mkdtemp(join(tmpdir(), "transaction-unrelated-")));
      try {
        tamperedJournal.root = unrelatedRoot;
        await writeFile(tamperedJournalPath, `${JSON.stringify(tamperedJournal, null, 2)}\n`);
        await assert.rejects(recoverTransactions(linkedRoot), /invalid transaction journal root|origin/);
        assert.deepEqual(await listTransactions(gitRoot), ["tampered-origin.json"]);
        tamperedJournal.root = originalOrigin;
        await writeFile(tamperedJournalPath, `${JSON.stringify(tamperedJournal, null, 2)}\n`);
        await recoverTransactions(linkedRoot);
      } finally {
        await rm(unrelatedRoot, { recursive: true, force: true });
      }

      await assert.rejects(
        runTransaction(gitRoot, "foreign-root", [await makeTarget(gitRoot, shared, regularDescriptor("foreign\n"))], { id: "foreign-root", crashAt: "prepared" }),
        /simulated process crash/,
      );
      const foreignJournalPath = join(gitRoot, ".agents", "tasks", ".transactions", "foreign-root.json");
      const foreignJournal = JSON.parse(await readFile(foreignJournalPath, "utf8"));
      const originalTarget = { ...foreignJournal.targets[0] };
      const foreignRoot = await realpath(await mkdtemp(join(tmpdir(), "transaction-foreign-target-")));
      try {
        foreignJournal.targets[0].root = foreignRoot;
        foreignJournal.targets[0].path = "foreign.md";
        await writeFile(foreignJournalPath, `${JSON.stringify(foreignJournal, null, 2)}\n`);
        await assert.rejects(recoverTransactions(linkedRoot), /not an allowed transaction root|not a Git worktree|foreign/);
        foreignJournal.targets[0] = originalTarget;
        await writeFile(foreignJournalPath, `${JSON.stringify(foreignJournal, null, 2)}\n`);
        await recoverTransactions(linkedRoot);
      } finally {
        await rm(foreignRoot, { recursive: true, force: true });
      }

      const legacy = join(gitRoot, ".agents", "tasks", "legacy.md");
      await writeFile(legacy, "before-legacy\n");
      await assert.rejects(
        runTransaction(gitRoot, "legacy-safe", [await makeTarget(gitRoot, legacy, regularDescriptor("after-legacy\n"))], { id: "legacy-safe", crashAfter: 1 }),
        /simulated process crash/,
      );
      const legacyJournalPath = join(gitRoot, ".agents", "tasks", ".transactions", "legacy-safe.json");
      const legacyJournal = JSON.parse(await readFile(legacyJournalPath, "utf8"));
      delete legacyJournal.root;
      delete legacyJournal.targets[0].root;
      legacyJournal.targets[0].path = ".agents/tasks/legacy.md";
      await writeFile(legacyJournalPath, `${JSON.stringify(legacyJournal, null, 2)}\n`);
      assert.deepEqual((await recoverTransactions(linkedRoot)).recovered, ["legacy-safe.json:finalized"]);
      assert.equal(await readFile(legacy, "utf8"), "after-legacy\n");

      const legacyOutside = await realpath(await mkdtemp(join(tmpdir(), "transaction-legacy-outside-")));
      try {
        await symlink(legacyOutside, join(gitRoot, ".agents", "legacy-escape"), "dir");
        await assert.rejects(
          runTransaction(gitRoot, "legacy-unsafe", [await makeTarget(gitRoot, shared, regularDescriptor("unsafe\n"))], { id: "legacy-unsafe", crashAt: "prepared" }),
          /simulated process crash/,
        );
        const unsafeJournalPath = join(gitRoot, ".agents", "tasks", ".transactions", "legacy-unsafe.json");
        const unsafeJournal = JSON.parse(await readFile(unsafeJournalPath, "utf8"));
        delete unsafeJournal.root;
        delete unsafeJournal.targets[0].root;
        unsafeJournal.targets[0].path = ".agents/legacy-escape/legacy-outside.md";
        await writeFile(unsafeJournalPath, `${JSON.stringify(unsafeJournal, null, 2)}\n`);
        await assert.rejects(recoverTransactions(linkedRoot), /manual_recovery_required|physical|escapes/);
        assert.deepEqual(await listTransactions(gitRoot), ["legacy-unsafe.json"]);
      } finally {
        await rm(legacyOutside, { recursive: true, force: true });
      }
    } finally {
      await rm(gitRoot, { recursive: true, force: true });
    }

    // An unrecognized node state blocks recovery and retains the journal for manual repair.
    const unknownRoot = await mkdtemp(join(tmpdir(), "transaction-unknown-"));
    try {
      await mkdir(join(unknownRoot, ".agents", "tasks"), { recursive: true });
      const value = join(unknownRoot, ".agents", "tasks", "unknown.md");
      await writeFile(value, "before\n");
      await assert.rejects(
        runTransaction(unknownRoot, "unknown", [await makeTarget(unknownRoot, value, regularDescriptor("after\n"))], { id: "unknown", crashAfter: 1 }),
        /simulated process crash/,
      );
      await writeFile(value, "neither-before-nor-after\n");
      await assert.rejects(recoverTransactions(unknownRoot), /manual_recovery_required/);
      assert.deepEqual(await listTransactions(unknownRoot), ["unknown.json"]);
    } finally { await rm(unknownRoot, { recursive: true, force: true }); }

    console.log("transaction.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
