// Real phone-WebKit DOM/gesture regression. No screenshots or gateway writes.
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const BASE = process.env.BASE || 'http://127.0.0.1:32466';
const ROOT = path.resolve(__dirname, '..');
const executablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'webkit-2248', 'Playwright.exe') : undefined);
const MIME = { '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
(async () => {
  const browser = await webkit.launch({ headless:true, executablePath });
  const out = { engine:'WebKit', fixture:'real source badge/sheet/gesture module with mocked composer placement and API; simulated touch pointer drag', cases:[] };
  try {
    for (const height of [844, 500]) {
      const ctx = await browser.newContext({ serviceWorkers:'block', viewport:{width:390,height}, deviceScaleFactor:3, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
      await ctx.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (u.origin !== new URL(BASE).origin) return route.abort();
        if (!['GET','HEAD'].includes(req.method())) return route.fulfill({json:{success:true,ok:true}});
        let rel = decodeURIComponent(u.pathname).replace(/^\//,'');
        if (!rel) rel = 'index.html';
        if (rel === 'mobile' || rel.startsWith('mobile/')) return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles/mobile.css"><link rel="stylesheet" href="/src/styles/mobile-shell.css"><link rel="stylesheet" href="/src/styles/mobile-liquid-glass-demo.css"></head><body class="pm-mobile-active"><button class="pm-model-badge pm-composer-model-badge" style="position:fixed;left:20px;bottom:90px;width:250px;height:44px"><span class="pm-model-badge-label">GPT</span></button><script type="module">import {initMobileModelBadge,refreshMobileModelBadge} from '/src/mobile/mobile-model-badge.js';initMobileModelBadge();await refreshMobileModelBadge();window.fixtureReady=true;</script></body></html>`});
        const root = path.join(ROOT,'web-ui'), file = path.resolve(root,rel);
        if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({body:fs.readFileSync(file),contentType:MIME[path.extname(file)] || 'application/octet-stream'});
        if (u.pathname === '/api/settings/provider') return route.fulfill({json:{llm:{provider:'openai_codex',providers:{openai_codex:{model:'gpt-5.5',reasoning_effort:'medium'}}}}});
        if (u.pathname.startsWith('/api/')) return route.fulfill({json:{ok:true,sessions:[],agents:[],items:[],providers:[],models:[],messages:[]}});
        return route.continue();
      });
      await ctx.addInitScript(() => localStorage.setItem('pm_device_token','dom-test-only'));
      const page = await ctx.newPage(), errors=[];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE+'/mobile#mobile/chat',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.fixtureReady);
      const badge = page.locator('.pm-composer-model-badge:visible').first();
      await badge.waitFor({state:'visible',timeout:10000});
      await page.waitForTimeout(2200);
      const host = page.locator('.pm-haptic-host').filter({has:badge});
      const overlay = host.locator('.pm-haptic-switch-overlay');
      if (await overlay.count()) await overlay.tap(); else await badge.tap();
      await page.locator('#pm-reasoning-control').waitFor({state:'visible',timeout:10000});
      await page.waitForTimeout(400);
      const geometry = await page.evaluate(() => {
        const rect = el => { const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        const trigger = [...document.querySelectorAll('.pm-composer-model-badge')].find(e=>e.getBoundingClientRect().width>0);
        const v=visualViewport, viewport={left:v.offsetLeft,top:v.offsetTop,right:v.offsetLeft+v.width,bottom:v.offsetTop+v.height,width:v.width,height:v.height};
        return {viewport,trigger:rect(trigger),sheet:rect(document.querySelector('#pm-msheet')),control:rect(document.querySelector('#pm-reasoning-control')),options:[...document.querySelectorAll('#pm-reasoning-control .pm-reasoning-segment')].map(e=>e.textContent.trim())};
      });
      const result={size:{width:390,height},...geometry,errors,drag:[]}; out.cases.push(result);
      console.log('DOM '+JSON.stringify(result));
      const {sheet:s,trigger:t,viewport:v}=geometry;
      assert(s.left>=v.left && s.top>=v.top && s.right<=v.right && s.bottom<=v.bottom,'sheet fully inside visual viewport');
      assert(s.bottom<=t.top,'sheet bottom above composer trigger');
      const segments = await page.locator('#pm-reasoning-control .pm-reasoning-segment').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}));
      assert(segments.length>=3,'multiple reasoning levels');
      await page.evaluate(({x,y})=>{
        const input=document.elementFromPoint(x,y);
        if(!input?.matches('.pm-haptic-gesture-input')) throw Error('slider hit-test did not reach real shared haptic input: '+input?.outerHTML);
        window.__reasoningTicks=0; window.__reasoningMoves=[];
        window.__reasoningObserver=new MutationObserver(records=>{
          const direction = css => /(?:^|;)\s*direction:\s*(rtl|ltr)/.exec(css || '')?.[1] || '';
          records.forEach((r,i)=>{const before=direction(r.oldValue),after=direction(i+1<records.length ? records[i+1].oldValue : input.getAttribute('style'));if(before!==after) window.__reasoningTicks++;});
        });
        window.__reasoningObserver.observe(input,{attributes:true,attributeFilter:['style'],attributeOldValue:true});
        input.addEventListener('pointermove',e=>window.__reasoningMoves.push({trusted:e.isTrusted,type:e.pointerType}));
      },segments[0]);
      const sample=()=>page.evaluate(()=>({index:Number(document.querySelector('#pm-reasoning-control').getAttribute('aria-valuenow')),ticks:window.__reasoningTicks,moves:window.__reasoningMoves.length}));
      const initial=await sample();
      const pointer = (type,point) => page.locator('.pm-haptic-gesture-input').dispatchEvent(type,{pointerId:7,pointerType:'touch',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:point.x,clientY:point.y});
      await pointer('pointerdown',segments[0]); await page.waitForTimeout(25);
      let prev=await sample();
      assert.equal(prev.index,0,'pointerdown selected first step');
      assert.equal(prev.ticks,Math.abs(initial.index),'pointerdown proxy ticks equal crossed steps');
      result.pointerDown={initialIndex:initial.index,...prev};
      for(const index of [1,1,segments.length-1,segments.length-2]) {
        await pointer('pointermove',{x:segments[index].x+(index===prev.index ? 0.1 : 0),y:segments[index].y});
        await page.waitForTimeout(55);
        const current=await sample(), expected=Math.abs(index-prev.index), ticks=current.ticks-prev.ticks;
        result.drag.push({from:prev.index,to:current.index,expected,ticks});
        assert.equal(current.index,index,'drag reaches intended step'); assert.equal(ticks,expected,'real proxy direction transitions equal crossed steps');
        prev=current;
      }
      await pointer('pointerup',segments[prev.index]); await page.waitForTimeout(30);
      result.pointerEvents=await page.evaluate(()=>window.__reasoningMoves);
      assert(result.pointerEvents.length>=4 && result.pointerEvents.every(e=>e.type==='touch' && !e.trusted),'simulated touch pointer drag reached real shared overlay');
      assert.equal(errors.length,0,'no page errors');
      await ctx.close();
    }
    console.log(JSON.stringify(out,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
