// Uses the installed playwright-cli without shell quoting the JavaScript payload.
// Fixtures and saved state belong to this test's isolated temporary service.
import path from "node:path";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import {
  createPotreeFixture,
  createLasFixture,
} from "../fixtures/generate.mjs";
const service = await startTestServer();
let browser;
try {
  browser = createBrowser("browser");
  const fixture = await createPotreeFixture(
    path.join(service.home, "pointcloud"),
  );
  const target = fixture;
  process.env.SCENELOOM_TEST_LAS = await createLasFixture(
    path.join(service.home, "sample.las"),
  );
  browser.open(service.url);
  const code = `async (page) => {
 await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
 page.on('dialog',dialog=>dialog.accept());const failures=[];page.on('pageerror',e=>failures.push(e.message));
 const check=(ok,message)=>{if(!ok)throw new Error(message)};
 await page.getByRole('button',{name:'打开数据',exact:true}).click();
 await page.getByLabel('数据路径').fill(${JSON.stringify(target)});
 await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('[data-testid="visible-points"]').textContent.replaceAll(',',''))>0,{},{timeout:30000});
 await page.getByRole('button',{name:'矩形',exact:true}).click();
 const box=await page.getByTestId('viewport').boundingBox();
 await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.8,{steps:12});await page.mouse.up();
 check(await page.getByRole('button',{name:'赋予类别',exact:true}).isEnabled(),'rectangle selection failed');
 const before=Number(await page.getByTestId('operation-count').textContent());
 await page.getByRole('button',{name:'赋予类别',exact:true}).click();
 check(Number(await page.getByTestId('operation-count').textContent())===before+1,'classification not added');
 await page.getByRole('button',{name:'撤销',exact:true}).click();check(Number(await page.getByTestId('operation-count').textContent())===before,'undo failed');
 await page.getByRole('button',{name:'重做',exact:true}).click();
 await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.8,{steps:8});await page.mouse.up();
 await page.getByRole('button',{name:'删除选区',exact:true}).click();
 check(Number(await page.getByTestId('operation-count').textContent())===before+2,'deletion not added');
 await page.getByRole('button',{name:'保存工程',exact:true}).last().click();
 await page.waitForFunction(()=>document.querySelector('footer').textContent.includes('工程已保存'));
 await page.getByRole('button',{name:'点云渲染',exact:true}).click();await page.getByLabel('显示点预算').selectOption('1200000');await page.getByRole('button',{name:'点云编辑',exact:true}).click();
 await page.getByRole('button',{name:'浏览',exact:true}).click();
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:12});await page.mouse.up();
 await page.reload();
 await page.getByRole('button',{name:'打开数据',exact:true}).click();await page.getByLabel('数据路径').fill(${JSON.stringify(target)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
 await page.waitForFunction(expected=>Number(document.querySelector('[data-testid="operation-count"]').textContent)===expected, before+2);
 await page.getByRole('button',{name:'选择工具',exact:true}).click();await page.getByRole('menuitemradio',{name:'多边形',exact:true}).click();
 const b=await page.getByTestId('viewport').boundingBox();
 await page.mouse.click(b.x+b.width*.3,b.y+b.height*.3);await page.mouse.click(b.x+b.width*.6,b.y+b.height*.3);await page.mouse.dblclick(b.x+b.width*.5,b.y+b.height*.6);
 check(await page.getByRole('button',{name:'赋予类别',exact:true}).isEnabled(),'polygon selection failed');
 await page.getByRole('button',{name:'浏览',exact:true}).click();
 ${process.env.SCENELOOM_TEST_LAS ? `await page.locator('.quick').getByRole('button',{name:'打开',exact:true}).click();await page.getByLabel('数据路径').fill(${JSON.stringify(process.env.SCENELOOM_TEST_LAS)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();await page.getByRole('heading',{name:'转换并打开',exact:true}).waitFor();check((await page.getByRole('dialog').textContent()).includes('.sceneloom'),'default storage missing');await page.getByRole('button',{name:'取消',exact:true}).click();` : ""}
 check(failures.length===0,failures.join(';'));
 await page.getByRole('button',{name:'点云渲染',exact:true}).click();await page.getByLabel('EDL 深度增强').uncheck();await page.getByLabel('EDL 深度增强').check();
 await page.getByLabel('着色方式').selectOption('rgb');await page.getByLabel('着色方式').selectOption('classification');
 await page.getByRole('button',{name:'点云编辑',exact:true}).click();${process.env.SCENELOOM_TEST_RESTORE === "1" ? `await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'保存工程',exact:true}).last().click();` : ""}
 await page.waitForFunction(()=>Number(document.querySelector('[data-testid="visible-points"]').textContent.replaceAll(',',''))>0);
 await page.screenshot({path:'${browser.artifacts.replaceAll("\\", "/")}/sceneloom-verified.png'});
 return {passed:true,checks:['real Potree streaming','rectangle classification','delete','undo/redo','budget and view changes','save/reopen','polygon selection','LAS conversion prompt'],operations:before+2};
}`;
  browser.run(code);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
