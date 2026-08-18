// Tests for package script binary resolution. Run: ./node_modules/.bin/tsx package-scripts.test.ts
//
// npm prepends only node_modules/.bin to PATH, so a bare `tsc` or `tsx` in a script silently
// falls back to a global install when the local one is absent — running the suite under an
// unpinned toolchain and, worse, reporting the missing dependency as a type error. Every
// invocation must name ./node_modules/.bin explicitly so a missing binary fails with exit 127
// and a message naming the path. This test locks the class, not the three strings that had it.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARDED = ["tsc", "tsx"] as const;
const LOCAL_BIN = "./node_modules/.bin/";

// A bare invocation is the binary name at a command position — start of the script, or after a
// shell separator (; & | && || newline) or a `do`/`then`. Arguments are never inspected, so
// ordinary script edits do not trip this.
function bareInvocations(script: string): string[] {
  const found: string[] = [];
  for (const bin of GUARDED) {
    const re = new RegExp(String.raw`(^|[;&|\n]|\bdo\b|\bthen\b)\s*(${bin})(\s|$)`, "g");
    for (const m of script.matchAll(re)) found.push(m[2]!);
  }
  return found;
}

async function packageJsonPaths(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name === "package.json") out.push(p);
    }
  };
  await walk(AI_ROOT, 0);
  return out.sort();
}

async function main() {
  const paths = await packageJsonPaths();
  // Skip-on-absent: a partial checkout must not fail the suite. But this test is pointless if it
  // silently inspects nothing, so require that it found the package it lives in.
  assert.ok(
    paths.some((p) => p.endsWith(join("pm-roadmap", "package.json"))),
    "package-scripts.test.ts found no pm-roadmap/package.json — the scan is not reaching ai/",
  );

  const offenders: string[] = [];
  let scriptsChecked = 0;
  for (const p of paths) {
    const pkg = JSON.parse(await readFile(p, "utf8"));
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      if (typeof script !== "string") continue;
      scriptsChecked++;
      for (const bin of bareInvocations(script)) {
        offenders.push(`${p.slice(AI_ROOT.length + 1)} → "${name}": bare '${bin}' (use ${LOCAL_BIN}${bin})`);
      }
    }
  }

  assert.equal(
    offenders.length,
    0,
    `package scripts must invoke ${LOCAL_BIN}<bin>, not a bare name that PATH can resolve to a global install:\n  ${offenders.join("\n  ")}`,
  );
  assert.ok(scriptsChecked > 0, "no scripts were inspected");

  // The matcher must actually catch what it claims, or a green result means nothing.
  assert.deepEqual(bareInvocations("tsc -p tsconfig.json"), ["tsc"], "start-of-script");
  assert.deepEqual(bareInvocations("for t in *.test.ts; do tsx \"$t\" || exit 1; done"), ["tsx"], "after do");
  assert.deepEqual(bareInvocations("npm run typecheck && tsc --noEmit"), ["tsc"], "after &&");
  assert.deepEqual(bareInvocations("./node_modules/.bin/tsc -p tsconfig.json"), [], "local path accepted");
  assert.deepEqual(bareInvocations("./node_modules/.bin/tsx server.ts"), [], "local path accepted");
  assert.deepEqual(bareInvocations("echo tsconfig.json && node --test"), [], "substring is not an invocation");

  console.log(`package-scripts.test.ts OK (${paths.length} package.json, ${scriptsChecked} scripts)`);
}

await main();
