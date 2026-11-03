import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { parse } = require('acorn');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const runtime = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const renderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const teams = read('web-ui/src/mobile/mobile-teams-pages.js');
const css = read('web-ui/src/styles/mobile.css') + '\n' + read('web-ui/src/styles/mobile-composer-stack.css');
function fn(source, name) {
  let found;
  function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) { found = source.slice(node.start, node.end); return; }
    for (const v of Object.values(node)) if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
  }
  walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  assert.ok(found, name); return found;
}
assert.match(teams, /enterkeyhint="enter"/);
assert.match(runtime, /composerFocused = document.activeElement === input\s*\|\| _isQuestionKeyboardTarget\(document.activeElement\)/);
assert.match(runtime, /const _isKeyboardComposerTarget =[\s\S]*?\|\| _isQuestionKeyboardTarget\(target\)/);
assert.match(runtime, /--pm-question-available-height/);
assert.match(runtime, /field.style.height = `\$\{field.scrollHeight\}px`/);
assert.match(runtime, /form\?\.style.removeProperty\('--pm-question-available-height'\)/);
const keySource = teams.match(/input\?\.addEventListener\('keydown', \(event\) => \{([\s\S]*?)\n  \}\);/)[1];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<html><body class="pm-mobile-active"><main class="pm-app"><form id="pm-composer" class="pm-composer has-pending-question"><div id="pm-mobile-question-popover" class="pm-mobile-question-popover" hidden></div></form></main></body></html>');
  await page.addStyleTag({ content: css });
  const sources = [fn(renderer, '_renderMobileQuestionCard'), ...['_mobileQuestionToggleOption', '_mobileQuestionToggleOther', '_mobileQuestionRememberDraft', '_captureMobileQuestionDraftState', '_restoreMobileQuestionDraftState', '_paintMobileQuestionComposerPopover'].map(n => fn(pages, n)), fn(runtime, '_isQuestionKeyboardTarget'), fn(runtime, '_revealQuestionInput')];
  await page.evaluate(({ sources, keySource }) => {
    window.eval(`const _mobileQuestionDrafts = new Map();
      const _normalizeMobileQuestion = q => q;
      const _pmCssEscape = s => CSS.escape(s);
      const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const _clearMobileQuestionValidationToast = () => {};
      const questionHost = document.querySelector('#pm-mobile-question-popover');
      ${sources.join('\n')}
      window.fixture = { host: questionHost, drafts: _mobileQuestionDrafts, paint: _paintMobileQuestionComposerPopover, capture: _captureMobileQuestionDraftState, restore: _restoreMobileQuestionDraftState, reveal: _revealQuestionInput, isTarget: _isQuestionKeyboardTarget };
      window._mobileQuestionToggleOption = _mobileQuestionToggleOption;
      window._mobileQuestionToggleOther = _mobileQuestionToggleOther;
      window._mobileQuestionRememberDraft = _mobileQuestionRememberDraft;`);
    fixture.question = { id: 'test-q', status: 'pending', questions: [{ id: 'choice', mode: 'single_select', label: 'Choose the question-card behavior', options: ['Keep the visible checks smooth while selecting an option', 'Preserve the current answer'], allowOther: true }, { id: 'text', mode: 'text', label: 'Add a multiline answer' }] };
    fixture.paint(fixture.host, document.querySelector('#pm-composer'), fixture.question, 0, {}, 'test');
    fixture.key = new Function('event', 'form', keySource);
  }, { sources, keySource });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await page.locator('#pm-composer').boundingBox();
    assert.ok(Math.abs(box.x - 10) < 1 && Math.abs(box.width - (width - 20)) < 1, `expanded width ${width}: ${JSON.stringify(box)}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const option = page.locator('.pm-q-opt').first();
  const before = await option.boundingBox();
  const indicator = await page.locator('.pm-q-check').first().evaluate(el => ({ border: getComputedStyle(el).borderColor, duration: getComputedStyle(el, '::after').transitionDuration }));
  assert.notEqual(indicator.border, 'rgba(0, 0, 0, 0)');
  assert.notEqual(indicator.duration, '0s');
  await option.click();
  assert.equal(await option.getAttribute('aria-pressed'), 'true');
  const after = await option.boundingBox();
  assert.equal(after.height, before.height, 'selecting must not reflow label');
  await page.evaluate(() => { fixture.original = fixture.host.firstElementChild; fixture.paint(fixture.host, document.querySelector('#pm-composer'), fixture.question, 0, {}, 'test'); });
  assert.equal(await page.evaluate(() => fixture.original === fixture.host.firstElementChild), true, 'same-question refresh retains DOM');
  await option.click();
  assert.equal(await option.getAttribute('aria-pressed'), 'false', 'selection reversible');
  await page.locator('.pm-q-other-toggle').click();
  const other = page.locator('[data-pm-q-other]');
  assert.equal(await other.getAttribute('enterkeyhint'), 'enter');
  await other.fill('First line\nSecond line\nThird line');
  await page.evaluate(() => {
    const field = document.querySelector('[data-pm-q-other]');
    _mobileQuestionRememberDraft(field);
    fixture.saved = fixture.capture(fixture.host);
    fixture.originalField = field;
    fixture.paint(fixture.host, document.querySelector('#pm-composer'), fixture.question, 0, fixture.saved, 'test');
  });
  assert.equal(await page.evaluate(() => fixture.originalField === document.activeElement), true, 'refresh keeps focused textarea');
  assert.equal(await other.inputValue(), 'First line\nSecond line\nThird line');
  await page.evaluate(() => {
    fixture.paint(fixture.host, document.querySelector('#pm-composer'), fixture.question, 1, {}, 'test');
    fixture.paint(fixture.host, document.querySelector('#pm-composer'), fixture.question, 0, fixture.saved, 'test');
  });
  assert.equal(await other.inputValue(), 'First line\nSecond line\nThird line', 'step roundtrip retains newlines');
  assert.equal(await page.evaluate(() => fixture.isTarget(document.querySelector('[data-pm-q-other]'))), true);
  await page.evaluate(() => {
    const form = document.querySelector('#pm-composer');
    form.style.setProperty('--pm-question-available-height', '220px');
    fixture.host.scrollTop = 0;
    fixture.reveal(document.querySelector('[data-pm-q-other]'));
  });
  assert.ok((await page.locator('#pm-composer').boundingBox()).height <= 222, 'keyboard viewport cap');
  assert.ok(await page.evaluate(() => fixture.host.scrollTop > 0), 'reveal scrolls inside the card');
  const keys = await page.evaluate(() => {
    let sent = 0, prevented = 0; const form = { requestSubmit: () => sent++ };
    const event = { key: 'Enter', preventDefault: () => prevented++ };
    fixture.key(event, form); const plain = [sent, prevented];
    fixture.key({ ...event, ctrlKey: true }, form);
    fixture.key({ ...event, ctrlKey: true, isComposing: true }, form);
    return { plain, sent, prevented };
  });
  assert.deepEqual(keys, { plain: [0, 0], sent: 1, prevented: 1 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.pm-q-check').first().evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s');
  console.log('PASS: responsive card width, visible animated checks, stable selection/refresh DOM, multiline drafts, viewport cap/reveal, Return and IME, reduced motion');
} finally { await browser.close(); }
