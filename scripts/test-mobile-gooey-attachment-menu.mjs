import fs from 'node:fs';
import assert from 'node:assert/strict';

const sources = [
  fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../generated/public-web-ui/static/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8'),
];
const styles = [
  fs.readFileSync(new URL('../web-ui/src/styles/mobile.css', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../generated/public-web-ui/static/styles/mobile.css', import.meta.url), 'utf8'),
];

for (const source of sources) {
  assert.match(source, /class="pm-attach-goo"/);
  assert.match(source, /data-pm-attach-action="photos" aria-label="Photos"/);
  assert.match(source, /data-pm-attach-action="camera" aria-label="Camera"/);
  assert.equal((source.match(/data-pm-attach-action=/g) || []).length, 2);
  assert.doesNotMatch(source, /data-pm-attach-action="files-photos"/);
  assert.match(source, /else if \(action === 'photos'\)[\s\S]{0,180}photoInput\?\.click\(\)/);
}
for (const css of styles) {
  assert.match(css, /#pm-attach-sheet \.pm-attach-goo\s*\{[\s\S]{0,260}filter: blur\(7px\) contrast\(18\)/);
  assert.match(css, /#pm-attach-sheet\.open \.pm-attach-sheet-action--photos[\s\S]{0,120}translate3d\(-42px, -68px/);
  assert.match(css, /#pm-attach-sheet\.open \.pm-attach-sheet-action--camera[\s\S]{0,120}translate3d\(42px, -68px/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*#pm-attach-sheet \.pm-attach-goo-blob/);
}

console.log('mobile gooey two-action attachment menu regression passed');
