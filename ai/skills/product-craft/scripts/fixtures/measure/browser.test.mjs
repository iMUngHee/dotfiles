import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

// Uses an installed Chromium browser; no browser or package is downloaded.
const candidates = [process.env.MEASURE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let browser;
for (const candidate of candidates) {
  try { await access(candidate); browser = candidate; break; } catch {}
}
const skip = browser ? false : 'no Chromium browser found; set MEASURE_BROWSER';
let child, profile, socket, sessionId;
let sequence = 0;
const pending = new Map();
function call(method, params = {}, session = sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function navigate(url) {
  await call('Page.navigate', { url });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Navigation did not finish: ${url}`);
}
before(async () => {
  if (skip) return;
  profile = await mkdtemp(join(tmpdir(), 'craft-geometry-'));
  child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  // The browser writes its endpoint here; its stderr is not reliably connected under every runner.
  let endpoint;
  for (let attempt = 0; attempt < 150 && !endpoint; attempt++) {
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
      if (port && path) endpoint = `ws://127.0.0.1:${port}${path}`;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(endpoint, 'Browser did not expose CDP');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }));
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
}, { timeout: 30000 });
after(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    await call('Browser.close', {}, null);
    socket.close();
  }
  if (child?.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 2000); });
  // A browser that ignored the close request would keep the test process alive through its pipes.
  if (child?.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGKILL');
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});
const directory = fileURLToPath(new URL('.', import.meta.url));
const measureSource = await readFile(new URL('../../measure-dom.js', import.meta.url), 'utf8');
test('planted 3px offset, wrapped label, overflow and clipped text are measured', { skip, timeout: 30000 }, async () => {
  await navigate(pathToFileURL(join(directory, 'defects.html')).href);
  const report = await evaluate(measureSource);
  assert.ok(report.findings.some(item => item.kind === 'alignment' && item.delta === 3), JSON.stringify(report));
  for (const kind of ['wrap', 'overflow', 'clipped-text']) {
    assert.ok(report.findings.some(item => item.kind === kind), `${kind}: ${JSON.stringify(report)}`);
  }
  console.log('planted findings:', JSON.stringify(report.findings));
});
test('clean layout, multiline prose and deliberate scrolling are not findings', { skip, timeout: 30000 }, async () => {
  await navigate(pathToFileURL(join(directory, 'clean.html')).href);
  const report = await evaluate(measureSource);
  assert.deepEqual(report.findings, []);
  console.log('clean findings:', JSON.stringify(report.findings));
});
test('intent overrides, hidden subtrees and associated labels avoid false positives', { skip, timeout: 30000 }, async () => {
  await navigate(pathToFileURL(join(directory, 'clean.html')).href);
  await evaluate(`document.body.insertAdjacentHTML('beforeend',
    '<label data-measure-wrap="allow" style="width:100px">An allowed multi line label</label>' +
    '<div data-measure-ignore><button style="height:10px;width:10px;padding:0">x</button></div>' +
    '<input id="check" type="checkbox"><label for="check">A generous clickable label</label>' +
    '<button id="tiny" style="width:12px;height:12px;padding:0;font-size:8px;line-height:1">x</button>')`);
  const report = await evaluate(measureSource);
  assert.deepEqual(report.findings.map(item => [item.kind, item.element]), [['target-size', '#tiny']]);
  assert.deepEqual(await evaluate('measureDOM({minTargetSize:0}).findings'), []);
});
test('viewer keeps full-size isolated frames and switches with keys, including iframe focus', { skip, timeout: 30000 }, async () => {
  const viewer = new URL('../../../references/candidate-viewer.html', import.meta.url);
  await navigate(viewer.href);
  const state = await evaluate(`({index:document.documentElement.dataset.candidate,
    width:document.querySelector('iframe').getBoundingClientRect().width,
    height:document.querySelector('iframe').getBoundingClientRect().height,
    sandbox:document.querySelector('iframe').getAttribute('sandbox')})`);
  assert.equal(state.index, '1');
  assert.equal(state.width, 1280);
  assert.equal(state.height, 752);
  assert.equal(state.sandbox, 'allow-scripts');
  if (process.env.MEASURE_CAPTURE_DIR) {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.MEASURE_CAPTURE_DIR, 'viewer-1.actual.png'), Buffer.from(data, 'base64'));
  }
  for (const [key, expected] of [['ArrowRight', '2'], ['1', '1'], ['ArrowLeft', '2']]) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key });
    assert.equal(await evaluate('document.documentElement.dataset.candidate'), expected);
  }
  if (process.env.MEASURE_CAPTURE_DIR) {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.MEASURE_CAPTURE_DIR, 'viewer-2.actual.png'), Buffer.from(data, 'base64'));
  }
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 300, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 300, button: 'left', clickCount: 1 });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '1' });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate('document.documentElement.dataset.candidate') === '1') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(await evaluate('document.documentElement.dataset.candidate'), '1');
  const reference = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="coral"/></svg>');
  viewer.searchParams.set('reference', reference);
  await navigate(viewer.href);
  await evaluate("document.querySelector('#compare').click()");
  assert.equal(await evaluate("document.querySelector('iframe').getBoundingClientRect().width"), 640);
  await evaluate("new Promise(resolve => { const image = document.querySelector('aside img'); image.onload = resolve; image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2880\" height=\"1800\"/>'); })");
  assert.ok(await evaluate("document.querySelector('aside').scrollWidth === document.querySelector('aside').clientWidth && document.querySelector('aside img').width <= 640"), 'a reference wider than its pane is scaled down to it');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight' });
  assert.equal(await evaluate("document.querySelector('aside').hidden"), false, 'a single reference stays beside every candidate');
  console.log('viewer: 1280x752 isolated frame; arrows, digits, iframe-focus keys and reference split passed');
});
test('relative PNG and HTML candidates open without edits; F toggles native image size', { skip, timeout: 30000 }, async () => {
  const viewer = new URL('../../../references/candidate-viewer.html', import.meta.url);
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  const png = join(profile, 'candidate.png');
  await writeFile(png, Buffer.from(data, 'base64'));
  viewer.searchParams.append('c', relative(fileURLToPath(new URL('.', viewer)), png).replaceAll('\\', '/'));
  viewer.searchParams.append('c', '../scripts/fixtures/measure/clean.html');
  viewer.searchParams.append('reference', '../scripts/fixtures/measure/candidate.svg');
  viewer.searchParams.append('reference', 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"/>'));
  viewer.searchParams.append('c', '../scripts/fixtures/measure/defects.html');
  await navigate(viewer.href);
  const native = await evaluate(`({width:document.querySelector('#image img').width,
    height:document.querySelector('#image img').height,
    scrollHeight:document.querySelector('#image').scrollHeight,
    viewportHeight:document.querySelector('#image').clientHeight})`);
  assert.equal(native.width, 1280);
  assert.equal(native.height, 800);
  assert.ok(native.scrollHeight > native.viewportHeight);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f' });
  assert.equal(await evaluate("document.querySelector('#fit').getAttribute('aria-pressed')"), 'true');
  assert.ok(await evaluate("document.querySelector('aside').classList.contains('fit')"));
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r' });
  assert.ok(await evaluate("document.querySelector('aside').scrollWidth === document.querySelector('aside').clientWidth && document.querySelector('aside').scrollHeight === document.querySelector('aside').clientHeight"));
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r' });
  assert.ok(await evaluate("document.querySelector('#image').scrollHeight === document.querySelector('#image').clientHeight"));
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f' });
  assert.equal(await evaluate("document.querySelector('aside').classList.contains('fit')"), false);
  assert.equal(await evaluate("document.querySelector('#image img').width"), 1280);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '2' });
  assert.ok(await evaluate("document.querySelector('iframe').src.endsWith('/clean.html')"));
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r' });
  assert.ok(await evaluate("document.querySelector('aside img').src.startsWith('data:image/svg+xml') && !document.querySelector('aside').hidden"), 'the second candidate shows the second reference');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '3' });
  assert.ok(await evaluate("document.querySelector('#compare').disabled && document.querySelector('aside').hidden"), 'a candidate without its own reference shows none');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '2' });
  assert.equal(await evaluate("document.querySelector('aside').hidden"), false);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r' });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 300, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 300, button: 'left', clickCount: 1 });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("document.activeElement.tagName !== 'IFRAME'")) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '1' });
  assert.equal(await evaluate('document.documentElement.dataset.candidate'), '1');
  console.log('file candidates: native PNG 1280x800 scrolls; F fits/restores; relative HTML and reference paths resolve; each candidate shows its own reference; URL frame keeps chooser shortcuts');
});
