import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const origin = `http://127.0.0.1:${process.argv[2] || 4317}`;
const out = path.resolve(process.argv[3] || 'screenshots');
fs.mkdirSync(out,{recursive:true});
const browser = await chromium.launch({headless:true});
try {
  for (const [name,width,height] of [['desktop',1440,1100],['mobile',390,844]]) {
    const page = await browser.newPage({viewport:{width,height}});
    const errors = [];
    page.on('pageerror',e => errors.push(e.message));
    await page.goto(`${origin}/hub-preview`);
    await page.waitForSelector('.hu-kpis');
    await page.locator('[data-range="24h"]').click();
    await page.waitForFunction(() => document.querySelector('#hu-status').textContent === '');
    await page.locator('[data-range="30d"]').click();
    await page.waitForFunction(() => document.querySelector('#hu-status').textContent === '');
    await page.locator('[data-range="7d"]').click();
    await page.waitForFunction(() => document.querySelector('#hu-status').textContent === '');
    const select = page.locator('#hu-provider');
    const options = await select.locator('option').allTextContents();
    if (options.length > 1) {
      await select.selectOption({index:1});
      await page.waitForFunction(() => document.querySelector('#hu-status').textContent === '');
      await select.selectOption('');
      await page.waitForFunction(() => document.querySelector('#hu-status').textContent === '');
    }
    await page.locator('[data-sort="inputTokens"]').click();
    if (await page.locator('[data-bucket]').count()) {
      await page.locator('[data-bucket]').first().focus();
      if (await page.locator('.hu-tooltip').isHidden()) throw new Error('Chart tooltip did not open on focus');
      await page.locator('#hu-refresh').focus();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow || errors.length) throw new Error(JSON.stringify({name,overflow,errors}));
    await page.screenshot({path:path.join(out,`hub-usage-${name}.png`),fullPage:true});
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await page.screenshot({path:path.join(out,`hub-usage-${name}-light.png`),fullPage:true});
    console.log(`${name}: ranges, provider filter, sorting, focus tooltip, no viewport overflow, no page errors PASS; ${options.length - 1} providers`);
    await page.close();
  }
} finally {await browser.close();}
