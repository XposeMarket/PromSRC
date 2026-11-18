import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from 'playwright';
const chat = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
const extract = name => { const start = chat.indexOf(`function ${name}(`); assert.ok(start >= 0); return chat.slice(start, chat.indexOf('\n}', start) + 2); };
let state, question = false;
const ctx = {
  window: {activeChatSessionId:'fixture'}, getSessionStreamState:()=>state, isSessionThinking:()=>true,
  renderLiveTurnTrace:e=>e.length ? '<div class="live-turn-timeline">Visible reasoning</div>' : '',
  renderStreamingApprovals:e=>e.length ? '<div>Approval required</div>' : '',
  renderInlineRuntimePlanHtml:p=>p?.length ? '<div>Work plan</div>' : '', getRuntimePlanItems:p=>p || [],
  getChatSessionById:()=>({processLog:[]}), mergeLiveTraceProcessEntries:()=>[],
  isGenerateImagePendingFromEntries:()=>!!state.imagePending, renderGeneratedImageLoadingCard:()=>'<div>Generating image</div>',
  renderAssistantWorkTimer:()=>'<div class="assistant-work-timer">Working for 6s</div>',
  renderAssistantContent:t=>t, escHtml:t=>String(t), findPendingPrometheusQuestionForSession:()=>question,
};
vm.createContext(ctx);
vm.runInContext(`${extract('renderSessionThinkingBodyHtml')}\n${extract('renderSessionThinkingHtml')}`,ctx);
state = {turnStartedAt:1,currentProgressLines:['Selecting model route...','Loading tool schemas...','Tool schemas ready.']};
const dots = ctx.renderSessionThinkingHtml('fixture');
assert.equal((dots.match(/class="thinking-dot"/g)||[]).length,3);
assert.doesNotMatch(dots,/Selecting model|Loading tool|schemas ready/);
assert.match(dots,/thinking-only/);
question=true;assert.equal(ctx.renderSessionThinkingHtml('fixture'),'','setup metadata must not keep an empty waiting bubble');
state.liveTraceEntries=[{}];assert.match(ctx.renderSessionThinkingHtml('fixture'),/Visible reasoning/);
state.liveTraceEntries=[];state.pendingApprovals=[{}];assert.match(ctx.renderSessionThinkingHtml('fixture'),/Approval required/);
question=false;
for(const next of [{liveTraceEntries:[{}]},{streamingAIText:'An answer'},{pendingApprovals:[{}]},{runtimeProgressState:[{}]},{imagePending:true}]){
  state={turnStartedAt:1,...next};assert.doesNotMatch(ctx.renderSessionThinkingBodyHtml('fixture'),/class="thinking-dot"/);
}
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1200,height:800}});
  await page.route('http://desktop-fixture.test/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    const file=path.resolve('web-ui','.'+pathname);
    if(file.startsWith(path.resolve('web-ui')+path.sep)&&fs.existsSync(file))return route.fulfill({path:file});
    return route.fulfill({status:404,body:''});
  });
  await page.goto('http://desktop-fixture.test/index.html');
  // Real desktop stylesheet cascade, isolated fixture: no gateway/model requests.
  await page.setContent(`<link rel="stylesheet" href="http://desktop-fixture.test/src/styles/desktop-entry.css"><div id="chat-view"><div id="chat-messages" class="is-streaming"><div class="msg-shell user"><div class="msg user"><div class="msg-body">Bring back the thinking dots, please.</div></div></div>${dots}</div></div>`);
  await page.waitForTimeout(500);
  const skins=['p1','gray','dark','blue','purple','custom'];
  const sourceLinks=[...fs.readFileSync('web-ui/index.html','utf8').matchAll(/<link rel="stylesheet" href="(src\/styles\/[^\"]+)"/g)].map(m=>m[1]);
  for(const entry of ['bundle','source']) {
    if(entry==='source') {
      await page.evaluate(links=>{document.querySelectorAll('link[rel="stylesheet"]').forEach(e=>e.remove());for(const href of links){const link=document.createElement('link');link.rel='stylesheet';link.href='http://desktop-fixture.test/'+href;document.head.append(link);}},sourceLinks);
      await page.waitForTimeout(300);
    }
  for(const skin of skins){
    await page.evaluate(s=>{document.documentElement.dataset.skin=s;document.documentElement.dataset.theme='dark';},skin);
    const result=await page.evaluate(()=>{const body=document.querySelector('.msg.user .msg-body'),dot=document.querySelector('.thinking-dot'),css=getComputedStyle(body);return {border:css.borderTopWidth,shadow:css.boxShadow,before:getComputedStyle(body,'::before').content,after:getComputedStyle(body,'::after').content,dotPlay:getComputedStyle(dot).animationPlayState};});
    assert.equal(result.border,'0px',skin);assert.equal(result.shadow,'none',skin);
    assert.ok(['none','normal'].includes(result.before),skin);assert.ok(['none','normal'].includes(result.after),skin);
    assert.equal(result.dotPlay,'running',skin);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.thinking-dot').first().evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>document.body.classList.add('chat-document-hidden'));
  assert.equal(await page.locator('.thinking-dot').first().evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
  await page.evaluate(()=>document.body.classList.remove('chat-document-hidden'));
  }
  console.log('PASS source + bundled desktop thinking: startup dots, metadata hidden, real content transitions, question/approval visibility, six themes borderless, reduced-motion/hidden pause');
} finally {await browser.close();}
