import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readlink, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tasksDir } from "./store.ts";

export type NodeDescriptor =
  | { type: "absent" }
  | { type: "regular"; content: string; mode: number; sha256: string }
  | { type: "symlink"; target: string };

export interface TransactionTarget {
  path: string;
  before: NodeDescriptor;
  after: NodeDescriptor;
}

export interface TransactionOptions {
  id?: string;
  failAfter?: number;
  crashAfter?: number;
  crashAt?: "prepared" | "applying" | "committed";
}

interface Journal {
  version: 1;
  id: string;
  operation: string;
  phase: "prepared" | "applying" | "committed";
  applied: number;
  targets: TransactionTarget[];
}

const ABSENT: NodeDescriptor = { type: "absent" };

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function regularDescriptor(content: string | Buffer, mode = 0o644): NodeDescriptor {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { type: "regular", content: buffer.toString("base64"), mode: mode & 0o777, sha256: hash(buffer) };
}

export function symlinkDescriptor(target: string): NodeDescriptor {
  return { type: "symlink", target };
}

export const absentDescriptor = (): NodeDescriptor => ({ ...ABSENT });

export async function describeNode(path: string): Promise<NodeDescriptor> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return absentDescriptor();
  if (info.isSymbolicLink()) return symlinkDescriptor(await readlink(path));
  if (!info.isFile()) throw new Error(`unsupported transaction node type: ${path}`);
  const content = await readFile(path);
  return { type: "regular", content: content.toString("base64"), mode: info.mode & 0o777, sha256: hash(content) };
}

export function sameDescriptor(a: NodeDescriptor, b: NodeDescriptor): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "absent") return true;
  if (a.type === "symlink" && b.type === "symlink") return a.target === b.target;
  return a.type === "regular" && b.type === "regular"
    && a.sha256 === b.sha256 && a.content === b.content && a.mode === b.mode;
}

function transactionDir(root: string): string {
  return join(tasksDir(root), ".transactions");
}

function safeTarget(root: string, relativePath: string): string {
  if (!relativePath || relativePath.split(/[\\/]/).includes("..")) throw new Error(`unsafe transaction path: ${relativePath}`);
  const absolute = resolve(root, relativePath);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`transaction path escapes root: ${relativePath}`);
  return absolute;
}

async function atomicJson(path: string, value: Journal): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

async function applyDescriptor(path: string, descriptor: NodeDescriptor): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (descriptor.type === "absent") {
    await rm(path, { recursive: false, force: true });
    return;
  }
  const tmp = `${path}.tx-${process.pid}-${Date.now()}`;
  await rm(tmp, { force: true });
  if (descriptor.type === "symlink") await symlink(descriptor.target, tmp);
  else {
    await writeFile(tmp, Buffer.from(descriptor.content, "base64"));
    await chmod(tmp, descriptor.mode);
  }
  await rename(tmp, path);
}

export async function makeTarget(root: string, path: string, after: NodeDescriptor): Promise<TransactionTarget> {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const rel = relative(root, absolute).split(sep).join("/");
  safeTarget(root, rel);
  return { path: rel, before: await describeNode(absolute), after };
}

async function rollback(root: string, journal: Journal): Promise<void> {
  for (let index = journal.targets.length - 1; index >= 0; index--) {
    const target = journal.targets[index];
    const path = safeTarget(root, target.path);
    const current = await describeNode(path);
    if (sameDescriptor(current, target.before)) continue;
    if (!sameDescriptor(current, target.after)) throw new Error(`manual_recovery_required: unknown node state at ${target.path}`);
    await applyDescriptor(path, target.before);
  }
}

export async function listTransactions(root: string): Promise<string[]> {
  return (await readdir(transactionDir(root)).catch(() => []))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

export async function recoverTransactions(root: string): Promise<{ recovered: string[] }> {
  const recovered: string[] = [];
  for (const name of await listTransactions(root)) {
    const path = join(transactionDir(root), name);
    const journal = JSON.parse(await readFile(path, "utf8")) as Journal;
    if (journal.version !== 1 || !Array.isArray(journal.targets)) throw new Error(`invalid transaction journal: ${name}`);
    const states = await Promise.all(journal.targets.map(async (target) => {
      const current = await describeNode(safeTarget(root, target.path));
      if (sameDescriptor(current, target.before)) return "before";
      if (sameDescriptor(current, target.after)) return "after";
      return "unknown";
    }));
    if (states.includes("unknown")) throw new Error(`manual_recovery_required: ${name} has an unknown target state`);
    if (states.every((state) => state === "after")) {
      await unlink(path);
      recovered.push(`${name}:finalized`);
      continue;
    }
    if (!states.every((state) => state === "before")) await rollback(root, journal);
    await unlink(path);
    recovered.push(`${name}:rolled-back`);
  }
  return { recovered };
}

export async function runTransaction(
  root: string,
  operation: string,
  targets: TransactionTarget[],
  opts: TransactionOptions = {},
): Promise<{ id: string; applied: number }> {
  const id = opts.id ?? `${Date.now()}-${randomUUID()}`;
  const path = join(transactionDir(root), `${id}.json`);
  if (await describeNode(path).then((node) => node.type !== "absent")) throw new Error(`transaction already exists: ${id}`);
  for (const target of targets) {
    const current = await describeNode(safeTarget(root, target.path));
    if (!sameDescriptor(current, target.before)) throw new Error(`transaction precondition failed: ${target.path}`);
  }
  const journal: Journal = { version: 1, id, operation, phase: "prepared", applied: 0, targets };
  const simulatedCrash = (where: string) => {
    const crash = new Error(`simulated process crash at ${where}`) as Error & { simulatedCrash: boolean };
    crash.simulatedCrash = true;
    return crash;
  };
  await atomicJson(path, journal);
  if (opts.crashAt === "prepared") throw simulatedCrash("prepared");
  try {
    journal.phase = "applying";
    await atomicJson(path, journal);
    if (opts.crashAt === "applying") throw simulatedCrash("applying");
    for (let index = 0; index < targets.length; index++) {
      await applyDescriptor(safeTarget(root, targets[index].path), targets[index].after);
      journal.applied = index + 1;
      await atomicJson(path, journal);
      if (opts.crashAfter === index + 1) {
        throw simulatedCrash(`target ${index + 1}`);
      }
      if (opts.failAfter === index + 1) throw new Error(`injected transaction failure after ${index + 1}`);
    }
    for (const target of targets) {
      const current = await describeNode(safeTarget(root, target.path));
      if (!sameDescriptor(current, target.after)) throw new Error(`transaction verification failed: ${target.path}`);
    }
    journal.phase = "committed";
    await atomicJson(path, journal);
    if (opts.crashAt === "committed") throw simulatedCrash("committed");
    await unlink(path);
    return { id, applied: targets.length };
  } catch (error) {
    if ((error as Error & { simulatedCrash?: boolean }).simulatedCrash) throw error;
    try {
      await rollback(root, journal);
      await unlink(path);
    } catch {
      // Retain the journal so the next mutating command blocks or recovers safely.
    }
    throw error;
  }
}
