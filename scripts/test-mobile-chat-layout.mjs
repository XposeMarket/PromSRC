import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const base = 'http://localhost:38129', root = path.resolve('generated/public-web-ui');
const shots = process.env.CHAT_LAYOUT_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [width, count] of [[390,1],[320,3]]) {
    const page = await browser.newPage({ viewport: {width,height:844}, isMobile:true, hasTouch:true, serviceWorkers:'block' });
    await page.addInitScript(() => { localStorage.setItem('pm_device_token','fixture'); localStorage.setItem('pm_force_mobile','1'); });
    const running = Array.from({length:count}, (_,i)=>({title:['Review the mobile layout','Check screenshots','Run tests'][i],provider:i%2?'anthropic':'openai_codex'}));
    await page.route('**/*', route => {
      const {origin,pathname:p}=new URL(route.request().url());
      if(origin!==base) return route.abort();
      if(p.startsWith('/api/')) return route.fulfill({json:p.endsWith('/glance')?{success:true,running,runningCount:count}:{success:true,sessions:[{id:'mobile_fixture_chat',title:'Mobile layout review',updatedAt:Date.now()}],projects:[],items:[],tasks:[],agents:[]}});
      const file=path.join(root,p.startsWith('/mobile')&&!p.includes('.')?'mobile.html':p);
      if(p.endsWith('/mobile-shell.js')) return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')+'\nexport { _openSessionContextSheet as showFixtureMenu };'});
      return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404});
    });
    await page.goto(base+'/mobile/chat');
    const row=page.locator('.pm-mobile-empty-chat [data-glance-open="tasks"]');
    await row.waitFor({timeout:10000});
    const gap=await row.evaluate(el=>el.querySelector('.pm-glance-copy').getBoundingClientRect().left-el.querySelector('.pm-glance-av:last-child').getBoundingClientRect().right);
    assert.ok(gap>=4 && gap<=10, `unexpected provider gap: ${gap}`);
    if(shots && width===390) await row.locator('..').screenshot({path:path.join(shots,'running.png')});
    // Open the real action sheet without depending on paired drawer history or mutating a chat.
    await page.evaluate(async()=>{(await import('/static/mobile/mobile-shell.js')).showFixtureMenu('fixture','Mobile layout review',{}, {x:160,y:312});});
    const sheet=page.locator('#pm-sess-sheet.open'); await sheet.waitFor({timeout:5000}); await sheet.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
    const rects=await sheet.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,last:el.querySelector('[data-sess-action="delete"]').getBoundingClientRect().bottom, labels:[...el.querySelectorAll('.pm-msheet-row-label')].map(e=>e.getBoundingClientRect().left),icon:!!el.querySelector('[data-sess-action="move-project"] svg')}));
    assert.ok(rects.icon && rects.bottom>rects.last && rects.bottom<=844 && Math.max(...rects.labels)-Math.min(...rects.labels)<1,JSON.stringify(rects));
    if(shots && width===390) await sheet.screenshot({path:path.join(shots,'menu.png')});
    console.log(`${width}px: all menu actions fit; ${count} provider(s), ${gap}px gap`); await page.close();
  }
} finally { await browser.close(); }
