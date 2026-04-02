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
//   10  Login required (browser opened, waiting for user to login)
//
// Auth:
//   Browser profiles are persisted per-domain in <script-dir>/.spa-auth/<domain>/

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, '.spa-auth');

// --- Args ---
const args = process.argv.slice(2);
const flagHtml = args.includes('--html');
const flagOpenLogin = args.includes('--open-login');
const positional = args.filter(a => !a.startsWith('--'));
const url = positional[0];
const selector = flagOpenLogin ? null : (positional[1] || 'body');

if (!url) {
  console.error('Usage: node spa-fetch.js <url> [css-selector] [--html]');
  console.error('       node spa-fetch.js --open-login <url>');
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
    const pw = require('playwright');
    const p = pw.chromium.executablePath();
    fs.accessSync(p);
  } catch {
    console.error('[spa-fetch] Chromium not found, installing...');
    execSync('npx playwright install chromium', { stdio: 'inherit' });
  }
}

function isLoginPage(pageUrl) {
  const current = new URL(pageUrl);
  if (current.hostname !== targetDomain) return true;
  const loginPatterns = ['/login', '/auth', '/signin', '/sso', '/fastid'];
  return loginPatterns.some(p => current.pathname.toLowerCase().includes(p));
}

// --- Open login: launch headful browser, write PID, return immediately ---
async function openLoginMode() {
  ensureChromium();
  const { chromium } = require('playwright');
  const profileDir = profileDirFor(targetDomain);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    timeout: 30000,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Poll until URL settles on target domain after SSO completes.
  // waitForURL is not used — it throws on SSO intermediate redirects (ERR_ADDRESS_UNREACHABLE).
  // We require the URL to stay on target domain for 2 consecutive checks to avoid false positives
  // where the page briefly touches the SSO provider before being redirected away again.
  if (isLoginPage(page.url())) {
    console.error('[spa-fetch] Browser opened — waiting for login...');
    const deadline = Date.now() + 300000; // 5 min
    let stableCount = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      try {
        const current = page.url();
        const onTarget = new URL(current).hostname === targetDomain && !isLoginPage(current);
        if (onTarget) {
          stableCount++;
          if (stableCount >= 2) break; // stable on target domain for 2s
        } else {
          stableCount = 0;
        }
      } catch { stableCount = 0; /* page may be navigating */ }
    }
    // Let the page fully settle
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
  }

  console.error('[spa-fetch] Login successful — session saved.');
  await context.close();
}

// --- Fetch mode: headless, exit 10 if login needed ---
async function fetchMode() {
  ensureChromium();
  const { chromium } = require('playwright');
  const profileDir = profileDirFor(targetDomain);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    timeout: 30000,
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Use domcontentloaded for fast login detection — networkidle is slow on SSO redirects
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (isLoginPage(page.url())) {
      console.error('[spa-fetch] Login required.');
      await context.close();
      process.exit(10);
    }

    // Now wait for SPA to fully render
    await page.waitForLoadState('networkidle', { timeout: 30000 });
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
(flagOpenLogin ? openLoginMode() : fetchMode()).catch(err => {
  console.error(`[spa-fetch] Fatal: ${err.message}`);
  process.exit(1);
});
