import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createPotreeFixture, createLasFixture } from '../fixtures/generate.mjs';
import { createGaussianFixture } from '../fixtures/gaussian.mjs';
import { createTilesFixture } from '../fixtures/tiles.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const artifacts = path.join(root, 'test-results', `desktop-${Date.now()}`);
const extracted = path.join(artifacts, '绿色版 portable');
await fs.mkdir(extracted, { recursive: true });
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const zip = path.join(root, 'release', `SceneLoom-Studio-${version}-win-x64.zip`);
const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const result = spawnSync(ps, ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(extracted)} -Force`], { encoding: 'utf8', windowsHide: true });
assert.equal(result.status, 0, result.stderr);
const server = net.createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const child = spawn(path.join(extracted, 'SceneLoom.exe'), ['--test-cdp-port', String(port)], { cwd: extracted, windowsHide: true, env: { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') } });
let browser, serviceUrl;
const report = { passed: false, extracted, checks: [] };
try {
  for (let i = 0; i < 120; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  assert.ok(browser, 'WebView2 CDP unavailable');
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 60; i++) {
    page = context.pages().find(p => p.url().startsWith('http://127.0.0.1:'));
    if (page) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(page, 'Desktop webview unavailable');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.querySelector('.ribbon'));
  serviceUrl = new URL(page.url()).origin;
  assert.equal((await fetch(serviceUrl + '/api/settings')).status, 403);
  assert.ok(await page.evaluate(() => !!window.__TAURI_INTERNALS__));
  report.checks.push('relocated Chinese/spaced path; bundled Node; authenticated local backend; native Tauri webview');
  const api = async (url, body) => {
    const r = await context.request.fetch(serviceUrl + '/api' + url, { method: body ? 'POST' : 'GET', data: body });
    assert.equal(r.status(), 200, await r.text()); return r.json();
  };
  const fixtures = path.join(artifacts, 'external-data');
  const potree = await createPotreeFixture(path.join(fixtures, 'potree'));
  const gs = await createGaussianFixture(path.join(fixtures, 'gaussian.ply'));
  const tiles = process.env.SCENELOOM_TEST_TILES || await createTilesFixture(path.join(fixtures, 'tiles'));
  const tilesName = path.basename(tiles.endsWith('.json') ? path.dirname(tiles) : tiles);
  for (const source of [potree, gs, tiles]) await api('/open', { path: source });
  await page.reload();
  await page.locator('.left-panel').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('pointcloud-classes').isVisible(), false);
  await page.getByRole('tab', { name: /gaussian\.ply/ }).click();
  assert.ok(await page.locator('.left-panel').isVisible(), 'GS hid project explorer');
  assert.equal(await page.getByTestId('pointcloud-classes').isVisible(), false);
  await page.waitForFunction(() => JSON.parse(document.querySelector('.gaussian-viewport')?.dataset.diagnostics || '{}').ready, null, { timeout: 60000 });
  report.gaussian = await page.locator('.gaussian-viewport').evaluate(e => JSON.parse(e.dataset.diagnostics));
  await page.screenshot({ path: path.join(artifacts, 'gaussian.png') });
  const textureErrors = [];
  page.on('console', m => { if (m.type() === 'error') textureErrors.push(m.text()); });
  await page.getByRole('tab', { name: new RegExp(tilesName) }).click();
  assert.ok(await page.locator('.left-panel').isVisible(), 'Tiles hid project explorer');
  assert.equal(await page.getByTestId('pointcloud-classes').isVisible(), false);
  await page.waitForFunction(() => JSON.parse(document.querySelector('.tiles-viewport')?.dataset.diagnostics || '{}').triangles > 0, null, { timeout: 30000 });
  if (process.env.SCENELOOM_TEST_TILES) await page.waitForTimeout(8000);
  report.tiles = await page.locator('.tiles-viewport').evaluate(e => JSON.parse(e.dataset.diagnostics));
  assert.deepEqual(textureErrors, []);
  await page.screenshot({ path: path.join(artifacts, 'tiles.png') });
  await page.getByRole('tab').first().click();
  await page.locator('.language-picker select').selectOption('en');
  await page.getByRole('button', { name: 'Open data', exact: true }).click();
  await page.getByRole('button', { name: 'Choose file', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Choose data directory', exact: true }).waitFor();
  await page.getByLabel('Data path', { exact: true }).fill(potree);
  await page.getByRole('dialog').getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('canvas[data-diagnostics]')].some(e => JSON.parse(e.dataset.diagnostics || '{}').visiblePoints > 0), null, { timeout: 30000 });
  assert.equal(await page.getByTestId('pointcloud-classes').isVisible(), true);
  await page.getByRole('button', { name: 'Point cloud', exact: true }).click();
  assert.ok(await page.getByTestId('pointcloud-classes').isVisible());
  await page.getByRole('button', { name: 'Selection tools', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Polygon', exact: true }).click();
  await page.locator('.ribbon-split').getByRole('button', { name: 'Polygon', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Selection tools', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'ribbon-menu.png') });
  await page.getByRole('menuitemradio', { name: 'Rectangle', exact: true }).click();
  report.checks.push('mixed ribbon layout; native WebView2 dropdown selection');
  await page.getByRole('button', { name: 'Point cloud rendering', exact: true }).click();
  assert.equal(await page.getByTestId('pointcloud-classes').isVisible(), false);
  const explorerToggle = page.getByRole('button', { name: 'Toggle explorer', exact: true });
  await explorerToggle.click();
  await page.getByRole('tab', { name: /gaussian\.ply/ }).click();
  assert.equal(await page.locator('.left-panel').isVisible(), false, 'View switch reset hidden explorer');
  await explorerToggle.click();
  await page.getByRole('tab').first().click();
  assert.ok(await page.locator('.left-panel').isVisible());
  report.checks.push('shared project explorer; classification labels only during point-cloud editing');
  await page.screenshot({ path: path.join(artifacts, 'potree.png') });
  report.checks.push('external Potree, Gaussian PLY and B3DM rendering');
  const las = await createLasFixture(path.join(fixtures, '中文 数据', '测试点云.las'));
  report.las = { source: las, points: 50000 };
  const job = await api('/convert', { source: las });
  let status;
  for (let i = 0; i < 240; i++) {
    status = await api('/jobs/' + job.id);
    if (!['running', 'cancelling'].includes(status.status)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.equal(status.status, 'succeeded', status.error || status.log);
  assert.equal(status.dataset.metadata.points, 50000);
  assert.equal((await api('/open', { path: las })).reused, true);
  report.las.output = status.dataset.folder;
  report.las.project = status.dataset.projectPath;
  report.checks.push('bundled C++ converter; Chinese/spaced LAS path; 50,000 points; reopen associates converted dataset');
  await page.evaluate(async () => { const { invoke } = window.__TAURI_INTERNALS__; await invoke('plugin:window|destroy', { label: 'main' }); }).catch(error => {
    if (!/closed/i.test(error.message)) throw error;
  });
  await new Promise((resolve, reject) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => reject(new Error('Desktop did not exit')), 15000).unref(); });
  await assert.rejects(fetch(serviceUrl + '/api/settings'));
  report.checks.push('native window shutdown ends local backend');
  report.passed = true;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ artifacts, ...report }, null, 2));
}
