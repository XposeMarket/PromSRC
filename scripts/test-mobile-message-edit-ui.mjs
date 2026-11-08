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

const start = js.indexOf('function _renderMobileUserEditComposer(');
assert.ok(start > 0, 'edit composer renderer exists');
const fn = js.slice(start, js.indexOf('\n}\n', start));
assert.ok(!/class="pm-msg-action/.test(fn), 'edit buttons must not use .pm-msg-action');
assert.match(fn, /class="pm-mobile-edit-btn" data-msg-action="cancel-edit"/);
assert.match(fn, /class="pm-mobile-edit-btn primary" data-msg-action="submit-edit"/);
assert.match(fn, /data-msg-edit-input="\$\{index\}"/, 'draft input hook preserved');
assert.match(fn, /_editingDraft/, 'draft value preserved');

const btn = css.match(/body\.pm-mobile-active \.pm-mobile-edit-btn \{([^}]*)\}/);
assert.ok(btn, 'dedicated edit button rule exists');
assert.match(btn[1], /min-height:\s*44px/);
assert.match(btn[1], /width:\s*auto/);
assert.match(btn[1], /white-space:\s*nowrap/);

const input = css.match(/body\.pm-mobile-active \.pm-mobile-edit-input \{([^}]*)\}/);
assert.ok(input && /max-height:/.test(input[1]) && /overflow-y:\s*auto/.test(input[1]), 'bounded textarea');

const portal = css.match(/body\.pm-mobile-active :is\(([^)]*)\) \{\s*font-family:\s*var\(--pm-font/);
assert.ok(portal && portal[1].includes('.pm-msg-lp-popover') && portal[1].includes('.pm-bubble--lifted'),
  'long-press portal declares the chat font');

console.log('ok mobile message edit ui');
