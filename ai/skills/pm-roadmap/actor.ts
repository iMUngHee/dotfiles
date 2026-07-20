import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ActorOptions = Record<string, string | true>;
export interface ActorResolution { actor: string; source: string; }
export interface ActorRuntime {
  env?: NodeJS.ProcessEnv;
  gitEmail?: (root: string) => string;
}

function defaultGitEmail(root: string): string {
  try {
    return execFileSync("git", ["config", "user.email"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// Precedence is most-specific first: flag, environment, checkout-local state, git fallback.
export function resolveActorSource(root: string, opts: ActorOptions = {}, runtime: ActorRuntime = {}): ActorResolution {
  const flag = (typeof opts.actor === "string" && opts.actor) || (typeof opts.by === "string" && opts.by);
  if (flag) return { actor: String(flag).trim(), source: "flag" };
  const envActor = runtime.env?.PM_ACTOR ?? process.env.PM_ACTOR;
  if (envActor?.trim()) return { actor: envActor.trim(), source: "PM_ACTOR" };
  try {
    const actor = readFileSync(join(root, ".agents", "state", "actor.txt"), "utf-8").trim();
    if (actor) return { actor, source: "state/actor.txt" };
  } catch {
    // No checkout-local identity.
  }
  const gitEmail = (runtime.gitEmail ?? defaultGitEmail)(root).trim();
  return gitEmail ? { actor: gitEmail, source: "git user.email" } : { actor: "", source: "" };
}

export function resolveActor(root: string, opts: ActorOptions = {}, runtime: ActorRuntime = {}): string {
  return resolveActorSource(root, opts, runtime).actor;
}

export function requireActor(root: string, opts: ActorOptions, context: string, runtime: ActorRuntime = {}): string {
  const actor = resolveActor(root, opts, runtime);
  if (!actor) throw new Error(`${context} requires an actor identity — set PM_ACTOR, pass --actor <name>, run 'pm whoami <name>', or set git user.email`);
  return actor;
}
