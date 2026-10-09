import fs from 'node:fs';
import assert from 'node:assert/strict';

const sources = [
  fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8'),
];
const styles = [
  fs.readFileSync(new URL('../web-ui/src/styles/mobile.css', import.meta.url), 'utf8'),
];

for (const source of sources) {
  assert.match(source, /class="pm-attach-goo"/);
  assert.match(source, /data-pm-attach-action="files-photos" aria-label="Files and photos"/);
  assert.match(source, /data-pm-attach-action="camera" aria-label="Camera"/);
  assert.equal((source.match(/data-pm-attach-action=/g) || []).length, 2);
  assert.match(source, /action === 'files-photos'[\s\S]{0,400}beginAttachmentPicker\(fileInput/);
}
for (const css of styles) {
  assert.match(css, /#pm-attach-sheet > \.pm-attach-sheet-panel > \.pm-attach-goo\s*\{[\s\S]{0,400}filter: blur\(7px\) contrast\(18\)/);
  // Files action (formerly "photos"): left arc position; camera action: right arc position.
  assert.match(css, /#pm-attach-sheet\.open \.pm-attach-sheet-panel > \.pm-attach-sheet-action--files[\s\S]{0,120}translate3d\(-38px, -58px/);
  assert.match(css, /#pm-attach-sheet\.open \.pm-attach-sheet-panel > \.pm-attach-sheet-action--camera[\s\S]{0,120}translate3d\(38px, -58px/);
  // removed: .pm-attach-goo-blob no longer exists in web-ui/src or src (no git history); reduced-motion now guards the .pm-attach-goo layer.
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*#pm-composer #pm-attach-sheet > \.pm-attach-sheet-panel > \.pm-attach-goo/);
}

console.log('mobile gooey two-action attachment menu regression passed');
