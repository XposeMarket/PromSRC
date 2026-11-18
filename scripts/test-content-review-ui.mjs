import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root=process.cwd(); const out=path.resolve('.pr/content-review-ui');fs.mkdirSync(out,{recursive:true});
const fixture={id:'preview-fixture',sessionId:'fixture',status:'pending',toolName:'request_final_action_approval',approvalKind:'final_action',action:'Post to Instagram',riskScore:7,policyTier:'commit',finalAction:{actionKind:'post',targetLabel:'Post',summary:'Publish the reviewed image and caption to @example.studio',surface:'Instagram',nextToolName:'browser_click',contentReview:{kind:'post',text:'Your first five minutes don’t have to belong to your notifications.\n\nCoffee first. Everything else can wait.\n\nWhat’s your morning ritual?\n\n#SlowMornings #DailyRitual',platform:'Instagram',account:'@example.studio',visibility:'Public',timing:'After approval',media:[{kind:'image',path:'fixture/campaign.png',label:'Campaign artwork'}]}}};
let changes=0;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.endsWith('/content-changes')){changes++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true}));return;}
 if(u.pathname==='/api/canvas/inline'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#e8dfd1"/><text x="40" y="70" fill="#453d32" font-family="sans-serif" font-size="15">THE DAILY RITUAL</text><text x="40" y="145" fill="#453d32" font-family="Georgia" font-size="44">Make room for</text><text x="40" y="200" fill="#453d32" font-family="Georgia" font-size="44">a slower morning.</text><ellipse cx="450" cy="355" rx="85" ry="12" fill="#c2b7a6"/><path d="M385 260h120v40q0 50-60 50t-60-50z" fill="#948068"/><path d="M505 270h20q30 0 20 25t-40 15" fill="none" stroke="#948068" stroke-width="8"/></svg>');return;}
 if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,sessions:[],approvals:[],teams:[],models:[],status:'ok'}));return;}
 if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/mobile.css"><style>body{background:#171918;color:#ecebe7;font:14px system-ui;padding:16px;margin:0}#host{max-width:520px;margin:auto}.chat-approval-card{padding:16px;border-radius:18px;border:1px solid #454944;background:#222522}button{color:inherit;background:#303630;border:1px solid #5b6559;border-radius:9px;padding:10px}a{color:inherit}textarea{font:inherit} [hidden]{display:none!important}</style><div id="host"></div>');return;}
 const p=path.resolve(root,'web-ui/src',decodeURIComponent(u.pathname.slice(1)));
 if(!p.startsWith(path.join(root,'web-ui/src'))||!fs.existsSync(p)){res.statusCode=404;res.end();return;}
 let data=fs.readFileSync(p);if(p.endsWith('TeamsPage.js'))data=Buffer.from(data+'\nexport { renderTeamInlineApprovalCard as testCard };');
 if(p.endsWith('mobile-pages.js'))data=Buffer.from(data+'\nexport { _renderMobileApprovalCard as testCard };');
 res.setHeader('Content-Type',/\.m?js$/.test(p)?'text/javascript':p.endsWith('.css')?'text/css':'text/plain');res.end(data);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
 for(const [surface,width] of [['mobile',390],['desktop',1100]]){
  const page=await browser.newPage({viewport:{width,height:1050},isMobile:surface==='mobile',hasTouch:surface==='mobile'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));await page.goto(origin);
  await page.evaluate(async({fixture,surface})=>{const mod=await import(surface==='mobile'?'/mobile/mobile-pages.js':'/pages/TeamsPage.js');window.fixture=fixture;window.card=mod.testCard;document.querySelector('#host').innerHTML=window.card(fixture);},{fixture,surface});
  await page.locator('.content-review img').waitFor(); await page.waitForFunction(()=>document.querySelector('.content-review img').naturalWidth>0);
  assert.equal(await page.locator('.content-review-text').innerText(),fixture.finalAction.contentReview.text);
  assert.ok(await page.locator('.content-review').innerText().then(t=>t.includes('@example.studio')));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'no horizontal viewport overflow');
  await page.screenshot({path:path.join(out,`${surface}.png`),fullPage:true});
  await page.locator('[data-content-review-edit]').click();await page.locator('textarea[data-content-review-draft]').fill('Revised caption for fresh review.');
  await page.evaluate(()=>{document.querySelector('#host').innerHTML=window.card(window.fixture)});
  assert.equal(await page.locator('[data-content-review-draft]').inputValue(),'Revised caption for fresh review.');
  assert.equal(await page.locator('[data-content-review-editor]').isVisible(),true);
  await page.locator('[data-content-review-send]').click();await page.getByText('Changes requested. This request cannot post;', {exact:false}).waitFor();
  await page.screenshot({path:path.join(out,`${surface}-changes.png`),fullPage:true});
  const bad=await page.evaluate(async()=>{const {renderContentReview}=await import('/components/ContentReview.js');return renderContentReview({contentReview:{kind:'post',text:'<img src=x onerror=alert(1)>',media:[{kind:'image',path:'https://evil.example/x.png'}]}})});
  assert.ok(bad.includes('&lt;img'));assert.ok(!bad.includes('src="https://evil'));
  assert.deepEqual(errors,[],surface+' runtime errors');await page.close();
 }
 assert.equal(changes,2);console.log('PASS actual mobile + desktop Teams renderers, media, full caption, draft refresh, request changes, escaping, responsive layout');
}finally{await browser.close();server.close();}
