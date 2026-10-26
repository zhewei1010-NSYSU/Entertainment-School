import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.PWA_TEST_URL || 'http://127.0.0.1:4185/Entertainment-School/';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(Error('Service worker installation timed out')), 30000))]));
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  assert.equal(manifest.display, 'standalone');
  assert.equal(new URL(manifest.start_url, base).pathname, new URL(base).pathname);
  for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some(icon => icon.sizes === size));
  await page.reload();
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await page.getByText('目前離線', { exact: false }).waitFor();
  await page.getByLabel('搜尋國小、地區或地址').waitFor();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}px`);
  }
  const publicData = await page.evaluate(async () => {
    const paths = ['data/schools.json', 'data/district-maps/高雄市.json', 'data/attractions/高雄市.json'];
    const results = [];
    for (const path of paths) { const r = await fetch(path); if (!r.ok) throw Error(path); results.push(await r.json()); }
    return results.map(value => !!value);
  });
  assert.deepEqual(publicData, [true, true, true]);
  await page.getByLabel('搜尋國小、地區或地址').fill('三民');
  await page.locator('.school-list button').first().click();
  await page.getByRole('button', { name: '加入照片與心得' }).click();
  await page.getByLabel('沿途的感受').fill('離線 PWA 測試心得');
  await page.getByRole('button', { name: '儲存這一站' }).click();
  await page.getByText('已儲存在這台裝置', { exact: true }).waitFor();
  await page.reload();
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('school-wander-local-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const query = db.transaction('records').objectStore('records').getAll();
      query.onsuccess = () => { db.close(); resolve(query.result); };
      query.onerror = () => { db.close(); reject(query.error); };
    };
  }));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].note, '離線 PWA 測試心得');
  assert.deepEqual(errors, []);
  console.log('PASS: project scope, standalone manifest, icons, offline reload, all map/catalogue samples, 320–768px layout, offline save and persistence.');
} finally { await browser.close(); }
