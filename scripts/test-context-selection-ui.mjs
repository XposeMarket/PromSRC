import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const code = await fs.readFile('web-ui/src/context-selection.js','utf8');
const browser = await chromium.launch({headless:true});
try {
  for (const width of [320,390,1280]) {
    const page = await browser.newPage({viewport:{width,height:1000}});
    await page.route('http://context.test/**', async route => {
      if (route.request().url().endsWith('/context-selection.js')) return route.fulfill({contentType:'text/javascript',body:code});
      await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>:root{--prom-text:#e5e7eb;--prom-border:#555;--prom-warning:#d9b970}body{margin:12px;background:#171819;color:#e5e7eb;font:14px system-ui}select,input,button{font:inherit;padding:8px;border:1px solid #666;border-radius:6px}option{color:#111}</style></head><body><main id="root"></main><script type="module">import{renderContextSelection,wireContextSelection}from'/context-selection.js';const p={providerId:'openai_codex',model:'gpt-6.1-sol',contextWindowTokens:272000,standardContextWindowTokens:272000,maxContextWindowTokens:872000,contextSelectionMode:'standard',source:'known_table',contextUsageWarning:'Extended context may consume more subscription allowance. GPT-5.4 documents 2x above 272k; GPT-6 multiplier not verified.'};const r=document.querySelector('#root');r.innerHTML=renderContextSelection(p,{compactionTriggerTokens:225136});wireContextSelection(r,p,async x=>{window.saved=x;},null);window.ready=true;</script></body></html>`});
    });
    await page.goto('http://context.test/');await page.waitForFunction(()=>window.ready);
    await page.selectOption('#context-choice-mode','maximum');
    assert.equal(await page.locator('#context-choice-save').isDisabled(),true);
    await page.check('#context-choice-ack');
    assert.equal(await page.locator('#context-choice-save').isDisabled(),false);
    await page.click('#context-choice-save');
    await page.waitForFunction(()=>window.saved?.mode==='maximum');
    assert.equal((await page.evaluate(()=>window.saved)).extendedAcknowledged,true);
    assert.equal(await page.locator('select').count(),2);
    assert.equal(await page.getByText('Capacity source:',{exact:false}).count(),0);
    await page.uncheck('#context-choice-ack');
    await page.selectOption('#context-choice-mode','500k');
    assert.equal(await page.locator('#context-choice-tokens').inputValue(),'500000');
    assert.equal(await page.locator('#context-choice-save').isDisabled(),true);
    await page.check('#context-choice-ack');await page.click('#context-choice-save');
    await page.waitForFunction(()=>window.saved?.mode==='custom'&&window.saved?.tokens===500000);
    await page.selectOption('#context-choice-mode','custom'); await page.selectOption('#context-choice-tokens','64000');
    await page.click('#context-choice-save');await page.waitForFunction(()=>window.saved?.tokens===64000);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`no overflow at ${width}`);
    const dir=process.env.CONTEXT_SCREENSHOT_DIR || 'artifacts/context-selection';await fs.mkdir(dir,{recursive:true});
    await page.selectOption('#context-choice-mode','maximum');await page.screenshot({path:path.join(dir,`context-${width}.png`),fullPage:true});
    await page.close();
  }
  console.log('PASS context selection UI: 320/390/1280 widths, consent gate, max/custom saves, screenshots');
} finally {await browser.close();}
