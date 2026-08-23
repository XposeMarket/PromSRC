import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'web-ui/src/styles/mobile.css'), 'utf8');

async function launchLayoutBrowser() {
  // PR CI intentionally installs dependencies without lifecycle scripts, so
  // Playwright's downloaded Chromium may be absent. GitHub's runner includes
  // stable Chrome; keep the bundled browser first for local determinism and
  // use the system channel as a CI-safe fallback.
  const candidates = process.env.CI
    ? [{ channel: 'chrome' }, {}]
    : [{}, { channel: 'chrome' }];
  const failures = [];
  for (const candidate of candidates) {
    try { return await chromium.launch({ headless: true, ...candidate }); }
    catch (error) { failures.push(error); }
  }
  throw new AggregateError(failures, 'No Chromium-compatible browser is available for the mobile bubble layout regression.');
}

const browser = await launchLayoutBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

try {
  await page.setContent(`<!doctype html><html><head><style>${css}</style><style>
    html, body { margin: 0; width: 390px; }
    .fixture { width: 358px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .fixture .markdown-body p { margin: 0; }
  </style></head><body class="pm-mobile-active"><main class="fixture pm-chat-body pm-chat-thread">
    <div id="short" class="pm-msg from-user"><div class="pm-bubble"><div class="markdown-body"><p>Sounds good</p></div></div></div>
    <div id="normal" class="pm-msg from-user"><div class="pm-bubble"><div class="markdown-body"><p>Please review the mobile app and make sure this message wraps naturally across the available width.</p></div></div></div>
    <div id="token" class="pm-msg from-user"><div class="pm-bubble"><div class="markdown-body"><p>https://example.test/${'unbroken'.repeat(55)}</p></div></div></div>
  </main></body></html>`);
  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { width: box.width, height: box.height, left: box.left, right: box.right, lineHeight: Number.parseFloat(style.lineHeight) || 0 };
    };
    return {
      short: rect('#short .pm-bubble'),
      normal: rect('#normal .pm-bubble'),
      normalParagraph: rect('#normal p'),
      token: rect('#token .pm-bubble'),
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  assert(metrics.short.width < 180, `short bubble should remain intrinsic (${metrics.short.width}px)`);
  assert(metrics.normal.width > 250, `normal prose collapsed into a narrow min-content bubble (${metrics.normal.width}px)`);
  assert(metrics.normalParagraph.height < 120, `normal prose wrapped into too many lines (${metrics.normalParagraph.height}px)`);
  assert(metrics.token.right <= metrics.viewportWidth, 'long token bubble escaped the viewport');
  assert(metrics.scrollWidth <= metrics.viewportWidth, `long token caused horizontal document overflow (${metrics.scrollWidth}px)`);
} finally {
  await browser.close();
}

console.log('mobile chat bubble layout passed');
