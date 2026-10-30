import path from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { createGaussianFixture } from "../fixtures/gaussian.mjs";
import { downloadGaussianSample } from "../fixtures/download-gaussian.mjs";
const service = await startTestServer();
let browser;
try {
  const gaussian = process.argv.includes("--public")
    ? await downloadGaussianSample()
    : await createGaussianFixture(path.join(service.home, "reference.ply"));
  const original = await readFile(gaussian);
  const response = await fetch(service.url + "/api/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: gaussian }),
  });
  assert.equal(response.status, 200);
  browser = createBrowser("gaussian");
  browser.open(service.url);
  const report = browser.run(`async(page)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{window.showDirectoryPicker=undefined;window.showSaveFilePicker=undefined;});
    await page.setViewportSize({width:1600,height:1000});await page.reload();
    await page.getByRole('tab',{name:/\\.ply/}).click();
    const host=page.locator('.gaussian-viewport');
    const state=()=>host.evaluate(h=>JSON.parse(h.dataset.diagnostics||'{}'));
    const wait=async predicate=>{for(let i=0;i<160;i++){const s=await state();if(predicate(s))return s;await page.waitForTimeout(250);}throw new Error('GS state timeout: '+JSON.stringify(await state())+' '+await page.locator('.gaussian-workspace').innerText());};
    const initial=await wait(d=>d.ready);if(await page.locator('iframe').count())throw new Error('Unexpected iframe');
    const canvas=host.locator('canvas[data-gaussian]');const box=await canvas.boundingBox();
    await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down({button:'middle'});
    for(let i=0;i<60;i++)await page.mouse.move(box.x+box.width*(.5+.12*i/60),box.y+box.height*(.5+.03*Math.sin(i/12)));
    await page.mouse.up({button:'middle'});await page.waitForTimeout(200);
    const motion=await state();const intervals=motion.renderIntervals.slice().sort((a,b)=>a-b);const performance={loadMs:initial.loadMs,firstFrameMs:initial.firstFrameMs,frames:intervals.length,p95Ms:intervals[Math.floor(intervals.length*.95)],maxMs:intervals.at(-1),gpu:initial.gpu,width:initial.width,height:initial.height};
    if(intervals.length<5)throw new Error('No measured camera motion');
    await page.locator('.gaussian-tools button').first().click();await page.waitForTimeout(300);
    await host.locator('#bottom-toolbar-picker').click();
    await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.8,{steps:12});await page.mouse.up();
    const selection=await wait(d=>d.selected>0);
    await page.keyboard.press('Delete');const removed=await wait(d=>d.deleted>0);
    await host.locator('#bottom-toolbar-undo').click();await wait(d=>d.deleted===0&&d.canRedo);
    await host.locator('#bottom-toolbar-redo').click();await wait(d=>d.deleted===removed.deleted);
    await host.locator('#bottom-toolbar-undo').click();await wait(d=>d.deleted===0);
    await host.locator('#bottom-toolbar-brush').click();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55,{steps:6});await page.mouse.up();await wait(d=>d.selected>0);
    await page.keyboard.press('Delete');const exportState=await wait(d=>d.deleted>0);
    const toggles=page.locator('.gaussian-tools input[type=checkbox]');await toggles.nth(2).check();await wait(d=>d.display.rings);await toggles.nth(2).uncheck();
    await page.getByRole('button',{name:/GS$/}).click();await host.locator('#export-popup').waitFor({state:'visible'});
    const download=page.waitForEvent('download');await host.locator('#export-popup .button').last().click();const exported=await download;await exported.saveAs(${JSON.stringify(path.join(browser.artifacts, "native-export.ply"))});
    if(${!process.argv.includes("--public")})for(const format of ['splat','sog','spz']){await page.locator('.gaussian-tools select').selectOption(format);await page.getByRole('button',{name:/GS$/}).click();await host.locator('#export-popup').waitFor({state:'visible'});const pending=page.waitForEvent('download',{timeout:60000});await host.locator('#export-popup .button').last().click();const file=await pending;await file.saveAs(${JSON.stringify(browser.artifacts.replaceAll("\\", "/") + "/native-export.")}+format);await page.waitForTimeout(200);}
    await page.waitForTimeout(600);await page.locator('.gaussian-tools button').nth(1).click();
    await host.locator('#export-popup').waitFor({state:'visible'});const projectDownload=page.waitForEvent('download');await host.locator('#export-popup .button').last().click();const project=await projectDownload;await project.saveAs(${JSON.stringify(path.join(browser.artifacts, "native-project.ssproj"))});
    await wait(d=>!d.dirty);
    await page.getByRole('tab').first().click();await page.waitForTimeout(100);const hidden=await state();await page.waitForTimeout(350);if((await state()).frames!==hidden.frames)throw new Error('Hidden editor is rendering');
    await page.getByRole('tab',{name:/\\.ply/}).click();await wait(d=>d.active);
    await host.locator('#bottom-toolbar-picker').click();await page.mouse.click(box.x+box.width*.6,box.y+box.height*.5);await page.keyboard.press('Control+a');await wait(d=>d.dirty);
    await page.locator('.scene-tab .close-view').click();const closeDialog=page.getByRole('dialog');await closeDialog.waitFor({state:'visible'});await closeDialog.getByRole('button').first().click();if(!await host.isVisible())throw new Error('Dirty close guard failed');
    for(let i=0;i<3&&(await state()).dirty;i++){await host.locator('#bottom-toolbar-undo').click();await page.waitForTimeout(100);}await wait(d=>!d.dirty);
    await page.locator('.scene-tab .close-view').click();await host.waitFor({state:'detached'});await page.waitForTimeout(600);
    if(errors.length)throw new Error(errors.join(';'));
    return {initial,selection,removed,exportState,performance,errors};
  }`);
  await writeFile(path.join(browser.artifacts, "gaussian-report.txt"), report);
  assert.deepEqual(await readFile(gaussian), original, "source data changed");
  const exported = await readFile(
    path.join(browser.artifacts, "native-export.ply"),
  );
  const count = Number(
    /element vertex (\d+)/.exec(exported.subarray(0, 65536).toString())[1],
  );
  assert.ok(
    count > 0 && count < (process.argv.includes("--public") ? 90854 : 512),
    "Export did not apply deletion",
  );
  for (const name of ["splat", "sog", "spz"]) {
    if (!process.argv.includes("--public"))
      assert.ok(
        (await readFile(path.join(browser.artifacts, "native-export." + name)))
          .length > 50,
        name + " export is empty",
      );
  }
  const projectPath = path.join(browser.artifacts, "native-project.ssproj");
  const saved = await fetch(service.url + "/api/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: projectPath }),
  });
  assert.equal(saved.status, 200);
  browser.run(
    `async(page)=>{await page.reload();await page.getByRole('tab',{name:/ssproj/}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('.gaussian-viewport')?.dataset.diagnostics||'{}').ready,null,{timeout:60000});const host=page.locator('.gaussian-viewport');const s=await host.evaluate(h=>JSON.parse(h.dataset.diagnostics));if(s.count>=${process.argv.includes("--public") ? 90854 : 512}||s.count===0)throw new Error('Saved project did not preserve deletion');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "gaussian-native-editor.png"))}});await page.locator('.language-picker select').selectOption('en');await page.getByRole('button',{name:'Save GS project',exact:true}).waitFor();await page.setViewportSize({width:540,height:900});for(const name of ['Toggle explorer','Toggle properties']){const b=page.getByRole('button',{name,exact:true});if(await b.getAttribute('aria-expanded')==='true')await b.click();}await page.waitForTimeout(300);const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));if(layout.scroll>layout.width+2)throw new Error('GS mobile page overflows');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "gaussian-native-mobile.png"))}});return {...s,layout};}`,
  );
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
