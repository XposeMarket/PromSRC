// The keyboard-open composer must sit on the LIVE keyboard edge. It used to
// prefer a bottom captured when the keyboard opened, so once iOS panned the
// visual viewport (scrolling with the keyboard up) the composer stayed behind
// the keyboard until another event, or floated too high when that snapshot was
// taken mid keyboard animation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = path.resolve(__dirname, '../../web-ui/src/mobile/mobile-chat-page-runtime.js');
const src = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
const start = src.indexOf('export function resolveMobileKeyboardComposerTop(');
const end = src.indexOf('\n}\n', start);
assert.ok(start >= 0 && end > start, 'resolveMobileKeyboardComposerTop must exist');
const body = src.slice(start, end + 2).replace('export function', 'function');
// eslint-disable-next-line no-new-func
const resolve = new Function(`${body}; return resolveMobileKeyboardComposerTop;`)();

// Keyboard opened: visual viewport 0..400, composer 60px tall, 4px gap.
const opened = resolve({ layoutHeight: 844, visualHeight: 400, visualTop: 0, viewportMode: 'visual', visualBottomAnchor: 400, bottom: 4, composerHeight: 60 });
assert.equal(opened, 400 - 4 - 60, 'composer sits directly on the keyboard edge');

// User scrolls with the keyboard up: iOS pans the visual viewport by 250px.
// The stale anchor (400) would put the composer behind the keyboard.
const panned = resolve({ layoutHeight: 844, visualHeight: 400, visualTop: 250, viewportMode: 'visual', visualBottomAnchor: 400, bottom: 4, composerHeight: 60 });
assert.equal(panned, 650 - 4 - 60, 'composer follows the live keyboard edge after panning');

// Snapshot taken mid keyboard animation (anchor 520 while the settled edge is 400)
// must not leave the composer floating 120px above the keyboard.
const midAnim = resolve({ layoutHeight: 844, visualHeight: 400, visualTop: 0, viewportMode: 'visual', visualBottomAnchor: 520, bottom: 4, composerHeight: 60 });
assert.equal(midAnim, 336, 'stale mid-animation anchor must not lift the composer');

// Layout mode is unchanged.
assert.equal(resolve({ layoutHeight: 844, viewportMode: 'layout', bottom: 450, composerHeight: 60 }), 844 - 450 - 60);

console.log('mobile-composer-keyboard-edge regression: ok');
