import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
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
