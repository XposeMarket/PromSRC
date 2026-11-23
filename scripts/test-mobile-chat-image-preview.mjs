import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = name => readFile(new URL('../web-ui/src/' + name, import.meta.url), 'utf8');
assert.match(await source('mobile/mobile-router.js'), /installChatImagePreview\(document.body\)/);
const names = ['Dawn', 'High tide', 'Dusk', 'Night'];
const svg = i => `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="510" viewBox="0 0 700 510"><rect width="700" height="510" fill="${['#b4d0d0','#a9c7d4','#caada3','#676c87'][i]}"/><circle cx="477" cy="150" r="61" fill="#ffe3ad"/><path d="M0 330L210 196 380 325 515 244 700 340V510H0Z" fill="#628589"/><path d="M0 335Q210 270 365 360T700 330V510H0Z" fill="#325f68"/></svg>`;
const btn = (i, attr='data-pm-media') => `<button ${attr} data-kind="image" data-name="${names[i]}" data-src="/img/${i}"><img src="/img/${i}" alt="${names[i]}"></button>`;
const browser = await chromium.launch({channel:'chromium'});
try {
 for (const mobile of [false,true]) {
  const page = await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1000,height:700},isMobile:mobile,hasTouch:mobile});
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await page.route('http://gallery.test/**', async r=>{
    const p=new URL(r.request().url()).pathname;
    if(p.startsWith('/src/')) return r.fulfill({contentType:p.endsWith('.js')?'text/javascript':'text/css',body:await source(p.slice(5))});
    if(p.startsWith('/img/')) return r.fulfill({contentType:'image/svg+xml',body:svg(Number(p.slice(5)))});
    return r.fulfill({contentType:'text/html', body:`<meta name="viewport" content="width=device-width,initial-scale=1"><body class="${mobile?'pm-mobile-active':''}"><style>body{font:16px system-ui;background:#212124;color:#eee;margin:22px}.pm-msg{padding:14px}.pm-msg img{width:42px}main{height:65vh;overflow:auto}</style><h2>Chat</h2><main><div style="height:65vh"></div><section class="pm-msg"><p>Three views of the coast.</p>${mobile?btn(0):''}<div id="gallery"></div>${mobile?`<div>${btn(2,'data-pm-media data-pm-generated-primary')}${btn(0,'data-pm-generated-thumb')}${btn(2,'data-pm-generated-thumb')}</div>`:''}<button data-pm-media data-kind="video">Clip</button></section><section class="pm-msg"><img class="prom-inline-media" tabindex="0" role="button" src="/img/3" alt="Night"></section></main><script type="module">import {renderDataCard,installPromCards} from '/src/cards/index.js';import {installChatImagePreview} from '/src/mobile/mobile-chat-image-preview.js';const names=${JSON.stringify(names)};document.querySelector('#gallery').innerHTML=renderDataCard({type:'gallery',items:${mobile?'[1]':'[0,1,2]'}.map(i=>({title:names[i],url:'/img/'+i}))});installPromCards();installChatImagePreview(document.body);window.legacy=0;document.body.addEventListener('click',e=>{if(e.target.closest('[data-pm-media]')) window.legacy++});window.ready=true;</script>`});
  });
  await page.goto('http://gallery.test/');await page.waitForFunction(()=>window.ready);
  const tile=page.locator('.pc-gallery-tile').nth(mobile?0:1), dialog=page.getByRole('dialog',{name:'Image gallery'});
  await tile.scrollIntoViewIfNeeded();const scroll=()=>page.locator('main').evaluate(el=>el.scrollTop);const before=await scroll();
  if(mobile) await tile.tap();else await tile.click();
  assert.equal(await dialog.locator('img').getAttribute('alt'),'High tide');assert.equal(await dialog.locator('figcaption span').innerText(),'2 / 3');
  assert.equal(await dialog.getByText('Open in Canvas').count(),0);
  await dialog.locator('img').evaluate(el=>el.decode());
  const shot=mobile?process.env.PREVIEW_SCREENSHOT:process.env.DESKTOP_SCREENSHOT;if(shot) await page.screenshot({path:shot});
  if(mobile){const rect=await dialog.locator('img').boundingBox();const cdp=await page.context().newCDPSession(page);for(const [type,pos] of [['touchStart',.79],['touchMove',.62],['touchMove',.42],['touchMove',.22],['touchEnd',null]]) await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pos===null?[]:[{x:rect.x+rect.width*pos,y:rect.y+rect.height*.6}]});}else await page.keyboard.press('ArrowRight');
  assert.equal(await dialog.locator('img').getAttribute('alt'),'Dusk');await dialog.getByLabel('Next',{exact:true}).click();assert.equal(await dialog.locator('img').getAttribute('alt'),'Dawn');await dialog.getByLabel('Previous',{exact:true}).click();assert.equal(await dialog.locator('img').getAttribute('alt'),'Dusk');
  await dialog.getByLabel('Close').click();assert.equal(await scroll(),before);
  if(mobile){await page.locator('[data-pm-generated-primary]').click();assert.equal(await dialog.locator('figcaption span').innerText(),'3 / 3');await page.keyboard.press('Escape');await page.locator('.prom-inline-media').focus();await page.keyboard.press('Enter');assert.equal(await dialog.locator('img').getAttribute('alt'),'Night');assert.equal(await dialog.locator('.pc-lb-nav').count(),0);await page.keyboard.press('Escape');await page.getByText('Clip',{exact:true}).tap();assert.equal(await page.evaluate(()=>window.legacy),1);}
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: desktop gallery click + mobile mixed-message gallery, swipe, wrap, keyboard, single image, scroll restoration, non-image fallback');
} finally {await browser.close();}
