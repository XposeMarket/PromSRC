import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { chromium, webkit } from 'playwright';
const root = process.cwd(), web = path.join(root, 'web-ui');
const out = path.join(root, '.pr/screenshots'); await fs.mkdir(out, {recursive:true});
const server = http.createServer(async(req,res)=>{try {
 const url = new URL(req.url,'http://localhost');
 if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><main></main>');return;}
 const file=path.resolve(web,'.'+url.pathname); if(!file.startsWith(web+path.sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',path.extname(file)==='.js'?'text/javascript':path.extname(file)==='.css'?'text/css':'text/plain');res.end(await fs.readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
try { for(const [engine,width,label] of [[chromium,1200,'desktop'],[webkit,390,'mobile'],[chromium,320,'narrow']]) {
 const browser=await engine.launch({headless:true});
 try {const page=await browser.newPage({viewport:{width,height:900}}); await page.goto(origin+'/fixture');
 await page.addStyleTag({content:'body{margin:0;background:#303644;color:#e5e7eb;font:14px system-ui}main{max-width:680px;margin:24px auto;padding:20px}h2{font-size:18px}pre{background:rgba(0,0,0,.15);padding:10px;border-radius:4px}a{color:#9ad4dc}blockquote{margin-left:0;padding-left:12px;border-left:2px solid #778}'});
 await page.addScriptTag({path:path.join(path.dirname(require.resolve('dompurify')),'purify.min.js')});
 await page.addScriptTag({path:path.join(path.dirname(require.resolve('marked')),'marked.umd.js')});
 await page.evaluate(async()=>{
  const {renderMd}=await import('/src/utils.js');
  const {renderTaskTool,renderTaskEvidence,rememberTaskTools}=await import('/src/features/tasks/task-detail-render.js');
  const main=document.querySelector('main');
  const pending=renderTaskTool({t:3,name:'workspace_run',pending:true},renderMd,'','task:1');
  if(!pending.includes('running…') || !pending.includes('Waiting for result…')) throw Error('Missing pending status');
  const other=renderTaskTool({t:3,name:'workspace_run',pending:true},renderMd,'','task:2');
  if(pending===other) throw Error('Disclosure identities collide');
  const note='## Verification notes\n\nChecked **mobile and desktop**.\n\n- Notes retain Markdown formatting.\n- Tool details stay collapsed until opened.\n\n> Existing glass navigation stays unchanged.\n\nUse `workspace_run` to inspect the test output.\n\n<img src=x onerror="window.pwned=1">';
  main.innerHTML='<h2>Activity</h2>'+renderTaskTool({t:1,name:'workspace_run',call:JSON.stringify({command:'npm run check:web-ui'}),result:'**Passed.** No errors.'},renderMd)+renderTaskTool({t:2,name:'write_note',call:JSON.stringify({content:'Verification completed'}),result:'Note saved.'},renderMd)+'<h2>Evidence</h2>'+renderTaskEvidence([{title:'Run note',content:note}],renderMd);
  window.restoreTools=rememberTaskTools; window.original=main.innerHTML;
 });
 assert.equal(await page.locator('details[open]').count(),0);
 assert.equal(await page.locator('details').first().locator('pre').isVisible(),false);
 assert.equal(await page.locator('.task-evidence-prose strong').innerText(),'mobile and desktop');
 assert.equal(await page.evaluate(()=>window.pwned),undefined);
 await page.screenshot({path:path.join(out,`${label}-collapsed.png`),fullPage:true});
 await page.locator('summary').first().click(); assert.equal(await page.locator('details[open]').count(),1);
 await page.evaluate(()=>{const root=document.querySelector('main'); const restore=window.restoreTools(root);root.innerHTML=window.original;restore();});
 assert.equal(await page.locator('details[open]').count(),1);
 assert.equal(await page.locator('details').first().locator('pre').isVisible(),true);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(out,`${label}-expanded.png`),fullPage:true});
 await page.locator('summary').first().click(); assert.equal(await page.locator('details[open]').count(),0);
 console.log(`PASS ${label}: disclosure, refresh, Markdown, escaping, overflow`);
 }finally{await browser.close();}
}}finally{server.close();}
