import path from "node:path";
import { writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { createForestFixture } from "../fixtures/generate.mjs";
const service = await startTestServer();
let browser;
try {
  const source = await createForestFixture(path.join(service.home, "forest"));
  browser = createBrowser("chm");
  browser.open(service.url);
  const report = browser.run(`async(page)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));const check=(ok,msg)=>{if(!ok)throw new Error(msg)},button=name=>page.getByRole('button',{name,exact:true}).first();
    await page.setViewportSize({width:1600,height:1000});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
    await button('打开数据').click();await page.getByLabel('数据路径').fill(${JSON.stringify(source)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
    const settle=()=>page.waitForFunction(()=>{const c=document.querySelector('canvas[data-diagnostics]');if(!c)return false;const d=JSON.parse(c.dataset.diagnostics);return d.settled&&d.loading===0&&d.visiblePoints>0;});await settle();
    await button('林业').click();await button('CHM 单木分割').click();await page.getByLabel('地面网格（m）',{exact:true}).fill('1');await page.getByLabel('树顶最小间距（m）',{exact:true}).fill('4');
    await page.getByLabel('处理分块边长（m）',{exact:true}).fill('8');await page.getByLabel('最小边界缓冲（m）',{exact:true}).fill('4');
    await button('计算分割').click();await page.getByText('检测到 2 个冠区',{exact:true}).waitFor();check(await page.getByTestId('operation-count').textContent()==='0','preview committed edits');
    await page.getByLabel('最低树高（m）',{exact:true}).fill('3');check(await button('应用分割结果').isDisabled(),'changed settings accepted stale result');await page.getByLabel('最低树高（m）',{exact:true}).fill('2');
    await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "chm-preview.png"))}});
    await button('应用分割结果').click();await page.getByRole('listitem').filter({hasText:'CHM 1'}).waitFor();await settle();check(await page.getByRole('listitem').count()===2,'missing tree entities');check(await page.getByTestId('operation-count').textContent()==='1','segmentation not atomic');
    await button('撤销').click();await settle();check(await page.getByRole('listitem').count()===0,'undo failed');await button('重做').click();await settle();check(await page.getByRole('listitem').count()===2,'redo failed');
    await page.getByRole('listitem').filter({hasText:'CHM 1'}).click();await button('单木画刷').click();await button('浏览').click();
    await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='已保存');
    await page.reload();await button('打开数据').click();await page.getByLabel('数据路径').fill(${JSON.stringify(source)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();await settle();await button('林业').click();await page.getByRole('listitem').filter({hasText:'CHM 1'}).waitFor();check(await page.getByRole('listitem').count()===2,'saved crowns not restored');
    await page.locator('.language-picker select').selectOption('en');await button('CHM tree segmentation').click();check(await button('Compute segmentation').isVisible(),'CHM English missing');await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'CHM mobile overflow');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "chm-mobile.png"))}});
    check(errors.length===0,errors.join(';'));return {passed:true,checks:['ribbon entry','CHM preview','stale parameters','atomic apply','undo/redo','manual tool reuse','save/reopen','English/mobile'],errors};
  }`);
  await writeFile(path.join(browser.artifacts, "chm-report.txt"), report);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
