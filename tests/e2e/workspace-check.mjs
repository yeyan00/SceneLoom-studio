import path from "node:path";
import { writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { createPotreeFixture } from "../fixtures/generate.mjs";
const service = await startTestServer();
let browser;
try {
  browser = createBrowser("workspace");
  const fixture =
    process.env.SCENELOOM_PERF_POTREE ||
    (await createPotreeFixture(path.join(service.home, "pointcloud")));
  browser.open(service.url);
  const result = browser.run(`async(page)=>{
 page.on('dialog',dialog=>dialog.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const check=(ok,message)=>{if(!ok)throw new Error(message)};
 await page.setViewportSize({width:1600,height:1000});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
 const openedAt=Date.now();await page.getByRole('button',{name:'打开数据',exact:true}).click();await page.getByLabel('数据路径').fill(${JSON.stringify(fixture)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
 const diagnostics=()=>page.locator('canvas').evaluate(canvas=>JSON.parse(canvas.dataset.diagnostics||'{}'));
 const settle=async()=>{const since=Date.now();await page.waitForFunction(since=>{const c=document.querySelector('canvas');if(!c?.dataset.diagnostics)return false;const d=JSON.parse(c.dataset.diagnostics);return d.sampledAt>=since&&d.settled&&d.loading===0&&d.visiblePoints>0;},since,{timeout:60000});};
 await page.waitForFunction(()=>Number(document.querySelector('[data-testid="visible-points"]').textContent.replaceAll(',',''))>0,{},{timeout:60000});const firstDisplayMs=Date.now()-openedAt;
 await settle();const initialBudgetSettledMs=Date.now()-openedAt;const button=name=>page.getByRole('button',{name,exact:true});
 await button('局部截取').click();let box=await page.getByTestId('view-main').boundingBox();
 await page.mouse.click(box.x+box.width*.3,box.y+box.height*.5);await page.mouse.click(box.x+box.width*.7,box.y+box.height*.5);await page.mouse.move(box.x+box.width*.5,box.y+box.height*.65);await page.mouse.click(box.x+box.width*.5,box.y+box.height*.65);
 await page.getByTestId('view-top').waitFor({state:'visible'});await settle();check((await diagnostics()).views===4,'four views not active');
 const draw=async(id,x1=.15,y1=.22,x2=.85,y2=.8)=>{const b=await page.getByTestId('view-'+id).boundingBox();await page.mouse.move(b.x+b.width*x1,b.y+b.height*y1);await page.mouse.down();await page.mouse.move(b.x+b.width*x2,b.y+b.height*y2,{steps:4});await page.mouse.up();await settle();};
 await button('矩形').click();await draw('top');let selected=(await diagnostics()).selectedPoints;check(selected>0,'top selection empty');
 await page.getByLabel('选区组合',{exact:true}).selectOption('union');await draw('front');check((await diagnostics()).selectedPoints>=selected,'union removed selected points');
 await page.getByLabel('选区组合',{exact:true}).selectOption('difference');await draw('side',.4,.4,.5,.5);
 await page.getByLabel('选区组合',{exact:true}).selectOption('intersection');await draw('top',.1,.18,.9,.88);check((await diagnostics()).selectedPoints>0,'combined selection empty');
 const editAt=Date.now();await button('赋予类别').click();await settle();const classificationMs=Date.now()-editAt;check((await page.getByTestId('operation-count').textContent())==='1','classification missing');
 await page.getByLabel('选区组合',{exact:true}).selectOption('replace');await draw('front');const beforeDelete=(await diagnostics()).visiblePoints;await button('删除选区').click();await settle();const afterDelete=(await diagnostics()).visiblePoints;check(afterDelete<beforeDelete,'deletion did not affect shared nodes');
 const historyTimes=[],presentedTimes=[];const readsBeforeHistory=(await diagnostics()).readBytes;
 for(let i=0;i<6;i++){let start=Date.now();await button('撤销').click();await settle();check((await diagnostics()).visiblePoints===beforeDelete,'undo did not restore points');historyTimes.push(Date.now()-start);presentedTimes.push((await diagnostics()).interactionMs);start=Date.now();await button('重做').click();await settle();check((await diagnostics()).visiblePoints===afterDelete,'redo changed result');historyTimes.push(Date.now()-start);presentedTimes.push((await diagnostics()).interactionMs);}
 check((await diagnostics()).readBytes===readsBeforeHistory,'history caused new point reads');
 await button('浏览').click();await page.getByRole('button',{name:'切换方向锁定 顶视图',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="切换方向锁定 顶视图"]').getAttribute('aria-pressed')==='false');
 const top=await page.getByTestId('view-top').boundingBox();await page.mouse.move(top.x+top.width*.5,top.y+top.height*.5);await page.mouse.down();await page.mouse.move(top.x+top.width*.6,top.y+top.height*.6,{steps:4});await page.mouse.up();
 await page.getByRole('button',{name:'最大化 顶视图',exact:true}).click();await settle();check((await diagnostics()).views===1,'maximize did not isolate view');await page.getByRole('button',{name:'最大化 顶视图',exact:true}).click();
 await page.getByRole('button',{name:'切换方向锁定 顶视图',exact:true}).click();await settle();
 await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('footer').textContent.includes('工程已保存'));
 await page.route('**/api/datasets/*/save',async route=>{const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({response});});
 await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='保存中');await button('撤销').click();
 await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='尚未保存');check((await page.getByTestId('operation-count').textContent())==='1','save overwrote concurrent undo');
 const restoredRecovery=page.waitForResponse(async response=>response.url().endsWith('/session')&&response.request().method()==='POST'&&(await response.json()).cursor===2);await button('重做').click();await restoredRecovery;await page.unroute('**/api/datasets/*/save');
 const saved=await page.evaluate(async source=>{const r=await fetch('/api/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:source})});return (await r.json()).dataset;},${JSON.stringify(fixture)});
 check(saved.session.cursor===2&&saved.session.operations[0].selection.kind==='intersection','saved composition mismatch: '+JSON.stringify(saved.session));check(!saved.recovered,'returning to saved history left stale recovery');check(saved.projectPath.endsWith('.sceneloom.json'),'project entry missing');
 await page.reload();await button('打开数据').click();await page.getByLabel('数据路径').fill(saved.projectPath);await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();await settle();check((await page.getByTestId('operation-count').textContent())==='2','project history not restored');check(await page.getByTestId('view-side').isVisible(),'local region not restored');
 await button('撤销').click();await button('撤销').click();await button('重做').click();await button('矩形').click();await draw('top');await button('赋予类别').click();await settle();check(await button('重做').isDisabled(),'branch retained stale redo');
 await button('撤销').click();await button('重做').click();await button('撤销').click();await button('重做').click();await settle();
 await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "workspace.png"))}});
 await page.locator('.language-picker select').selectOption('en');check(await button('Local region').isVisible(),'workspace translation missing');check(await page.getByRole('button',{name:'Toggle orientation lock Top view',exact:true}).isVisible(),'view translation missing');
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'workspace mobile overflow');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "workspace-mobile.png"))}});await page.setViewportSize({width:1600,height:1000});
 const environment=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),info=gl.getExtension('WEBGL_debug_renderer_info');return {browser:navigator.userAgent,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),jsHeapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null};});
 check(errors.length===0,errors.join(';'));const final=await diagnostics(),sorted=historyTimes.toSorted((a,b)=>a-b);
 return {passed:true,environment,sourcePoints:saved.metadata.points,firstDisplayMs,initialBudgetSettledMs,classificationMs,history:{samples:historyTimes.length,automationMedianMs:sorted[Math.floor(sorted.length/2)],automationMaxMs:Math.max(...historyTimes),presentedMedianMs:presentedTimes.toSorted((a,b)=>a-b)[Math.floor(presentedTimes.length/2)],presentedMaxMs:Math.max(...presentedTimes)},diagnostics:final,checks:['centerline region','four shared views','union/difference/intersection','highlight','ordered classify/delete','undo/redo','no history point reads','unlock/maximize','SQLite save and JSON reopen','save with concurrent undo','branch redo invalidation','rapid history convergence','workspace translation and mobile'],errors};
 }`);
  await writeFile(path.join(browser.artifacts, "workspace-report.txt"), result);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
