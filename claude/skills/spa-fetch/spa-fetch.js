#!/usr/bin/env node
// spa-fetch.js — Fetch rendered content from SPA sites using Playwright
//
// Usage:
//   node spa-fetch.js <url> [css-selector] [--html]
//   node spa-fetch.js --open-login <url>
//
// Modes:
//   default              Headless fetch. Exit code 10 if login required.
//   --open-login <url>   Open headful browser for login, auto-close on success
//
// Options:
//   css-selector   Wait for this selector before extracting (default: body)
//   --html         Output innerHTML instead of innerText
//
// Exit codes:
//   0   Success
//   1   Error
//   10  Login required
//   11  Bot detection (Cloudflare, CAPTCHA, etc.)
//
// Auth:
//   Browser profiles are persisted per-domain in <script-dir>/.spa-auth/<domain>/

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const AUTH_DIR = path.join(__dirname, ".spa-auth");

// --- Anti-detection ---
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-infobars",
];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// --- Args ---
const args = process.argv.slice(2);
const flagHtml = args.includes("--html");
const flagOpenLogin = args.includes("--open-login");
const positional = args.filter((a) => !a.startsWith("--"));
const url = positional[0];
const selector = flagOpenLogin ? null : positional[1] || "body";

if (!url) {
  console.error("Usage: node spa-fetch.js <url> [css-selector] [--html]");
  console.error("       node spa-fetch.js --open-login <url>");
  process.exit(1);
}

// --- Helpers ---
const targetDomain = new URL(url).hostname;

function profileDirFor(domain) {
  const dir = path.join(AUTH_DIR, domain);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureChromium() {
  try {
    const pw = require("playwright");
    const p = pw.chromium.executablePath();
    fs.accessSync(p);
  } catch {
    console.error("[spa-fetch] Chromium not found, installing...");
    execSync("npx playwright install chromium", { stdio: "inherit" });
  }
}

function isLoginPage(pageUrl) {
  const current = new URL(pageUrl);
  if (current.hostname !== targetDomain) return true;
  const loginPatterns = ["/login", "/auth", "/signin", "/sso", "/fastid"];
  return loginPatterns.some((p) => current.pathname.toLowerCase().includes(p));
}

function isBotChallenge(bodyText) {
  const challengePatterns = [
    "security verification",
    "checking your browser",
    "verify you are human",
    "just a moment",
    "attention required",
    "ray id:",
    "cloudflare",
    "captcha",
    "challenge-platform",
  ];
  const lower = bodyText.toLowerCase();
  return (
    challengePatterns.some((p) => lower.includes(p)) && bodyText.length < 2000
  );
}

function launchOptions(headless) {
  return {
    headless,
    timeout: 30000,
    args: STEALTH_ARGS,
    ...(headless && { userAgent: USER_AGENT }),
  };
}

// --- Open login: launch headful browser, write PID, return immediately ---
async function openLoginMode() {
  ensureChromium();
  const { chromium } = require("playwright");
  const profileDir = profileDirFor(targetDomain);

  const context = await chromium.launchPersistentContext(
    profileDir,
    launchOptions(false),
  );

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  // Poll until URL settles on target domain after SSO completes.
  // waitForURL is not used — it throws on SSO intermediate redirects (ERR_ADDRESS_UNREACHABLE).
  // We require the URL to stay on target domain for 2 consecutive checks to avoid false positives
  // where the page briefly touches the SSO provider before being redirected away again.
  if (isLoginPage(page.url())) {
    console.error("[spa-fetch] Browser opened — waiting for login...");
    const deadline = Date.now() + 300000; // 5 min
    let stableCount = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      try {
        const current = page.url();
        const onTarget =
          new URL(current).hostname === targetDomain && !isLoginPage(current);
        if (onTarget) {
          stableCount++;
          if (stableCount >= 2) break;
        } else {
          stableCount = 0;
        }
      } catch {
        stableCount = 0;
      }
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1000);
  }

  // Persist session-only cookies so headless fetch can reuse them.
  // Sites using session-only cookies (no expires/max-age) lose auth on browser close.
  const cookies = await context.cookies();
  const expiry = Math.floor(Date.now() / 1000) + 86400; // 24h from now
  const sessionCookies = cookies
    .filter((c) => c.expires === -1)
    .map((c) => ({ ...c, expires: expiry }));
  if (sessionCookies.length > 0) {
    await context.addCookies(sessionCookies);
    console.error(
      `[spa-fetch] Persisted ${sessionCookies.length} session cookies (24h expiry).`,
    );
  }

  console.error("[spa-fetch] Login successful — session saved.");
  await context.close();
}

// --- Fetch mode: headless with anti-detection, fallback on networkidle timeout ---
async function fetchMode() {
  ensureChromium();
  const { chromium } = require("playwright");
  const profileDir = profileDirFor(targetDomain);

  const context = await chromium.launchPersistentContext(
    profileDir,
    launchOptions(true),
  );

  // Strip navigator.webdriver to evade basic bot checks
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    // Phase 1: Navigate with domcontentloaded for fast login/bot detection
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (isLoginPage(page.url())) {
      console.error("[spa-fetch] Login required.");
      await context.close();
      process.exit(10);
    }

    // Phase 2: Wait for SPA render — networkidle with fallback
    const settled = await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!settled) {
      // networkidle timed out — common on heavy SPAs. Wait a bit and proceed.
      console.error(
        "[spa-fetch] networkidle timeout — proceeding with current content.",
      );
      await page.waitForTimeout(3000);
    }

    // Phase 3: Bot challenge detection
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (isBotChallenge(bodyText)) {
      console.error(
        "[spa-fetch] Bot detection page (Cloudflare/CAPTCHA). Try --open-login to establish a browser session first.",
      );
      await context.close();
      process.exit(11);
    }

    // Phase 4: Extract content from selector
    await page.waitForSelector(selector, { timeout: 15000 });

    const locator = page.locator(selector);
    const content = flagHtml
      ? await locator.innerHTML()
      : await locator.innerText();

    console.log(content);
  } catch (err) {
    console.error(`[spa-fetch] Error: ${err.message}`);
    process.exit(1);
  } finally {
    await context.close().catch(() => {});
  }
}

// --- Main ---
(flagOpenLogin ? openLoginMode() : fetchMode()).catch((err) => {
  console.error(`[spa-fetch] Fatal: ${err.message}`);
  process.exit(1);
});
