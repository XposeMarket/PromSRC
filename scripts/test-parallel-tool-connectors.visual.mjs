import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const out=process.env.CONNECTOR_SCREENSHOTS||'.pr/connector-screens';fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let p=path.join(root,decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'text/plain');res.end(fs.readFileSync(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,1024])for(const theme of ['blue','gold','light']){
  const page=await browser.newPage({viewport:{width,height:850}});
  await page.goto(base+'/package.json');
  await page.setContent(`<html><head><link rel="stylesheet" href="${base}/web-ui/src/styles/components.css"><link rel="stylesheet" href="${base}/web-ui/src/styles/mobile.css"><link rel="stylesheet" href="${base}/web-ui/src/styles/mobile-composer-stack.css"><style>body{margin:0;padding:24px;box-sizing:border-box;background:var(--bg)!important;color:var(--text)!important;font-family:Arial}#sample{background:var(--bg);color:var(--text);padding:8px}#sample{max-width:650px}.pm-live-trace,.live-turn-trace{display:flex;flex-direction:column;gap:6px}h3{font-size:15px;font-weight:500}p{font-size:13px;color:var(--muted)}</style></head><body class="${width<700?'pm-mobile-active':''}"><section id="sample"><p>Actual shared tool renderer · ${theme}</p><h3>Checking the stream renderer</h3><div class="${width<700?'pm-trace-tool-body':'live-turn-tool-body'}"><div id="rows" class="${width<700?'pm-live-trace':'live-turn-trace'}"></div></div></section></body></html>`);
  await page.evaluate(async({base,theme})=>{
   const color=theme==='blue'?'#3d8bff':theme==='gold'?'#d9b66b':'#14786c';const light=theme==='light';
   for(const [k,v]of Object.entries({'--accent':color,'--pm-accent':color,'--bg':light?'#f5f3ee':'#101011','--text':light?'#18191b':'#dedee3','--muted':light?'#535862':'#92929d','--pm-text':light?'#18191b':'#dedee3','--pm-muted':light?'#535862':'#92929d'}))document.documentElement.style.setProperty(k,v,'important');
   document.body.style.setProperty('background',light?'#f5f3ee':'#101011','important');
   document.querySelector('#sample').style.setProperty('background',light?'#f5f3ee':'#101011','important');
   const m=await import(base+'/web-ui/src/tool-activity.js');window.tools=m;
   const trace=[];const names=['read_file','search_files','workspace_run','write_note'];
   names.forEach((name,i)=>{m.applyToolActivityEvent(trace,'call',{action:name,args:{filename:'web-ui/src/mobile/mobile-chat-renderer-runtime.js',query:'reasoning summary grouping boundary test that wraps on mobile',command:'node scripts/test-stream-connectors.mjs'},toolCallId:'c'+i,...(i<3?{parallelGroupId:'batch-a',parallelIndex:i,parallelSize:3}:{})});});
   document.querySelector('#rows').innerHTML=trace.map(e=>m.renderToolActivityEntry(e)).join('');
   m.installToolActivityExpansionPersistence(document);m.refreshParallelToolConnectors(document);
  },{base,theme});
  await page.waitForTimeout(180);
  await page.evaluate(theme=>{const bg=theme==='light'?'#f5f3ee':'#101011';document.body.style.setProperty('background',bg,'important');document.querySelector('#sample').style.setProperty('background',bg,'important');},theme);
  for(const expanded of [false,true]){
   if(expanded){await page.evaluate(()=>{const row=document.querySelector('.tool-activity-wrap');const d=document.createElement('div');d.textContent='Expanded tool details, several lines below the first icon.';d.style.height='90px';row.appendChild(d);});await page.waitForTimeout(120);}
   const metrics=await page.evaluate(()=>{
    window.tools.refreshParallelToolConnectors(document);
    return {overflow:document.documentElement.scrollWidth>innerWidth,lines:[...document.querySelectorAll('.tool-parallel-connector')].map(l=>{const r=l.closest('.tool-activity-wrap'),a=r.querySelector('.tool-activity-tool-icon,.tool-activity-connector-logo').getBoundingClientRect(),b=r.nextElementSibling.querySelector('.tool-activity-tool-icon,.tool-activity-connector-logo').getBoundingClientRect(),c=l.getBoundingClientRect();return {visible:c.height>0&&l.getClientRects().length>0,top:c.top-a.bottom,bottom:b.top-c.bottom,x:Math.abs(c.left+.5-a.left-a.width/2),color:getComputedStyle(l).backgroundColor};})};
   });
   assert.equal(metrics.overflow,false);assert.equal(metrics.lines.length,2,JSON.stringify({width,theme,expanded,metrics}));for(const x of metrics.lines){assert(x.visible,'connector must render in collapsed/expanded state');assert(x.top>=2.99&&x.bottom>=2.99);assert(x.x<.6);}
   if(width===390||width===1024)await page.locator('#sample').screenshot({path:path.join(out,`${width}-${theme}${expanded?'-expanded':''}.png`)});
   console.log(JSON.stringify({width,theme,expanded,...metrics}));
  }
  await page.close();
 }
}finally{await browser.close();server.close();}
console.log('actual renderer/CSS connector geometry PASS');
