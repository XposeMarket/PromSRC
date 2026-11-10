// Real Chromium DOM and synthetic transport. Never connects to an account.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SIGN_IN_SCREENSHOTS || path.join(root, '.pr/screenshots');
await fs.mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#101010;color:#eee;font:16px/1.5 system-ui;--prom-surface:#242424;--prom-text:#f3f3f3;--prom-muted:#b9b9b9;padding:24px 16px}header{color:#bbb;margin-bottom:40px}main{max-width:720px;margin:auto}.chat{margin:28px 0 40px}#host{max-width:460px;margin:auto}body.light{background:#fafafa;color:#222;--prom-surface:#fff;--prom-text:#222;--prom-muted:#555}</style></head><body><main><header>Prometheus · Sign-in</header><p class="chat">To continue, add your login securely. Your password stays out of chat.</p><div id="host"></div><button id="outside">Outside action</button></main><script type="module">
import {mountSecureAccessCard,mountPendingLoginCard} from '/web-ui/src/features/secure-access/secure-access-core.js';
window.calls=[];window.events=[];const q=new URLSearchParams(location.search);if(q.has('light'))document.body.className='light';
const fetchJson=async(p,o)=>{window.calls.push({path:p,body:JSON.parse(o.body||'{}')});if(q.has('error'))throw Error('offline');if(q.has('slow'))await new Promise(r=>setTimeout(r,250));return p.endsWith('/submit')&&p.includes('/requests/')?{credential:{id:'synthetic',storage:q.has('session')?'session':'persistent'}}:{transferred:true}};
const opts={fetchJson,onResolved:m=>events.push(m)};const origin=q.has('long')?'https://very-long-synthetic-account-host.example.test:8443':'https://example.com';
window.handle=q.has('approval')?mountPendingLoginCard(document.querySelector('#host'),{...opts,credential:{id:'fake',origin,identifier:'you@example.com',pendingLogin:true}}):mountSecureAccessCard(document.querySelector('#host'),{...opts,request:{id:'fake',mode:q.get('mode')||'existing',origin,label:'Example',expiresAt:new Date(Date.now()+600000).toISOString(),replaces:q.has('replacement')?'old':undefined},status:{persistentAllowed:!q.has('session'),entry:{canEnter:!q.has('blocked')},owner:{canApprove:false}}});window.ready=true;
</script></body></html>`;
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}const file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/plain');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const go=async(q='')=>{await page.goto(`http://127.0.0.1:${server.address().port}/?${q}`);await page.waitForFunction(()=>window.ready);};
const open=async()=>page.getByRole('button',{name:'Continue',exact:true}).click();
const fill=async()=>{await page.getByLabel('Email or username',{exact:true}).fill('you@example.com');await page.getByLabel('Password',{exact:true}).fill('SYNTHETIC-ONLY-123!');};
const shot=async(n)=>page.screenshot({path:path.join(out,n+'.png'),fullPage:true});
try{
await go();assert.equal(await page.locator('dialog[open]').count(),0);await shot('mobile-launcher');await open();await shot('mobile-entry');await fill();await page.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'text');await page.keyboard.press('Escape');assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');assert.equal(await page.evaluate(()=>calls.length),0);assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Continue');await open();await fill();await page.getByRole('button',{name:'Save login',exact:true}).click();assert.equal(await page.locator('dialog').count(),0);const saved=await page.evaluate(()=>calls);assert.equal(saved.length,1);assert.equal(saved[0].body.remember,true);assert(!saved.some(x=>x.path.includes('/login/')));assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);await shot('mobile-saved');
await go('session');await open();assert.match(await page.locator('.sa-form').innerText(),/memory only/);await fill();await page.getByRole('button',{name:'Save login',exact:true}).click();assert.equal(await page.evaluate(()=>calls[0].body.remember),false);
await go('error');await open();await fill();await page.getByRole('button',{name:'Save login',exact:true}).click();await page.getByRole('alert').filter({hasText:'Could not save'}).waitFor();await shot('mobile-error');await page.getByRole('button',{name:'Close sign-in',exact:true}).click();assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');
for(const q of ['blocked','replacement']){await go(q);await open();assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Save login',exact:true}).count(),0);await shot('mobile-'+q);}
await go();await open();await fill();await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');await fill();await page.evaluate(()=>handle.expire());assert.equal(await page.locator('dialog').count(),0);assert.match(await page.locator('#host').innerText(),/expired/);assert.equal(await page.evaluate(()=>calls.length),0);
await go();await open();await fill();await page.evaluate(()=>handle.destroy());assert.equal(await page.locator('#host').innerText(),'');
await go();await page.getByRole('button',{name:'Skip',exact:true}).click();assert.equal(await page.evaluate(()=>calls[0].path),'/api/secure-access/requests/fake/cancel');
await go('approval&slow');await open();await shot('mobile-approval');await page.getByRole('button',{name:'Approve sign-in',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Approve sign-in',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'It worked',exact:true}).waitFor();assert.match(await page.locator('dialog').innerText(),/result is unknown/);await shot('mobile-submitted');assert.equal(await page.evaluate(()=>calls.length),1);await page.getByRole('button',{name:'Not sure yet',exact:true}).click();assert.equal(await page.evaluate(()=>calls.length),1);
for(const mode of ['otp','new','api_key']){await go('mode='+mode);assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.locator('input[data-prom-secret]').count(),1);}
for(const width of [320,390,1440])for(const theme of ['', '&light']){await page.setViewportSize({width,height:900});await go('long'+theme);await open();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const rect=await page.locator('dialog').boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width);await shot((width===1440?'desktop':`mobile-${width}`)+(theme?'-light':'-dark'));}
// Verify real app styles do not defeat native dialog visibility or modal focus.
for (const mobile of [true,false]) {
 await page.setViewportSize({width:mobile?390:1440,height:844}); await go();
 for (const file of mobile?['theme-tokens.css','mobile.css','mobile-shell.css']:['theme-tokens.css','base.css','components.css','pages.css','themes.css']) await page.addStyleTag({url:'/web-ui/src/styles/'+file});
 if(mobile) await page.evaluate(()=>document.body.classList.add('pm-mobile-active'));
 await open(); await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),true);
 assert.equal(await page.evaluate(()=>document.querySelector('dialog').matches(':modal')),true);
 await shot(mobile?'mobile-global-styles':'desktop-global-styles');
}
assert.deepEqual(errors,[]);console.log('PASS real Chromium sign-in presentation: save-only transport, entry/owner boundaries, wipe/expiry/unmount, focus return, approval/outcome separation, variants, 320/390/1440 dark+light');
}finally{await browser.close();await new Promise(r=>server.close(r));}
