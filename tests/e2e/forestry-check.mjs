import path from "node:path";
import { writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { createPotreeFixture } from "../fixtures/generate.mjs";
const service = await startTestServer();
let browser;
try {
  const source =
    process.env.SCENELOOM_PERF_POTREE ||
    (await createPotreeFixture(path.join(service.home, "points")));
  browser = createBrowser("forestry");
  browser.open(service.url);
  const report = browser.run(`async(page)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());const check=(ok,message)=>{if(!ok)throw new Error(message)},button=name=>page.getByRole('button',{name,exact:true}).first();
 await page.setViewportSize({width:1600,height:1000});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
 await button('打开数据').click();await page.getByLabel('数据路径').fill(${JSON.stringify(source)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
 const settle=()=>page.waitForFunction(()=>{const c=document.querySelector('canvas');if(!c?.dataset.diagnostics)return false;const d=JSON.parse(c.dataset.diagnostics);return d.settled&&d.loading===0&&d.visiblePoints>0;});await settle();
 await button('林业').click();await button('单木管理').click();check(await page.getByRole('tab',{name:'单木',exact:true}).isVisible(),'plugin dock missing');check(await button('单木画刷').isDisabled(),'brush enabled without active tree');
 const draw=async()=>{await button('矩形').click();const box=await page.getByTestId('view-main').boundingBox();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.75,{steps:5});await page.mouse.up();};
 await draw();await button('选区新建单木').click();await page.getByRole('listitem').filter({hasText:'单木 1'}).waitFor();await settle();check(await page.getByTestId('operation-count').textContent()==='1','create-and-assign not atomic');
 await button('撤销').click();await settle();check(await page.getByRole('listitem').count()===0,'undo retained tree');await button('重做').click();await page.getByRole('listitem').filter({hasText:'单木 1'}).click();await settle();
 await button('新建单木').click();await page.getByRole('listitem').filter({hasText:'单木 2'}).waitFor();await settle();check(await page.getByRole('listitem').filter({hasText:'单木 2'}).getAttribute('aria-pressed')==='true','new tree not active');
 await page.getByLabel('归属策略',{exact:true}).selectOption('replace');await draw();await button('归入当前单木').click();await settle();await draw();await button('从当前单木移除').click();await settle();await button('撤销').click();await settle();
 await button('新建单木').click();await page.getByRole('listitem').filter({hasText:'单木 3'}).waitFor();await settle();
 await button('单木画刷').click();const box=await page.getByTestId('view-main').boundingBox(),x=box.x+box.width*.35,y=box.y+box.height*.5;
 const before=Number(await page.getByTestId('operation-count').textContent());await page.mouse.move(x,y);await page.mouse.down();for(let i=0;i<40;i++){await page.mouse.move(x+box.width*.3*i/39,y+Math.sin(i/5)*35);await page.waitForTimeout(8);}await page.waitForTimeout(90);await page.mouse.up();await settle();check(Number(await page.getByTestId('operation-count').textContent())===before+1,'tree brush not single command');
 const frames=await page.evaluate(()=>JSON.parse(document.querySelector('canvas').dataset.brushMetrics||'[]'));check(frames.length>0&&frames.every(f=>f.cameraLocked),'tree brush preview/lock failed');
 await page.getByLabel('画刷从当前单木移除').check();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+50,y,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await settle();check(Number(await page.getByTestId('operation-count').textContent())===before+1,'cancel persisted removal');
 await page.getByLabel('单木名称').fill('Oak A');await button('更新名称').click();await page.getByRole('listitem').filter({hasText:'Oak A'}).waitFor();
 await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='已保存');
 const saved=await page.evaluate(async source=>(await(await fetch('/api/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:source})})).json()).dataset,${JSON.stringify(source)});
 check(saved.session.operations.some(op=>op.type==='setAttribute'&&op.selection.kind==='brush'),'tree brush not saved');check(saved.session.operations.filter(op=>op.type==='createTree').length===3,'tree catalog not saved');
 await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "forestry.png"))}});
 await page.reload();await button('打开数据').click();await page.getByLabel('数据路径').fill(saved.projectPath);await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();await settle();await button('林业').click();await button('单木管理').click();await page.getByRole('listitem').filter({hasText:'Oak A'}).waitFor();
 await button('点云编辑').click();await button('分类画刷').click();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+80,y,{steps:4});await page.mouse.up();await settle();check(await page.locator('canvas').getAttribute('data-render-mode')==='classification','classification adapter did not restore');
 await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='已保存');
 await page.locator('.language-picker select').selectOption('en');await button('Forestry').click();check(await button('Tree manager').isVisible(),'plugin translation missing');await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'plugin mobile overflow');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "forestry-mobile.png"))}});
 check(errors.length===0,errors.join(';'));const sorted=frames.map(f=>f.latencyMs).sort((a,b)=>a-b);return {passed:true,sourcePoints:saved.metadata.points,feedback:{samples:sorted.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),targetMs:50},checks:['plugin ribbon and dock','automatic IDs','atomic create from selection','instance undo/redo','assign/move/remove','shared brush','cancel','rename','save/reopen','classification independence','English/mobile'],errors};
 }`);
  await writeFile(path.join(browser.artifacts, "forestry-report.txt"), report);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
