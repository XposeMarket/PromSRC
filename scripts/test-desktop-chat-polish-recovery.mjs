import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { agentAvatarHtml } from '../web-ui/src/components/provider-logo.js';
const read = p => fs.readFileSync(p, 'utf8');
const chat = read('web-ui/src/pages/ChatPage.js');
const picker = read('web-ui/src/legacy-desktop-bootstrap.js');
const runtime = read('web-ui/src/features/chat/runtime/desktop-send-chat-runtime.js');
const extract = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
// Explicitly opening the live group must not eagerly build historical bodies.
{
  const groups = ['old', 'current'].map(id => ({id,kind:'tools',entries:[{id,type:'tool',activity:{kind:'operation'}}]}));
  const ctx = { liveTraceGroups:()=>groups, foldMobileReasoningSummaryGroups:g=>g, mobileReasoningSummaryTitle:()=>'',
    desktopTraceProgressSummary:()=>'', liveTraceCurrentToolLabel:()=> 'Working', liveTraceToolSummary:()=> 'Earlier',
    liveTraceSummaryKey:s=>s, isDesktopMutableProgressTraceEntry:()=>false, isDesktopTraceReasoningSummaryType:()=>false,
    escHtml:s=>String(s), renderToolActivityIcon:()=>'', renderThinkingState:s=>s, waitCountdownHtml:()=>'',
    rememberLazyTraceBody:entries=>entries[0].id, renderLiveTraceList:entries=>`<b>${entries[0].id} body</b>` };
  vm.runInNewContext(extract(chat,'renderLiveTurnTrace'),ctx);
  const html = ctx.renderLiveTurnTrace([], {streaming:true,openLiveCurrent:true});
  assert.match(html,/data-lazy-trace="old"/,'old groups remain lazy while current is open');
  assert.doesNotMatch(html,/<b>old body<\/b>/);
  assert.match(html,/<b>current body<\/b>/,'explicit current group is expanded');
}

// Run the real local SSE reasoning branches: summary packets paint immediately;
// private provider thinking stays private and does not become a visible trace.
for (const type of ['thinking_delta', 'reasoning_summary', 'reasoning_summary_delta']) {
  const marker = type === 'thinking_delta' ? "case 'thinking_delta': {" : "case 'reasoning_summary_delta': {";
  const start = runtime.indexOf(marker) + marker.length;
  const body = runtime.slice(start, runtime.indexOf('break;', start));
  for (const visibility of ['summary', 'private']) {
    const ctx = { event: {type, text:'Inspecting', thinking:'Inspecting', visibility}, streamState:{}, thisSessionId:'s', window:{activeChatSessionId:'s'}, pendingThinkingBurst:'', paints:0, traces:0,
      chatProgressVisibility:e=>e.visibility, appendLiveTrace:()=>{}, renderIfViewingThisSession:()=>{},
      setDesktopLiveProgressNarration:()=>ctx.traces++, scheduleStreamingRenderFor:()=>ctx.paints++ };
    vm.runInNewContext(body, ctx);
    const visible = type !== 'thinking_delta' || visibility === 'summary';
    assert.equal(ctx.paints, visible ? 1 : 0, `${type}/${visibility} schedules correctly`);
    assert.equal(ctx.traces, visible ? 1 : 0);
  }
}
// Effort is the final selection; a failed save must leave the picker open.
for (const failure of [false, true]) {
  let click, closed = 0, errors = 0;
  const button = {getAttribute:()=> 'high', addEventListener:(_t,fn)=>{click=fn;}};
  const controller = {sessionId:'s', detail:{querySelectorAll:()=>[button]}};
  const ctx = { EFFORT_CAPABLE_PROVIDERS:new Set(['openai_codex']), _effortLevelsForProvider:()=>[{v:'high',label:'High'}], escHtml:s=>s,
    _desktopSwitcherShowDetail:()=>{}, _desktopSwitcherOption:()=>'', _closeModelSwitcher:c=>{assert.equal(c,controller);closed++;},
    setActiveChatModelRoute:async()=>{if(failure)throw new Error('offline');}, showToast:()=>errors++ };
  vm.runInNewContext(extract(picker,'_renderDesktopSwitcherEffort'),ctx);
  ctx._renderDesktopSwitcherEffort({provider:'openai_codex',model:'gpt-6-astra'},controller);
  await click(); assert.equal(closed,failure?0:1);assert.equal(errors,failure?1:0);
}
// A new window with only a saved cursor must request its missing visible prefix.
for (const hydrated of [false, true]) {
  const urls=[];let renders=0;const frames=[];const state={liveTraceEntries:hydrated?[{text:'old'}]:[]};
  const ctx={window:{activeChatSessionId:'s',_mainChatStreamActiveIdBySession:{s:'stream'},_sessionThinking:{}},Number,String,Math,
    _isMainChatStreamCatchupSessionVisible:()=>true,_loadSessionFromServer:async()=>{},readDesktopActiveChatRun:()=>({streamId:'stream',lastSeq:50}),getMainChatStreamLastSeq:()=>0,
    getSessionStreamState:()=>state,resetMainChatStreamCursor:()=>{},fetchJsonWithTimeout:async u=>{urls.push(u);return {events:[{seq:51,type:'reasoning_summary_delta'}],stream:{streamId:'stream',lastSeq:51}};},
    getChatSessionById:()=>({}),applyMainChatStreamFrame:(_s,f,o)=>frames.push(o),applyStreamStateToWindow:()=>{},syncActiveSessionRunState:()=>{},renderProgressPanel:()=>{},renderStreamingChatUpdate:()=>renders++,rememberDesktopActiveChatRun:()=>{} };
  vm.runInNewContext('async '+extract(chat,'catchUpMainChatStream'),ctx);
  await ctx.catchUpMainChatStream('s',{recovery:true});
  assert.match(urls[0],hydrated?/after=50$/:/after=0$/);
  assert.equal(frames[0].suppressRender,true);assert.equal(renders,1);
}
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1000,height:720}});
  const css=['base','components','themes','surfaces-polish'].map(n=>read(`web-ui/src/styles/${n}.css`)).join('\n');
  await page.setContent(`<html data-theme="dark"><style>${css}</style><body><div class="chat-input-area"><button data-add-secret>obsolete</button></div><div class="background-spawn-dock has-many" style="width:400px">${['anthropic','openai_codex','xai'].map(providerId=>`<section class="background-spawn-lane"><button class="background-spawn-summary"><span class="background-spawn-avatar">${agentAvatarHtml({providerId},'Agent')}</span><span class="background-spawn-main"><strong>Agent</strong><em>Processing</em></span><span class="background-spawn-status">Running</span></button></section>`).join('')}</div><div id="model-switcher-popover" class="model-switcher-popover"><div class="model-switcher-panel">Settings</div><div class="model-switcher-panel">Effort</div></div><div id="timeline"></div></body></html>`);
  const geometry=await page.evaluate(()=>{const dock=document.querySelector('.background-spawn-dock'),card=dock.querySelector('section'),menu=document.querySelector('#model-switcher-popover');return {width:card.getBoundingClientRect().width,height:card.getBoundingClientRect().height,scrollbar:getComputedStyle(dock).scrollbarWidth,background:getComputedStyle(menu).backgroundColor,secret:getComputedStyle(document.querySelector('[data-add-secret]')).display,providers:[...document.querySelectorAll('[data-provider]')].map(e=>e.dataset.provider)};});
  assert.ok(geometry.width<=160 && geometry.height<=38,JSON.stringify(geometry));assert.equal(geometry.scrollbar,'none');assert.equal(geometry.background,'rgba(0, 0, 0, 0)');assert.equal(geometry.secret,'none');assert.deepEqual(geometry.providers,['anthropic','openai','xai']);
  await page.evaluate(source=>{window.eval(`const liveTraceRenderedMarkup = new WeakMap();\n${source}`);},['getLiveTraceDisclosureKey','captureLiveTraceDisclosureState','restoreLiveTraceDisclosureState','syncLiveTraceNodeAttributes','directLiveTraceChild','reconcileLiveTraceChildren','patchLiveTraceEntries','patchLiveTraceGroup','patchLiveTraceTimelineNode'].map(n=>extract(chat,n)).join('\n'));
  const mutations=await page.evaluate(()=>{const root=document.querySelector('#timeline');root.innerHTML='<div data-live-trace-group="stable"><details open><summary>Tool</summary><pre data-command-terminal-output>output</pre></details></div>';const current=root.firstElementChild,next=current.cloneNode(true);patchLiveTraceTimelineNode(current,next);current.querySelector('details').open=false;const observer=new MutationObserver(()=>{});observer.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});for(let i=0;i<50;i++)patchLiveTraceTimelineNode(current,next);const n=observer.takeRecords().length;observer.disconnect();return {n,open:current.querySelector('details').open};});
  assert.equal(mutations.n,0,'unchanged trace generates zero DOM mutations');assert.equal(mutations.open,false,'reader disclosure choice survives');
  console.log('PASS desktop repair: local reasoning paints, private visibility, effort close/error, cold-cursor recovery, replay batching, compact provider cards, transparent picker, no secret button, stable disclosure DOM');
} finally {await browser.close();}
