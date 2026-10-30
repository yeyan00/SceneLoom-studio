import path from "node:path";
import { startTestServer } from "../helpers/server.mjs";
import { createBrowser } from "../helpers/browser.mjs";
import { createPotreeFixture } from "../fixtures/generate.mjs";
const service = await startTestServer();
let browser;
try {
  const source = await createPotreeFixture(
    path.join(service.home, "ribbon-points"),
  );
  browser = createBrowser("ribbon");
  browser.open(service.url);
  browser.run(`async page => {
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.language-picker select').selectOption('en');
    await page.getByRole('heading',{name:'Turn spatial data into a world to explore.',exact:true}).waitFor();
    await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "welcome-en.png"))}});
    await page.locator('.language-picker select').selectOption('zh-CN');
    await page.getByRole('heading',{name:'让空间数据，成为可探索的世界',exact:true}).waitFor();
    await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "welcome-zh.png"))}});
    const arrow = () => page.getByRole('button',{name:'选择工具',exact:true});
    await page.getByRole('button',{name:'点云编辑',exact:true}).click();check(await arrow().isDisabled(),'Empty scene enabled selection menu');await page.getByRole('button',{name:'工程',exact:true}).click();
    await page.getByRole('button',{name:'打开数据',exact:true}).click();
    await page.getByLabel('数据路径',{exact:true}).fill(${JSON.stringify(source)});
    await page.getByRole('dialog').getByRole('button',{name:'打开',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(document.querySelector('canvas[data-diagnostics]')?.dataset.diagnostics||'{}').visiblePoints>0);
    await page.getByRole('button',{name:'工程',exact:true}).click();const large = page.locator('.ribbon').getByRole('button',{name:'打开数据',exact:true});
    const icon = await large.locator('svg').boundingBox(), text = await large.locator('span').boundingBox();
    check(icon.y+icon.height<=text.y+1,'Large button label is not below icon');
    const save = page.locator('.ribbon').getByRole('button',{name:'保存工程',exact:true});
    const saveIcon = await save.locator('svg').boundingBox(), saveText = await save.locator('span').boundingBox();
    check(saveIcon.x+saveIcon.width<=saveText.x+1,'Small button is not horizontal');
    await page.getByRole('button',{name:'点云编辑',exact:true}).click();check(await page.locator('.ribbon').getByText('工作空间',{exact:true}).count()===0,'Repeated workspace group remains');await arrow().focus();await page.keyboard.press('ArrowDown');
    await page.getByRole('menu',{name:'选择工具'}).waitFor();
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    await page.locator('.ribbon-split').getByRole('button',{name:'多边形',exact:true}).waitFor();
    check(await page.getByRole('menu').count()===0,'Selection did not close menu');
    await arrow().click();
    check(await page.getByRole('menuitemradio',{name:'多边形',exact:true}).getAttribute('aria-checked')==='true','Selected tool not remembered');
    await page.keyboard.press('Escape');
    check(await arrow().evaluate(e=>document.activeElement===e),'Escape did not restore focus');
    await arrow().click();await page.getByRole('menuitemradio',{name:'矩形',exact:true}).click();
    await arrow().click();await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "ribbon-desktop.png"))}});
    await page.getByRole('button',{name:'点云编辑',exact:true}).click();
    check(await page.getByRole('menu').count()===0,'Outside click left menu open');
    await page.setViewportSize({width:390,height:844});await arrow().scrollIntoViewIfNeeded();await arrow().click();
    const popup = await page.getByRole('menu').boundingBox();
    check(popup.x>=0 && popup.x+popup.width<=390,'Menu clipped by narrow viewport');
    await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "ribbon-mobile.png"))}});
    await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:900});
    await page.getByRole('button',{name:'林业',exact:true}).click();
    await page.screenshot({path:${JSON.stringify(path.join(browser.artifacts, "ribbon-forestry.png"))}});
    return {passed:true,checks:['bilingual slogan','mixed button layout','disabled menu','keyboard selection','remembered tool','Escape focus','outside click','unclipped mobile menu','forestry plugin']};
  }`);
} finally {
  try {
    browser?.close();
  } finally {
    await service.close();
  }
}
