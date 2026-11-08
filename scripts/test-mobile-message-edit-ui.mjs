// Regression: mobile user-message edit composer buttons must not inherit the
// compact 30px .pm-msg-action icon sizing, and the body-level long-press
// portal must declare the chat font (it lives outside .pm-app).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web-ui/src/styles/mobile.css'), 'utf8') + fs.readFileSync(path.join(root, 'web-ui/src/styles/mobile-message-edit.css'), 'utf8');

assert.ok(!js.includes('function _renderMobileUserEditComposer('), 'unused inline editor removed; composer-edit browser test covers active editor');

const portal = css.match(/body\.pm-mobile-active :is\(([^)]*)\) \{\s*font-family:\s*var\(--pm-font/);
assert.ok(portal && portal[1].includes('.pm-msg-lp-popover') && portal[1].includes('.pm-bubble--lifted'),
  'long-press portal declares the chat font');

console.log('ok mobile message edit ui');
