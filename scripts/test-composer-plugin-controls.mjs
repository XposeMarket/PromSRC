import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require=createRequire(import.meta.url);require('tsx/cjs');
const {pluginReferenceHint}=require('../src/gateway/chat/plugin-references.ts');
const catalog=[{group:'vercel',source:'connector',name:'list_deployments'},{group:'github',source:'connector',name:'list_repos'}];
assert.match(pluginReferenceHint('/vercel show status',catalog),/list_deployments/);
assert.doesNotMatch(pluginReferenceHint('/vercel show status',catalog),/list_repos/);
for(const text of ['https://test/vercel','/unknown','/vercel-other','/vercel/path']) assert.equal(pluginReferenceHint(text,catalog),'');
assert.equal(pluginReferenceHint('/vercel',[]),'');
const browser=await chromium.launch({channel:'chromium'});
try {for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:{width:mobile?390:960,height:650},isMobile:mobile});
 await page.route('http://test.local/**',async route=>{const p=new URL(route.request().url()).pathname;if(p.startsWith('/static/assets/'))return route.fulfill({contentType:'image/svg+xml',body:await readFile(resolve('web-ui/src',p.slice(8)))});return p==='/'?route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><body style="font:15px system-ui">'}):route.fulfill({contentType:'text/javascript',body:await readFile(resolve('web-ui/src',p.slice(1)))});});
 await page.goto('http://test.local/');
 const mount=()=>page.evaluate(async mobile=>{ const m=await import('/features/chat/composer-plugin-controls.js');const tag=mobile?'pm-chat-access':'prom-chat-access';window.commands=[];window.calls=[];let mode=sessionStorage.getItem('test-mode')||'default';m.installComposerControls(tag,commands,async(url,o)=>{if(url.includes('plugin-references'))return {plugins:[{id:'vercel',title:'Vercel'}]};if(o){calls.push(JSON.parse(o.body));mode=calls.at(-1).toolPermissionMode;sessionStorage.setItem('test-mode',mode);}return {success:true,toolPermissionMode:mode};},()=>window.advanced=true,()=>{const div=document.createElement('div');div.innerHTML=m.decoratePluginMarkdown('Check /vercel <code>/vercel</code> <a href="/vercel">link</a>',commands,s=>s);document.body.prepend(div);});document.body.append(document.createElement(tag));},mobile);
 await mount();
 const icon=selector=>page.locator(`${selector} svg path`).evaluate(el=>[getComputedStyle(el).fill,getComputedStyle(el).stroke]);
 await page.getByRole('button',{name:'Permissions: Default'}).click();assert.equal(await page.locator('.composer-plugin-label').count(),1);assert.equal(await page.locator('a').getAttribute('href'),'/vercel');
 assert.equal(await page.locator('#trigger').textContent(),'');assert.equal(await page.getByText('Lite skips routine approval prompts.',{exact:false}).count(),0);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.locator('#trigger').click();
 if(process.env.COMPOSER_PROOF){await mkdir(process.env.COMPOSER_PROOF,{recursive:true});await page.screenshot({path:resolve(process.env.COMPOSER_PROOF,(mobile?'mobile':'desktop')+'.png')});}
 assert.deepEqual(await icon('#trigger'),await icon('[data-mode=default]'));assert.equal((await icon('#trigger'))[0],'none');
 await page.getByRole('button',{name:'Lite Permissions',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls),[{toolPermissionMode:'lite'}]);
 await page.reload();await mount();await page.getByRole('button',{name:'Permissions: Lite'}).click();
 for(const accent of ['rgb(190, 136, 44)','rgb(36, 117, 201)']){await page.evaluate(c=>document.body.style.setProperty('--t-accent',c),accent);assert.deepEqual(await icon('#trigger'),[accent,accent]);assert.deepEqual(await icon('[data-mode=lite]'),[accent,accent]);assert.deepEqual(await icon('[data-mode=default]'),['none','rgb(145, 148, 151)']);}
 await page.getByRole('button',{name:'Default Permissions',exact:true}).click();await page.getByRole('button',{name:'Permissions: Default'}).click();await page.getByRole('button',{name:/Advanced/}).click();assert.deepEqual(await page.evaluate(()=>[window.advanced,window.calls]),[true,[{toolPermissionMode:'default'}]]);await page.close();
}console.log('PASS: plugin scope and token boundaries; desktop/mobile component: brands, mode round trip and Advanced.');}finally{await browser.close();}
