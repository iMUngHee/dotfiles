// Needs `npm install` in the skill directory; run with `npm test` there. A missing
// dependency fails these tests instead of skipping them.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { MessageProcessor } from "@a2ui/web_core";
import { boardCatalog } from "../board-catalog.mjs";
import { prepareSurface } from "../board-core.mjs";
import { makeBoard, run, serve, template } from "./helpers.mjs";

test("the shipped template is a valid A2UI v1.0 surface once its choices are numbered", async () => {
  const messages = prepareSurface(await template());
  new MessageProcessor([boardCatalog]).processMessages(structuredClone(messages));
});

test("serve refuses a surface the basic catalog rejects, with exit 2", async t => {
  const surface = await template();
  surface[0].createSurface.components.push({ id: "bogus", component: "Bogus" });
  surface[0].createSurface.components.find(c => c.id === "root").children.push("bogus");
  const dir = await makeBoard(surface);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await run(["serve", dir]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /not a valid A2UI v1\.0 surface/);
});

test("serve prints the ready line, bundles the panel on request, and stop ends it", async t => {
  const dir = await makeBoard(await template());
  t.after(() => rm(dir, { recursive: true, force: true }));
  const board = serve(dir);
  t.after(() => board.child.kill());
  const { url, round } = await board.ready;
  const panel = await fetch(`${url}__panel.js`);
  assert.equal(panel.status, 200);
  assert.ok((await panel.text()).length > 100_000, "panel bundle includes React and the renderer");
  const stopped = await run(["stop", dir, "--round", round]);
  assert.equal(stopped.code, 0);
  assert.equal(await board.exited, 0);
  assert.equal((await run(["wait", dir, "--round", round, "--timeout", "1"])).code, 5);
});
