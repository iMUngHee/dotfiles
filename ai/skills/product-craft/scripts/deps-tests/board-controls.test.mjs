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
  const send = () => page.locator("button.pcb-submit", { hasText: "채택해서 보내기" }).click();
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
  await page.getByText("시안을 채택하면 색·간격·정렬을 조정할 수 있습니다.").waitFor();
  assert.equal(await page.getByText("시안을 채택하면", { exact: false }).count(), 1, "the group note appears once");
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
  const viewing = n => page.waitForFunction(k => document.querySelector(`button.pcb-card[data-candidate="${k}"] .pcb-eye`), n);
  await card(page, "2").click();
  await viewing("2");
  assert.equal(await shown(), "2");
  await viewer().locator("nav button").first().click();
  await viewing("1");
  assert.match(await card(page, "1").getAttribute("aria-label"), /보는 중/);
  assert.equal(await card(page, "1").locator(".pcb-eye title").textContent(), "보는 중");
  assert.doesNotMatch(await card(page, "1").textContent(), /채택됨/);
  assert.match(await card(page, "2").textContent(), /채택됨/);
  assert.doesNotMatch(await card(page, "2").getAttribute("aria-label"), /보는 중/);
  assert.equal(await card(page, "2").locator(".pcb-eye").count(), 0);
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
  await candidate("1").waitForFunction(() => document.getElementById("price") && getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
  assert.equal(await style("1", "#row", "rowGap"), "24px");
  assert.equal(await style("1", "#row", "justifyContent"), "center");
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  await page.waitForTimeout(200);
  assert.equal(await style("2", "#price", "color"), "rgb(3, 199, 90)", "a candidate that is not chosen shows as written");
  await page.getByText("조정은 채택한 시안 1에만 적용됩니다.").waitFor();
  await viewer().locator("nav button").first().click();
  await connected("1");
  await candidate("1").waitForFunction(() => document.getElementById("price") && getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
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
    await candidate("1").waitForFunction(k => document.querySelector(`#pcb-layer .pcb-pin-dot[data-n="${k}"]`), n);
    return measure(n);
  };
  const measure = n => candidate("1").evaluate(k => {
    const marker = document.querySelector(`#pcb-layer .pcb-pin-dot[data-n="${k}"]`).getBoundingClientRect();
    const pin = window.__pcbPins.find(p => p.n === k);
    const target = document.querySelector(pin.selector).getBoundingClientRect();
    const cx = marker.left + marker.width / 2;
    const cy = marker.top + marker.height / 2;
    // A line-sized element is marked on its top (or bottom) edge, above the click point.
    const line = target.height <= 60;
    const dy = line ? Math.min(Math.abs(cy - target.top), Math.abs(cy - target.bottom)) : Math.abs(cy - (target.top + pin.oy * target.height));
    return Math.max(Math.abs(cx - (target.left + pin.ox * target.width)), dy);
  }, n);
  await pinAt("#title");
  await page.getByLabel("위치 A 메모").fill("제목 더 작게");
  assert.equal(await page.getByLabel("위치 A 메모").inputValue(), "제목 더 작게", "the note shows what was typed");
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
  await page.getByRole("button", { name: "위치 A 삭제" }).click();
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
  assert.equal(await page.locator(".pcb-pin-number").last().textContent(), "T", "the 20th pin is T");
  await page.getByRole("button", { name: "위치 T 삭제" }).click();
  await pinCount(19);
  await pinOn("2");
  await pinCount(20);
  await card(page, "2").click();
  await send();
  assert.equal((await answer()).context.pins.length, 20);
});

test("a disabled submit button shows its reason and a distinct fill", async t => {
  const { page } = await open(t, await template(), two());
  const decide = page.locator("button.pcb-submit", { hasText: "채택해서 보내기" });
  assert.equal(await decide.isDisabled(), true);
  await page.getByText("‘채택할 시안’에서 하나를 골라 주세요.").waitFor();
  assert.equal(await decide.evaluate(el => getComputedStyle(el).opacity), "1");
  assert.equal(await decide.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(34, 39, 46)", "a flat grey slab");
  await card(page, "1").click();
  assert.equal(await decide.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
});

test("reject all says it drops the chosen candidate, and pinning names its target", async t => {
  const { page, viewer, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  await page.getByText("시안 1에 남깁니다.").waitFor();
  await card(page, "1").click();
  await page.getByLabel("코멘트", { exact: true }).fill("둘 다 아쉬워요");
  await page.getByText("다시 그리면 시안 1 채택과 조정값은 버려집니다.").waitFor();
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  await page.getByText("시안 2에 남깁니다.").waitFor();
  await page.getByText("채택한 시안이 아니라서 참고 메모로 보냅니다.").waitFor();
});

test("a colour token warns when the text it colours falls below 4.5:1 on its background", async t => {
  const { page, candidate, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  await card(page, "1").click();
  const warning = page.locator('[data-pcb-control="accent"] .pcb-contrast');
  await page.getByLabel("강조색 hex").fill("#1d4ed8");
  await page.getByLabel("강조색 hex").press("Enter");
  await candidate("1").waitForFunction(() => document.getElementById("price") && getComputedStyle(document.getElementById("price")).color === "rgb(29, 78, 216)");
  // The initial green falls short too, so wait for the report on the new value to clear it.
  await page.waitForFunction(() => !document.querySelector('[data-pcb-control="accent"] .pcb-contrast'));
  assert.equal(await warning.count(), 0, "dark blue on white passes");
  await page.getByLabel("강조색 hex").fill("#a7f3d0");
  await page.getByLabel("강조색 hex").press("Enter");
  await warning.waitFor();
  assert.match(await warning.textContent(), /이 색과 배경의 대비가 1\.\d:1입니다\.글자에는 4\.5:1 이상이 필요합니다\./);
  await page.getByText("시안 1 · 조정 1개 · 대비 경고 1개", { exact: true }).waitFor();
  const fix = page.getByRole("button", { name: /^#[0-9a-f]{6}로 바꾸기$/ });
  const target = (await fix.textContent()).slice(0, 7);
  await fix.click();
  await page.waitForFunction(t => document.querySelector('input[aria-label="강조색 hex"]').value === t, target);
  await page.waitForFunction(() => !document.querySelector('[data-pcb-control="accent"] .pcb-contrast'));
});

test("a pin's text keeps the visible line breaks as spaces", async t => {
  const candidates = { "one.html": tokenCandidate("one").replace('<span class="price" id="price">89,000원</span>', '<span class="price" id="price">무선<br>89,000원</span>'), "two.html": tokenCandidate("two") };
  const { page, candidate, connected } = await open(t, await fullSurface(), candidates);
  await connected("1");
  await page.getByRole("button", { name: "위치 지정" }).click();
  await candidate("1").waitForFunction(() => document.documentElement.style.cursor === "crosshair");
  await candidate("1").locator("#price").click();
  await page.getByText("시안 1 · “무선 89,000원”").waitFor();
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
    top.postMessage({ pcb: 1, type: "contrast", candidate: "1", values: { unknown: 2 } }, "*");
    top.postMessage({ pcb: 1, type: "contrast", candidate: "1", values: { accent: 40 } }, "*");
    top.postMessage({ pcb: 1, type: "contrast", candidate: "2", values: { accent: 1.5 } }, "*");
  });
  await page.evaluate(() => {
    const pin = { selector: "#title", ox: 0.5, oy: 0.5, x: 0.1, y: 0.1, text: "t" };
    window.postMessage({ pcb: 1, type: "pin", candidate: "1", pin }, "*");
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".pcb-pin").count(), before);
  assert.equal(await page.locator(".pcb-contrast").count(), 0, "malformed or foreign contrast reports are ignored");
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
  await candidate("1").waitForFunction(() => document.getElementById("price") && getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
  const nav = viewer().locator("nav button");
  await nav.nth(1).click();
  await nav.first().click();
  await connected("1");
  await candidate("1").waitForFunction(() => document.getElementById("price") && getComputedStyle(document.getElementById("price")).color === "rgb(59, 130, 246)");
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

// Colour roles, pin letters, the disabled look, layout stability, the overflow cue and contrast.

const pinOnce = async (page, candidate, n, selector) => {
  await page.getByRole("button", { name: "위치 지정" }).click();
  await candidate(n).waitForFunction(() => document.documentElement.style.cursor === "crosshair");
  await candidate(n).locator(selector).click();
};
const pinCount = (page, k) => page.waitForFunction(n => document.querySelectorAll(".pcb-pin").length === n, k);
const style = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop);

test("a click on the candidate's root, below a short body, pins \"html\"", async t => {
  const short = '<!doctype html><html><head><meta charset="utf-8"><style>:root { --accent: #03c75a; } body { margin: 0; height: 40px; }</style></head><body><p style="margin:0">짧음</p></body></html>';
  const { page, candidate, connected, send, answer } = await open(t, await fullSurface(), { "one.html": short, "two.html": tokenCandidate("two") });
  await connected("1");
  await page.getByRole("button", { name: "위치 지정" }).click();
  await candidate("1").waitForFunction(() => document.documentElement.style.cursor === "crosshair");
  await candidate("1").locator("html").click({ position: { x: 200, y: 400 } });
  await pinCount(page, 1);
  await card(page, "1").click();
  await send();
  assert.equal((await answer()).context.pins[0].selector, "html");
});

test("selection, focus and pins have three distinct colours", async t => {
  const { page, candidate, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  await card(page, "2").focus();
  assert.equal(await style(card(page, "2"), "outlineColor"), "rgb(255, 255, 255)", "keyboard focus is a white ring");
  await card(page, "1").click();
  assert.equal(await style(card(page, "1"), "backgroundColor"), "rgb(128, 200, 255)", "selection is the accent fill");
  await pinOnce(page, candidate, "1", "#price");
  await pinCount(page, 1);
  assert.equal(await style(page.locator(".pcb-pin-number").first(), "backgroundColor"), "rgb(255, 194, 77)");
  await candidate("1").waitForFunction(() => document.querySelector("#pcb-layer .pcb-pin-marker"));
  const covers = await candidate("1").evaluate(() => {
    const disc = document.querySelector("#pcb-layer .pcb-pin-disc").getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("price"));
    const text = range.getBoundingClientRect();
    return disc.left < text.right && disc.right > text.left && disc.top < text.bottom && disc.bottom > text.top;
  });
  assert.equal(covers, false, "the lettered disc does not cover the pinned text");
  const tip = await candidate("1").evaluate(() => {
    const dot = document.querySelector("#pcb-layer .pcb-pin-dot").getBoundingClientRect();
    return dot.top + dot.height / 2 - document.getElementById("price").getBoundingClientRect().top;
  });
  assert.ok(Math.abs(tip) <= 1, `the stem ends on the line's top edge, not inside its text (${tip})`);
  // Near the top edge the marker hangs below its point instead.
  await page.getByRole("button", { name: "위치 지정" }).click();
  await candidate("1").waitForFunction(() => document.documentElement.style.cursor === "crosshair");
  await candidate("1").locator("#hd").click({ position: { x: 200, y: 4 } });
  await candidate("1").waitForFunction(() => document.querySelectorAll("#pcb-layer .pcb-pin-marker").length === 2);
  const order = await candidate("1").evaluate(() => [...document.querySelectorAll("#pcb-layer .pcb-pin-marker")].map(m =>
    m.querySelector(".pcb-pin-dot").getBoundingClientRect().top < m.querySelector(".pcb-pin-disc").getBoundingClientRect().top ? "below" : "above"));
  assert.deepEqual(order, ["above", "below"]);
  await candidate("1").waitForFunction(() => document.querySelector("#pcb-layer .pcb-pin-marker"));
  assert.equal(await candidate("1").evaluate(() => getComputedStyle(document.querySelector("#pcb-layer .pcb-pin-disc")).backgroundColor), "rgb(255, 194, 77)");
});

test("pins are lettered in list order across candidates, and relabel after a delete", async t => {
  const { page, viewer, candidate, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  await pinOnce(page, candidate, "1", "#title");
  await pinOnce(page, candidate, "1", "#price");
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  await pinOnce(page, candidate, "2", "#title");
  await pinCount(page, 3);
  const letters = () => page.locator(".pcb-pin-number").allTextContents();
  assert.deepEqual(await letters(), ["A", "B", "C"]);
  await candidate("2").waitForFunction(() => document.querySelector("#pcb-layer .pcb-pin-marker")?.textContent === "C");
  await page.getByRole("button", { name: "위치 B 삭제" }).click();
  await pinCount(page, 2);
  assert.deepEqual(await letters(), ["A", "B"]);
  await page.getByLabel("위치 B 메모").waitFor();
  assert.equal(await page.locator(".pcb-pin-where").nth(1).textContent(), "시안 2 · “two”");
  await candidate("2").waitForFunction(() => document.querySelector("#pcb-layer .pcb-pin-marker")?.textContent === "B");
});

test("before a candidate is chosen every token control has the one disabled look", async t => {
  const { page } = await open(t, await fullSurface(), two());
  const hex = page.getByLabel("강조색 hex");
  const swatch = page.getByLabel("강조색 색 선택");
  const active = page.locator('.pcb-segment[aria-checked="true"]');
  for (const control of [hex, active]) assert.equal(await style(control, "opacity"), "0.6");
  assert.equal(await style(swatch, "opacity"), "1", "the swatch keeps showing its true colour");
  assert.equal(await style(swatch, "borderTopColor"), await style(hex, "borderTopColor"));
  assert.equal(await style(hex, "borderTopColor"), "rgb(74, 80, 88)");
  assert.equal(await style(active, "backgroundColor"), "rgb(74, 80, 88)");
  await card(page, "1").click();
  assert.equal(await style(active, "backgroundColor"), "rgb(128, 200, 255)");
});

test("choosing, typing and viewing never move the rows or resize the answer area", async t => {
  const surface = await fullSurface();
  const decide = surface[0].createSurface.components.find(c => c.id === "decide");
  // Passes while the comment is short, then fails with a message long enough to wrap.
  decide["@checks"].push({ condition: { "@call": "length", args: { value: { "@path": "/feedback/comment" }, max: 10 } },
    message: "코멘트가 길면 이 버튼으로는 보낼 수 없습니다. 열 글자 이내로 줄이거나 다시 그려 달라고 보내 주세요." });
  for (const width of [1280, 960]) {
    const { page, viewer, connected } = await open(t, surface, two());
    await page.setViewportSize({ width, height: 800 });
    await connected("1");
    const measure = () => page.evaluate(() => {
      const answer = document.querySelector("aside a2ui-basic-column:has(> a2ui-react-submitbutton)").getBoundingClientRect();
      // Relative to the panel's content, since focusing the comment scrolls the panel.
      const row = document.querySelector('[data-pcb-control="accent"]').getBoundingClientRect().top + document.querySelector("aside").scrollTop;
      return { answer: answer.height, row };
    });
    const first = await measure();
    const same = async what => {
      await page.waitForTimeout(150);
      const now = await measure();
      assert.ok(Math.abs(now.answer - first.answer) <= 0.5, `${width}: answer height after ${what}: ${first.answer} → ${now.answer}`);
      assert.ok(Math.abs(now.row - first.row) <= 0.5, `${width}: token row after ${what}: ${first.row} → ${now.row}`);
    };
    await card(page, "1").click();
    await page.getByText("조정은 시안 1에 바로 반영됩니다.").waitFor();
    // The fixture's green falls short on white, so the preview counts it.
    await page.getByText("시안 1 · 대비 경고 1개", { exact: true }).waitFor();
    const row = await page.evaluate(() => [...document.querySelectorAll("button.pcb-submit")].map(b => Math.round(b.getBoundingClientRect().top)));
    assert.equal(row[0], row[1], "the answer buttons share one row");
    await same("choosing 1");
    await page.getByLabel("강조색 hex").fill("#2563eb");
    await page.getByLabel("강조색 hex").press("Enter");
    await page.getByLabel("코멘트", { exact: true }).fill("짧게");
    await page.getByText("시안 1 · 조정 1개 · 코멘트 1개", { exact: true }).waitFor();
    await same("a short comment");
    await page.getByLabel("코멘트", { exact: true }).fill("이 코멘트는 열 글자를 넘습니다");
    await page.getByText("코멘트가 길면").waitFor();
    await same("a long comment");
    await viewer().locator("nav button").nth(1).click();
    await connected("2");
    await page.getByRole("button", { name: "시안 1 보기" }).waitFor();
    assert.equal(await page.getByLabel("강조색 hex").isDisabled(), true, "controls lock while another candidate is on screen");
    assert.equal(await page.locator('[data-pcb-control="accent"] .pcb-reset').isDisabled(), true, "so does their reset");
    assert.equal(await page.locator('[data-pcb-control="accent"] .pcb-reset').isVisible(), false);
    await same("viewing 2");
    await page.getByRole("button", { name: "시안 1 보기" }).click();
    await connected("1");
    await same("going back to 1");
    assert.equal(await page.getByLabel("강조색 hex").isDisabled(), false);
  }
});

test("the answer area shows the overflow cue only while the panel scrolls further", async t => {
  const surface = await template();
  const { components } = surface[0].createSurface;
  components.push({ id: "pins", component: "RegionNotes", label: "위치 메모", value: { "@path": "/pins" } });
  const root = components.find(c => c.id === "root");
  root.children.splice(root.children.indexOf("comment"), 0, "pins");
  const { page, candidate, connected } = await open(t, surface, two());
  await connected("1");
  const cue = () => page.evaluate(() => document.querySelector("aside").hasAttribute("data-more-below"));
  const until = want => page.waitForFunction(w => document.querySelector("aside").hasAttribute("data-more-below") === w, want);
  await page.waitForTimeout(200);
  assert.equal(await cue(), false, "a surface that fits has no cue");
  let added = 0;
  while (!(await cue()) && added < 10) {
    await pinOnce(page, candidate, "1", "#title");
    await pinCount(page, ++added);
    await page.waitForTimeout(100);
  }
  assert.equal(await cue(), true, "content under the answer area shows the cue without scrolling");
  await page.evaluate(() => { const a = document.querySelector("aside"); a.scrollTop = a.scrollHeight; });
  await until(false);
  assert.equal(await page.evaluate(() => document.querySelector("aside").hasAttribute("data-scrolled")), true, "scrolled content fades under the title");
  await page.evaluate(() => { document.querySelector("aside").scrollTop = 0; });
  await until(true);
  while (added > 0) {
    await page.getByRole("button", { name: "위치 A 삭제" }).click();
    await pinCount(page, --added);
  }
  await until(false);
});

const contrastNote = (page, token) => page.locator(`[data-pcb-control="${token}"] .pcb-contrast`);
const unmeasuredNote = (page, token) => page.locator(`[data-pcb-control="${token}"] .pcb-unmeasured`);
const setHex = async (page, value) => {
  await page.getByLabel("강조색 hex").fill(value);
  await page.getByLabel("강조색 hex").press("Enter");
};

test("contrast composites translucent backgrounds, nested layers and translucent text", async t => {
  const single = tokenCandidate("one", { extraCss: ".row { background: rgba(0, 0, 0, .5); }" });
  const nested = tokenCandidate("two", { extraCss: ".row { background: rgba(0, 0, 0, .5); } .price { background: rgba(0, 0, 0, .5); }" });
  const { page, viewer, connected } = await open(t, await fullSurface(), { "one.html": single, "two.html": nested });
  await connected("1");
  await card(page, "1").click();
  // White over black at .5 on white is rgb(127.5): 3.98:1, shown rounded down.
  // The initial green also falls short here, so wait for the ratio of the new value.
  await setHex(page, "#ffffff");
  await page.waitForFunction(() => /대비가 3\.9:1/.test(document.querySelector('[data-pcb-control="accent"] .pcb-contrast')?.textContent ?? ""));
  await viewer().locator("nav button").nth(1).click();
  await connected("2");
  await card(page, "2").click();
  // #808080 over two .5 black layers on white (rgb 63.75): 2.64:1.
  await setHex(page, "#808080");
  await page.waitForFunction(() => /대비가 2\.6:1/.test(document.querySelector('[data-pcb-control="accent"] .pcb-contrast')?.textContent ?? ""));

  const faint = tokenCandidate("one", { accent: "rgba(255, 255, 255, .2)", extraCss: "body { background: #000; }" });
  const second = await open(t, await fullSurface(), { "one.html": faint, "two.html": tokenCandidate("two") });
  await second.connected("1");
  await card(second.page, "1").click();
  // White at .2 over black composites to rgb(51): 1.66:1.
  await contrastNote(second.page, "accent").waitFor();
  assert.match(await contrastNote(second.page, "accent").textContent(), /대비가 1\.6:1/);
});

test("text on a gradient or image is reported as unmeasured", async t => {
  const gradient = tokenCandidate("one", { extraCss: ".row { background: linear-gradient(#fff, #eee); }" });
  const { page, connected } = await open(t, await fullSurface(), { "one.html": gradient, "two.html": tokenCandidate("two") });
  await connected("1");
  await card(page, "1").click();
  await unmeasuredNote(page, "accent").waitFor();
  assert.equal(await unmeasuredNote(page, "accent").textContent(), "확인 필요: 이미지·그러데이션 위 글자(“89,000원”)는 대비를 재지 못했습니다. 눈으로 확인해 주세요.");
  await page.getByText("시안 1 · 대비 확인 1개", { exact: true }).waitFor();
  assert.equal(await contrastNote(page, "accent").count(), 0);
});

test("a valid contrast report replaces the last one; foreign or malformed ones are ignored", async t => {
  const { page, candidate, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  await card(page, "1").click();
  await page.waitForTimeout(400);
  const post = data => candidate("1").evaluate(d => top.postMessage(d, "*"), data);
  const report = { pcb: 1, type: "contrast", candidate: "1", values: {}, unmeasured: ["accent"], backgrounds: {}, samples: { accent: "가격" } };
  await post(report);
  await unmeasuredNote(page, "accent").waitFor();
  await post({ ...report, values: { accent: 2 }, backgrounds: { accent: "#ffffff" } });
  await contrastNote(page, "accent").waitFor();
  assert.equal(await unmeasuredNote(page, "accent").count(), 0, "a warning outranks the unmeasured note");
  await post({ ...report, unmeasured: [], samples: {} });
  await page.waitForFunction(() => !document.querySelector(".pcb-contrast, .pcb-unmeasured"));
  for (const bad of [
    { ...report, candidate: "2" },
    { ...report, unmeasured: ["unknown"] },
    { ...report, unmeasured: ["accent", "accent"] },
    { ...report, unmeasured: [1] },
    { ...report, unmeasured: "accent" },
    { ...report, backgrounds: { accent: "white" } },
    { ...report, samples: { accent: 7 } },
    { ...report, unmeasured: [], samples: { accent: "가격" } },
    (({ unmeasured, ...rest }) => rest)(report),
  ]) await post(bad);
  await page.evaluate(d => window.postMessage(d, "*"), report);
  await page.waitForTimeout(300);
  assert.equal(await unmeasuredNote(page, "accent").count(), 0, "foreign or malformed reports change nothing");
  assert.deepEqual(await page.evaluate(() => window.__pcbErrors ?? []), []);
});

test("reject all can be sent with only a location note", async t => {
  const { page, candidate, connected, answer } = await open(t, await fullSurface(), two());
  await connected("1");
  const none = page.locator("button.pcb-submit", { hasText: "다시 그려 주세요" });
  assert.equal(await none.isDisabled(), true);
  await page.getByText("다시 그려 달라고 하려면 코멘트나 위치 메모를 남겨 주세요.").waitFor();
  await pinOnce(page, candidate, "1", "#price");
  await pinCount(page, 1);
  await page.waitForFunction(() => !document.querySelector("button.pcb-submit.pcb-secondary").disabled);
  await page.getByRole("button", { name: "위치 A 삭제" }).click();
  await page.waitForFunction(() => document.querySelector("button.pcb-submit.pcb-secondary").disabled);
  await pinOnce(page, candidate, "1", "#price");
  await page.waitForFunction(() => !document.querySelector("button.pcb-submit.pcb-secondary").disabled);
  await none.click();
  const sent = await answer();
  assert.equal(sent.name, "candidate.none");
  assert.equal(sent.context.pins.length, 1);
});

test("the viewer hides tools it cannot use, marks the chosen candidate, shows its width and locks after a send", async t => {
  const { page, viewer, connected, send, shown } = await open(t, await template(), two());
  await connected("1");
  assert.equal(await viewer().locator("#compare").isVisible(), false, "no reference, no compare button");
  assert.equal(await viewer().locator("#fit").isVisible(), false, "no image, no fit button");
  const width = await viewer().evaluate(() => [document.getElementById("width").textContent, `${document.querySelector("iframe").clientWidth}px`]);
  assert.equal(width[0], width[1]);
  await card(page, "2").click();
  await viewer().waitForFunction(() => document.querySelectorAll("nav button")[1].hasAttribute("data-chosen"));
  assert.equal(await viewer().evaluate(() => document.querySelectorAll("nav button")[0].hasAttribute("data-chosen")), false);
  await send();
  await page.getByText("시안 2 채택으로 보냈습니다.").waitFor();
  await viewer().waitForFunction(() => document.documentElement.hasAttribute("data-locked"));
  assert.equal(await viewer().evaluate(() => getComputedStyle(document.querySelector('nav button[aria-current="true"]')).opacity), "1", "the sent candidate's tab stays readable");
  await viewer().locator("nav button").first().click({ force: true });
  await page.waitForTimeout(200);
  assert.equal(await shown(), "2", "the viewer stays on the sent candidate");
});

test("pins close together keep their letters visible", async t => {
  const { page, candidate, connected } = await open(t, await fullSurface(), two());
  await connected("1");
  await page.getByRole("button", { name: "위치 지정" }).click();
  await page.getByText("시안에서 위치를 눌러 주세요 · Esc 취소").waitFor();
  assert.equal(await candidate("1").evaluate(() => document.getElementById("pcb-layer").textContent), "", "the candidate shows only a frame, no second instruction");
  await page.getByRole("button", { name: "지정 취소" }).click();
  await pinOnce(page, candidate, "1", "#title");
  await pinOnce(page, candidate, "1", "#row");
  await candidate("1").waitForFunction(() => document.querySelectorAll("#pcb-layer .pcb-pin-disc").length === 2);
  const overlap = await candidate("1").evaluate(() => {
    const [a, b] = [...document.querySelectorAll("#pcb-layer .pcb-pin-disc")].map(d => d.getBoundingClientRect());
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  assert.equal(overlap, false);
});

test("the answer area sits at the foot of the panel even when the content is short", async t => {
  const { page, connected } = await open(t, await template(), two());
  await connected("1");
  const gap = await page.evaluate(() => innerHeight - document.querySelector("aside a2ui-basic-column:has(> a2ui-react-submitbutton)").getBoundingClientRect().bottom);
  assert.ok(Math.abs(gap) <= 1, `answer area bottom is ${gap}px above the window bottom`);
});
