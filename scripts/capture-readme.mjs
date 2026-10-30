// Capture the real UI using only generated geometry and isolated application state.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestServer } from '../tests/helpers/server.mjs';
import { createPotreeFixture } from '../tests/fixtures/generate.mjs';

const service = await startTestServer();
let browser;
try {
  const fixture = await createPotreeFixture(path.join(service.home, 'synthetic-demo'));
  const metadataPath = path.join(fixture, 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const shift = metadata.offset;
  metadata.name = 'Synthetic terrain · generated demo';
  metadata.offset = [0, 0, 0];
  for (const key of ['min', 'max']) {
    metadata.boundingBox[key] = metadata.boundingBox[key].map((v, i) => v - shift[i]);
    metadata.attributes[0][key] = metadata.attributes[0][key].map((v, i) => v - shift[i]);
  }
  await writeFile(metadataPath, JSON.stringify(metadata));
  await mkdir('docs/screenshots', { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(service.url);
  await page.evaluate(() => localStorage.setItem('sceneloom.locale', 'zh-CN'));
  await page.reload();
  await page.locator('.welcome').waitFor();
  await page.screenshot({ path: 'docs/screenshots/01-workspace.png' });
  await page.locator('.welcome').getByRole('button', { name: '打开数据…', exact: true }).click();
  await page.getByLabel('数据路径', { exact: true }).fill(fixture);
  await page.getByRole('dialog').getByRole('button', { name: '打开', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="visible-points"]').textContent.replaceAll(',', '')) > 0);
  await page.getByRole('button', { name: '适应视图', exact: true }).click();
  await page.getByRole('button', { name: '点云渲染', exact: true }).click();
  // Hide machine-specific filesystem paths in property text before capture.
  await page.evaluate((root) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent.includes(root)) node.textContent = node.textContent.replaceAll(root, '/demo');
    }
  }, service.home);
  for (const [mode, name] of [['rgb', '02-synthetic-rgb'], ['classification', '03-synthetic-classification']]) {
    await page.getByLabel('着色方式', { exact: true }).selectOption(mode);
    await page.waitForFunction(m => document.querySelector('canvas').dataset.renderMode === m, mode);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/screenshots/${name}.png` });
  }
  console.log('Captured 3 screenshots using generated data only.');
} finally {
  await browser?.close();
  await service.close();
}
