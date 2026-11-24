import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const url = process.env.KART_URL ?? 'http://127.0.0.1:4193/';
const output = resolve(process.env.KART_REPORT_DIR ?? 'go-kart/validation');
mkdirSync(output, { recursive: true });
const launch = { headless: true, args: ['--enable-unsafe-swiftshader'] };
if (process.env.CHROME_BINARY) launch.executablePath = process.env.CHROME_BINARY;
const browser = await chromium.launch(launch);

async function check(label, baseline) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
  if (baseline) await page.route('**/assets/kart/kart-body.glb', route =>
    route.fulfill({ path: baseline, contentType: 'model/gltf-binary' }));
  const modelResponse = page.waitForResponse(res => res.url().endsWith('/assets/kart/kart-body.glb'));
  await page.goto(url);
  const response = await modelResponse;
  assert.equal(response.status(), 200);
  const bytes = (await response.body()).length;
  await page.locator('#start:enabled').waitFor({ timeout: 20000 });
  await page.locator('#start').click();
  await page.keyboard.down('ArrowUp');
  const pace = await page.evaluate(() => new Promise(resolve => {
    let start, last;
    const frames = [];
    function sample(now) {
      start ??= now;
      if (last !== undefined) frames.push(now - last);
      last = now;
      if (now - start < 4500) requestAnimationFrame(sample);
      else {
        frames.sort((a, b) => a - b);
        resolve({
          fps: +(frames.length * 1000 / (now - start)).toFixed(1),
          p95FrameMs: +frames[Math.floor(frames.length * .95)].toFixed(2),
          frames: frames.length,
        });
      }
    }
    requestAnimationFrame(sample);
  }));
  await page.keyboard.up('ArrowUp');
  assert.ok(Number(await page.locator('#speed').textContent()) > 45);
  assert.notEqual(await page.locator('#current').textContent(), '—');
  await page.screenshot({ path: resolve(output, label + '-desktop.png') });
  const beforeBrake = Number(await page.locator('#speed').textContent());
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(before => Number(document.querySelector('#speed').textContent) < before - 5,
    beforeBrake);
  await page.keyboard.up('ArrowDown');
  await page.locator('#camera').click();
  assert.match(await page.locator('#camera').getAttribute('aria-label'), /Traseira ampla/);
  await page.keyboard.press('c');
  assert.match(await page.locator('#camera').getAttribute('aria-label'), /Visão do piloto/);
  await page.keyboard.press('r');
  await page.waitForFunction(() => document.querySelector('#current').textContent === '—');
  assert.deepEqual(errors, []);
  await context.close();
  return { ...pace, modelBytes: bytes, consoleErrors: errors };
}

try {
  const report = {};
  if (process.env.KART_BASELINE_GLB) report.before = await check('antes', process.env.KART_BASELINE_GLB);
  report.after = await check('depois');
  writeFileSync(resolve(output, 'desktop.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
