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
  browser = createBrowser("brush");
  browser.open(service.url);
  const report = browser.run(`async(page)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=(ok,message)=>{if(!ok)throw new Error(message)},button=name=>page.getByRole('button',{name,exact:true});
 await page.setViewportSize({width:1600,height:1000});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
 await button('打开数据').click();await page.getByLabel('数据路径').fill(${JSON.stringify(source)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
 const settled=()=>page.waitForFunction(()=>{const c=document.querySelector('canvas');if(!c?.dataset.diagnostics)return false;const d=JSON.parse(c.dataset.diagnostics);return d.settled&&d.loading===0&&d.visiblePoints>0;});await settled();
 const box=await page.getByTestId('view-main').boundingBox(),x=box.x+box.width*.4,y=box.y+box.height*.5;
 await button('分类画刷').click();await page.mouse.move(x,y);await page.keyboard.press('Equal');check(Number(await page.getByLabel('画刷直径').inputValue())>48,'size shortcut failed');await page.keyboard.press('Minus');
 const samplesBefore=await page.evaluate(()=>JSON.parse(document.querySelector('canvas').dataset.brushMetrics||'[]').length);
 await page.mouse.down();await page.mouse.move(x+box.width*.25,y,{steps:24});await page.waitForTimeout(80);
 check(await page.getByTestId('operation-count').textContent()==='0','preview created history');
 const during=await page.evaluate(()=>JSON.parse(document.querySelector('canvas').dataset.brushMetrics||'[]'));check(during.length>samplesBefore,'no live feedback before release');
 await page.keyboard.down('Space');check(!(await page.locator('[data-testid="view-main"] .selection-overlay').getAttribute('class')).includes('passive'),'space navigated during stroke');await page.keyboard.up('Space');
 await page.mouse.wheel(0,400);await page.mouse.move(x+box.width*.3,y+10);await page.waitForTimeout(80);await page.mouse.up();await settled();check(await page.getByTestId('operation-count').textContent()==='1','stroke not one history command');
 await button('撤销').click();await settled();check(await page.getByTestId('operation-count').textContent()==='0','undo failed');await button('重做').click();await settled();
 await page.mouse.move(x,y+30);await page.mouse.down();await page.mouse.move(x+80,y+30,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await settled();check(await page.getByTestId('operation-count').textContent()==='1','cancel committed a stroke');
 const beforeNavigation=await page.evaluate(()=>JSON.stringify(JSON.parse(document.querySelector('canvas').dataset.diagnostics).mainCamera));
 await page.keyboard.down('Space');check((await page.locator('[data-testid="view-main"] .selection-overlay').getAttribute('class')).includes('passive'),'temporary navigation failed');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+10,{steps:4});await page.mouse.up();await page.keyboard.up('Space');await page.waitForFunction(before=>JSON.stringify(JSON.parse(document.querySelector('canvas').dataset.diagnostics).mainCamera)!==before,beforeNavigation);
 await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='已保存');
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+100,y,{steps:4});await page.keyboard.press('Control+s');await page.mouse.up();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='已保存');check(await page.getByTestId('operation-count').textContent()==='2','saving active stroke lost or duplicated it');
 const saved=await page.evaluate(async source=>{const r=await fetch('/api/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:source})});return (await r.json()).dataset;},${JSON.stringify(source)});
 check(saved.session.operations[0].selection.kind==='brush','brush not persisted');
 const latencies=[],commitTimes=[];
 for(const diameter of [16,48,160,512]){
   await page.locator('.class-list button').nth([16,48,160,512].indexOf(diameter)+3).click();
   await page.getByLabel('画刷直径').fill(String(diameter));await page.mouse.move(x,y);await page.mouse.down();
   for(let i=0;i<30;i++){await page.mouse.move(x+box.width*.3*i/29,y+Math.sin(i/5)*60);await page.waitForTimeout(8);}
   await page.waitForTimeout(100);await page.mouse.up();await settled();commitTimes.push(await page.evaluate(()=>JSON.parse(document.querySelector('canvas').dataset.diagnostics).interactionMs));
 }
 await page.locator('.class-list button').nth(7).click();await page.getByLabel('画刷直径').fill('48');await page.mouse.move(x,y);await page.mouse.down();
 for(let i=0;i<240;i++){await page.mouse.move(x+box.width*.3*i/239,y+Math.sin(i/12)*90);if(i===100)await page.keyboard.press('Equal');}
 await page.waitForTimeout(100);const longFrame=await page.evaluate(()=>JSON.parse(document.querySelector('canvas').dataset.brushMetrics||'[]').at(-1));check(longFrame.samples>=200,'long stroke preview did not converge');await page.mouse.up();await settled();
 const frames=await page.evaluate(()=>JSON.parse(document.querySelector('canvas').dataset.brushMetrics||'[]'));
 check(frames.every(frame=>frame.cameraLocked),'camera was not frozen');
 latencies.push(...frames.map(f=>f.latencyMs));const sorted=latencies.toSorted((a,b)=>a-b);
 await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "brush.png"))}});
 await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='已保存');
 await page.reload();await button('打开数据').click();await page.getByLabel('数据路径').fill(saved.projectPath);await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();await settled();check(Number(await page.getByTestId('operation-count').textContent())>=1,'reopen lost strokes');
 await page.locator('.language-picker select').selectOption('en');check(await button('Classification brush').isVisible(),'translation missing');
 await button('Classification brush').click();await page.getByLabel('Brush diameter').fill('48');await page.keyboard.press('BracketRight');check(await page.getByLabel('Brush diameter').inputValue()==='48','shortcut intercepted numeric input');
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'brush mobile overflow');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "brush-mobile.png"))}});
 check(errors.length===0,errors.join(';'));
 const glInfo=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {browser:navigator.userAgent,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),pixelRatio:devicePixelRatio};});
 return {passed:true,sourcePoints:saved.metadata.points,targetMs:50,cachedPoints:Math.max(...frames.map(f=>f.cachedPoints)),environment:glInfo,commitMs:commitTimes,feedback:{samples:sorted.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),within50ms:sorted.filter(v=>v<=50).length,targetMetP95:sorted[Math.floor(sorted.length*.95)]<=50},checks:['live category preview','one stroke one command','size shortcuts and input isolation','locked stroke','temporary navigation','cancel','undo/redo','save active stroke','save/reopen','four brush sizes','240-point variable-size stroke convergence','English mobile layout'],errors};
 }`);
  await writeFile(path.join(browser.artifacts, "brush-report.txt"), report);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
