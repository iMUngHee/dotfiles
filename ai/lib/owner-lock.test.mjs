import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireOwnerLock,
  inspectOwnerLock,
  reclaimOwnerLock,
  releaseOwnerLock,
} from "./owner-lock.mjs";

const DEAD_PID = 2_147_483_646;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(path) {
  return stat(path).then(() => true).catch(() => false);
}

async function writeOwner(lock, owner, extras = []) {
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, `owner-${owner.token}.json`), `${JSON.stringify(owner)}\n`);
  for (const name of extras) await writeFile(join(lock, name), "unexpected\n");
}

test("owner locks serialize and release only their exact ownership token", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "owner-lock-basic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "state.lock");

  const owner = await acquireOwnerLock(lock, { operation: "first", retries: 0 });
  const entries = await readdir(lock);
  assert.deepEqual(entries, [`owner-${owner.token}.json`]);
  await assert.rejects(
    acquireOwnerLock(lock, { operation: "second", retries: 0 }),
    /lock held by live local owner/,
  );

  assert.equal(await releaseOwnerLock({ path: lock, token: "not-the-owner" }), false);
  assert.equal(await exists(lock), true, "a foreign release must leave the live lock intact");
  assert.equal(await releaseOwnerLock(owner), true);
  assert.equal(await exists(lock), false);
});

test("owner locks recover only valid dead local owners and fail closed otherwise", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "owner-lock-controls-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "tasks.lock");
  const deadOwner = {
    host: hostname(),
    pid: DEAD_PID,
    token: "dead-owner",
    operation: "crashed",
    started: new Date(0).toISOString(),
  };

  await writeOwner(lock, deadOwner);
  const recovered = await acquireOwnerLock(lock, { operation: "recovered", retries: 0 });
  assert.notEqual(recovered.token, deadOwner.token);
  await releaseOwnerLock(recovered);

  await writeOwner(lock, { ...deadOwner, host: "another-host", token: "foreign" });
  await assert.rejects(acquireOwnerLock(lock, { retries: 0 }), /another host/);
  await rm(lock, { recursive: true, force: true });

  await writeOwner(lock, { ...deadOwner, token: "malformed" }, ["extra-entry"]);
  await assert.rejects(acquireOwnerLock(lock, { retries: 0 }), /unexpected lock entries/);
  await rm(lock, { recursive: true, force: true });

  await writeFile(lock, "legacy-file-lock\n");
  await assert.rejects(acquireOwnerLock(lock, { retries: 0 }), /legacy regular-file lock/);
});

test("owner lock acquisition enforces an elapsed deadline", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "owner-lock-deadline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "deadline.lock");
  const owner = await acquireOwnerLock(lock, { operation: "holder", retries: 0 });
  t.after(() => releaseOwnerLock(owner));

  const started = performance.now();
  await assert.rejects(
    acquireOwnerLock(lock, { operation: "contender", deadlineMs: 80, retryMs: 25 }),
    (error) => error?.code === "owner_lock_timeout",
  );
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 70, `deadline returned too early: ${elapsed}ms`);
  assert.ok(elapsed < 180, `deadline exceeded its wall-clock budget: ${elapsed}ms`);
  assert.equal((await inspectOwnerLock(lock)).owner.token, owner.token);
});

test("a delayed second reclaimer cannot remove a live replacement owner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "owner-lock-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "current.lock");
  await writeOwner(lock, {
    host: hostname(),
    pid: DEAD_PID,
    token: "stale",
    operation: "crashed",
    started: new Date(0).toISOString(),
  });

  const fastGate = join(root, "fast.go");
  const slowGate = join(root, "slow.go");
  const releaseGate = join(root, "release.go");
  const moduleUrl = new URL("./owner-lock.mjs", import.meta.url).href;
  const worker = String.raw`
    const { inspectOwnerLock, reclaimOwnerLock, acquireOwnerLock, releaseOwnerLock } = await import(process.env.MODULE_URL);
    const { stat } = await import("node:fs/promises");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (path) => { while (!await stat(path).then(() => true).catch(() => false)) await sleep(5); };
    const observed = await inspectOwnerLock(process.env.LOCK);
    console.log("OBSERVED");
    await waitFor(process.env.GATE);
    const reclaimed = await reclaimOwnerLock(process.env.LOCK, observed);
    console.log("RECLAIMED:" + reclaimed);
    if (process.env.MODE === "fast") {
      const owner = await acquireOwnerLock(process.env.LOCK, { operation: "replacement", retries: 0 });
      console.log("ACQUIRED:" + owner.token);
      await waitFor(process.env.RELEASE_GATE);
      await releaseOwnerLock(owner);
    } else {
      try {
        const stolen = await acquireOwnerLock(process.env.LOCK, { operation: "intruder", retries: 0 });
        console.log("STOLE");
        await releaseOwnerLock(stolen);
      } catch {
        console.log("BLOCKED");
      }
    }
  `;

  const fast = spawnWorker(worker, { MODULE_URL: moduleUrl, LOCK: lock, GATE: fastGate, RELEASE_GATE: releaseGate, MODE: "fast" });
  const slow = spawnWorker(worker, { MODULE_URL: moduleUrl, LOCK: lock, GATE: slowGate, RELEASE_GATE: releaseGate, MODE: "slow" });
  await Promise.all([fast.waitFor("OBSERVED"), slow.waitFor("OBSERVED")]);
  await writeFile(fastGate, "go\n");
  await fast.waitFor("ACQUIRED:");
  const replacement = await inspectOwnerLock(lock);
  assert.equal(replacement.state, "owned");
  assert.equal(replacement.owner.operation, "replacement");

  await writeFile(slowGate, "go\n");
  await slow.waitFor("BLOCKED");
  assert.match(slow.output(), /RECLAIMED:false/);
  assert.doesNotMatch(slow.output(), /STOLE/);
  const stillOwned = await inspectOwnerLock(lock);
  assert.equal(stillOwned.state, "owned");
  assert.equal(stillOwned.owner.token, replacement.owner.token);

  await writeFile(releaseGate, "release\n");
  await Promise.all([fast.done(), slow.done()]);
  assert.equal(await exists(lock), false);
});

function spawnWorker(code, env) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", code], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}\n${stdout}`)));
  });
  return {
    output: () => stdout,
    waitFor: async (needle) => {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (stdout.includes(needle)) return;
        if (child.exitCode !== null) throw new Error(`worker exited before '${needle}': ${stderr}\n${stdout}`);
        await sleep(5);
      }
      throw new Error(`timed out waiting for '${needle}': ${stderr}\n${stdout}`);
    },
    done: () => completion,
  };
}
