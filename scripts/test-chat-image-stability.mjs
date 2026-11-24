import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Exercise the shared production row renderer, with each surface's real CSS.
const src = resolve(process.env.CHAT_IMAGE_TEST_SOURCE || 'web-ui/src');
const browser = await chromium.launch({channel:'chromium'});
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: {width: mobile ? 390 : 1050, height: 760}, isMobile: mobile });
    await page.route('http://img.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/src/')) return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:await readFile(resolve(src,path.slice(5)))});
      if (path.endsWith('.svg')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="610"><rect width="256" height="610" fill="#32485c"/><path d="M20 30h216m-216 24h160m-160 24h184" stroke="#d5e3ec" stroke-width="7"/></svg>'});
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles/${mobile?'mobile':'components'}.css"><style>main{max-width:720px;margin:auto;padding:16px}#rows img{width:50px}</style><main><h3>Tool screenshot</h3><div class="${mobile?'pm-trace':'live-turn'}-vision-break"><button class="${mobile?'pm-live':'live-turn'}-vision-preview" style="--vision-aspect:256/610;--pm-vision-aspect:256/610"><img src="/portrait.svg"></button></div><section id="rows"></section></main>`});
    });
    await page.goto('http://img.test/');
    const result = await page.evaluate(async mobile => {
      const {reconcileKeyedTimelineRows:render} = await import('/src/features/chat/timeline/keyed-dom.js');
      const {setInnerHTMLPreservingVisuals:setContents} = await import('/src/utils.js');
      const root = document.querySelector('#rows');
      const key = mobile?'pm':'chat';
      const paint = (i,img='/attachment.svg') => render(root,`<article data-${key}-row-key="sent" data-${key}-row-signature="${i}"><p>Sent attachment</p>${i%2?'<span></span>':''}<button><img loading="lazy" src="${img}"></button><p>Update ${i}</p></article>`,{setContents});
      paint(0);
      const image = root.querySelector('img'); image.scrollIntoView();
      if (!image.complete || !image.naturalWidth) await new Promise((ok,fail)=>{ image.onload=ok; image.onerror=()=>fail(Error('Fixture load failed: '+image.src)); });
      await image.decode();
      const height = root.getBoundingClientRect().height;
      let remounts=0, shifts=0;
      for (let i=1;i<=30;i++) {
        paint(i); await new Promise(requestAnimationFrame);
        if (root.querySelector('img')!==image) remounts++;
        if (Math.abs(root.getBoundingClientRect().height-height)>1) shifts++;
      }
      const rect=document.querySelector('main > div > button').getBoundingClientRect();
      paint(31,'/different.svg');
      const changed=root.querySelector('img').getAttribute('src')==='/different.svg';
      render(root,'',{setContents});
      return {remounts,shifts,width:rect.width,height:rect.height,changed,removed:!root.querySelector('img')};
    },mobile);
    console.log(mobile?'mobile':'desktop',result);
    assert.equal(result.remounts,0); assert.equal(result.shifts,0);
    assert.ok(result.width<=169 && result.width>=96 && result.height<=141); assert.ok(result.changed && result.removed);
    if (!mobile) await page.evaluate(async () => {
      const {preserveVisualIframes: patch} = await import('/src/utils.js');
      const body = document.querySelector('#rows');
      for (const type of ['question', 'approval']) {
        const markup = (i,id) => `<p>${i}</p>${i % 2 ? '<em>stream</em>' : ''}<img src="/attachment.svg"><div class="chat-${type}-card" data-${type}-id="${id}"><input></div>`;
        body.innerHTML = markup(0,'one'); const img = body.querySelector('img'), input = body.querySelector('input');
        input.value = 'draft'; input.focus();
        for(let i=1;i<=30;i++){ const t=document.createElement('template'); t.innerHTML=markup(i,'one'); patch(body,t.content);
          if(body.querySelector('img')!==img || body.querySelector('input')!==input || document.activeElement!==input || input.value!=='draft') throw Error(type+' remounted or lost input'); }
        const t=document.createElement('template'); t.innerHTML=markup(31,'two'); patch(body,t.content);
        if(body.querySelector('input')===input || body.querySelector('input').value) throw Error('new card inherited old state');
      }
    });
    if(process.env.CHAT_IMAGE_SHOTS) await page.screenshot({path:resolve(process.env.CHAT_IMAGE_SHOTS,`${mobile?'mobile':'desktop'}-trace.png`)});
    await page.close();
  }
} finally {await browser.close();}
