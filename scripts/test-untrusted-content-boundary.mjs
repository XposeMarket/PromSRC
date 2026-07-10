import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function contentType(file) {
  return file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
}

const routes = new Map([
  ['/vendor/dompurify/purify.min.js', path.join(root, 'node_modules/dompurify/dist/purify.min.js')],
  ['/vendor/marked/marked.min.js', path.join(root, 'node_modules/marked/marked.min.js')],
  ['/src/utils.js', path.join(root, 'web-ui/src/utils.js')],
]);

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  if (pathname === '/test') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body><div id="host"></div>
      <script src="/vendor/dompurify/purify.min.js"></script>
      <script src="/vendor/marked/marked.min.js"></script>
      <script type="module">
        import { renderMd } from '/src/utils.js';
        window.__renderMd = renderMd;
        window.__ready = true;
      </script></body></html>`);
    return;
  }
  const file = routes.get(pathname);
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
});

const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address()));
});

let browser;
try {
  const address = await listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/test`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true);

  const markdownResult = await page.evaluate(() => {
    window.__markdownPwned = 0;
    const markdown = [
      '<img src=x onerror="window.__markdownPwned=1">',
      '<svg onload="window.__markdownPwned=2"><script>window.__markdownPwned=3<\/script></svg>',
      '<iframe srcdoc="<script>parent.__markdownPwned=4<\/script>"></iframe>',
      '<form action="/api/chat" method="post"><input name="message" value="pwn"></form>',
      '[unsafe](javascript:window.__markdownPwned=5)',
      '<div style="background:url(javascript:window.__markdownPwned=6)">styled</div>',
      '**safe bold**',
    ].join('\n\n');
    const host = document.getElementById('host');
    host.innerHTML = window.__renderMd(markdown);
    return {
      html: host.innerHTML,
      pwned: window.__markdownPwned,
      forbidden: !!host.querySelector('script,style,iframe,object,embed,form,input,svg,math,[onerror],[onload],[onclick],[srcdoc]'),
      unsafeHref: Array.from(host.querySelectorAll('[href],[src]')).some((node) => /^(?:javascript|vbscript):/i.test(String(node.getAttribute('href') || node.getAttribute('src') || '').trim())),
      safeBold: host.querySelector('strong')?.textContent || '',
    };
  });
  assert.equal(markdownResult.pwned, 0, 'malicious Markdown executed');
  assert.equal(markdownResult.forbidden, false, `forbidden Markdown surface survived: ${markdownResult.html}`);
  assert.equal(markdownResult.unsafeHref, false, `dangerous Markdown URL survived: ${markdownResult.html}`);
  assert.equal(markdownResult.safeBold, 'safe bold', 'safe Markdown formatting was lost');

  const visualResult = await page.evaluate(async () => {
    window.__visualPwned = 0;
    const host = document.getElementById('host');
    host.innerHTML = window.__renderMd('```html\n<script>parent.__visualPwned=1<\/script><p>isolated visual</p>\n```');
    const frame = host.querySelector('iframe');
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      pwned: window.__visualPwned,
      sandbox: frame?.getAttribute('sandbox') || '',
      inlineLoad: frame?.hasAttribute('onload') || false,
      srcdocHasScript: /<script/i.test(frame?.getAttribute('srcdoc') || ''),
    };
  });
  assert.equal(visualResult.pwned, 0, 'sandboxed visual reached its privileged parent');
  assert.match(visualResult.sandbox, /allow-scripts/, 'visual scripts were unexpectedly disabled');
  assert.doesNotMatch(visualResult.sandbox, /allow-same-origin/, 'visual retained privileged same-origin access');
  assert.equal(visualResult.inlineLoad, false, 'visual retained an inline event handler');
  assert.equal(visualResult.srcdocHasScript, true, 'visual regression test did not exercise scripted content');

  const scopedAuth = require('../dist/gateway/security/scoped-render-auth.js');
  const workerToken = scopedAuth.issueCreativeRenderGrant('render_job_123', 60_000);
  const workerHeaders = { 'x-prometheus-render-token': workerToken };
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: '/api/canvas/creative-render-ui/index.html', headers: workerHeaders }), { present: true, ok: true });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: '/api/canvas/creative-render-jobs/render_job_123', headers: workerHeaders }), { present: true, ok: true });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'POST', url: '/api/canvas/creative-render-jobs/render_job_123/complete', headers: workerHeaders }), { present: true, ok: true });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: '/api/sessions', headers: workerHeaders }), { present: true, ok: false });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: '/api/canvas/creative-render-jobs/other_job', headers: workerHeaders }), { present: true, ok: false });
  scopedAuth.revokeCreativeRenderGrant(workerToken);
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: '/api/canvas/creative-render-ui/index.html', headers: workerHeaders }), { present: true, ok: false });

  const previewToken = scopedAuth.issueCreativePreviewGrant({ sessionId: 'default', htmlPath: 'clips/demo.html', root: 'creative' });
  const previewBase = '/api/canvas/html-motion-clip/preview?sessionId=default&path=clips%2Fdemo.html&root=creative';
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: `${previewBase}&renderToken=${previewToken}`, headers: {} }), { present: true, ok: true });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: `/api/canvas/html-motion-clip/preview?sessionId=default&path=clips%2Fother.html&root=creative&renderToken=${previewToken}`, headers: {} }), { present: true, ok: false });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: `/api/sessions?renderToken=${previewToken}`, headers: {} }), { present: true, ok: false });

  const workspaceToken = scopedAuth.issueWorkspacePreviewGrant('reports/demo.html');
  const workspaceHeaders = { 'x-prometheus-render-token': workspaceToken };
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: '/preview?path=reports%2Fdemo.html', headers: workspaceHeaders }), { present: true, ok: true });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'GET', url: '/preview?path=reports%2Fother.html', headers: workspaceHeaders }), { present: true, ok: false });
  assert.deepEqual(scopedAuth.evaluateCreativeRenderGrant({ method: 'POST', url: '/preview?path=reports%2Fdemo.html', headers: workspaceHeaders }), { present: true, ok: false });

  const projectsSource = read('web-ui/src/pages/ProjectsPage.js');
  assert.doesNotMatch(projectsSource, /\s(?:onclick|onload|onerror|oninput|onchange)\s*=\s*["']/i, 'Projects page still compiles data into inline handlers');
  const utilsSource = read('web-ui/src/utils.js');
  assert.doesNotMatch(utilsSource, /allow-scripts\s+allow-same-origin|allow-same-origin\s+allow-scripts/i);
  const workerSource = read('src/gateway/routes/canvas.router.ts');
  assert.doesNotMatch(workerSource, /creativeRenderWorker[^\n]*[?&]token=/i, 'creative worker URL still carries a gateway bearer');
  const indexSource = read('web-ui/index.html');
  assert.doesNotMatch(indexSource, /params\.get\(['"]token['"]\)|__PROM_CREATIVE_RENDER_CONTEXT[\s\S]{0,300}\btoken\b/, 'creative worker exposes a token to page JavaScript');

  console.log('Untrusted content boundary tests passed.');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(() => resolve()));
}
