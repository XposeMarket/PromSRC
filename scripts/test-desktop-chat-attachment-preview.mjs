import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = 'http://desktop-chat.test';
const styles = ['theme-tokens', 'base', 'components', 'pages', 'themes', 'multi-chat-workspace'];
const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
const page = await browser.newPage({ viewport: { width: 1280, height: 780 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(4000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  // Real desktop CSS and ChatPage staging/paste handlers, without a live gateway or account.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <html data-theme="dark" data-skin="p1"><head><meta charset="utf-8">${styles.map(name => `<link rel="stylesheet" href="/src/styles/${name}.css">`).join('')}</head>
      <body class="electron-shell"><div class="app"><aside class="sidebar"></aside><div class="workspace">
      <div class="main-shell-wrap"><header class="topbar"></header><main class="main-shell">
      <div class="prom-multi-chat-tabs"><div class="prom-multi-chat-tab is-main">
       <button class="prom-multi-chat-tab-open"><span class="prom-multi-chat-tab-title">New chat</span></button>
       <button class="prom-multi-chat-tab-close" aria-label="Close tab">×</button></div>
       <button class="prom-multi-chat-new" aria-label="New tab">+</button></div>
      <div id="chat-view"><div id="chat-messages"></div><div class="chat-input-area">
      <div id="chat-composer-attachment-stack" class="chat-composer-attachment-stack"><div id="chat-file-staging" class="chat-file-staging"></div></div>
      <div class="chat-input-row"><div class="chat-composer-input-wrap" id="chat-composer-input-wrap">
      <textarea id="chat-input" rows="1" placeholder="Send Prometheus a message"></textarea></div></div>
      </div></div></main></div></div></div><script type="module" src="/src/pages/ChatPage.js"></script></body></html>` });
    if (url.pathname.startsWith('/src/')) {
      const file = new URL(`../web-ui${url.pathname}`, import.meta.url);
      const contentType = url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : undefined;
      return route.fulfill({ body: await readFile(file), contentType });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.stageFiles === 'function');
  const input = page.locator('#chat-input');
  await input.fill('Unsent draft');
  await input.evaluate(async element => {
    const clipboard = new DataTransfer();
    for (const [color, width] of [['tomato', 320], ['royalblue', 460]]) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = 130;
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, width, 130);
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      clipboard.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    }
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  const chips = page.locator('#chat-file-staging .chat-file-pill');
  await chips.nth(1).waitFor();
  assert.equal(await chips.count(), 2);
  const imageButton = chips.first().getByRole('button', { name: /^Preview / });
  assert.equal(await imageButton.count(), 1, 'a pasted image chip should have a dedicated preview action');
  const name = await chips.first().getAttribute('title');
  assert.match(name, /^pasted-screenshot-/);
  assert.ok((await chips.first().boundingBox()).width <= 174, 'image chip should be compact');
  assert.ok(await chips.first().locator('.pill-name').evaluate(el => el.scrollWidth > el.clientWidth), 'long title should ellipsize');

  const corner = () => page.evaluate(() => {
    const shell = document.querySelector('.main-shell-wrap');
    const strip = document.querySelector('.prom-multi-chat-tabs');
    const tab = strip.firstElementChild;
    const button = tab.querySelector('.prom-multi-chat-tab-open');
    const shellBox = shell.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    return {
      radius: parseFloat(getComputedStyle(shell).borderTopLeftRadius),
      inset: tabBox.left - shellBox.left,
      border: getComputedStyle(tab).borderLeftWidth,
      underline: getComputedStyle(tab, '::after').left,
      labelInset: getComputedStyle(button).paddingLeft,
      edgeClickable: document.elementFromPoint(shellBox.left + 2, tabBox.top + tabBox.height / 2) === button,
    };
  });
  const expanded = await corner();
  assert.ok(expanded.radius > 0, 'expanded sidebar should retain the rounded shell');
  assert.equal(expanded.inset, 0, 'first tab background must start at the shell edge');
  assert.equal(expanded.border, '0px', 'no divider should interrupt the corner');
  assert.equal(expanded.underline, '0px', 'active underline must reach the shell edge');
  assert.ok(parseFloat(expanded.labelInset) >= 12, 'keep the label comfortably inside the tab');
  assert.equal(expanded.edgeClickable, true, 'the newly filled area should be part of the tab hit target');
  await page.locator('.sidebar').evaluate(el => el.classList.add('collapsed'));
  assert.deepEqual(await corner(), {
    radius: 0, inset: 8, border: '1px', underline: '10px', labelInset: '12px', edgeClickable: false,
  });
  await page.locator('.sidebar').evaluate(el => el.classList.remove('collapsed'));

  const screenshots = process.env.PROM_DESKTOP_CHAT_SCREENSHOTS;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'desktop-chat.png') });
    const tab = await page.locator('.prom-multi-chat-tab').first().boundingBox();
    await page.screenshot({ path: path.join(screenshots, 'tab-corner.png'), clip: {
      x: Math.max(0, Math.floor(tab.x) - 24), y: Math.max(0, Math.floor(tab.y) - 14),
      width: Math.ceil(tab.width) + 86, height: 80,
    } });
  }
  await imageButton.click();
  const dialog = page.getByRole('dialog', { name: 'Image preview' });
  const preview = dialog.locator('img');
  assert.equal(await preview.getAttribute('src'), await chips.first().locator('img').getAttribute('src'));
  assert.equal(await dialog.locator('.img-preview-name').textContent(), name);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'image-preview.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await imageButton.evaluate(el => el === document.activeElement), 'closing restores focus to the image chip');

  await chips.nth(1).getByRole('button', { name: /^Preview / }).press('Enter');
  assert.equal(await preview.getAttribute('src'), await chips.nth(1).locator('img').getAttribute('src'));
  await page.mouse.click(8, 100);
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await input.inputValue(), 'Unsent draft');
  assert.equal(await chips.count(), 2);

  await chips.first().getByRole('button', { name: /^Remove / }).click();
  assert.equal(await chips.count(), 1);
  assert.equal(await dialog.count(), 0);
  await page.evaluate(() => window.stageFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })]));
  assert.equal(await chips.nth(1).getByRole('button', { name: /^Preview / }).count(), 0, 'documents have no image preview');
  // The existing message/lightbox path still works, including literal filename text.
  await page.evaluate(src => window.openImgPreview(src, `Raul's <screenshot>.png`), await chips.first().locator('img').getAttribute('src'));
  assert.equal(await dialog.locator('.img-preview-name').textContent(), `Raul's <screenshot>.png`);
  // A closed dialog's cleanup event can arrive after the next preview request.
  await preview.evaluate(img => {
    img.closest('dialog').close();
    window.openImgPreview(img.src, 'Next image.png');
  });
  assert.equal(await dialog.locator('.img-preview-name').textContent(), 'Next image.png');
  assert.equal(await page.locator('#img-preview-overlay').count(), 1);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

console.log('desktop chat tab geometry and staged image previews passed');
