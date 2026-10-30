import path from "node:path";
import { writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { createForestFixture } from "../fixtures/generate.mjs";
const service = await startTestServer();
let browser;
try {
  const source = await createForestFixture(path.join(service.home, "forest"));
  browser = createBrowser("labels");
  browser.open(service.url);
  const report = browser.run(`async(page)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));const check=(ok,msg)=>{if(!ok)throw new Error(msg)},button=name=>page.getByRole('button',{name,exact:true}).first();
    await page.setViewportSize({width:1600,height:1000});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
    await button('打开数据').click();await page.getByLabel('数据路径').fill(${JSON.stringify(source)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
    const settle=()=>page.waitForFunction(()=>{const c=document.querySelector('canvas[data-diagnostics]');if(!c)return false;const d=JSON.parse(c.dataset.diagnostics);return d.settled&&d.loading===0&&d.visiblePoints>0;});await settle();
    await button('点云编辑').click();await button('管理标签集').click();const dialog=page.getByRole('dialog');check(await dialog.getByLabel('标签集名称',{exact:true}).isDisabled(),'built-in editable');check(await dialog.getByRole('listitem',{name:'0 Created, never classified',exact:true}).count()===1,'wrong LAS zero name');
    await dialog.getByRole('button',{name:'新建标签集',exact:true}).click();await dialog.getByLabel('标签集名称',{exact:true}).fill('City project A');
    const add=async(id,name,aliases,semantic)=>{await dialog.getByRole('button',{name:'新增类别',exact:true}).click();await dialog.getByLabel('类别 ID',{exact:true}).fill(String(id));await dialog.getByLabel('正式名称',{exact:true}).fill(name);await dialog.getByLabel('别名',{exact:true}).fill(aliases);await dialog.getByLabel('算法语义',{exact:true}).selectOption(semantic);await dialog.getByRole('button',{name:'保存类别定义',exact:true}).click();};
    await add(2,'Building','建筑,house','building');await add(42,'Terrain','地面','ground');await add(5,'Canopy','树冠','vegetation');
    await dialog.getByLabel('搜索类别名称、别名或 ID',{exact:true}).fill('house');check(await dialog.getByRole('listitem').count()===1,'alias search failed');await dialog.getByLabel('搜索类别名称、别名或 ID',{exact:true}).fill('');
    await dialog.getByRole('button',{name:'保存到标签库',exact:true}).click();await dialog.getByText('标签集已保存到本机标签库',{exact:true}).waitFor();
    const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'导出 JSON',exact:true}).click();const download=await downloadEvent;await download.saveAs(${JSON.stringify(path.join(browser.artifacts, "labels-export.json"))});
    await dialog.getByRole('button',{name:'应用到当前工程',exact:true}).click();check(await page.getByTestId('operation-count').textContent()==='0','definition switched point IDs');
    await page.getByLabel('搜索点云类别',{exact:true}).fill('house');check(await page.locator('.class-list button').count()===1,'sidebar alias search failed');check((await page.locator('.class-list button').textContent()).includes('Building'),'canonical name lost');await page.getByLabel('搜索点云类别',{exact:true}).fill('');
    await page.locator('.class-list button').filter({hasText:'Terrain'}).click();await button('矩形').click();const box=await page.getByTestId('view-main').boundingBox();await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.8,{steps:5});await page.mouse.up();await button('赋予类别').click();await settle();
    await button('保存工程').last().click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-state"]').textContent==='已保存');
    const saved=await page.evaluate(async source=>(await(await fetch('/api/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:source})})).json()).dataset,${JSON.stringify(source)});
    check(saved.session.operations[0].category===42,'classification used wrong label ID');check(saved.session.labelSet.classes.find(c=>c.id===2).semantic==='building','ID2 semantic not preserved');
    await button('管理标签集').click();await dialog.getByRole('button',{name:'删除库中模板',exact:true}).click();await dialog.getByText('模板已删除，工程副本保留',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'新建标签集',exact:true}).click();await dialog.getByLabel('导入标签集文件',{exact:true}).setInputFiles(${JSON.stringify(path.join(browser.artifacts, "labels-export.json"))});await dialog.getByText('已导入草稿，确认后应用到工程',{exact:true}).waitFor();check(await dialog.getByLabel('标签集名称',{exact:true}).inputValue()==='City project A','JSON roundtrip failed');
    await dialog.getByRole('listitem',{name:'2 Building',exact:true}).click();await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "labels-desktop.png"))}});
    await dialog.getByRole('button',{name:'关闭类别编辑',exact:true}).click();await dialog.getByRole('button',{name:'应用到当前工程',exact:true}).click();
    await page.reload();await button('打开数据').click();await page.getByLabel('数据路径').fill(saved.projectPath);await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();await settle();await button('点云编辑').click();check((await page.locator('.label-set-summary').textContent()).includes('City project A'),'project depends on deleted library');
    await page.locator('.language-picker select').selectOption('en');await button('Manage label sets').click();await dialog.getByRole('listitem',{name:'2 Building',exact:true}).click();await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page overflow');check(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth),'mobile dialog overflow');await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "labels-mobile.png"))}});
    check(errors.length===0,errors.join(';'));return {passed:true,checks:['LAS defaults/read-only','new label sets','canonical names/aliases/semantics','alias search','library save/delete','JSON import/export','numeric classification','project snapshot/reopen','English/mobile'],errors};
  }`);
  await writeFile(path.join(browser.artifacts, "labels-report.txt"), report);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
