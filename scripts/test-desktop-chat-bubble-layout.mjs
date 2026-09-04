import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const css = [
  read('web-ui/src/styles/base.css'),
  read('web-ui/src/styles/components.css'),
  read('web-ui/src/styles/themes.css'),
  read('web-ui/src/styles/multi-chat-workspace.css'),
].join('\n');

async function launchLayoutBrowser() {
  const candidates = process.env.CI
    ? [{ channel: 'chrome' }, {}]
    : [{}, { channel: 'chrome' }];
  const failures = [];
  for (const candidate of candidates) {
    try { return await chromium.launch({ headless: true, ...candidate }); }
    catch (error) { failures.push(error); }
  }
  throw new AggregateError(failures, 'No Chromium-compatible browser is available for the desktop chat bubble layout regression.');
}

const browser = await launchLayoutBrowser();
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });

try {
  await page.setContent(`<!doctype html><html data-theme="dark" data-skin="blue"><head><style>${css}</style><style>
    html, body { margin: 0; width: 1000px; height: 720px; }
    #chat-view { width: 420px; height: 720px; }
    [hidden] { display: none !important; }
  </style></head><body class="right-canvas-open">
    <div id="chat-view">
      <div id="chat-messages">
        <div id="assistant-shell" class="msg-shell ai">
          <div class="msg ai"><div class="msg-bubble-stack"><div class="msg-body"><div id="assistant-content" class="msg-content">This assistant trace should use the complete conversation track so tool activity and reasoning do not collapse into a centered min-content column.</div></div></div></div>
        </div>
        <div id="user-shell" class="msg-shell user">
          <div class="msg user"><div class="msg-bubble-stack"><div class="msg-body"><div class="msg-content">Keep this user bubble intrinsic.</div></div></div></div>
        </div>
      </div>
      <div id="composer" class="chat-input-area"></div>
    </div>
  </body></html>`);

  const metrics = await page.evaluate(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { left: rect.left, right: rect.right, width: rect.width, widthCss: style.width };
    };
    return {
      assistantShell: measure('#assistant-shell'),
      assistantStack: measure('#assistant-shell .msg-bubble-stack'),
      assistantBody: measure('#assistant-shell .msg-body'),
      assistantContent: measure('#assistant-content'),
      userShell: measure('#user-shell'),
      userBody: measure('#user-shell .msg-body'),
      composer: measure('#composer'),
    };
  });

  const assistantTrackWidth = metrics.assistantShell.width;
  assert(assistantTrackWidth > 0, 'assistant message track collapsed');
  for (const key of ['assistantStack', 'assistantBody', 'assistantContent']) {
    assert(Math.abs(metrics[key].width - assistantTrackWidth) <= 1,
      `${key} should fill the assistant track (${metrics[key].width}px vs ${assistantTrackWidth}px)`);
  }
  assert(Math.abs(metrics.composer.width - assistantTrackWidth) <= 1,
    `assistant track and composer should share a width (${assistantTrackWidth}px vs ${metrics.composer.width}px)`);
  assert(metrics.userBody.width < metrics.userShell.width,
    'user bubble should remain intrinsic instead of becoming a full-width assistant track');
} finally {
  await browser.close();
}

console.log('desktop chat bubble layout passed');
