import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('web-ui/src/mobile/mobile-chat-page-runtime.js', root), 'utf8');
const extract = (name) => { const start=source.indexOf(`  function ${name}(`); const end=source.indexOf('\n  }',start)+4; return source.slice(start,end); };
const browser = await chromium.launch({headless:true});
for (const width of [320,390]) {
 const page=await browser.newPage({viewport:{width,height:844}});
 await page.setContent('<html><body class="pm-mobile-active"><main class="pm-app"><div class="pm-msg from-user"><div class="pm-bubble">Original message</div></div><form id="pm-composer" class="pm-composer"><div class="pm-composer-row"><textarea id="pm-composer-input" class="pm-composer-input">Unsent draft</textarea><button type="submit">Send</button></div></form></main></body></html>');
 for(const file of ['mobile-shell.css','mobile.css','mobile-message-edit.css']) await page.addStyleTag({content:fs.readFileSync(new URL(`web-ui/src/styles/${file}`,root),'utf8')});
 await page.evaluate((code)=>{
 const form=document.querySelector('form'),input=document.querySelector('textarea'),page=document;
 let messageComposerEdit=null; const __pmChat={editingMessageIndex:-1};
 const thread=[{role:'user',body:{text:'Original message'}}];
 const _activeMobileThread=()=>thread,_mobileMessageCopyText=m=>m.body.text;
 const resizeComposerInput=()=>{},_pmUpdateComposerRichPreview=()=>{},updateComposerSubmitState=()=>{},setChatComposerMode=()=>{};
 const renderThreadNow=()=>document.querySelector('.pm-msg').classList.toggle('editing',__pmChat.editingMessageIndex===0);
 eval(code+';window.startEdit=startMobileEditUserMessage;window.cancelEdit=cancelMobileEditUserMessage;');
 }, ['finishMobileComposerEdit','startMobileEditUserMessage','cancelMobileEditUserMessage'].map(extract).join('\n'));
 await page.evaluate(()=>window.startEdit(0));
 assert.equal(await page.locator('textarea').inputValue(),'Original message');
 assert.equal(await page.locator('.editing').count(),1);
 assert.equal(await page.locator('.pm-msg textarea').count(),0);
 assert.equal(await page.locator('.pm-msg').evaluate(e=>getComputedStyle(e).opacity),'0.42');
 await page.locator('textarea').fill('Changed message');
 await page.screenshot({path:`.pr/composer-edit-${width}.png`});
 await page.getByRole('button',{name:'Cancel message edit'}).click();
 assert.equal(await page.locator('textarea').inputValue(),'Unsent draft');
 assert.equal(await page.locator('.editing').count(),0);
 await page.close();
}
await browser.close();
assert.match(source,/if \(messageComposerEdit\) \{\s*await submitMobileEditedUserMessage/);
assert.match(source,/if \(!messageComposerEdit\) saveComposerDraft/);
console.log('PASS: composer edit loads text, dims original, no inline editor, cancel restores draft at 320/390; submit routing and draft guards');
