import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readlink, readdir, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tasksDir } from "./store.ts";
import { listGitWorktrees, withCurrentLocks } from "../../lib/worktree.mjs";

export type NodeDescriptor =
  | { type: "absent" }
  | { type: "regular"; content: string; mode: number; sha256: string }
  | { type: "symlink"; target: string };

export interface TransactionTarget {
  root?: string;
  path: string;
  before: NodeDescriptor;
  after: NodeDescriptor;
}

export interface TransactionOptions {
  id?: string;
  failAfter?: number;
  crashAfter?: number;
  crashAt?: "prepared" | "applying" | "committed";
  beforeApply?: (target: TransactionTarget, index: number) => void | Promise<void>;
}

interface Journal {
  version: 1;
  root?: string;
  id: string;
  operation: string;
  phase: "prepared" | "applying" | "committed";
  applied: number;
  targets: TransactionTarget[];
}

interface AllowedRoots {
  all: Set<string>;
  checkouts: Set<string>;
  taskStore: string;
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

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function canonicalRelative(root: string, path: string): string {
  const rel = relative(root, path).split(sep).join("/");
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(`transaction path escapes allowed root: ${path}`);
  }
  return rel;
}

async function canonicalRoot(root: string, label: string): Promise<string> {
  const absolute = resolve(root);
  const canonical = await realpath(absolute).catch(() => null);
  if (!canonical || !isAbsolute(canonical)) throw new Error(`invalid transaction ${label}: ${root}`);
  return canonical;
}

async function physicalNodePath(path: string): Promise<string> {
  const absolute = resolve(path);
  let parent = dirname(absolute);
  const missing: string[] = [];
  for (;;) {
    const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info) break;
    const next = dirname(parent);
    if (next === parent) throw new Error(`transaction target has no existing ancestor: ${path}`);
    missing.unshift(basename(parent));
    parent = next;
  }
  const canonicalParent = await realpath(parent);
  return join(canonicalParent, ...missing, basename(absolute));
}

async function canonicalTaskStore(root: string): Promise<string> {
  return canonicalRoot(tasksDir(root), "task store");
}

async function transactionDir(root: string): Promise<string> {
  return join(await canonicalTaskStore(root), ".transactions");
}

async function allowedTargetRoots(originRoot: string): Promise<AllowedRoots> {
  const origin = await canonicalRoot(originRoot, "origin root");
  const checkouts = new Set<string>([origin]);
  try {
    for (const entry of listGitWorktrees(origin)) {
      checkouts.add(await canonicalRoot(entry.path, "Git worktree"));
    }
  } catch {
    // Non-Git fixtures have one checkout root.
  }
  const taskStore = await canonicalTaskStore(origin);
  return { all: new Set([...checkouts, taskStore]), checkouts, taskStore };
}

async function safeTarget(root: string, relativePath: string): Promise<string> {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(`unsafe transaction path: ${relativePath}`);
  }
  const lexical = resolve(root, relativePath);
  const lexicalRelative = relative(root, lexical).split(sep).join("/");
  if (relativePath !== lexicalRelative) throw new Error(`non-canonical transaction path: ${relativePath}`);
  const physical = await physicalNodePath(lexical);
  if (!isWithin(root, physical)) throw new Error(`transaction target escapes physical allowed root: ${relativePath}`);
  const physicalRelative = relative(root, physical).split(sep).join("/");
  if (physicalRelative !== relativePath) throw new Error(`non-canonical physical transaction path: ${relativePath}`);
  return physical;
}

function owningRoot(path: string, allowed: AllowedRoots): string | null {
  return [...allowed.all]
    .filter((root) => isWithin(root, path) && root !== path)
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

async function targetPath(
  originRoot: string,
  target: TransactionTarget,
  allowed: AllowedRoots,
  legacy: boolean,
): Promise<string> {
  if (!target.root) {
    if (!legacy) throw new Error("invalid transaction target root: missing");
    try {
      return await safeTarget(originRoot, target.path);
    } catch (error: any) {
      throw new Error(`manual_recovery_required: ${error.message}`);
    }
  }
  if (legacy) throw new Error("manual_recovery_required: origin-less journal contains a rooted target");
  if (!isAbsolute(target.root)) throw new Error(`invalid transaction target root: ${target.root}`);
  const canonical = await canonicalRoot(target.root, "target root");
  if (canonical !== target.root) throw new Error(`invalid transaction target root alias: ${target.root}`);
  if (!allowed.all.has(canonical)) throw new Error(`target root is not an allowed transaction root: ${canonical}`);
  return safeTarget(canonical, target.path);
}

async function journalOrigin(callerRoot: string, journal: Journal, name: string): Promise<{ origin: string; allowed: AllowedRoots; legacy: boolean }> {
  const callerStore = await canonicalTaskStore(callerRoot);
  const inferredRoot = dirname(dirname(callerStore));
  if (!journal.root) {
    const inferredStore = await canonicalTaskStore(inferredRoot).catch(() => null);
    if (!inferredStore || inferredStore !== callerStore) {
      throw new Error(`manual_recovery_required: legacy journal is not in the canonical task store: ${name}`);
    }
    return { origin: inferredRoot, allowed: await allowedTargetRoots(inferredRoot), legacy: true };
  }
  if (!isAbsolute(journal.root)) throw new Error(`invalid transaction journal root: ${name}`);
  const origin = await canonicalRoot(journal.root, "journal root");
  if (origin !== journal.root) throw new Error(`invalid transaction journal root alias: ${name}`);
  const originStore = await canonicalTaskStore(origin).catch(() => null);
  if (!originStore || originStore !== callerStore) throw new Error(`invalid transaction journal root: ${name}`);
  return { origin, allowed: await allowedTargetRoots(origin), legacy: false };
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
  const origin = await canonicalRoot(root, "origin root");
  const allowed = await allowedTargetRoots(origin);
  const lexical = isAbsolute(path) ? resolve(path) : resolve(origin, path);
  const physical = await physicalNodePath(lexical);
  const targetRoot = owningRoot(physical, allowed);
  if (!targetRoot) throw new Error(`transaction target is outside every allowed root: ${path}`);
  const targetPath = canonicalRelative(targetRoot, physical);
  await safeTarget(targetRoot, targetPath);
  return { root: targetRoot, path: targetPath, before: await describeNode(physical), after };
}

async function rollback(
  origin: string,
  journal: Journal,
  allowed: AllowedRoots,
  legacy: boolean,
  appliedCount: number,
): Promise<void> {
  for (let index = Math.min(appliedCount, journal.targets.length) - 1; index >= 0; index--) {
    const target = journal.targets[index];
    const path = await targetPath(origin, target, allowed, legacy);
    const current = await describeNode(path);
    if (sameDescriptor(current, target.before)) continue;
    if (!sameDescriptor(current, target.after)) throw new Error(`manual_recovery_required: unknown node state at ${target.path}`);
    await applyDescriptor(path, target.before);
  }
}

export async function listTransactions(root: string): Promise<string[]> {
  const dir = await transactionDir(root).catch(() => null);
  if (!dir) return [];
  return (await readdir(dir).catch(() => []))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

export async function recoverTransactions(root: string): Promise<{ recovered: string[] }> {
  const recovered: string[] = [];
  const dir = await transactionDir(root);
  for (const name of await listTransactions(root)) {
    const path = join(dir, name);
    const journal = JSON.parse(await readFile(path, "utf8")) as Journal;
    if (
      journal.version !== 1
      || !Array.isArray(journal.targets)
      || !Number.isInteger(journal.applied)
      || journal.applied < 0
      || journal.applied > journal.targets.length
      || !["prepared", "applying", "committed"].includes(journal.phase)
    ) {
      throw new Error(`invalid transaction journal: ${name}`);
    }
    const { origin, allowed, legacy } = await journalOrigin(root, journal, name);
    const resolvedTargets = await Promise.all(journal.targets.map((target) => targetPath(origin, target, allowed, legacy)));
    const currentRoots = [...allowed.checkouts].filter((checkout) =>
      resolvedTargets.includes(join(checkout, ".agents", "state", "current.txt")));
    await withCurrentLocks(currentRoots, async () => {
      const states = await Promise.all(journal.targets.map(async (target, index) => {
        const current = await describeNode(resolvedTargets[index]);
        if (sameDescriptor(current, target.before)) return "before";
        if (sameDescriptor(current, target.after)) return "after";
        return "unknown";
      }));
      if (states.includes("unknown")) throw new Error(`manual_recovery_required: ${name} has an unknown target state`);
      if (journal.phase === "committed") {
        if (!states.every((state) => state === "after")) {
          throw new Error(`manual_recovery_required: committed journal ${name} is not wholly applied`);
        }
        await unlink(path);
        recovered.push(`${name}:finalized`);
        return;
      }
      if (states.every((state) => state === "after")) {
        await unlink(path);
        recovered.push(`${name}:finalized`);
        return;
      }
      if (states.some((state, index) => index >= journal.applied && state === "after")) {
        throw new Error(`manual_recovery_required: ${name} applied beyond its journal boundary`);
      }
      if (!states.every((state) => state === "before")) {
        await rollback(origin, journal, allowed, legacy, journal.applied);
      }
      await unlink(path);
      recovered.push(`${name}:rolled-back`);
    }, { operation: "transaction-recovery" });
  }
  return { recovered };
}

export async function runTransaction(
  root: string,
  operation: string,
  targets: TransactionTarget[],
  opts: TransactionOptions = {},
): Promise<{ id: string; applied: number }> {
  const origin = await canonicalRoot(root, "origin root");
  const allowed = await allowedTargetRoots(origin);
  const id = opts.id ?? `${Date.now()}-${randomUUID()}`;
  const dir = await transactionDir(origin);
  const path = join(dir, `${id}.json`);
  if (await describeNode(path).then((node) => node.type !== "absent")) throw new Error(`transaction already exists: ${id}`);
  for (const target of targets) {
    const current = await describeNode(await targetPath(origin, target, allowed, false));
    if (!sameDescriptor(current, target.before)) throw new Error(`transaction precondition failed: ${target.path}`);
  }
  const journal: Journal = { version: 1, root: origin, id, operation, phase: "prepared", applied: 0, targets };
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
      const target = targets[index];
      await opts.beforeApply?.(target, index);
      const resolved = await targetPath(origin, target, allowed, false);
      const current = await describeNode(resolved);
      if (!sameDescriptor(current, target.before)) throw new Error(`transaction precondition failed during apply: ${target.path}`);
      await applyDescriptor(resolved, target.after);
      journal.applied = index + 1;
      await atomicJson(path, journal);
      if (opts.crashAfter === index + 1) throw simulatedCrash(`target ${index + 1}`);
      if (opts.failAfter === index + 1) throw new Error(`injected transaction failure after ${index + 1}`);
    }
    for (const target of targets) {
      const current = await describeNode(await targetPath(origin, target, allowed, false));
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
      await rollback(origin, journal, allowed, false, journal.applied);
      await unlink(path);
    } catch {
      // Keep the journal so the next task-locked mutator recovers or fails closed.
    }
    throw error;
  }
}
