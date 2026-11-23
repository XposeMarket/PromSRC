import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../web-ui/',import.meta.url));
const base='http://sources.test';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
 let gatewayRuns=[]; const diffRequests=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const patch='@@ -1,2 +1,2 @@\n-const size = 380;\n+const size = 316;\n export { size };';
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
  if(u.pathname.startsWith('/api/')){if(u.pathname==='/api/coding/diff')diffRequests.push(Object.fromEntries(u.searchParams));const json={'/api/background':{statuses:gatewayRuns},'/api/account/status':{authenticated:true,accountRequired:false},'/api/onboarding/status':{nextStep:'done',modelConnected:true},'/api/coding/diff':{diff:patch,baselineKind:'git-head',insertions:1,deletions:1},'/api/canvas/file':{success:true,content:'const size = 316;',inWorkspace:true}};return route.fulfill({json:json[u.pathname]||{}});}
  const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  if(u.pathname==='/src/pages/ChatPage.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')+'\nwindow.fixture={sourcePanelState,chatResourcesState,setSourcePanelChatContext,renderSourcePanel,openFullSourcePanel,showSourcesMinimizedPanel,loadSourceRuns,getTabs:()=>canvasTabs};'});
  return route.fulfill({path:file});
 });
 await page.goto(base+'/?desktop=1');await page.waitForFunction(()=>window.fixture);await page.waitForTimeout(800);
 await page.evaluate(()=>{const f=window.fixture,sid='sources-review';window.currentMode='chat';window.activeChatSessionId=sid;window.chatSessions=[{id:sid,title:'Review Sources',history:[]}];f.setSourcePanelChatContext({surface:'main_chat',sessionId:sid},{load:false});f.openFullSourcePanel();});
 await page.waitForTimeout(500);
 const panel=page.locator('#right-panel');const quiet=await panel.boundingBox();assert(quiet.width<=318 && quiet.height<505,JSON.stringify(quiet));
 const shot=async(name,el)=>{if(process.env.SOURCES_SHOTS){fs.mkdirSync(process.env.SOURCES_SHOTS,{recursive:true});await (el||page).screenshot({path:path.join(process.env.SOURCES_SHOTS,name+'.png')});}};
 const checkFloating=async()=>{
  const geometry=await panel.evaluate(p=>{const box=p.getBoundingClientRect(),ws=p.parentElement.getBoundingClientRect(),chat=p.parentElement.querySelector('.center-col').getBoundingClientRect(),style=getComputedStyle(p);return {mode:style.position,radius:parseFloat(style.borderRadius),gap:ws.right-box.right,top:box.top-ws.top,bottom:ws.bottom-box.bottom,chatRight:ws.right-chat.right,below:p.contains(document.elementFromPoint(box.right-10,box.bottom+6)),tabOverflow:[...p.querySelectorAll('[data-source-tab]')].some(t=>t.getBoundingClientRect().right>box.right)};});
  assert(geometry.mode==='absolute' && geometry.radius>=16 && geometry.gap>=12 && geometry.top>=12 && geometry.bottom>=12 && geometry.chatRight<=1 && !geometry.below && !geometry.tabOverflow,JSON.stringify(geometry));
  const rail=await page.locator('.prom-multi-chat-tabs:visible').first().boundingBox();
  for(const id of ['#theme-toggle','#drawerToggle']){const b=await page.locator(id).boundingBox();assert(b && b.height<=28 && Math.abs(b.y+b.height/2-rail.y-rail.height/2)<=1,JSON.stringify({id,b,rail}));}
 };await checkFloating();
 await shot('overview',panel);
 await page.evaluate(()=>{const f=window.fixture,sid=window.activeChatSessionId,t=Date.now();localStorage.setItem('prometheus_background_agent_work_v1',JSON.stringify([{id:'audit',sessionId:sid,agentName:'Review layout',status:'running',providerId:'anthropic',model:'Claude',reasoningEffort:'medium',updatedAt:t},{id:'other',sessionId:'another-thread',agentName:'Unrelated run',status:'running',updatedAt:t}]));f.chatResourcesState.sessionId=sid;f.chatResourcesState.resources=Array.from({length:36},(_,i)=>({id:'r'+i,title:['Layout notes','Before.png','Editor reference'][i%3],threadId:sid,kind:'file',origin:i%2?'user_upload':'web_fetch',status:'available',locator:{path:'notes/'+i},createdAt:new Date(t-i*60000).toISOString()}));const file={id:'size',path:'/demo/layout.js',displayPath:'layout.js',status:'modified',baselineKind:'git-head',insertions:1,deletions:1};f.sourcePanelState.codingContext={root:'/demo',files:[file],roots:[]};f.renderSourcePanel();});
 assert.deepEqual(await panel.locator('.sec h3').allTextContents(), ['Environment','Lineage · 1 running','Changed by this thread','Recent sources']);
 assert.equal(await panel.locator('.dock-provider.claude').count(),1);
 assert.equal(await panel.locator('.sec h3').first().evaluate(el=>getComputedStyle(el).fontSize),'11.5px');
 assert.match(await panel.locator('.lineage-row .run-model').innerText(),/medium reasoning/);
 assert.equal(await panel.locator('.sec').filter({hasText:'Recent sources'}).locator('[data-source-item^="workspace-file:"]').count(),0);
 await panel.locator('.lineage-row').click();assert(await panel.locator('details[data-run="audit"]').evaluate(el=>el.open));
 await page.locator('[data-source-tab="overview"]').click();await page.evaluate(()=>window.setDockTimelineFilter('All'));
 await shot('overview-populated',panel);await shot('desktop-overview');
 await page.locator('[data-source-tab="timeline"]').click();const busy=await panel.boundingBox();assert(busy.height<=521 && busy.height>quiet.height);assert(await page.locator('#source-panel-body').evaluate(e=>e.scrollHeight>e.clientHeight));assert(!((await panel.innerText()).includes('Unrelated run')));
 await shot('timeline',panel);await page.locator('.dock-filters button',{hasText:'Agents'}).click();await panel.locator('.dock-agent summary').click();assert.match(await panel.innerText(),/medium reasoning/);
 await page.locator('[data-source-tab="files"]').click();const row=panel.locator('[data-source-item="workspace-file:size"]');await row.click();await page.waitForSelector('#canvas-diff-wrap .coding-diff-line');assert.equal(await page.locator('#coding-diff-workspace').count(),0);assert.equal(await page.locator('#source-panel-shell').isVisible(),false);assert.notEqual(await panel.evaluate(e=>getComputedStyle(e).position),'absolute');assert.equal(diffRequests.at(-1).view,'working');assert.equal(diffRequests.at(-1).sessionId,'sources-review');
 const split=page.locator('.diff-split-toggle');if(await split.isVisible()){await split.click();assert(await page.locator('.canvas-split-diff').isVisible());}await shot('canvas');
 await page.locator('#sources-return').click();assert.equal(await row.evaluate(e=>e===document.activeElement),true);
 await page.evaluate(()=>{const tab=window.fixture.getTabs().find(t=>t.diskPath==='/demo/layout.js');tab.content='unsaved draft';tab.dirty=true;});await row.click();await page.waitForSelector('#canvas-diff-wrap .canvas-diff-toolbar');assert(await page.evaluate(()=>window.fixture.getTabs().some(t=>t.dirty && t.content==='unsaved draft')));await page.locator('#sources-return').click();
 await page.setViewportSize({width:1024,height:650});await page.locator('[data-source-tab="timeline"]').click();await page.locator('.dock-filters button',{hasText:'All'}).click();await checkFloating();const laptop=await panel.boundingBox();assert(laptop.width<=300 && laptop.height<=443,JSON.stringify(laptop));assert(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.deepEqual(errors.filter(e=>/sourceDock|sourcePanel|mountDiff|sourceDockReturn/i.test(e)),[]);// No local worker cache: recover only the selected thread's run and anchor edits at spawn, not completion.
 gatewayRuns=[{id:'remote',spawnerSessionId:'sources-review',agentName:'Mira',tags:['Terrain'],promptPreview:'Build <terrain> tiles',model:'claude-opus-5-5',reasoningEffort:'high',result:'Finished mesh',state:'completed',startedAt:1700000001000,completedAt:1700000010000,fileChanges:{generatedAt:1700000010000,files:[{path:'/demo/terrain.js',status:'added'}]}},{id:'foreign',spawnerSessionId:'another',tags:['Foreign run'],state:'completed'}];
 await page.evaluate(async()=>{const sid=window.activeChatSessionId;localStorage.removeItem('prometheus_background_agent_work_v1');window.chatSessions.find(s=>s.id===sid).history=[{role:'user',timestamp:1700000000000,text:'Build terrain'},{role:'user',timestamp:1700000005000,text:'Next request'}];await window.fixture.loadSourceRuns(sid,true);window.setSourcePanelTab('overview');});
 const worker=panel.locator('.lineage-row',{hasText:'Mira'});assert.equal(await worker.locator('.run-assignment').innerText(),'Build <terrain> tiles');assert.match(await worker.innerText(),/Claude Opus 5.5 · high reasoning/);await worker.click();assert.equal(await panel.locator('details[data-run=remote] summary .run-assignment').innerText(),'Build <terrain> tiles');assert.match(await panel.locator('details[data-run=remote] .x').innerText(),/Outcome[\s\S]*Finished mesh/);assert.equal(await panel.locator('details[data-run="remote"]').count(),1);assert.match(await panel.innerText(),/Created by Mira/);assert.match(await panel.locator('.turn').innerText(),/Build terrain/);assert.doesNotMatch(await panel.innerText(),/Foreign run/);
 await page.evaluate(()=>{const f=window.fixture;const make=(runId,state,options={})=>({runId,sessionId:window.activeChatSessionId,mode:'background',command:runId,state,...options});f.sourcePanelState.processRuns=[make('preview','running'),make('build','exited',{exitCode:0}),make('lint','exited',{exitCode:1}),make('foreground','running',{mode:'foreground'})];window.setSourcePanelTab('overview');});
 const processes=panel.locator('.sec').filter({has:page.getByRole('heading',{name:'Background processes'})}),completed=processes.locator('details');assert.equal(await completed.evaluate(e=>e.open),false);assert.match(await processes.innerText(),/preview/);assert.doesNotMatch(await processes.innerText(),/lint|build|foreground/);await completed.locator('summary').click();assert.match(await completed.innerText(),/build[\s\S]*Complete/);assert.match(await completed.innerText(),/lint[\s\S]*Failed/);assert.equal(await completed.locator('button').count(),2);
 await page.evaluate(()=>{const f=window.fixture;Object.assign(f.sourcePanelState.processRuns[0],{state:'exited',exitCode:0});f.renderSourcePanel();});assert.match(await processes.innerText(),/No active processes/);assert.equal(await completed.locator('button').count(),3);
 for(const skin of ['p1','gray','dark','blue','purple']){const paints=await page.evaluate(async skin=>{document.documentElement.dataset.skin=skin;delete document.documentElement.dataset.skinKind;await new Promise(r=>setTimeout(r,250));return ['#chat-view .chat-input-area','#right-panel','#source-panel-body'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)},skin);assert.equal(new Set(paints).size,1,skin+': '+paints);}
 console.log('Desktop Sources:',JSON.stringify({quiet,busy,laptop}),'; navigation, scoping and draft preservation passed');
} finally { await browser.close(); }
