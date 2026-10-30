import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { createPotreeFixture } from "../fixtures/generate.mjs";
import { createTilesFixture } from "../fixtures/tiles.mjs";

const service = await startTestServer();
let browser;
try {
  const points = [];
  for (const name of ["点云 A", "点云 B"]) {
    const source = await createPotreeFixture(path.join(service.home, name));
    const metadata = JSON.parse(
      await readFile(path.join(source, "metadata.json"), "utf8"),
    );
    metadata.name = name;
    await writeFile(
      path.join(source, "metadata.json"),
      JSON.stringify(metadata),
    );
    points.push(source);
  }
  const tiles = await createTilesFixture(path.join(service.home, "tiles"));
  const destination = path.join(service.home, "workspace.sceneloom.json");
  browser = createBrowser("data-tree");
  browser.open(service.url);
  browser.run(`async(page) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.evaluate(() => localStorage.setItem('sceneloom.locale', 'zh-CN')); await page.reload();
    const tree = page.getByTestId('project-data-tree');
    const open = async (type, source) => {
      await tree.getByRole('button', { name: '添加数据', exact: true }).click();
      await page.getByLabel('数据类型', { exact: true }).selectOption(type);
      await page.getByLabel('数据路径', { exact: true }).fill(source);
      if (type === 'project') {
        await page.getByRole('button', { name: '选择文件', exact: true }).click();
        const picker = page.getByRole('region', { name: '选择文件', exact: true });
        await picker.getByRole('button', { name: 'workspace.sceneloom.json', exact: true }).dblclick();
        await picker.waitFor({ state: 'hidden' });
        if (await page.getByLabel('数据路径', { exact: true }).inputValue() !== source) throw new Error('Project file picker lost its selected path');
      }
      await page.getByRole('dialog').getByRole('button', { name: '打开', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    };
    await tree.getByRole('button', { name: '添加点云', exact: true }).click();
    await page.getByLabel('数据路径', { exact: true }).fill(${JSON.stringify(points[0])});
    await page.getByRole('button', { name: '选择数据目录', exact: true }).click();
    const directoryPicker = page.getByRole('region', { name: '选择目录', exact: true });
    await directoryPicker.getByRole('button', { name: '选择此目录', exact: true }).click();
    await directoryPicker.waitFor({ state: 'hidden' });
    if (await page.getByLabel('数据路径', { exact: true }).inputValue() !== ${JSON.stringify(points[0])}) throw new Error('Directory selection lost its full path');
    await page.getByRole('button', { name: '选择文件', exact: true }).click();
    const filePicker = page.getByRole('region', { name: '选择文件', exact: true });
    await filePicker.getByRole('button', { name: 'metadata.json', exact: true }).click();
    await page.screenshot({ path: ${JSON.stringify(path.join(browser.artifacts, "open-file-picker.png"))} });
    await filePicker.getByRole('button', { name: '选择此文件', exact: true }).click();
    await filePicker.waitFor({ state: 'hidden' });
    if (await page.getByLabel('数据路径', { exact: true }).inputValue() !== ${JSON.stringify(path.join(points[0], "metadata.json"))}) throw new Error('File selection lost its full path');
    await page.getByRole('dialog').getByRole('button', { name: '打开', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await open('pointcloud', ${JSON.stringify(points[1])});
    if (await tree.locator('.asset').count() !== 2) throw new Error('Multiple point clouds were not retained');
    await tree.getByRole('button', { name: /点云 A.*Potree/ }).click();
    await page.getByRole('tab', { name: /点云 A/ }).waitFor();
    await open('tiles', ${JSON.stringify(tiles)});
    if (await tree.locator('.asset').count() !== 3) throw new Error('Mixed data tree missing entries');
    const tileTab = page.locator('.scene-tab').filter({ has: page.getByRole('tab', { name: /3D Tiles/ }) });
    await tileTab.locator('.close-view').click();
    if (await tree.locator('.asset').count() !== 3) throw new Error('Closing a tab removed project data');
    await tree.locator('.asset').filter({ hasText: '3D Tiles' }).click();
    await page.getByRole('tab', { name: /3D Tiles/ }).waitFor();
    await tree.getByRole('button', { name: '保存多数据项目', exact: true }).click();
    await page.getByLabel('项目文件路径', { exact: true }).fill(${JSON.stringify(destination)});
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await open('project', ${JSON.stringify(destination)});
    if (await tree.locator('.asset').count() !== 3) throw new Error('Project did not restore all references');
    await tree.getByRole('button', { name: '添加点云', exact: true }).click();
    if (await page.getByLabel('数据类型', { exact: true }).inputValue() !== 'pointcloud') throw new Error('Typed add action lost its filter');
    if (await page.locator('.supported-data-types > div').count() !== 1) throw new Error('Type hints were not filtered');
    await page.screenshot({ path: ${JSON.stringify(path.join(browser.artifacts, "open-pointcloud.png"))} });
    await page.getByLabel('数据类型', { exact: true }).selectOption('auto');
    if (await page.locator('.supported-data-types > div').count() !== 4) throw new Error('Auto detect hints must list all data types');
    await page.screenshot({ path: ${JSON.stringify(path.join(browser.artifacts, "open-data-types.png"))} });
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('.tiles-viewport')?.dataset.diagnostics || '{}').ready);
    await page.screenshot({ path: ${JSON.stringify(path.join(browser.artifacts, "project-data-tree.png"))} });
    await page.locator('.language-picker select').selectOption('en');
    await tree.getByRole('button', { name: 'Add data', exact: true }).click();
    await page.getByLabel('Data type', { exact: true }).selectOption('auto');
    if (await page.locator('.supported-data-types').innerText().then(text => /[\u4e00-\u9fff]/.test(text))) throw new Error('English format hints contain untranslated text');
    await page.setViewportSize({ width: 540, height: 900 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error('Open dialog overflows narrow viewport');
    await page.screenshot({ path: ${JSON.stringify(path.join(browser.artifacts, "open-data-types-mobile-en.png"))} });
    await page.getByRole('button', { name: 'Choose file', exact: true }).click();
    const mobilePicker = page.getByRole('region', { name: 'Choose file', exact: true });
    await mobilePicker.waitFor();
    await mobilePicker.locator('.directory-list[aria-busy="false"]').waitFor();
    if (await mobilePicker.locator('.directory-list button').count() === 0) throw new Error('File browser did not list local drives');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error('File browser overflows narrow viewport');
    await page.screenshot({ path: ${JSON.stringify(path.join(browser.artifacts, "open-file-picker-mobile-en.png"))} });
    await mobilePicker.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (!await page.getByRole('dialog').isVisible()) throw new Error('Cancelling file selection closed the open dialog');
    if (errors.length) throw new Error(errors.join('; '));
    return { pointclouds: 2, tiles: 1, projectRestored: true, closeRetainsData: true };
  }`);
  const index = JSON.parse(await readFile(destination, "utf8"));
  assert.equal(index.resources.length, 3);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
