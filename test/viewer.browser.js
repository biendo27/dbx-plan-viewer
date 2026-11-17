import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { plan } from './fixtures.js';
const html = await readFile(new URL('../ui/index.html',import.meta.url),'utf8');
async function open(page, context) {
 await page.addInitScript(() => {});
 await page.setContent(html.replace('<script>', () => `<script>window.dbxPlugin={ready:Promise.resolve(${JSON.stringify(context || {}).replace(/</g,'\\u003c')}),onContext(cb){window.refreshContext=cb}};</script><script>`));
}
async function paste(page, xml = plan) { await page.getByRole('button',{name:'Paste XML',exact:true}).click(); await page.locator('#xml-input').fill(xml); await page.locator('#paste-form').getByRole('button',{name:'View Plan',exact:true}).click(); }
test('paste, nested statements, local properties, XML, keyboard selection, zoom and pan',async ({page}) => {
 await open(page); await paste(page); await expect(page.locator('.node')).toHaveCount(2);
 await page.locator('.node').first().focus(); await page.keyboard.press('Enter'); await expect(page.locator('#properties')).toContainText('IX_Items');
 await page.locator('.node').last().click(); await expect(page.locator('#properties')).toContainText('parent predicate'); await expect(page.locator('#properties')).not.toContainText('IX_Items');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click(); await expect(page.locator('#zoom-level')).not.toHaveText('100%');
 const before = await page.locator('#graph-layer').getAttribute('transform'); await page.locator('#canvas').focus(); await page.keyboard.press('ArrowRight'); expect(await page.locator('#graph-layer').getAttribute('transform')).not.toBe(before);
 await page.getByRole('button',{name:'Source XML',exact:true}).click(); await expect(page.locator('#xml-view')).toHaveText(plan);
 await page.locator('#statement-choice').selectOption('1'); await page.getByRole('button',{name:'Diagram',exact:true}).click(); await expect(page.locator('#no-operators')).toBeVisible();
 await page.locator('#statement-choice').selectOption('2'); await expect(page.locator('.node')).toHaveCount(1);
});
test('context refresh handles all cells and truncation; invalid new input clears old graph',async ({page}) => {
 await open(page,{result:{columns:['plan'],rows:[[plan],[plan]],truncated:true}});
 await expect(page.locator('#plan-choice option')).toHaveCount(2); await expect(page.locator('#notice')).toContainText('500');
 await paste(page,'<broken>'); await expect(page.locator('#notice')).toContainText('Invalid'); await expect(page.locator('.node')).toHaveCount(0);
 await page.evaluate(xml => window.refreshContext({result:{columns:['plan'],rows:[[xml]],truncated:false}}),plan); await expect(page.locator('.node')).toHaveCount(2);
 await page.evaluate(() => window.refreshContext({result:{columns:[],rows:[],truncated:false}})); await expect(page.locator('#viewer')).toBeHidden(); await expect(page.locator('#notice')).toContainText('No ShowPlan');
});
test('bad first result cell leaves later plans selectable and file import works',async ({page}) => {
 await open(page,{result:{columns:['p'],rows:[['<ShowPlanXML'],[plan]]}}); await page.locator('#plan-choice').selectOption('1'); await expect(page.locator('.node')).toHaveCount(2);
 await page.locator('#file').setInputFiles({name:'synthetic.sqlplan',mimeType:'application/xml',buffer:Buffer.from(plan)}); await expect(page.locator('#plan-choice')).toContainText('synthetic.sqlplan');
});
for (const width of [375,768,1440]) test(`theme and layout at ${width}px`,async ({page}) => {
 await page.setViewportSize({width,height:900}); await open(page); await paste(page);
 for (const theme of ['light','dark']) { await page.evaluate(t => document.documentElement.dataset.dbxTheme=t,theme); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); const bg = await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor); expect(bg).toBe(theme === 'dark' ? 'rgb(19, 26, 36)' : 'rgb(245, 247, 250)'); await page.screenshot({path:`test-results/viewer-${width}-${theme}.png`,fullPage:true}); }
});
test('treats SQL and property markup as text and preserves source dollar sequences',async ({page}) => {
 await open(page); const xml = plan.replace('SELECT synthetic',() => 'SELECT $&amp; &lt;img src=x onerror=alert(1)&gt;'); await paste(page,xml);
 await page.locator('.sql-preview summary').click(); await expect(page.locator('#statement-sql')).toHaveText('SELECT $& <img src=x onerror=alert(1)>'); await expect(page.locator('#statement-sql img')).toHaveCount(0);
 await page.getByRole('button',{name:'Paste XML',exact:true}).hover(); await page.getByRole('button',{name:'Paste XML',exact:true}).click(); await expect(page.locator('#paste-dialog')).toBeVisible(); await page.screenshot({path:'test-results/paste-overlay.png'}); await page.getByRole('button',{name:'Cancel',exact:true}).click();
});
