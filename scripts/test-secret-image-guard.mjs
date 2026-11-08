import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium, webkit } from 'playwright';
import { payloadContainsRecognizableSecret as client, assertSafeChatRequest, containsRecognizableSecret } from '../web-ui/src/features/chat/secret-format-guard.js';
const source = fs.readFileSync('src/security/secret-format-guard.ts', 'utf8');
const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports, mod);
const server = mod.exports.payloadContainsRecognizableSecret;
const secret = 'sk-proj-' + 'a'.repeat(32);
// Synthetic signature-bearing transport data, NOT a real credential or user's screenshot.
const raster = (header) => Buffer.from(header, 'latin1').toString('base64').replace(/=+$/, '') + 'AAAA/AIza' + 'A'.repeat(35) + 'A'.repeat((4 - ((Buffer.from(header, 'latin1').toString('base64').replace(/=+$/, '').length + 44) % 4)) % 4);
const bytes = raster('\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0');
assert(containsRecognizableSecret(bytes));
const image = { type: 'image', name: 'screen.png', mimeType: 'image/png', base64: bytes };
const cases = [
  [{ message: 'Not a fan', attachments: [image] }, false],
  [{ attachments: [{ ...image, base64: `data:image/png;base64,${bytes}` }] }, false],
  [{ history: [{ body: { attachments: [image] }, attachmentPreviews: [{ ...image, dataUrl: `data:image/png;base64,${bytes}` }] }] }, false],
  [{ message: secret, attachments: [image] }, true],
  [{ attachments: [{ ...image, name: secret }] }, true],
  [{ attachments: [{ ...image, caption: secret }] }, true],
  [{ attachments: [{ ...image, base64: secret }] }, true],
  [{ attachments: [{ ...image, base64: bytes + secret }] }, true],
  [{ attachments: [{ ...image, mimeType: 'text/plain' }] }, true],
  [{ attachments: [{ ...image, mimeType: 'image/svg+xml' }] }, true],
  [{ attachments: [{ ...image, mimeType: 'image/jpeg' }] }, true],
  [{ attachments: [{ ...image, dataUrl: `data:text/plain;base64,${bytes}` }] }, true],
  [{ attachments: [{ ...image, metadata: { base64: bytes } }] }, true],
  [{ base64: bytes }, true],
  [{ message: `data:image/png;base64,${bytes}` }, true],
  [{ attachments: image }, true],
  [{ attachments: [{ ...image, nested: { message: secret } }] }, true],
  [{ [secret]: 'plain' }, true],
  [{ queued: [{ text: secret }] }, true],
  [{ message: 'Not a fan' }, false],
];
for (const [mime, header] of [['image/jpeg', '\xff\xd8\xff' + 'A'.repeat(15)], ['image/gif', 'GIF89a' + 'A'.repeat(12)], ['image/webp', 'RIFFaaaaWEBP' + 'A'.repeat(6)]]) cases.push([{ attachments: [{ mimeType: mime, base64: raster(header) }] }, false]);
let deep = {}; for (let i = 0; i < 33; i++) deep = { next: deep }; cases.push([deep, true]);
const routes = ['/api/chat', '/api/chat/steer', '/api/sessions/example/history', '/api/sessions/example/edit-rerun-reset', '/api/sessions/example/queue'];
for (const [value, rejected] of cases) {
  assert.equal(server(value), rejected, 'gateway classification');
  assert.equal(client(value), rejected, 'client classification');
  for (const route of routes) for (const body of [value, JSON.stringify(value)]) {
    if (rejected) assert.throws(() => assertSafeChatRequest(route, body));
    else assert.doesNotThrow(() => assertSafeChatRequest(route, body));
  }
}
assert.throws(() => assertSafeChatRequest('/api/chat', '{' + secret));
assert.doesNotThrow(() => assertSafeChatRequest('/api/protected-plugins/save', { secret }));
// Actual browser imports exercise atob and the shared desktop/mobile guard.
const browserSource = fs.readFileSync('web-ui/src/features/chat/secret-format-guard.js', 'utf8');
for (const browserType of [chromium, webkit]) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(async ({ code, cases }) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const module = await import(url); URL.revokeObjectURL(url);
      return cases.map(([payload]) => { try { module.assertSafeChatRequest('/api/chat', JSON.stringify(payload)); return false; } catch { return true; } });
    }, { code: browserSource, cases });
    assert.deepEqual(result, cases.map(([, expected]) => expected));
  } finally { await browser.close(); }
}
console.log(`PASS ${cases.length} image/text boundary fixtures, gateway/client + Chromium/WebKit, send/history/edit/steer/queue, no credential echo.`);
