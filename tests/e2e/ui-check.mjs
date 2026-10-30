// Visual and layout checks through the installed playwright-cli.
import path from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import {
  createPotreeFixture,
  createLasFixture,
} from "../fixtures/generate.mjs";
const service = await startTestServer();
let browser;
try {
  browser = createBrowser("ui");
  const fixture = await createPotreeFixture(
    path.join(service.home, "pointcloud"),
  );
  const target = fixture;
  process.env.SCENELOOM_TEST_LAS = await createLasFixture(
    path.join(service.home, "sample.las"),
  );
  browser.open(service.url);
  const code = `async(page)=>{
 page.on('dialog',dialog=>dialog.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const check=(ok,message)=>{if(!ok)throw new Error(message)};
 await page.goto(${JSON.stringify(service.url)});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
 await page.getByLabel('语言',{exact:true}).selectOption('en');
 check(await page.getByRole('button',{name:'Open data',exact:true}).isVisible(),'English commands missing');
 await page.reload();check(await page.getByLabel('Language',{exact:true}).inputValue()==='en','Locale preference not restored');
 check(await page.locator('.welcome').textContent().then(text=>text.includes('3DGS')&&text.includes('3D Tiles')),'Welcome text does not describe multiple data types');
 await page.locator('.welcome').getByRole('button',{name:'Open data…',exact:true}).click();await page.getByLabel('Data path',{exact:true}).fill(${JSON.stringify(fixture)});await page.getByRole('dialog').getByRole('button',{name:'Open',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('[data-testid="visible-points"]').textContent.replaceAll(',',''))>0);
 const canvas=page.locator('canvas');await canvas.evaluate(e=>e.dataset.identity='same-runtime');
 const sizes=[[1920,1080],[1280,720],[1024,768],[768,600],[390,844]];
 for(const language of ['en','zh-CN']){
   await page.locator('.language-picker select').selectOption(language);
   check(await canvas.getAttribute('data-identity')==='same-runtime','Language switch recreated renderer');
   for(const [width,height]of sizes){
     await page.setViewportSize({width,height});
     if(width<900){for(const button of await page.locator('.layout-controls button').all()){if(await button.getAttribute('aria-expanded')==='true'&&await button.getAttribute('title')!== (language==='en'?'Collapse ribbon':'折叠功能区'))await button.click();}}
     const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,ribbon:document.querySelector('.ribbon').getBoundingClientRect().height,view:document.querySelector('[data-testid="viewport"]').getBoundingClientRect().width}));
     check(dimensions.scroll<=dimensions.width,'Horizontal page overflow: '+language+' '+width);check(dimensions.view>=280,'Viewport too narrow');check(dimensions.ribbon<=72,'Ribbon too tall');
     await page.screenshot({path:'${browser.artifacts.replaceAll("\\", "/")}/layout-'+language+'-'+width+'.png'});
   }
 }
 await page.setViewportSize({width:1280,height:720});
 for(const label of ['显示工程面板','显示属性面板']){const b=page.getByRole('button',{name:label,exact:true});if(await b.getAttribute('aria-expanded')==='false')await b.click();}
 const heightBefore=(await page.getByTestId('viewport').boundingBox()).height;await page.getByRole('button',{name:'折叠功能区',exact:true}).click();check((await page.getByTestId('viewport').boundingBox()).height>heightBefore+40,'Ribbon collapse did not free viewport space');await page.getByRole('button',{name:'展开功能区',exact:true}).click();
 await page.getByRole('button',{name:'适应视图',exact:true}).click();
 await page.waitForFunction(()=>{const count=document.querySelector('[data-testid="visible-points"]').textContent;const loading=document.querySelector('[data-testid="loading-nodes"]').textContent;const now=performance.now();const state=window.__uiSettle||{count:'',since:now};if(count!==state.count||loading!=='0'){state.count=count;state.since=now;}window.__uiSettle=state;return Number(count.replaceAll(',',''))>0&&loading==='0'&&now-state.since>1000;},{},{timeout:30000});
 await page.getByRole('button',{name:'点云渲染',exact:true}).click();
 for(const [mode,label]of [['rgb','RGB 原色'],['height','高程'],['classification','分类']]){
   await page.getByLabel('着色方式',{exact:true}).selectOption(mode);await page.waitForFunction(m=>document.querySelector('canvas').dataset.renderMode===m,mode);
   check(await page.getByLabel('着色方式',{exact:true}).inputValue()===mode,'Ribbon mode is out of sync');
   for(const enabled of [false,true]){await page.getByLabel('EDL 深度增强',{exact:true}).setChecked(enabled);await page.waitForFunction(v=>document.querySelector('canvas').dataset.edl===String(v),enabled);await canvas.screenshot({path:'${browser.artifacts.replaceAll("\\", "/")}/render-'+mode+'-'+enabled+'.png'});}
 }
 await page.getByLabel('着色方式',{exact:true}).selectOption('rgb');await page.waitForFunction(()=>document.querySelector('canvas').dataset.renderMode==='rgb');
 await page.locator('.language-picker select').selectOption('en');check(await page.getByLabel('Color mode',{exact:true}).inputValue()==='rgb','Language changed rendering state');await page.locator('.language-picker select').selectOption('zh-CN');
 await page.getByRole('button',{name:'点云编辑',exact:true}).click();await page.screenshot({path:'${browser.artifacts.replaceAll("\\", "/")}/ui-verified.png'});
 check(errors.length===0,errors.join(';'));return {passed:true,layouts:10,renderModes:3,edlVariants:6,localePersistence:true,errors};
}`;
  browser.run(code);
  function read(mode, edl) {
    return PNG.sync.read(
      readFileSync(`${browser.artifacts}/render-${mode}-${edl}.png`),
    );
  }
  function difference(a, b) {
    assert.equal(a.width, b.width);
    let total = 0;
    for (let i = 0; i < a.data.length; i += 4)
      for (let c = 0; c < 3; c++)
        total += Math.abs(a.data[i + c] - b.data[i + c]);
    return total / (a.width * a.height * 3);
  }
  const images = ["rgb", "height", "classification"].map((mode) =>
    read(mode, false),
  );
  const differences = [
    difference(images[0], images[1]),
    difference(images[1], images[2]),
    difference(images[0], images[2]),
  ];
  for (const d of differences)
    assert.ok(d > 0.1, "Color modes produced indistinguishable images");
  for (const mode of ["rgb", "height", "classification"]) {
    const off = read(mode, false),
      on = read(mode, true);
    assert.ok(difference(off, on) > 0.01, "EDL did not change the image");
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs(off.data[c] - on.data[c]) <= 2,
        "EDL changed background color/gamma",
      );
  }
  console.log(
    JSON.stringify({
      passed: true,
      layouts: 10,
      renderVariants: 6,
      pixelDifferences: differences.map((n) => Number(n.toFixed(3))),
      screenshots: browser.artifacts,
    }),
  );
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
