// Exercise production styles, shield component and paperclip touch handlers on a phone-sized viewport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const runtime = fs.readFileSync('web-ui/src/mobile/mobile-chat-page-runtime.js', 'utf8');
const between = (a,b) => runtime.slice(runtime.indexOf(a),runtime.indexOf(b,runtime.indexOf(a)));
const out = process.env.COMPOSER_PROOF;
(async () => {
  const engine = process.env.COMPOSER_WEBKIT ? webkit : chromium;
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport:{width:390,height:460}, isMobile:true, hasTouch:true });
    const markup = between('      <div class="pm-composer-row">','      <div class="pm-chat-voice-shell"').replace(/\$\{ICONS\.(\w+)\}/g, (_,key) => ({ paperclip:'📎', micSmall:'🎙', send:'↑' }[key] || '')).replace(/\$\{escapeHtml\(requestedSession[^\n]*?\)\}/,'Message').replace(/\$\{escapeHtml\(window.__pmModelBadgeLabel[^}]+\}/,'Model').replace(/\$\{window.__pmModelBadgeFast[^}]+\}/,'hidden');
    await page.route('http://fixture.test/**', async route => {
      const p = new URL(route.request().url()).pathname;
      if (p !== '/') return route.fulfill({ contentType: p.endsWith('css')?'text/css':'text/javascript', body:fs.readFileSync(path.join('web-ui/src',p)) });
      return route.fulfill({ contentType:'text/html', body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/mobile.css"><link rel="stylesheet" href="/styles/mobile-composer-stack.css"><body class="pm-mobile-active" style="--pm-text:#eee;--pm-surface:#282832;background:#202029;color:#eee"><form id="pm-composer" class="pm-composer" style="position:fixed;bottom:12px;left:12px;right:12px">${markup}</form>` });
    });
    await page.goto('http://fixture.test/');
    await page.evaluate(async()=>{const {installComposerControls}=await import('/features/chat/composer-plugin-controls.js');installComposerControls('pm-chat-access',[],async()=>({toolPermissionMode:'default'}),()=>{});});
    const input=page.locator('#pm-composer-input'), clip=page.locator('#pm-attach-btn'), shield=page.locator('pm-chat-access'), badge=page.locator('.pm-composer-model-badge');
    const form=page.locator('#pm-composer');
    const isEditing=()=>input.evaluate(el=>document.activeElement===el);
    const capture=async name=>{if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,name+'.png')});}};
    assert.ok(await clip.isVisible()); assert.ok(!await shield.isVisible() && !await badge.isVisible());
    const expectControls = async (visible, state) => {
      for (const el of [shield, badge]) assert.equal(await el.isVisible(), visible, state);
    };
    const focusEmpty = async () => { await input.focus(); await form.evaluate(el=>el.classList.add('is-focused')); };
    await focusEmpty();
    await expectControls(true, 'open before the first character');
    await capture('focused-empty');
    await input.fill('x'); await form.evaluate(el=>el.classList.add('has-text'));
    await input.fill(''); await form.evaluate(el=>el.classList.remove('has-text'));
    await expectControls(true, 'clearing the draft must not collapse the toolbar');
    await input.evaluate(el=>el.blur()); await form.evaluate(el=>el.classList.remove('is-focused'));
    await expectControls(false, 'closed empty composer');
    await focusEmpty(); await expectControls(true, 'reopened empty composer');
    await input.fill('Draft'); await form.evaluate(el=>el.classList.add('has-text')); await page.waitForTimeout(160);
    const [a,b,c]=await Promise.all([clip,shield,badge].map(el=>el.boundingBox()));
    for(const gap of [b.x-a.x-a.width,c.x-b.x-b.width]) assert.ok(gap>=-1&&gap<=4,`toolbar gap ${gap}`);
    await capture('expanded');
    await shield.locator('#trigger').tap(); const panel=shield.locator('#panel'); await panel.waitFor({state:'visible'});
    assert.ok(await isEditing(),'shield opener must preserve editor focus');
    await page.setViewportSize({width:390,height:415}); await page.waitForTimeout(100);
    const r=await shield.boundingBox(), p=await panel.boundingBox(); assert.ok(Math.abs(r.y-p.y-p.height-6)<2,'shield tracks resized viewport');
    await capture('permissions'); await page.keyboard.press('Escape');
    await page.evaluate(source=>{const input=document.querySelector('textarea'), attachBtn=document.querySelector('#pm-attach-btn');window.clipClicks=0;attachBtn.onclick=()=>window.clipClicks++;eval(source);}, between('  let attachTouchStart;',"  preserveComposerFocusOnPointer(attachBtn"));
    await input.focus(); await clip.tap(); assert.ok(await isEditing()); assert.equal(await page.evaluate(()=>window.clipClicks),1,'tap activates once');
    await input.evaluate(el=>el.blur()); await clip.tap(); assert.ok(!await isEditing(),'do not summon a closed keyboard');
    assert.match(fs.readFileSync('web-ui/src/mobile/mobile-model-badge.js','utf8'),/if \(usesDraftDefault\) window\.__pmModelBadgeReasoningLabel = ''/);
    console.log(`PASS ${engine.name()}: compact and focused-empty visibility, spacing, shield anchor, tap focus and single activation`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
