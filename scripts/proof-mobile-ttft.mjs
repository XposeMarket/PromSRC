// Static branch-module preview: no gateway, credentials or model requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { webkit, chromium } from 'playwright';
const root = process.cwd(), out = path.resolve(process.argv[2] || '.pr/shots');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const p=path.resolve(root, `.${decodeURIComponent(req.url.split('?')[0])}`);
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<body class="pm-mobile-active"><main id="rows"></main></body>');return;}
 if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try {res.setHeader('content-type',p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 for(const [name,engine,viewport] of [['phone',webkit,{width:390,height:844}],['desktop',chromium,{width:1440,height:900}]]){
  const browser=await engine.launch({headless:true});
  try {
   const page=await browser.newPage({viewport}); await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.addStyleTag({url:'/web-ui/src/styles/mobile.css'});
   await page.addStyleTag({content:'body{background:#17191d;color:#ededf0;margin:0;padding:28px;font:16px system-ui}main{max-width:700px;margin:auto}.pm-bubble{padding:20px}.pm-thinking-dots{display:flex;gap:4px}.pm-thinking-dots span{width:4px;height:4px;background:#aaa;border-radius:50%}'});
   await page.evaluate(async()=>{
    const {createMobileChatMessageRenderer}=await import('/web-ui/src/mobile/mobile-chat-message-renderer.js');
    const helpers=new Proxy({__pmChat:{activeSessionId:'proof'},escapeHtml:s=>String(s),chatTimelineRowSignature:()=>'',_getPendingApprovalsForSession:()=>[],_mobileWorkflowTraceEntriesForMessage:()=>[],_collectMessageMedia:()=>[],_renderMobileMarkdown:s=>s}, {get:(o,k)=>o[k]||(()=> '')});
    window.render=createMobileChatMessageRenderer(()=>helpers);
    window.turn={role:'assistant',streaming:true,body:{text:''}};
    window.state=await import('/web-ui/src/mobile/mobile-ttft-state.js');
    document.querySelector('#rows').innerHTML=window.render(window.turn);
   });
   // Before snapshot uses the actual base renderer with exactly the same fixture.
   const before=execFileSync('git',['show','origin/main:web-ui/src/mobile/mobile-chat-message-renderer.js'],{encoding:'utf8'}).replace(/^import .*\n/,'').replace('export function','function');
   await page.evaluate((source)=>{window.afterHtml=document.querySelector('#rows').innerHTML; const make=new Function('highlightMobileVoiceMarkdown',source+'; return createMobileChatMessageRenderer;')(()=> '');const helpers=new Proxy({__pmChat:{activeSessionId:'proof'},escapeHtml:s=>String(s),chatTimelineRowSignature:()=>'',_getPendingApprovalsForSession:()=>[],_mobileWorkflowTraceEntriesForMessage:()=>[],_collectMessageMedia:()=>[],_renderMobileMarkdown:s=>s},{get:(o,k)=>o[k]||(()=> '')});document.querySelector('#rows').innerHTML=make(()=>helpers)(window.turn);},before);
   await page.screenshot({path:path.join(out,`${name}-before.png`)});
   await page.evaluate(()=>{document.querySelector('#rows').innerHTML=window.afterHtml;window.turn._pmPendingStatus.startedAt=Date.now()-4500;document.querySelector('pm-pending-status').dataset.start=window.turn._pmPendingStatus.startedAt;const el=document.querySelector('pm-pending-status');el.remove();document.querySelector('.pm-bubble').prepend(el);});
   await page.waitForFunction(()=>document.querySelector('pm-pending-status')?.textContent.includes('Thinking'));
   await page.screenshot({path:path.join(out,`${name}-thinking.png`)});
   await page.evaluate(()=>window.state.noteMobilePendingEvent(window.turn,{type:'latency',phase:'queued'}));
   assert.equal(await page.locator('pm-pending-status').textContent(),'Waiting for a model slot');
   await page.screenshot({path:path.join(out,`${name}-queued.png`)});
   await page.evaluate(()=>window.state.noteMobilePendingEvent(window.turn,{type:'token',text:'Ready'}));
   assert.equal(await page.locator('pm-pending-status').isHidden(),true);
   await page.evaluate(()=>{window.turn.body.text='Ready.';document.querySelector('#rows').innerHTML=window.render(window.turn);});
   assert.equal(await page.locator('pm-pending-status').count(),0);
   await page.screenshot({path:path.join(out,`${name}-answer.png`)});
   await page.route('**/api/**',route=>route.fulfill({json:{success:true,llm:{provider:'anthropic',providers:{anthropic:{model:'claude-opus-5-5',reasoning_effort:'high'}}},reasoning:{main_chat:'low'}}}));
   await page.evaluate(async()=>{
    window.__pmChat={activeSessionId:'mobile_default'};
    localStorage.setItem('pm_mobile_chat_model_route_v1',JSON.stringify({providerId:'anthropic',model:'claude-opus-5-5',reasoningEffort:'high'}));
    document.querySelector('#rows').innerHTML='<button class="pm-model-badge pm-composer-model-badge"><span class="pm-model-badge-label"></span></button>';
    window.badge=await import('/web-ui/src/mobile/mobile-model-badge.js');
    window.badge.resetMobileDraftModelRoute();window.badge.initMobileModelBadge();await window.badge.refreshMobileModelBadge(true);
   });
   assert.match(await page.locator('.pm-composer-reasoning-name').textContent(),/Default.*Low/i);
   await page.screenshot({path:path.join(out,`${name}-default-low.png`)});
   await page.locator('.pm-model-badge').click();
   await page.getByRole('button',{name:'Use default (Low)',exact:true}).waitFor();
   await page.screenshot({path:path.join(out,`${name}-reset-default.png`)});
   console.log(`PASS ${name}: real renderer lifecycle and actual model badge default/reset UI`);
  } finally{await browser.close();}
 }
}finally{await new Promise(r=>server.close(r));}
