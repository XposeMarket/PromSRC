import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const mobileCss = read('web-ui/src/styles/mobile.css');
const generatedCss = read('generated/public-web-ui/static/styles/mobile.css');
const mobileShell = read('web-ui/src/mobile/mobile-shell.js');
const generatedShell = read('generated/public-web-ui/static/mobile/mobile-shell.js');

assert.equal(generatedCss, mobileCss, 'generated mobile.css must stay synchronized with source');
assert.equal(generatedShell, mobileShell, 'generated mobile-shell.js must stay synchronized with source');

const materialStart = mobileCss.indexOf('/* One material recipe for compact transient surfaces. */');
const materialEnd = mobileCss.indexOf('/* The scrim should separate the popover', materialStart);
assert.ok(materialStart >= 0 && materialEnd > materialStart, 'shared transient popover material block must exist');
const materialBlock = mobileCss.slice(materialStart, materialEnd);
assert.match(materialBlock, /border:\s*0\s*!important;/, 'shared compact popover material must be borderless');
assert.doesNotMatch(materialBlock, /border:\s*1px\s+solid\s+var\(--pm-ios-popover-border\)/, 'shared material must not restore an outer popover rim');

const borderlessStart = mobileCss.indexOf('/* Mobile popover shells are intentionally borderless.');
assert.ok(borderlessStart >= 0, 'final mobile borderless-popover policy must exist');
const borderlessBlock = mobileCss.slice(borderlessStart);
assert.match(borderlessBlock, /\[class\$="-popover"\]/, 'borderless policy must cover generic popover shells');
assert.match(borderlessBlock, /\.pm-attach-sheet-panel/, 'borderless policy must cover the attachment menu panel');
assert.match(borderlessBlock, /\.pm-msheet:not\(\.is-reasoning\):not\(\.is-model-switch\)/, 'borderless policy must cover compact mobile sheets');
assert.match(borderlessBlock, /border-width:\s*0\s*!important;/, 'outer mobile popover rims must be removed');
assert.match(borderlessBlock, /border-color:\s*transparent\s*!important;/, 'outer mobile popover rim color must be transparent');

const renameStart = mobileCss.indexOf('.pm-msheet-rename {');
const renameEnd = mobileCss.indexOf('.pm-sess-rename-wrap', renameStart);
assert.ok(renameStart >= 0 && renameEnd > renameStart, 'rename sheet style block must exist');
const renameBlock = mobileCss.slice(renameStart, renameEnd);
assert.match(renameBlock, /left:\s*50%\s*!important;/, 'rename dialog must be horizontally centered');
assert.match(renameBlock, /width:\s*min\(360px,\s*calc\(100vw\s*-\s*32px\)\)/, 'rename dialog must use compact phone-safe width');
assert.match(renameBlock, /height:\s*auto;/, 'rename dialog must size to its content');
assert.match(renameBlock, /border-radius:\s*24px\s*!important;/, 'rename dialog must use a compact continuous corner shape');
assert.match(renameBlock, /\.pm-msheet-rename\.open\s*\{[^}]*translate\(-50%,\s*0\)/s, 'open rename dialog must preserve centered transform');

assert.match(
  mobileShell,
  /sheet\.style\.top\s*=\s*isOpen\s*\?\s*['"]auto['"]\s*:\s*['"]['"];/,
  'rename keyboard handler must release the fixed top edge while bottom-anchored above the keyboard',
);
assert.match(
  mobileShell,
  /sheet\.style\.bottom\s*=\s*isOpen\s*\?\s*\(offset\s*\+\s*8\)\s*\+\s*['"]px['"]\s*:\s*['"]['"];/,
  'rename dialog must continue to follow the keyboard bottom offset',
);
assert.match(mobileCss, /\.pm-sess-rename-input:focus\s*\{[^}]*border-color:\s*var\(--pm-accent/s, 'rename input focus border must remain intact');

console.log('[test-mobile-popover-polish] passed: mobile popover shells are borderless and Rename Chat remains compact above the keyboard');
