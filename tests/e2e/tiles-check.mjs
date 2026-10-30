import path from "node:path";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { downloadTilesSample } from "../fixtures/download-tiles.mjs";
import { createTilesFixture, createWideTilesFixture } from "../fixtures/tiles.mjs";
const service = await startTestServer();
let browser;
try {
  const paths = await Promise.all([
    createTilesFixture(path.join(service.home, "legacy-b3dm")),
    createTilesFixture(path.join(service.home, "modern-glb"), { b3dm: false }),
    createTilesFixture(path.join(service.home, "implicit-glb"), {
      b3dm: false,
      implicit: true,
    }),
    createWideTilesFixture(path.join(service.home, "wide-branches")),
  ]);
  for (const source of paths) {
    const r = await fetch(service.url + "/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: source }),
    });
    assert.equal(r.status, 200);
  }
  browser = createBrowser("tiles");
  browser.open(service.url);
  browser.run(`async(page)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1600,height:1000});
    const states=[];const host=()=>page.locator('.scene-view-pane:not([hidden]) .tiles-viewport');
    const ready=()=>page.waitForFunction(()=>{const h=document.querySelector('.scene-view-pane:not([hidden]) .tiles-viewport');const s=JSON.parse(h?.dataset.diagnostics||'{}');return s.ready&&s.visible>0&&s.triangles>0;},null,{timeout:30000});
    for(const name of ['legacy-b3dm','modern-glb','implicit-glb','wide-branches']){
      await page.getByRole('tab',{name:new RegExp(name)}).click();await ready();const state=await host().evaluate(h=>JSON.parse(h.dataset.diagnostics));if(Math.abs(state.origin[0]-6378137)>1)throw new Error('ECEF origin not rebased');
      const box=await host().boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.55,{steps:12});await page.mouse.up();await page.waitForTimeout(500);
      const moved=await host().evaluate(h=>JSON.parse(h.dataset.diagnostics));if(JSON.stringify(moved.position)===JSON.stringify(state.position))throw new Error('Camera did not orbit');
      await page.locator('.scene-view-pane:not([hidden]) input[type=checkbox]').check();await page.waitForTimeout(250);if(!await host().evaluate(h=>JSON.parse(h.dataset.diagnostics).wireframe))throw new Error('Wireframe failed');await page.locator('.scene-view-pane:not([hidden]) input[type=checkbox]').uncheck();
      await page.locator('.scene-view-pane:not([hidden]) .workspace-tools button').first().click();await page.waitForTimeout(350);
      await host().locator('canvas').screenshot({path:${JSON.stringify(path.join(browser.artifacts, "tiles-"))}+name+'.png'});states.push(moved);
      await page.getByRole('tab').first().click();await page.waitForTimeout(200);const hidden=await page.locator('.tiles-viewport').last().evaluate(h=>JSON.parse(h.dataset.diagnostics));await page.waitForTimeout(300);const after=await page.locator('.tiles-viewport').last().evaluate(h=>JSON.parse(h.dataset.diagnostics));if(hidden.frames!==after.frames)throw new Error('Hidden tiles still rendering');
    }
    await page.reload();await page.getByRole('tab',{name:/modern-glb/}).click();await ready();await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "tiles-desktop.png"))}});
    await page.locator('.language-picker select').selectOption('en');await page.getByLabel('Wireframe',{exact:true}).waitFor();await page.setViewportSize({width:540,height:900});await page.waitForTimeout(300);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw new Error('Mobile overflow');
    await page.locator('.scene-tab').filter({has:page.getByRole('tab',{name:/modern-glb/})}).locator('.close-view').click();await page.waitForTimeout(500);if(errors.length)throw new Error(errors.join(';'));return {passed:true,states,errors};
  }`);
  for (const name of ["legacy-b3dm", "modern-glb", "implicit-glb", "wide-branches"]) {
    const png = PNG.sync.read(
      await readFile(path.join(browser.artifacts, "tiles-" + name + ".png")),
    );
    let green = 0;
    for (let i = 0; i < png.data.length; i += 4)
      if (
        png.data[i + 1] > png.data[i] * 1.5 &&
        png.data[i + 1] > png.data[i + 2] * 1.3
      )
        green++;
    assert.ok(green > 1000, "Blank tiles rendering: " + name);
  }
  if (process.argv.includes("--public")) {
    const source = await downloadTilesSample();
    const response = await fetch(service.url + "/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: source }),
    });
    assert.equal(response.status, 200);
    browser.run(
      `async(page)=>{await page.setViewportSize({width:1600,height:1000});await page.reload();await page.getByRole('tab',{name:/tiles-dragon/}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('.scene-view-pane:not([hidden]) .tiles-viewport')?.dataset.diagnostics||'{}').triangles>0,null,{timeout:60000});await page.getByLabel('LOD error',{exact:true}).selectOption('2');const area=await page.locator('.scene-view-pane:not([hidden]) .tiles-viewport').boundingBox();await page.mouse.move(area.x+area.width*.5,area.y+area.height*.5);await page.mouse.wheel(0,-3000);await page.waitForFunction(()=>JSON.parse(document.querySelector('.scene-view-pane:not([hidden]) .tiles-viewport')?.dataset.diagnostics||'{}').loaded>=2,null,{timeout:30000});const host=page.locator('.scene-view-pane:not([hidden]) .tiles-viewport');const stats=await host.evaluate(h=>JSON.parse(h.dataset.diagnostics));if(stats.loaded<2)throw new Error('Public sample LOD did not refine');await page.locator('.scene-view-pane:not([hidden]) .workspace-tools button').first().click();await page.waitForTimeout(500);await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "tiles-public.png"))}});return {publicSample:stats};}`,
    );
  }
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
