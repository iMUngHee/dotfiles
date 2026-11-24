#!/usr/bin/env node
// Candidate board CLI. See references/interface.md, "Candidates, when the owner is choosing".
//
//   board.mjs serve <dir>                         prints "board: ready <url> round=<round>"
//   board.mjs wait  <dir> --round <r> [--timeout <seconds>]
//   board.mjs stop  <dir> --round <r>
//
// Exit codes: 0 done (wait prints the answer as one JSON line), 2 usage, board or surface
// error, 3 no answer yet (run wait again), 5 the round ended without an answer.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BoardError, prepareSurface, readBoard, startBoard, stopRound, waitForAnswer } from "./board-core.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message, code = 2) {
  console.error(`board: ${message}`);
  process.exit(code);
}

function option(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);
  return value;
}

async function dependencies() {
  try {
    const [core, catalog, esbuild] = await Promise.all([
      import("@a2ui/web_core"), import("@a2ui/web_core/catalogs/basic/v1"), import("esbuild"),
    ]);
    return { MessageProcessor: core.MessageProcessor, basicCatalog: catalog.basicCatalog, esbuild };
  } catch (error) {
    fail(`dependencies missing (${error.code ?? error.message}); run: npm install --prefix "${SKILL}"`);
  }
}

async function serve(dir) {
  const board = readBoard(dir);
  let messages;
  try {
    messages = JSON.parse(readFileSync(join(dir, board.surface), "utf8"));
  } catch (error) {
    throw new BoardError(`${board.surface}: ${error.message}`);
  }
  prepareSurface(messages, board.candidates.length);
  const { MessageProcessor, basicCatalog, esbuild } = await dependencies();
  try {
    new MessageProcessor([basicCatalog]).processMessages(structuredClone(messages));
  } catch (error) {
    throw new BoardError(`${board.surface} is not a valid A2UI v1.0 surface: ${error.message}`);
  }
  const panel = async () => {
    const result = await esbuild.build({
      entryPoints: [join(SKILL, "scripts", "board-panel.jsx")],
      absWorkingDir: SKILL, bundle: true, write: false, format: "esm", minify: true,
      jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    });
    return result.outputFiles[0].text;
  };
  const running = await startBoard({ dir, board, messages, panel });
  console.log(`board: ready ${running.url} round=${running.round}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => running.close());
  await running.closed;
}

const [command, target, ...rest] = process.argv.slice(2);
if (!["serve", "wait", "stop"].includes(command) || !target) {
  fail("usage: board.mjs serve <dir> | wait <dir> --round <r> [--timeout <seconds>] | stop <dir> --round <r>");
}
const dir = resolve(target);
try {
  if (command === "serve") {
    await serve(dir);
  } else if (command === "wait") {
    const seconds = Number(option(rest, "timeout", "540"));
    if (!Number.isFinite(seconds) || seconds <= 0) fail("--timeout must be a positive number of seconds");
    const result = await waitForAnswer({ dir, round: option(rest, "round"), timeoutMs: seconds * 1000 });
    if (result.code === 0) console.log(JSON.stringify(result.answer));
    else if (result.code === 3) console.error("board: no answer yet; run wait again");
    else console.error("board: the round ended without an answer; ask in the conversation");
    process.exit(result.code);
  } else {
    const { stopped } = await stopRound({ dir, round: option(rest, "round") });
    console.log(stopped ? "board: stopped" : "board: not running");
  }
} catch (error) {
  if (error instanceof BoardError) fail(error.message, error.code);
  throw error;
}
