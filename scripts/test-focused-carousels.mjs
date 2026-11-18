import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web-ui');
const out = path.join(root, '.pr/screenshots');
await fs.mkdir(out, { recursive: true });
// Extract real renderer declarations, without bootstrapping unrelated app services.
async function declarations(file, names) {
  const text = await fs.readFile(path.join(web, file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
}
const desktop = await declarations('src/pages/ChatPage.js', ['pcRenderCarousel','pcCleanText','pcCleanTitle','pcCleanDescription','pcMerchantLabel','renderSourcesArtifact']);
const mobile = await declarations('src/mobile/mobile-pages.js', ['_renderMobileSources','_renderMobileProductCarousel','_productCarouselImageUrl']);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.endsWith('.svg')) { res.setHeader('Content-Type','image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#bc9964"/><circle cx="300" cy="190" r="90" fill="#38332b"/></svg>'); return; }
    if (url.pathname === '/fixture') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>'); return; }
    const file = path.resolve(web, '.' + url.pathname);
    if (!file.startsWith(web + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
let checks = 0;
try {
 for (const [engine, width] of [[chromium,1100],[webkit,390]]) {
  const browser = await engine.launch();
  try {
   for (const dark of [true,false]) {
    const page = await browser.newPage({viewport:{width,height:1000},hasTouch:width<500,reducedMotion:'reduce'});
    const errors = []; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/fixture');
    await page.evaluate(dark=>{document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.dataset.skin=dark?'p1':'light';},dark);
    await page.addStyleTag({url:origin+'/src/styles/components.css'});
    if(width<500)await page.addStyleTag({url:origin+'/src/styles/mobile.css'});
    await page.addStyleTag({content:`:root{--text:${dark?'#eee':'#222'};--muted:${dark?'#aaa':'#666'};--line:${dark?'#444':'#ddd'};--panel:${dark?'#202020':'#fff'};--pm-text:var(--text);--pm-muted:var(--muted);--pm-border:var(--line);--pm-surface:var(--panel);--pm-bg:var(--panel)}body{margin:0;background:${dark?'#141414':'#fafafa'}!important;color:var(--text)!important;font:15px system-ui}main{max-width:680px;padding:16px;margin:auto;min-width:0}h2{font-size:16px;font-weight:550}.pm-sources,.pm-product-carousel{max-width:100%}`});
    await page.evaluate(async ({desktop,mobile,isMobile}) => {
      const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.escHtml=window.escapeHtml=esc;
      window.pcUpdateProductCarouselArrows=()=>{};
      const render = new Function(desktop+'\n'+mobile+'\nreturn {sources:typeof renderSourcesArtifact!=="undefined"?renderSourcesArtifact:null,mobileSources:_renderMobileSources,products:pcRenderCarousel,mobileProducts:typeof _renderMobileProductCarousel!=="undefined"?_renderMobileProductCarousel:null};')();
      const sources = {title:'Reference reading',items:['CommonMark guide','CSS layout reference','Accessible interactions'].map((title,i)=>({title,url:'https://example.com/'+i,publisher:'Reference '+(i+1),snippet:'A useful reference for building readable interfaces.'}))};
      const svg = 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#bc9964"/><circle cx="300" cy="190" r="90" fill="#38332b"/></svg>');
      const products={title:'Example products',items:['Studio headphones','Compact speaker','Desk microphone'].map((title,i)=>({title,productUrl:'https://example.com/product/'+i,price:'$'+(99+i*40),merchant:'Example shop',description:'Illustrative product data',imageUrl:svg}))};
      const data = await import('/src/cards/cards-data.js');
      const main=document.createElement('main');
      main.className=isMobile?'pm-msg from-ai':'msg';
      const sourceRender=isMobile?render.mobileSources:render.sources;
      const productRender=isMobile?render.mobileProducts:render.products;
      if(!sourceRender||!productRender)throw Error('Renderer declaration missing');
      main.innerHTML='<h2>Sources</h2>'+sourceRender(sources)+'<h2>Products</h2>'+productRender(isMobile?{productCarousel:products}:products)+'<h2>Images</h2>'+data.renderDataCard({type:'gallery',id:'gallery-test',items:[0,1,2].map(i=>({url:'/image'+i+'.svg',thumbnail:'/thumb'+i+'.svg',title:'Image '+(i+1)}))});
      document.body.append(main);
      const runtime=await import('/src/cards/card-runtime.js');runtime.installPromCards();
      window.runtime=runtime;
    },{desktop,mobile,isMobile:width<500});
    await page.waitForSelector('.fc-controls');
    assert.equal(await page.locator('.fc-track').count(),3,`tracks at ${width}: ${await page.locator('main').innerHTML()}`); checks++;
    for (let i=0;i<3;i++) {
      const track=page.locator('.fc-track').nth(i);
      await track.focus(); await page.keyboard.press('End');
      await page.waitForFunction(i=>document.querySelectorAll('.fc-position')[i].textContent==='3 / 3',i);
      const delta=await track.evaluate(t=>{const a=t.lastElementChild.getBoundingClientRect(),b=t.getBoundingClientRect();return Math.abs(a.left+a.width/2-b.left-b.width/2)});
      assert.ok(delta<3,`end centered: ${delta}`);checks++;
      await page.keyboard.press('Home');
      await page.waitForFunction(i=>document.querySelectorAll('.fc-position')[i].textContent==='1 / 3',i);
      await page.locator('.fc-controls').nth(i).locator('button').last().click();
      await page.waitForFunction(i=>document.querySelectorAll('.fc-position')[i].textContent==='2 / 3',i);
      assert.equal(await track.locator('.fc-active').count(),1);checks++;
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
    const galleryStyle=await page.locator('.pc-gallery').evaluate(g=>{const s=getComputedStyle(g);return {border:s.borderTopWidth,padding:s.paddingTop,background:s.backgroundColor,header:getComputedStyle(g.querySelector('.pc-head')).display};});
    assert.deepEqual(galleryStyle,{border:'0px',padding:'0px',background:'rgba(0, 0, 0, 0)',header:'none'});checks++;
    const productLayout=await page.locator('.fc-track').nth(1).locator('.fc-active').evaluate(c=>{
      const image=c.querySelector('.pc-img-wrap,.pm-product-img-wrap');
      const title=c.querySelector('.pc-title,.pm-product-title');
      return {image:image.offsetHeight,details:c.offsetHeight-image.offsetHeight,minTitle:getComputedStyle(title).minHeight,titleWeight:getComputedStyle(title).fontWeight};
    });
    assert.ok(productLayout.image>productLayout.details,JSON.stringify(productLayout));checks++;
    assert.equal(productLayout.minTitle,'0px');checks++;
    assert.equal(productLayout.titleWeight,'600');checks++;
    const product=page.locator('.fc-track').nth(1).locator('a').first();
    assert.match(await product.getAttribute('href'),/example.com\/product/);checks++;
    await page.locator('.pc-gallery-tile').nth(1).click();
    await page.waitForSelector('.pc-lightbox');checks++;
    await page.keyboard.press('Escape');
    await page.evaluate(()=>document.querySelector('.pc-lightbox')?.remove());
    await page.evaluate(()=>{const first=document.querySelector('.fc-track');const clone=first.parentElement.cloneNode(true);clone.querySelectorAll('.fc-controls').forEach(n=>n.remove());clone.querySelector('.fc-track').replaceChildren(first.firstElementChild.cloneNode(true));document.body.append(clone);window.runtime.hydrateCards();});
    assert.equal(await page.locator('.fc-controls').count(),3);checks++;
    await page.evaluate(()=>document.body.lastElementChild.remove());
    const dragBlocked=await page.locator('.fc-track').first().evaluate(t=>{
      const a=t.querySelector('a');
      a.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:100,clientY:10}));
      a.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:40,clientY:10}));
      a.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      return !a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    });assert.ok(dragBlocked);checks++;
    await page.locator('.fc-track').first().evaluate(t=>t.append(t.firstElementChild.cloneNode(true)));
    await page.waitForFunction(()=>document.querySelector('.fc-position').textContent.endsWith('/ 4'));checks++;
    await page.locator('.fc-track').first().evaluate(t=>t.lastElementChild.remove());
    await page.waitForFunction(()=>document.querySelector('.fc-position').textContent.endsWith('/ 3'));checks++;
    await page.evaluate(()=>{window.reattach=document.querySelector('.fc-track').parentElement;window.marker=document.createComment('restore');window.reattach.before(window.marker);window.reattach.remove();});
    await page.waitForTimeout(80);
    await page.evaluate(()=>window.marker.replaceWith(window.reattach));
    await page.waitForFunction(()=>document.querySelectorAll('.fc-controls').length===3);checks++;
    await page.locator('.fc-track').first().focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>document.querySelector('.fc-position').textContent==='2 / 3');checks++;
    await page.setViewportSize({width:width-40,height:1000});
    await page.waitForTimeout(100);
    const centered=await page.locator('.fc-track').first().evaluate(t=>{const a=t.querySelector('.fc-active').getBoundingClientRect(),b=t.getBoundingClientRect();return Math.abs(a.left+a.width/2-b.left-b.width/2)<3});
    assert.ok(centered);checks++;
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
    assert.deepEqual(errors,[]);checks++;
    await page.locator('.fc-track').first().focus();await page.keyboard.press('Home');
    await page.waitForFunction(()=>document.querySelector('.fc-position').textContent==='1 / 3');
    await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.fc-position').textContent==='2 / 3');
    await page.locator('h2').first().click();
    await page.screenshot({path:path.join(out,`carousels-${width<500?'mobile':'desktop'}-${dark?'dark':'light'}.png`),fullPage:true});
    await page.close();
   }
  } finally {await browser.close();}
 }
 console.log(`PASS focused carousels: ${checks} checks, Chromium desktop + WebKit mobile, light/dark`);
} finally {server.close();}
