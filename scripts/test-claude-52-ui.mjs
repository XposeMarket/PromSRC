import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { reasoningCapability, supportsFastSpeed } from '../web-ui/src/reasoning-capabilities.js';
import { getReasoningCapability, supportsFastSpeed as serverFast } from '../dist/providers/reasoning-capabilities.js';
import { formatModelDisplayName, relabelModelSelect } from '../web-ui/src/model-display.js';
const ids = ['claude-fable-5-2', 'claude-mythos-5-2'];
for (const model of ids) {
  assert.deepEqual(reasoningCapability('anthropic', model).efforts, getReasoningCapability('anthropic', model).efforts);
  assert.equal(supportsFastSpeed('anthropic', model), serverFast('anthropic', model));
  assert.equal(supportsFastSpeed('anthropic', model), true);
  assert.match(formatModelDisplayName(model, 'anthropic'), /5\.2$/);
}
const select = { tagName: 'SELECT', options: ids.map(value => ({ value, textContent: '' })) };
relabelModelSelect(select, 'anthropic');
assert.match(select.options[1].textContent, /verified organization/);
assert.equal(select.options[1].value, ids[1]);
const root = resolve('web-ui');
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--panel:#202020;--panel-2:#171717;--text:#eee;--muted:#aaa;--line:#444;--brand:#cf8b5d}body{margin:20px;background:#111;color:#eee;font:14px system-ui}main{max-width:800px;margin:auto}h1{font-size:20px}select{color-scheme:dark}</style><main><h1>Claude 5.2 · production agent picker</h1><div id="mount"></div></main><script type="module">import {renderAgentModelPicker} from '/src/components/agent-model-picker.js'; document.querySelector('#mount').innerHTML=['fable','mythos'].map((family,i)=>renderAgentModelPicker({id:'proof'+i,name:'Preview',model:'anthropic/claude-'+family+'-5-2',reasoning_effort:'high'},'proof')).join('');window.ready=true;</script>`;
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/plain'); res.end(readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const out = process.env.CLAUDE52_PROOF_DIR || '.pr/claude-52-proof'; mkdirSync(out, { recursive: true });
  for (const [surface, width, height] of [['desktop', 1100, 720], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: surface === 'mobile' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready);
    for (const model of ids) assert.ok(await page.locator(`option[value="${model}"]`).count() >= 2);
    assert.ok(await page.locator('option[value="xhigh"]').count() >= 2);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/${surface}.png`, fullPage: true });
    await page.close();
  }
  console.log('PASS browser/backend capability parity, restricted label and production agent picker desktop/mobile screenshots');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
