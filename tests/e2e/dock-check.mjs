import { writeFile } from "node:fs/promises";
import path from "node:path";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
const service = await startTestServer({
  tools: async (plugins) => {
    await writeFile(
      path.join(plugins, "check.json"),
      JSON.stringify({
        id: "test.echo",
        title: "EXE echo check",
        description: "A registered process used by the browser test",
        category: ["自动处理", "点云处理"],
        executable: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1])", "{message}"],
        parameters: [
          {
            id: "message",
            label: "Message",
            type: "text",
            required: true,
            default: "browser-task-ok",
          },
        ],
      }),
    );
  },
});
let browser;
try {
  browser = createBrowser("dock");
  browser.open(service.url);
  const code = `async(page)=>{
 page.on('dialog',dialog=>dialog.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));const check=(ok,message)=>{if(!ok)throw new Error(message)};
 await page.setViewportSize({width:1280,height:720});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
 check(await page.getByRole('region',{name:'日志面板',exact:true}).count()===0,'Log panel should be hidden by default');
 const before=(await page.getByTestId('viewport').boundingBox()).height;
 await page.getByRole('button',{name:'视图',exact:true}).click();await page.getByRole('button',{name:'工具箱面板',exact:true}).click();check(await page.getByRole('tab',{name:'属性',exact:true}).count()===0,'Toolbox opened properties');check(await page.getByRole('tab',{name:'单木',exact:true}).count()===0,'Toolbox opened forestry');
 check(await page.getByRole('tab',{name:'工具箱',exact:true}).getAttribute('aria-selected')==='true','Toolbox tab not selected');
 check((await page.getByTestId('viewport').boundingBox()).height===before,'Toolbox stole viewport height');
 const right=await page.locator('.right-panel').boundingBox();check(right.x+right.width===1280,'Toolbox is not on the right edge');
 await page.locator('.tool-drawer>summary').filter({hasText:'格式转换'}).click();await page.getByRole('treeitem').filter({hasText:'Potree 转换'}).waitFor();
 await page.getByRole('treeitem').filter({hasText:'Potree 转换'}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 await page.locator('.tool-drawer>summary').filter({hasText:'自动处理'}).click();
 const tool=page.getByRole('treeitem').filter({hasText:'EXE echo check'});await tool.waitFor();
 check((await page.locator('[aria-level]').evaluateAll(list=>list.map(e=>Number(e.getAttribute('aria-level'))))).every(n=>n<=3),'Tool tree exceeded three levels');
 await tool.click();await page.getByLabel('Message',{exact:true}).fill('browser-task-ok');await page.getByRole('button',{name:'运行工具',exact:true}).click();
 await page.locator('.task-card').filter({hasText:'已完成'}).waitFor({timeout:15000});check((await page.locator('.task-card').textContent()).includes('browser-task-ok'),'EXE stdout missing');
 check(await page.getByRole('alert').count()===0,'Generic EXE completion caused an application error');
 await page.locator('.task-history .task-card[data-status="succeeded"]').waitFor({state:'attached',timeout:10000});check(await page.locator('.tasks-content > .task-card').count()===0,'Completed task did not archive');await page.locator('.task-history > summary').click();check((await page.locator('.task-history .task-card').textContent()).includes('browser-task-ok'),'Archived task lost its log');
 await page.getByRole('button',{name:'显示属性面板',exact:true}).click();check(await page.getByRole('tab',{name:'属性',exact:true}).getAttribute('aria-selected')==='true','Properties did not open');check(await page.getByText('数据概览',{exact:true}).isVisible(),'Data properties missing');await page.getByRole('tab',{name:'工具箱',exact:true}).click();check(await tool.isVisible(),'Drawer state was lost on tab switch');
 await page.getByLabel('搜索工具…',{exact:true}).fill('Potree');check(await page.getByRole('treeitem').filter({hasText:'Potree 转换'}).isVisible(),'Tool search did not open matching path');check(await page.getByRole('treeitem').filter({hasText:'EXE echo check'}).count()===0,'Tool search did not filter');await page.getByLabel('搜索工具…',{exact:true}).fill('');
 await page.evaluate(()=>fetch('/api/logs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({level:'warn',message:'hidden-panel-marker'})}));
 await page.getByRole('button',{name:'日志',exact:true}).click();await page.getByLabel('搜索日志',{exact:true}).fill('hidden-panel-marker');await page.locator('.log-message').filter({hasText:'hidden-panel-marker'}).waitFor();
 await page.getByLabel('日志级别',{exact:true}).selectOption('warn');await page.locator('.log-message').filter({hasText:'hidden-panel-marker'}).waitFor();
 const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'导出日志',exact:true}).click();const download=await downloadEvent;check(download.suggestedFilename()==='sceneloom-logs.jsonl','Log export missing');
 await page.getByLabel('关闭日志面板',{exact:true}).click();check((await page.getByTestId('viewport').boundingBox()).height===before,'Closing logs did not restore viewport');
 await page.getByRole('button',{name:'日志',exact:true}).click();await page.getByLabel('搜索日志',{exact:true}).fill('');await page.getByLabel('日志级别',{exact:true}).selectOption('');
 await page.screenshot({path:'${browser.artifacts.replaceAll("\\", "/")}/dock-desktop.png'});
 await page.getByLabel('关闭日志面板',{exact:true}).click();await page.locator('.language-picker select').selectOption('en');check(await page.getByRole('tab',{name:'Toolbox',exact:true}).isVisible(),'Dock translation missing');
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Dock overflowed narrow layout');await page.screenshot({path:'${browser.artifacts.replaceAll("\\", "/")}/dock-mobile.png'});
 await page.getByRole('button',{name:'Close Toolbox panel',exact:true}).click();await page.getByRole('button',{name:'Logs',exact:true}).click();check(await page.getByRole('region',{name:'Log panel',exact:true}).isVisible(),'Mobile logs unavailable');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Logs overflowed narrow layout');
 check(errors.length===0,errors.join(';'));return{passed:true,checks:['right dock tabs','drawer tree depth','tool search','registered EXE execution','hidden persistent logs','filter/export','mobile layout'],errors};
 }`;

  browser.run(code);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
