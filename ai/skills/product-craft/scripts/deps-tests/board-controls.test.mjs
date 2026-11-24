// Journeys 4-7 of ../../design-contract.md and the bridge's isolation, in headless Chromium.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { fullSurface, makeBoard, run, serve, template, tokenCandidate } from "./helpers.mjs";

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(() => browser?.close());

async function open(t, surface, candidates, { prepare, route } = {}) {
  const dir = await makeBoard(surface, candidates, prepare);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const board = serve(dir);
  t.after(() => board.child.kill());
  const { url, round } = await board.ready;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  t.after(() => page.close());
  if (route) await route(page);
  await page.goto(url);
  await page.getByText("채택할 시안").first().waitFor();
  const viewer = () => page.frames().find(f => f.url().includes("/__viewer/candidate-viewer.html"));
  const candidate = n => page.frames().find(f => new URL(f.url()).pathname === `/${n === "1" ? "one" : "two"}.html`);
  const shown = () => viewer().evaluate(() => document.documentElement.dataset.candidate);
  const send = () => page.locator("button.pcb-submit", { hasText: "고른 시안으로 보내기" }).click();
  const answer = async () => {
    const waited = await run(["wait", dir, "--round", round, "--timeout", "5"]);
    assert.equal(waited.code, 0, waited.stderr);
    return JSON.parse(waited.stdout);
  };
  const connected = n => page.waitForFunction(k => window.__pcbConnected?.has(k), n);
  return { dir, round, page, board, viewer, candidate, shown, send, answer, connected };
}

const two = (o1 = {}, o2 = {}) => ({ "one.html": tokenCandidate("one", o1), "two.html": tokenCandidate("two", o2) });
const card = (page, n) => page.locator(`button.pcb-card[data-candidate="${n}"]`);

test("board.mjs catalog prints the schema of the board components and showCandidate", async () => {
  const { code, stdout } = await run(["catalog"]);
  assert.equal(code, 0);
  const text = stdout;
  for (const name of ["CandidatePicker", "Heading", "Hint", "SubmitButton", "CommentField", "ColorToken", "SizeNudge", "AlignPicker", "RegionNotes", "showCandidate"]) {
    assert.match(text, new RegExp(`"${name}"`), name);
  }
  JSON.parse(text);
});

test("one catalog serves a minimal surface and a full one, each with its own answer shape", async t => {
  const minimal = await open(t, await template(), two());
  await card(minimal.page, "1").click();
  await minimal.send();
  const a = await minimal.answer();
  assert.deepEqual(a.context.adjust, {});
  assert.deepEqual(a.context.pins, []);
  const full = await open(t, await fullSurface(), two());
  await full.connected("1");
  await card(full.page, "2").click();
  await full.send();
  const b = await full.answer();
  assert.equal(b.context.choice, "2");
  assert.deepEqual(b.context.adjust, {});
});

test("the support table shows which controls a viewed candidate cannot preview", async t => {
  const candidates = two({}, { declare: ["accent", "align"], extraCss: ".card { --accent: red; }" });
  const { page, board, connected } = await open(t, await fullSurface({ radius: true }), candidates);
  const notice = id => page.locator(`[data-pcb-control="${id}"] .pcb-unavailable`);
  await connected("1");
  await page.getByText("시안을 고르면 색·간격·정렬 같은 값을 조정할 수 있습니다.").waitFor();
  assert.equal(await page.getByText("시안을 고르면", { exact: false }).count(), 1, "the group note appears once");
  await card(page, "1").click();
  await page.waitForFunction(() => !document.querySelector('[data-pcb-control="gap"] .pcb-unavailable'));
  assert.equal(await notice("accent").count(), 0);
  assert.equal(await notice("radius").count(), 1);
  await card(page, "2").click();
  await connected("2");
  await page.waitForFunction(() => document.querySelector('[data-pcb-control="gap"] .pcb-unavailable'));
  assert.equal(await notice("accent").count(), 1);
  assert.equal(await notice("align").count(), 0);
  assert.match(board.stderr(), /radius/);
});

test("journey 4: the viewed card and the chosen card are marked separately", async t => {
  const { page, viewer, shown } = await open(t, await template(), two());
  await card(page, "2").click();
  await page.waitForFunction(() => document.querySelector('button.pcb-card[data-candidate="2"]')?.textContent.includes("보는 중"));
  assert.equal(await shown(), "2");
  await viewer().locator("nav button").first().click();
  await page.waitForFunction(() => document.querySelector('button.pcb-card[data-candidate="1"]')?.textContent.includes("보는 중"));
  assert.match(await card(page, "1").textContent(), /보는 중/);
  assert.doesNotMatch(await card(page, "1").textContent(), /선택됨/);
  assert.match(await card(page, "2").textContent(), /선택됨/);
  assert.doesNotMatch(await card(page, "2").textContent(), /보는 중/);
});

test("journey 5: adjustments preview live, survive switching, reset, and come back as typed data", async t => {
  const { page, viewer, candidate, connected, send, answer } = await open(t, await fullSurface(), two());
  await connected("1");
  const style = (n, sel, prop) => candidate(n).locator(sel).evaluate((el, p) => getComputedStyle(el)[p], prop);
  assert.equal(await page.getByLabel("강조색 hex").isDisabled(), true, "controls wait for a choice");
  await card(page, "1").click();
  await page.getByLabel("강조색 hex").fill("#3b82f6");
  await page.getByLabel("강조색 hex").press("Enter");
  await page.getByRole("button", { name: "간격 늘리기" }).click();
  await page.getByRole("button", { name: "간격 늘리기" }).click();
  await page.getByRole("radio", { name: "가운데" }).click();
  await candidate("1").waitForFunction(() => getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
  assert.equal(await style("1", "#row", "rowGap"), "24px");
  assert.equal(await style("1", "#row", "justifyContent"), "center");
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  await page.waitForTimeout(200);
  assert.equal(await style("2", "#price", "color"), "rgb(3, 199, 90)", "a candidate that is not chosen shows as written");
  await page.getByText("조정은 선택한 시안 1에만 적용됩니다.").waitFor();
  await viewer().locator("nav button").first().click();
  await connected("1");
  await candidate("1").waitForFunction(() => getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
  await page.locator('[data-pcb-control="gap"]').getByRole("button", { name: "초기화" }).click();
  await candidate("1").waitForFunction(() => getComputedStyle(document.getElementById("row")).rowGap === "16px");
  await send();
  assert.deepEqual((await answer()).context.adjust, { accent: "#3b82f6", align: "center" });
});

test("journey 6: pins stay on their element through compare mode, scrolling and sticky headers", async t => {
  const { page, viewer, candidate, connected, send, answer } = await open(t, await fullSurface(), two());
  await connected("1");
  const pinAt = async selector => {
    await page.getByRole("button", { name: "위치 지정" }).click();
    await candidate("1").waitForFunction(() => document.documentElement.style.cursor === "crosshair");
    await candidate("1").locator(selector).click();
  };
  const offBy = async n => {
    await candidate("1").waitForFunction(k => document.querySelector(`#pcb-layer .pcb-pin-marker[data-n="${k}"]`), n);
    return measure(n);
  };
  const measure = n => candidate("1").evaluate(k => {
    const marker = document.querySelector(`#pcb-layer .pcb-pin-marker[data-n="${k}"]`).getBoundingClientRect();
    const pin = window.__pcbPins.find(p => p.n === k);
    const target = document.querySelector(pin.selector).getBoundingClientRect();
    const cx = marker.left + marker.width / 2;
    const cy = marker.top + marker.height / 2;
    return Math.max(Math.abs(cx - (target.left + pin.ox * target.width)), Math.abs(cy - (target.top + pin.oy * target.height)));
  }, n);
  await pinAt("#title");
  await page.getByLabel("위치 1 메모").fill("제목 더 작게");
  assert.equal(await page.getByLabel("위치 1 메모").inputValue(), "제목 더 작게", "the note shows what was typed");
  assert.ok(await offBy(1) <= 4);
  await viewer().locator("#compare").click().catch(() => {});
  await candidate("1").evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(100);
  assert.ok(await offBy(1) <= 4, "after compare mode and document scroll");
  await candidate("1").evaluate(() => window.scrollTo(0, 0));
  await pinAt("#deep");
  await candidate("1").evaluate(() => { document.getElementById("scroller").scrollTop = 250; });
  await page.waitForTimeout(100);
  assert.ok(await offBy(2) <= 4, "after an inner scroll");
  await pinAt("#hd");
  await candidate("1").evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  assert.ok(await offBy(3) <= 4, "a sticky header pin follows the header");
  await card(page, "1").click();
  await send();
  const { pins } = (await answer()).context;
  assert.equal(pins.length, 3);
  assert.equal(pins[0].note, "제목 더 작게");
  for (const p of pins) {
    assert.equal(p.candidate, "1");
    for (const k of ["ox", "oy", "x", "y"]) assert.ok(p[k] >= 0 && p[k] <= 1, k);
  }
});

test("pins can be deleted and stay put across a candidate switch", async t => {
  const { page, viewer, candidate, connected, send, answer } = await open(t, await fullSurface(), two());
  await connected("1");
  for (const sel of ["#title", "#price"]) {
    await page.getByRole("button", { name: "위치 지정" }).click();
    await candidate("1").waitForFunction(() => document.documentElement.style.cursor === "crosshair");
    await candidate("1").locator(sel).click();
  }
  await page.getByRole("button", { name: "위치 1 삭제" }).click();
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  await viewer().locator("nav button").first().click();
  await connected("1");
  await candidate("1").waitForFunction(() => document.querySelectorAll("#pcb-layer .pcb-pin-marker").length === 1);
  await card(page, "1").click();
  await send();
  assert.equal((await answer()).context.pins.length, 1);
});

test("the round-wide pin limit stops at 20 and frees up after a delete", async t => {
  const { page, viewer, candidate, connected, send, answer } = await open(t, await fullSurface(), two());
  const pinOn = async n => {
    await page.getByRole("button", { name: "위치 지정" }).click();
    await candidate(n).waitForFunction(() => document.documentElement.style.cursor === "crosshair");
    await candidate(n).locator("#price").click();
  };
  await connected("1");
  for (let i = 0; i < 11; i++) await pinOn("1");
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  // A pin reaches the panel by postMessage after the click, so counts are awaited, not read.
  const pinCount = k => page.waitForFunction(n => document.querySelectorAll(".pcb-pin").length === n, k);
  for (let i = 0; i < 9; i++) await pinOn("2");
  await pinCount(20);
  await page.getByRole("button", { name: "위치 지정" }).click();
  await page.getByText("위치는 20개까지 남길 수 있습니다.").waitFor();
  await candidate("2").locator("#price").click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".pcb-pin").count(), 20, "a click at the limit adds nothing");
  await page.getByRole("button", { name: "위치 20 삭제" }).click();
  await pinCount(19);
  await pinOn("2");
  await pinCount(20);
  await card(page, "2").click();
  await send();
  assert.equal((await answer()).context.pins.length, 20);
});

test("a disabled submit button shows its reason and a distinct fill", async t => {
  const { page } = await open(t, await template(), two());
  const decide = page.locator("button.pcb-submit", { hasText: "고른 시안으로 보내기" });
  assert.equal(await decide.isDisabled(), true);
  await page.getByText("채택할 시안을 골라 주세요.").waitFor();
  assert.equal(await decide.evaluate(el => getComputedStyle(el).opacity), "0.6");
  assert.equal(await decide.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  await card(page, "1").click();
  assert.equal(await decide.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
});

test("reject all says it drops the chosen candidate, and pinning names its target", async t => {
  const { page, viewer, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  await page.getByText("시안 1에 남깁니다.").waitFor();
  await card(page, "1").click();
  await page.getByLabel("코멘트", { exact: true }).fill("둘 다 아쉬워요");
  await page.getByText("보내면 시안 1 선택과 조정값은 버려집니다.").waitFor();
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  await page.getByText("시안 2에 남깁니다.").waitFor();
});

test("journey 7: a CSP candidate is served untouched and its preview is marked unavailable", async t => {
  const csp = `<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src 'none'">${tokenCandidate("two")}`;
  const { page, viewer, board } = await open(t, await fullSurface(), { "one.html": tokenCandidate("one"), "two.html": csp });
  assert.match(board.stderr(), /Content-Security-Policy/);
  await viewer().locator("nav button").nth(1).click();
  await page.getByText("미리보기 반영 불가").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "위치 지정" }).isDisabled(), true);
});

test("the panel ignores pins from the wrong source, the wrong candidate or the wrong shape", async t => {
  const { page, candidate, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  const before = await page.locator(".pcb-pin").count();
  await candidate("1").evaluate(() => {
    const pin = { selector: "#title", ox: 0.5, oy: 0.5, x: 0.1, y: 0.1, text: "t" };
    top.postMessage({ pcb: 1, type: "pin", candidate: "2", pin }, "*");
    top.postMessage({ pcb: 1, type: "pin", candidate: "1", pin: { ...pin, x: 7 } }, "*");
    top.postMessage({ pcb: 1, type: "pin", candidate: "1", pin, extra: true }, "*");
    top.postMessage({ pcb: 1, type: "pin", candidate: "1", pin: { ...pin, selector: "x".repeat(301) } }, "*");
  });
  await page.evaluate(() => {
    const pin = { selector: "#title", ox: 0.5, oy: 0.5, x: 0.1, y: 0.1, text: "t" };
    window.postMessage({ pcb: 1, type: "pin", candidate: "1", pin }, "*");
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".pcb-pin").count(), before);
  assert.deepEqual(await page.evaluate(() => window.__pcbErrors ?? []), []);
});

test("the bridge ignores state from another origin, for another candidate, or with malformed tokens", async t => {
  const { candidate, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  const accent = () => candidate("1").evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  const before = await accent();
  await candidate("1").evaluate(() => {
    const send = data => window.dispatchEvent(new MessageEvent("message", { data, origin: "http://evil.example", source: window.top }));
    send({ pcb: 1, type: "state", candidate: "1", tokens: { accent: "#ff0000" }, pins: [], pinMode: false });
  });
  await candidate("1").evaluate(() => {
    const origin = new URL(document.querySelector("script[data-candidate]").src).origin;
    const send = data => window.dispatchEvent(new MessageEvent("message", { data, origin, source: window.top }));
    send({ pcb: 1, type: "state", candidate: "2", tokens: { accent: "#ff0000" }, pins: [], pinMode: false });
    send({ pcb: 1, type: "state", candidate: "1", tokens: { accent: "red" }, pins: [], pinMode: false });
    send({ pcb: 1, type: "state", candidate: "1", tokens: { gap: 1e9 }, pins: [], pinMode: false });
    send({ pcb: 1, type: "state", candidate: "1", tokens: { align: "middle" }, pins: [], pinMode: false });
  });
  assert.equal(await accent(), before);
});

test("connection survives a late panel, a reload of the same candidate and a quick 1-2-1 switch", async t => {
  const late = async page => {
    await page.route("**/__panel.js", async route => { await new Promise(r => setTimeout(r, 3500)); await route.continue(); });
  };
  const { page, viewer, candidate, connected } = await open(t, await fullSurface(), two(), { route: late });
  await connected("1");
  assert.equal(await page.getByText("미리보기 반영 불가").count(), 0);
  await card(page, "1").click();
  await page.getByLabel("강조색 hex").fill("#3b82f6");
  await page.getByLabel("강조색 hex").press("Enter");
  await candidate("1").evaluate(() => location.reload());
  await connected("1");
  await candidate("1").waitForFunction(() => getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
  const nav = viewer().locator("nav button");
  await nav.nth(1).click();
  await nav.first().click();
  await connected("1");
  await candidate("1").waitForFunction(() => getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
});

test("a ready that arrives before the frame's load event still connects", async t => {
  const slowImage = { "one.html": tokenCandidate("one").replace("</body>", '<img src="/slow.png"></body>'), "two.html": tokenCandidate("two") };
  const route = async page => {
    await page.route("**/slow.png", async r => { await new Promise(res => setTimeout(res, 1500)); await r.fulfill({ status: 404, body: "" }); });
  };
  const { connected } = await open(t, await fullSurface(), slowImage, { route });
  await connected("1");
});

test("limit values round-trip; one past the limit refuses to serve", async t => {
  const edge = await fullSurface();
  const comps = edge[0].createSurface.components;
  comps.find(c => c.id === "accent").token = "a".repeat(30);
  comps.find(c => c.id === "accent").value = { "@path": `/adjust/${"a".repeat(30)}` };
  Object.assign(comps.find(c => c.id === "gap"), { min: -10000, max: 10000, step: 1, initial: 9999 });
  const { page, send, answer } = await open(t, edge, two());
  await card(page, "1").click();
  await page.getByRole("button", { name: "간격 늘리기" }).click();
  await send();
  assert.equal((await answer()).context.adjust.gap, 10000);
  const over = await fullSurface();
  Object.assign(over[0].createSurface.components.find(c => c.id === "gap"), { max: 10001 });
  const dir = await makeBoard(over, two());
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal((await run(["serve", dir])).code, 2);
});
