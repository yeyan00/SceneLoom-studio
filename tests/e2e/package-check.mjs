import path from "node:path";
import { mkdir, readFile, rename } from "node:fs/promises";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import {
  createPotreeFixture,
  createLasFixture,
} from "../fixtures/generate.mjs";
import { openProject, closeProjects } from "../../server/project-store.mjs";
import { datasetIdentity } from "../../server/dataset-identity.mjs";
const service = await startTestServer({ isolatedProjects: false });
let browser;
try {
  const sources = path.join(service.home, "inputs"),
    aDir = path.join(sources, "A.sceneloom"),
    a = await createPotreeFixture(path.join(aDir, "pointcloud")),
    original = await createLasFixture(path.join(sources, "A.las"));
  const identity = await datasetIdentity(a),
    store = await openProject({
      stateDir: path.join(service.home, "state"),
      id: "converted-A",
      folder: a,
      revision: identity.revision,
      metadata: identity.metadata,
      projectDirectory: aDir,
      originalSource: original,
    });
  closeProjects();
  const b = await createPotreeFixture(path.join(sources, "B"));
  await service.api("/open", { path: b });
  const destination = path.join(service.home, "output");
  await mkdir(destination);
  browser = createBrowser("package");
  browser.open(service.url);
  browser.run(`async(page)=>{
 page.on('dialog',dialog=>dialog.accept());const errors=[];page.on('pageerror',error=>errors.push(error.message));const check=(ok,message)=>{if(!ok)throw new Error(message)};
 await page.setViewportSize({width:1400,height:1000});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
 const button=name=>page.getByRole('button',{name,exact:true});await button('打开数据').click();await page.getByLabel('数据路径').fill(${JSON.stringify(store.entry)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('[data-testid="visible-points"]').textContent.replaceAll(',',''))>0);
 await button('矩形').click();const box=await page.getByTestId('view-main').boundingBox();await page.mouse.move(box.x+box.width*.2,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.8,{steps:4});await page.mouse.up();await button('赋予类别').click();
 await button('工程').click();await button('打包工程').click();await page.getByLabel('扫描工程目录',{exact:true}).fill(${JSON.stringify(sources)});await button('扫描').click();await page.locator('.package-project-list label').filter({hasText:'B.sceneloom'}).waitFor();await button('全选').click();
 await page.getByLabel('目标目录',{exact:true}).fill(${JSON.stringify(destination)});await button('浏览目标目录').click();await page.getByRole('region',{name:'选择目录',exact:true}).waitFor();await button('选择此目录').click();
 await page.getByLabel('包含关联的原始 LAS / LAZ（如有）',{exact:true}).check();await button('开始打包').click();
 await page.waitForFunction(()=>{const p=document.querySelector('.package-progress');return p&&p.querySelector('strong').textContent==='已完成';},{},{timeout:60000});
 check(await page.locator('.package-progress li').count()===2,'batch results missing');check(await page.locator('.package-progress li b').allTextContents().then(values=>values.every(value=>value==='已完成')),'batch failed');
 await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "package-desktop.png"))}});
 await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await button('工程').click();await button('打包工程').click();check(await page.getByRole('region',{name:'打包进度',exact:true}).isVisible(),'closing dialog lost task results');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
 await page.locator('.language-picker select').selectOption('en');await button('Package projects').click();check(await page.getByLabel('Destination directory',{exact:true}).isVisible(),'package translation missing');await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'package mobile overflow');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "package-mobile.png"))}});
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();check(errors.length===0,errors.join(';'));return{passed:true,checks:['scan and multi-select','directory picker','originals','unsaved edit snapshot','progress/results','task survives dialog close','translation/mobile'],errors};
 }`);
  const aPacked = path.join(
    destination,
    "A.sceneloom",
    "project.sceneloom.json",
  );
  assert.ok(JSON.parse(await readFile(aPacked, "utf8")).originalSource);
  // Windows keeps the live source database directory locked; disconnect every data dependency instead.
  await rename(a, path.join(service.home, "disconnected-pointcloud"));
  await rename(original, path.join(service.home, "disconnected.las"));
  await rename(b, path.join(service.home, "disconnected-B"));
  const opened = await service.api("/open", { path: aPacked });
  assert.equal(opened.dataset.session.cursor, 1);
  assert.equal(opened.dataset.recovered, false);
  browser.run(
    `async(page)=>{await page.setViewportSize({width:1400,height:1000});await page.getByRole('button',{name:'Open data',exact:true}).click();await page.getByLabel('Data path').fill(${JSON.stringify(aPacked)});await page.getByRole('dialog').getByRole('button',{name:'Open',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="operation-count"]').textContent==='1'&&Number(document.querySelector('[data-testid="visible-points"]').textContent.replaceAll(',',''))>0);return {passed:true,checks:['opens after source is disconnected','editing history restored']};}`,
  );
  console.log(
    JSON.stringify({
      passed: true,
      packagedProjects: 2,
      sourceDisconnected: true,
    }),
  );
} finally {
  try {
    browser?.close();
  } finally {
    closeProjects();
    await service.close();
  }
}
