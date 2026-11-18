const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const app = express();
app.use('/src', express.static(path.resolve('web-ui/src')));
app.get('/', (_, res) => res.send(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;background:#181a1d;color:#eee;padding:16px;--panel:#242729;--text:#eee}button{padding:12px}#chat{max-width:460px}</style><h2>Protected connection setup</h2><div id="chat"></div><script type="module">
import {renderConnectionChatCards,wireConnectionChatCards} from '/src/features/connectors/connection-chat-card.js';
import {openProtectedPluginCard} from '/src/features/secure-access/protected-plugin-card.js';
import {createMobileChatMessageRenderer} from '/src/mobile/mobile-chat-message-renderer.js';
window.calls=[];window.allowed=true;window.mismatch=false;
const attempt={id:'fixture-attempt',serviceId:'x',serviceName:'X / Twitter',state:'awaiting_secure_input',metadata:{protectedPluginSetup:'x'}};
window.api=async(p,o={})=>{window.calls.push({p,method:o.method||'GET'});if(p==='/api/protected-plugins')return {setup:{canConfigure:window.allowed},storageAvailable:true,services:[{id:'x',name:'X'}]};if(p==='/api/secure-access/status')return {owner:{canApprove:false}};if(p.startsWith('/api/protected-plugins/app-schema/'))return {serviceId:'x',fields:[{key:'clientId',label:'Client ID',secret:false,required:true},{key:'clientSecret',label:'Client Secret',secret:true}]};if(p==='/api/connection-attempts/fixture-attempt')return {attempt:{...attempt,serviceId:window.mismatch?'other':'x'}};throw Error('UNEXPECTED_REQUEST');};
window.render=()=>{document.querySelector('#chat').innerHTML=renderConnectionChatCards({artifacts:[{type:'connection_card',attempt},{type:'connection_card',attempt}]});wireConnectionChatCards(document.querySelector('#chat'),window.api);};
window.openDirect=()=>openProtectedPluginCard(window.api,{serviceId:'x'});
window.openExpiry=()=>openProtectedPluginCard(window.api,{serviceId:'x',attemptId:'fixture-attempt',oauthApp:true});
window.renderMain=()=>{const ctx=new Proxy({ICONS:{},__pmChat:{},_collectMessageMedia:()=>[],_getPendingApprovalsForSession:()=>[],_mobileWorkflowTraceEntriesForMessage:()=>[],escapeHtml:s=>String(s||'')},{get:(o,k)=>k in o?o[k]:()=>''});const renderer=createMobileChatMessageRenderer(()=>ctx);document.querySelector('#chat').innerHTML=renderer({role:'ai',body:{text:'Open setup below'},artifacts:[{type:'connection_card',attempt}],_done:true},0);wireConnectionChatCards(document.querySelector('#chat'),window.api);};
window.renderMain();
</script>`));
(async()=>{
 let server,browser;
 try {
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  browser=await chromium.launch({headless:true});
  const output=path.resolve('.pr/screenshots');fs.mkdirSync(output,{recursive:true});
  for(const [surface,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1100,height:850}]]) {
   const page=await browser.newPage({viewport}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.getByRole('button',{name:'Open setup'}).waitFor();
   assert.equal(await page.locator('[data-connection-chat-card]').count(),1);
   await page.screenshot({path:path.join(output,`${surface}-connection-card.png`)});
   await page.getByRole('button',{name:'Open setup'}).click();
   await page.getByLabel('Client Secret',{exact:true}).fill('synthetic-test-only');
   await page.getByLabel('Client ID',{exact:true}).fill('fixture-client');
   await page.evaluate(()=>{window.retained=document.querySelector('input[type=password]');Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await page.locator('[data-protected-plugin-card]').count(),1);
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await page.getByLabel('Client Secret',{exact:true}).inputValue(),'synthetic-test-only');
   assert.equal(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage,window.calls,document.body.innerHTML]).includes('synthetic-test-only')),false);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.method!=='GET')),false);
   assert.equal(await page.evaluate(()=>window.calls.some(c=>c.p.endsWith('/start'))),false);
   await page.getByLabel('Client Secret',{exact:true}).fill('');
   await page.screenshot({path:path.join(output,`${surface}-protected-form.png`)});
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.retained.value),'');
   await page.getByRole('button',{name:'Open setup'}).click();await page.getByLabel('Client Secret',{exact:true}).fill('temporary');
   await page.evaluate(()=>{window.retained=document.querySelector('input[type=password]');window.dispatchEvent(new Event('pagehide'));});
   assert.equal(await page.evaluate(()=>window.retained.value),'');assert.equal(await page.locator('[data-protected-plugin-card]').count(),0);
   await page.getByRole('button',{name:'Open setup'}).click();await page.getByLabel('Client Secret',{exact:true}).fill('temporary');
   await page.evaluate(()=>{window.retained=document.querySelector('input[type=password]');window.dispatchEvent(new Event('hashchange'));});
   assert.equal(await page.evaluate(()=>window.retained.value),'');
   await page.getByRole('button',{name:'Open setup'}).click();await page.getByLabel('Client Secret',{exact:true}).fill('temporary');
   await page.evaluate(()=>{window.retained=document.querySelector('input[type=password]');Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));const now=Date.now;Date.now=()=>now()+300001;Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));Date.now=now;});
   assert.equal(await page.evaluate(()=>window.retained.value),'');assert.equal(await page.locator('[data-protected-plugin-card]').count(),0);
   await page.evaluate(()=>window.mismatch=true);await page.getByRole('button',{name:'Open setup'}).click();await page.getByText('Unable to open setup',{exact:true}).waitFor();assert.equal(await page.locator('input').count(),0);await page.getByRole('button',{name:'Close',exact:true}).click();
   await page.evaluate(()=>{window.allowed=false;window.mismatch=false;});await page.getByRole('button',{name:'Open setup'}).click();await page.getByText('Pair this device first',{exact:true}).waitFor();assert.equal(await page.locator('input').count(),0);
   assert.deepEqual(errors,[]);await page.close();console.log(surface+': render/resume/app-switch/no-leak/cancel/pagehide/navigation/timeout/identity/owner PASS');
  }
  const runtime=fs.readFileSync('web-ui/src/mobile/mobile-chat-renderer-runtime.js','utf8');assert.match(runtime,/renderConnectionChatCards\(turnPresentation\)/);for(const host of ['threadEl','patchedEl','host'])assert.ok(runtime.includes('wireConnectionChatCards('+host+', mobileGatewayFetch)'));
  console.log('mobile credential cards PASS');
 } finally {await browser?.close();await new Promise(r=>server?server.close(r):r());}
})().catch(e=>{console.error(e);process.exitCode=1;});
