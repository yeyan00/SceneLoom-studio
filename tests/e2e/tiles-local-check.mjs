import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startTestServer } from '../helpers/server.mjs';
const source = path.resolve(process.argv[2] || 'data/tile3');
const json = JSON.parse(await readFile(path.join(source, 'tileset.json'), 'utf8'));
console.log({ asset: json.asset, branches: json.root.children?.[0]?.children?.length });
const service = await startTestServer({ production: !process.argv.includes('--dev') });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const artifacts = path.resolve('test-results/tiles-local');
await mkdir(artifacts, { recursive: true });
try {
  console.log(await service.api('/open', { path: source }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(service.url);
  await page.getByRole('tab', { name: /tile3/ }).click();
  await page.waitForTimeout(12000);
  const stats = await page.locator('.tiles-viewport').evaluate(e => e.dataset.diagnostics);
  console.log({ stats, errors: errors.slice(0, 10) });
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ stats, errors }, null, 2));
  await page.screenshot({ path: path.join(artifacts, 'view.png') });
  if (!JSON.parse(stats || '{}').triangles) throw new Error('No rendered triangles');
  if (errors.length) throw new Error(errors.slice(0, 10).join('\n'));
} finally { await browser.close(); await service.close(); }
