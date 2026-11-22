import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('generated/public-web-ui'), base='http://localhost:38132', browser=await chromium.launch(), shots=process.env.ROSTER_SHOTS;
if(shots) fs.mkdirSync(shots,{recursive:true});
try { for(const [kind,width] of [['subagents',390],['teams',320]]) {
  const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await page.addInitScript(()=>{localStorage.setItem('pm_force_mobile','1');localStorage.setItem('pm_device_token','fixture');});
  const rows=['Earlier','Latest'].map((name,i)=>({id:'r'+i,name,subagentIds:[],lastRunAt:i+5,lastRun:{startedAt:i+5,inProgress:!!i},running:!!i}));
  await page.route('**/*',route=>{const {origin,pathname:p}=new URL(route.request().url());if(origin!==base)return route.abort(); if(p.startsWith('/api/'))return route.fulfill({json:{success:true,teams:rows,team:rows[1],agents:rows,sessions:[],tasks:[],projects:[],items:[]}});const file=path.join(root,p.startsWith('/mobile')&&!p.includes('.')?'mobile.html':p);if(p.endsWith('/mobile-shell.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')+'\nexport { _sessionButtonHtml as fixtureRow };'}); return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404});});
  await page.goto(base+'/mobile/chat');
  await page.waitForSelector('#pm-composer',{state:'attached'});
  const composer=await page.locator('#pm-composer').evaluate(el=>({height:el.offsetHeight,width:el.offsetWidth}));
  await page.evaluate(k=>location.hash='#mobile/'+k,kind);
  const dock=page.locator('.pm-roster-search'),search=dock.locator('input'),preview=page.locator('.pm-team-preview h3');
  await preview.waitFor({timeout:10000});assert.equal(await preview.textContent(),'Latest');assert.equal(await page.locator('.pm-team-tile.is-roster-working').count(),1);
  const bounds=await dock.boundingBox();assert.equal(bounds.height,composer.height);assert.ok(Math.abs(bounds.width-composer.width)<1);console.log(kind,{bounds,composer});
  if(shots) await page.screenshot({path:path.join(shots,kind+'.png')});
  await search.fill('Earlier');assert.equal(await page.locator('.pm-team-tile:visible').count(),1);assert.equal(await preview.isVisible(),false);
  await search.fill('not in roster');assert.equal(await page.locator('.pm-roster-no-match').isVisible(),true);await search.fill('');assert.equal(await preview.isVisible(),true);
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:500});visualViewport.dispatchEvent(new Event('resize'));});
  const kb=await dock.boundingBox();assert.ok(Math.abs(kb.y+kb.height-500)<2,JSON.stringify(kb));assert.equal(kb.height,bounds.height);await search.blur();
  const badges=await page.evaluate(async()=>{const mod=await import('/static/mobile/mobile-shell.js');return [{needsYou:true,activeRun:true,mobileUnread:true},{activeRun:true},{mobileUnread:true},{paused:true}].map((s,i)=>{const wrap=document.createElement('div');wrap.innerHTML=mod.fixtureRow({id:'fixture'+i,title:'Review '+i,...s});return wrap.firstElementChild.dataset.sessionState;});});
  assert.deepEqual(badges,['needs-you','working','unread','idle']);
  await page.close();
}
 const desk=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'});
 await desk.route('**/*',route=>{const {origin,pathname:p}=new URL(route.request().url());if(origin!==base)return route.abort();if(p.startsWith('/api/'))return route.fulfill({json:{success:true,authenticated:true,accountRequired:false,nextStep:'done',modelConnected:true,sessions:[],projects:[],tasks:[],items:[]}});const file=path.resolve('web-ui','.'+(p==='/'?'/index.html':p));return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404});});
 await desk.addInitScript(()=>{window.timeAgo=()=>"now";window.escHtml=v=>{const s=document.createElement('span');s.textContent=String(v);return s.innerHTML;};});await desk.goto(base+'/?desktop=1');await desk.waitForFunction(()=>typeof window.renderChatSessionCard==='function');
 const states=await desk.evaluate(()=>[false,true].map(priority=>[true,false].map(needsYou=>{const box=document.createElement('div');box.innerHTML=window.renderChatSessionCard({id:'fixture',title:'Review change',needsYou,activeRun:true,unread:true},{priority});return [box.firstElementChild.classList.contains('is-working'),box.querySelector('.session-wait-badge')?.textContent||''];})));
 assert.deepEqual(states,[[[false,'Needs you'],[true,'']],[[false,'Needs you'],[true,'']]]);await desk.close();
} finally {await browser.close();}
console.log('Roster search, preview, keyboard and sidebar states passed.');
