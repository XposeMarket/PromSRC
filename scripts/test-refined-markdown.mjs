import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web-ui');
const out = path.join(root, '.pr', 'screenshots');
await fs.mkdir(out, { recursive: true });
const types = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml' };
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'); return; }
    const file = path.resolve(web, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(web + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});
const markdown = '# A cleaner reading experience\n\nThe same conversation, with **clearer hierarchy** and comfortable spacing.\n\n## What changed\n\nOpen `settings.json` to change the defaults.\n\n- Restrained emphasis, not heavier text.\n- Readable code and quiet containers.\n  - Nested details still belong to the list.\n\n> Good formatting should guide attention, not compete for it.\n\n## A small code example\n\n```javascript\nconst message = "Hey Raul";\nconsole.log(message);\n```\n\n[View documentation](https://example.com)\n\n### Supporting detail\n\nA casual reply still stays casual.\n\n| Element | Treatment |\n| --- | ---: |\n| Inline code | Subtle surface |\n| Quotes | Thin accent rail |\n\n---\n\n- [x] Preview the reading style\n- [ ] Approve the PR\n\n#### Detail\n##### Smaller\n###### Quiet label';
let checks=0;
try {
 for (const mobile of [false,true]) for (const light of [false,true]) {
  const page = await browser.newPage({viewport:{width:mobile?390:1200,height:900},deviceScaleFactor:1});
  await page.goto(origin+'/fixture');
  const entry = await fs.readFile(path.join(web,mobile?'mobile.html':'index.html'),'utf8');
  const css = [...entry.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>m[1]).filter(h=>!h.startsWith('http'));
  assert(css.some(h=>h.includes('refined-markdown.css')));
  for (const href of css) await page.addStyleTag({url:new URL(href,origin+'/').href});
  for(const surface of ['desktop','mobile']) assert((await fs.readFile(path.join(web,'src/styles',surface+'-entry.css'),'utf8')).includes("@import './refined-markdown.css'"));
  if(process.argv.includes('--production')) {
   const dir=path.join(root,'generated/public-web-ui');const manifest=JSON.parse(await fs.readFile(path.join(dir,'asset-manifest.json'),'utf8'));
   const compiled=await fs.readFile(path.join(dir,manifest.entries[mobile?'mobile':'desktop'].css),'utf8');assert(compiled.includes('--rmd-text'),'production bundle includes Refined');
   await page.addStyleTag({content:compiled});
  }
  // Exercise desktop shell's late-loaded mobile stylesheet as well.
  if(mobile) { await page.addStyleTag({url:origin+'/src/styles/mobile.css'}); await page.addStyleTag({url:origin+'/src/styles/mobile-surfaces.css'}); }
  await page.addScriptTag({url:origin+'/src/theme-registry.js'});
  await page.addScriptTag({path:path.join(path.dirname(require.resolve('dompurify')),'purify.min.js')});
  await page.addScriptTag({path:path.join(path.dirname(require.resolve('marked')),'marked.umd.js')});
  await page.evaluate(async ({mobile,light,markdown})=>{
   window.PROM_APPLY_THEME_ATTRIBUTES(light?'parchment':'p1');
   document.body.className=mobile?'pm-mobile-active':'';
   const {renderMd}=await import('/src/utils.js');
   const html=renderMd(markdown);
   const content=mobile?`<div class="pm-msg from-ai"><div class="pm-bubble"><div id="prose" class="markdown-body">${html}</div></div></div>`:`<div class="msg assistant"><div id="prose" class="msg-content markdown-body">${html}</div></div>`;
   const user=mobile?'<div class="pm-msg from-user"><div class="pm-bubble"><div class="markdown-body"><strong id="user">User emphasis</strong></div></div></div>':'<div class="msg user"><div class="msg-content markdown-body"><strong id="user">User emphasis</strong></div></div>';
   const live=mobile?`<div class="pm-msg from-ai"><div class="pm-bubble"><div id="live" class="pm-live-md">${html}</div></div></div>`:`<div class="live-turn-prose"><div id="live" class="live-turn-md">${html}</div></div>`;
   document.body.innerHTML=`<main id="chat-view"><section id="capture">${content}</section><section id="checks">${user}${live}</section></main>`;
   document.getElementById('prose').insertAdjacentHTML('beforeend','<div class="pcx"><h2 id="card-heading">Card title</h2></div>');
  },{mobile,light,markdown});
  // Only fixture positioning; all prose and card typography uses product CSS.
  await page.addStyleTag({content:`body{display:block!important;margin:0!important;padding:24px ${mobile?'16':'40'}px!important;overflow:auto!important;background:${light?'#faf8f2':'#17191e'}!important}#chat-view{display:block!important;position:relative;z-index:1;max-width:680px;margin:auto;font-family:var(--pm-font,var(--font,system-ui))}#capture .msg,#capture .pm-msg{display:block}#capture .pm-bubble{max-width:100%;width:100%;padding:0;background:none;box-shadow:none}#checks{margin-top:40px}`});
  const before=await page.evaluate(()=>{
   const sheet=[...document.styleSheets].find(s=>s.href?.includes('refined-markdown.css'));sheet.disabled=true;
   const result=['user','card-heading'].map(id=>{const s=getComputedStyle(document.getElementById(id));return [s.fontSize,s.fontWeight,s.color]});sheet.disabled=false;return result;
  });
  const result=await page.evaluate(()=>{
   const root=document.getElementById('prose');const style=s=>getComputedStyle(root.querySelector(s));
   return {h1:style('h1').fontSize,h2:style('h2').fontSize,bold:style('strong').fontWeight,inline:style('p code').borderTopWidth,quote:style('blockquote').borderLeftWidth,code:style('pre code').whiteSpace,live:getComputedStyle(document.querySelector('#live h1')).fontSize,unchanged:['user','card-heading'].map(id=>{const s=getComputedStyle(document.getElementById(id));return[s.fontSize,s.fontWeight,s.color]}),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(result.h1,'25px');assert.equal(result.h2,'17px');assert.equal(result.bold,'620');assert.equal(result.inline,'1px');assert.equal(result.quote,'2px');assert.equal(result.code,'pre');assert.equal(result.live,'25px');if(!process.argv.includes('--production')) assert.deepEqual(result.unchanged,before);assert.equal(result.overflow,false);checks+=9;
  assert.equal(await page.locator('#prose td').nth(1).evaluate(e=>getComputedStyle(e).textAlign),'right');checks++;
  await page.locator('#capture').screenshot({path:path.join(out,`${mobile?'mobile':'desktop'}-${light?'light':'dark'}.png`)});
  await page.evaluate(()=>{document.querySelector('#prose pre code').textContent='long_code_'.repeat(100);document.querySelector('#prose td').textContent='LONG_TABLE_VALUE_'.repeat(80)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;
  if(mobile){
   const source=await fs.readFile(path.join(web,'src/mobile/mobile-tasks-pages.js'),'utf8');
   const fn=source.slice(source.indexOf('function _pmRenderLiveCard('),source.indexOf('\nfunction _pmRenderActivity'));
   await page.evaluate(({fn})=>{
    const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const render=new Function('buildTaskCard','escapeHtml','_pmBrainTaskLabel','renderProviderLogo','_pmLrSegments',fn+';return _pmRenderLiveCard;')(x=>x,esc,()=>'',()=>'',()=> '');
    const base={id:'sample',kind:'scheduled',status:'complete',tone:'success',avatar:{},initials:'P',sub:'started 13m ago · Claude Opus 5.5',progress:{total:0},terminal:true};
    document.getElementById('chat-view').innerHTML='<section id="tasks">'+[ {actor:'Scheduled · Merge Steward: PR triage + deploy',title:'Merge Steward: PR triage + deploy'},{actor:'Prometheus plan',title:'Resume connected-memory Stage D (team reuse) and get it to a PR'}].map(x=>render({...base,...x})).join('')+'</section>';
   },{fn});
   const task=await page.evaluate(()=>['actor','title','sub'].map(c=>{let s=getComputedStyle(document.querySelector('.pm-lr-'+c));return[s.fontSize,s.fontWeight]}));
   assert.deepEqual(task,[['12px','500'],['15px','600'],['11px','400']]);checks++;
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.waitForTimeout(800);
   assert(await page.locator('.pm-lr-title').first().isVisible(), 'task titles visible');
   await page.locator('#tasks').screenshot({path:path.join(out,`tasks-${light?'light':'dark'}.png`)});
  }
  await page.close();
 }
 console.log(`PASS Refined Markdown: ${checks} browser assertions, desktop/mobile light/dark + live + task hierarchy. Screenshots: ${out}`);
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
