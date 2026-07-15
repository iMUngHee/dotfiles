import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OWNER_RE = /^owner-([0-9a-z-]+)\.json$/i;

export class OwnerLockError extends Error {
  constructor(message, code = "owner_lock_blocked") {
    super(message);
    this.code = code;
  }
}

async function pathInfo(path) {
  return lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

function validateOwner(path, marker, value) {
  const token = marker.match(OWNER_RE)?.[1];
  if (
    !token
    || !value
    || value.token !== token
    || typeof value.host !== "string"
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.operation !== "string"
    || !value.operation
    || typeof value.started !== "string"
    || !Number.isFinite(Date.parse(value.started))
  ) {
    throw new OwnerLockError(`malformed owner lock: ${path}`);
  }
  return value;
}

function processState(pid) {
  try {
    process.kill(pid, 0);
    return "live";
  } catch (error) {
    if (error?.code === "ESRCH") return "dead";
    if (error?.code === "EPERM") return "unverifiable";
    throw error;
  }
}

export async function inspectOwnerLock(path) {
  const info = await pathInfo(path);
  if (!info) return { state: "missing", path };
  if (!info.isDirectory()) throw new OwnerLockError(`legacy regular-file lock requires operator cleanup: ${path}`);
  const entries = await readdir(path).then((value) => value.sort()).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!entries) return { state: "missing", path };
  if (entries.length === 0) return { state: "empty", path };
  if (entries.length !== 1 || !OWNER_RE.test(entries[0])) {
    throw new OwnerLockError(`unexpected lock entries: ${path}`);
  }
  const marker = entries[0];
  let owner;
  try {
    owner = JSON.parse(await readFile(join(path, marker), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "changed", path };
    throw new OwnerLockError(`malformed owner lock: ${path}`);
  }
  return { state: "owned", path, marker, owner: validateOwner(path, marker, owner) };
}

export async function reclaimOwnerLock(path, observed) {
  if (observed?.state === "empty") {
    return rmdir(path).then(() => true).catch((error) => {
      if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) return false;
      throw error;
    });
  }
  if (observed?.state !== "owned") return false;
  if (observed.owner.host !== hostname()) {
    throw new OwnerLockError(`lock held by another host (${observed.owner.host}, pid ${observed.owner.pid}): ${path}`);
  }
  const liveness = processState(observed.owner.pid);
  if (liveness === "live") return false;
  if (liveness === "unverifiable") {
    throw new OwnerLockError(`lock owner liveness is unverifiable (pid ${observed.owner.pid}): ${path}`);
  }

  const current = await inspectOwnerLock(path);
  if (
    current.state !== "owned"
    || current.marker !== observed.marker
    || current.owner.token !== observed.owner.token
    || current.owner.pid !== observed.owner.pid
    || current.owner.host !== observed.owner.host
    || current.owner.started !== observed.owner.started
  ) return false;
  if (processState(current.owner.pid) !== "dead") return false;

  const removed = await unlink(join(path, observed.marker)).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  if (!removed) return false;
  await rmdir(path).catch((error) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
  });
  return true;
}

export async function acquireOwnerLock(
  path,
  { operation = "lock", retries = 100, retryMs = 25, deadlineMs } = {},
) {
  await mkdir(dirname(path), { recursive: true });
  const deadline = deadlineMs === undefined ? null : performance.now() + deadlineMs;
  const assertBeforeDeadline = () => {
    if (deadline !== null && performance.now() >= deadline) {
      throw new OwnerLockError(`lock acquisition deadline exceeded: ${path}`, "owner_lock_timeout");
    }
  };
  for (let attempt = 0; ; attempt++) {
    assertBeforeDeadline();
    const token = randomUUID();
    const marker = `owner-${token}.json`;
    const owner = { host: hostname(), pid: process.pid, token, operation, started: new Date().toISOString() };
    const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${token}`);
    await mkdir(temporary);
    await writeFile(join(temporary, marker), `${JSON.stringify(owner)}\n`);
    try {
      await rename(temporary, path);
      return { path, token, marker, owner };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (!await pathInfo(path)) {
        if (attempt > retries) throw error;
        continue;
      }
      const observed = await inspectOwnerLock(path);
      assertBeforeDeadline();
      if (observed.state === "changed" || observed.state === "missing") continue;
      if (observed.state === "empty") {
        await reclaimOwnerLock(path, observed);
        continue;
      }
      if (observed.owner.host !== hostname()) {
        throw new OwnerLockError(`lock held by another host (${observed.owner.host}, pid ${observed.owner.pid}): ${path}`);
      }
      const liveness = processState(observed.owner.pid);
      if (liveness === "dead") {
        await reclaimOwnerLock(path, observed);
        continue;
      }
      if (liveness === "unverifiable") {
        throw new OwnerLockError(`lock owner liveness is unverifiable (pid ${observed.owner.pid}): ${path}`);
      }
      if (deadline !== null) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) assertBeforeDeadline();
        await sleep(Math.min(retryMs, remaining));
        continue;
      }
      if (attempt >= retries) {
        throw new OwnerLockError(`lock held by live local owner (pid ${observed.owner.pid}): ${path}`);
      }
      await sleep(retryMs);
    }
  }
}

export async function releaseOwnerLock(handle) {
  if (!handle?.path || !handle?.token) return false;
  const marker = `owner-${handle.token}.json`;
  const current = await readFile(join(handle.path, marker), "utf8").then(JSON.parse).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!current || current.token !== handle.token) return false;
  const removed = await unlink(join(handle.path, marker)).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  if (!removed) return false;
  await rmdir(handle.path).catch((error) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
  });
  return true;
}

export async function withOwnerLock(path, operation, fn, options = {}) {
  const owner = await acquireOwnerLock(path, { ...options, operation });
  try {
    return await fn(owner);
  } finally {
    await releaseOwnerLock(owner);
  }
}
