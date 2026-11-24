// Replays the journeys in ../../design-contract.md in headless Chromium.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { makeBoard, run, serve, template } from "./helpers.mjs";

// A 1x1 red PNG, so the candidate's separate image asset has real bytes to load.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

async function withExtraQuestion() {
  const surface = await template();
  const { components, dataModel } = surface[0].createSurface;
  components.find(c => c.id === "root").children.splice(2, 0, "light");
  components.push({
    id: "light", component: "ChoicePicker", label: "라이트 테마도 필요한가요?", variant: "mutuallyExclusive",
    displayStyle: "chips", options: [{ label: "필요", value: "yes" }, { label: "불필요", value: "no" }],
    value: { "@path": "/extra/light" },
  });
  dataModel.extra = { light: [] };
  return surface;
}

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(() => browser?.close());

async function open(t, surface, candidates, prepare) {
  const dir = await makeBoard(surface, candidates, prepare);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const board = serve(dir);
  t.after(() => board.child.kill());
  const { url, round } = await board.ready;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  t.after(() => page.close());
  const responses = [];
  page.on("response", response => responses.push([new URL(response.url()).pathname, response.status()]));
  await page.goto(url);
  await page.getByText("채택할 시안", { exact: false }).first().waitFor();
  return { dir, round, page, responses };
}

test("choose: pick 2, answer the added question, comment, send once", async t => {
  const candidates = {
    "one.html": '<link rel="stylesheet" href="assets/style.css"><p id="t">one</p><img src="assets/dot.png" alt="">',
    "two.html": "<p>two</p>",
  };
  const { dir, round, page, responses } = await open(t, await withExtraQuestion(), candidates, async dir => {
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "style.css"), "#t { color: rgb(255, 0, 0); }");
    await writeFile(join(dir, "assets", "dot.png"), PNG);
  });

  const candidate = page.frames().find(frame => frame.url().endsWith("/one.html"));
  assert.ok(candidate, "candidate 1 is loaded inside the viewer");
  await candidate.locator("#t").waitFor();
  assert.equal(await candidate.locator("#t").evaluate(el => getComputedStyle(el).color), "rgb(255, 0, 0)");
  assert.ok(responses.some(([path, code]) => path === "/assets/style.css" && code === 200));
  assert.ok(responses.some(([path, code]) => path === "/assets/dot.png" && code === 200));

  const decide = page.locator("button.pcb-submit", { hasText: "고른 시안으로 보내기" });
  assert.equal(await decide.isDisabled(), true, "choose is disabled before a candidate is picked");
  await page.getByText("어느 시안으로 갈지 골라 주세요.", { exact: false }).waitFor();
  const viewer = page.frames().find(frame => frame.url().includes("/__viewer/candidate-viewer.html"));
  await page.locator('button.pcb-card[data-candidate="2"]').click();
  await viewer.waitForFunction(() => document.documentElement.dataset.candidate === "2");
  await page.getByText("필요", { exact: true }).click();
  await page.getByRole("textbox").fill("리스트는 1처럼");
  assert.equal(await decide.isDisabled(), false);
  await decide.click();
  await page.getByText("시안 2 채택으로 보냈습니다.").waitFor();
  await page.getByText("“리스트는 1처럼”", { exact: true }).waitFor();
  assert.equal(await decide.count(), 0, "the form is replaced by what was sent");

  const waited = await run(["wait", dir, "--round", round, "--timeout", "5"]);
  assert.equal(waited.code, 0, waited.stderr);
  const answer = JSON.parse(waited.stdout);
  assert.equal(answer.name, "candidate.decide");
  assert.deepEqual(answer.context, { choice: "2", comment: "리스트는 1처럼", extra: { light: ["yes"] }, adjust: {}, pins: [] });

});

test("reject all: needs a comment, then returns candidate.none with it", async t => {
  const { dir, round, page } = await open(t, await template());
  const none = page.locator("button.pcb-submit", { hasText: "전부 아님" });
  assert.equal(await none.isDisabled(), true, "reject is disabled while the comment is empty");
  await page.getByRole("textbox").fill("둘 다 너무 차가움");
  assert.equal(await none.isDisabled(), false);
  await none.click();
  await page.getByText("전부 아님으로 보냈습니다.").waitFor();
  const waited = await run(["wait", dir, "--round", round, "--timeout", "5"]);
  assert.equal(waited.code, 0, waited.stderr);
  const answer = JSON.parse(waited.stdout);
  assert.equal(answer.name, "candidate.none");
  assert.equal(answer.context.comment, "둘 다 너무 차가움");
});

test("keys typed in the panel stay in the panel; the viewer's keys work when it has focus", async t => {
  const { page } = await open(t, await template());
  const viewer = page.frames().find(frame => frame.url().includes("/__viewer/candidate-viewer.html"));
  const shown = () => viewer.evaluate(() => document.documentElement.dataset.candidate);
  assert.equal(await shown(), "1");
  await page.getByRole("textbox").fill("");
  await page.getByRole("textbox").pressSequentially("2");
  assert.equal(await shown(), "1", "typing 2 in the comment does not switch candidates");
  await viewer.locator("nav button").first().focus();
  await page.keyboard.press("2");
  assert.equal(await shown(), "2", "the viewer switches when it has focus");
});
