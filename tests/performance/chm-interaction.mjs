import path from "node:path";
import { writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
const source = process.env.SCENELOOM_CHM_POTREE;
if (!source)
  throw new Error(
    "Set SCENELOOM_CHM_POTREE and SCENELOOM_CHM_REGION (dataset-local JSON region)",
  );
const scope = JSON.parse(process.env.SCENELOOM_CHM_REGION);
const service = await startTestServer();
let browser;
try {
  const { dataset: ds } = await service.api("/open", { path: source });
  const base = `/datasets/${ds.id}`;
  const job = await service.api(base + "/chm", {
    operations: [],
    scope,
    policy: "unassigned",
    valueType: "uint16",
    parameters: {},
  });
  let result;
  for (let i = 0; i < 1800; i++) {
    result = await service.api(base + "/chm/" + job.id);
    if (result.status !== "running") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (result.status !== "succeeded")
    throw new Error(result.error || result.status);
  const { command } = await service.api(base + "/chm/" + job.id + "/apply", {});
  const [x, y, z] = scope.center;
  const workspace = {
    ...ds.session.workspace,
    region: scope,
    single: true,
    maximized: "main",
    cameras: {
      main: {
        position: [x, y - 160, z + 180],
        target: [x, y, z],
        up: [0, 0, 1],
        zoom: 1,
        locked: false,
      },
    },
  };
  await service.api(base + "/save", {
    ...ds.session,
    sourceRevision: ds.revision,
    operations: [command],
    cursor: 1,
    workspace,
  });
  browser = createBrowser("chm-interaction");
  browser.open(service.url);
  const report = browser.run(`async(page)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true}).first();
    await page.setViewportSize({width:1600,height:1000});await page.evaluate(()=>localStorage.setItem('sceneloom.locale','zh-CN'));await page.reload();
    await button('打开数据').click();await page.getByLabel('数据路径').fill(${JSON.stringify(ds.projectPath)});await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
    const settle=()=>page.waitForFunction(()=>{const c=document.querySelector('canvas[data-diagnostics]');if(!c)return false;const d=JSON.parse(c.dataset.diagnostics);return d.settled&&d.loading===0&&d.visiblePoints>0;});await settle();
    await button('林业').click();await button('新建单木').click();await page.getByRole('listitem').last().waitFor();await page.getByLabel('归属策略',{exact:true}).selectOption('replace');await settle();
    await button('单木画刷').click();const box=await page.getByTestId('view-main').boundingBox(),x=box.x+box.width*.4,y=box.y+box.height*.5;
    await page.mouse.move(x,y);await page.mouse.down();for(let i=0;i<50;i++){await page.mouse.move(x+box.width*.25*i/49,y+Math.sin(i/6)*30);await page.waitForTimeout(10);}await page.waitForTimeout(100);await page.mouse.up();await settle();
    const frames=await page.evaluate(()=>JSON.parse(document.querySelector('canvas[data-diagnostics]').dataset.brushMetrics||'[]'));
    if(!frames.length)throw new Error('No brush feedback');const sorted=frames.map(f=>f.latencyMs).sort((a,b)=>a-b);
    await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "chm-interaction.png"))}});
    if(errors.length)throw new Error(errors.join(';'));
    return {passed:true,sourcePoints:${ds.metadata.points},chmCrowns:${command.trees.length},chmCommandBytes:${Buffer.byteLength(JSON.stringify(command))},feedback:{samples:sorted.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),targetMs:50},errors};
  }`);
  await writeFile(
    path.join(browser.artifacts, "chm-interaction-report.txt"),
    report,
  );
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
