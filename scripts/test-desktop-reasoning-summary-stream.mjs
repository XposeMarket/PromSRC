import fs from 'node:fs';
import assert from 'node:assert/strict';
const desktop = fs.readFileSync(new URL('../web-ui/src/pages/ChatPage.js', import.meta.url), 'utf8');
const desktopGenerated = fs.readFileSync(new URL('../generated/public-web-ui/static/pages/ChatPage.js', import.meta.url), 'utf8');
const desktopCss = fs.readFileSync(new URL('../web-ui/src/styles/components.css', import.meta.url), 'utf8');
const desktopGeneratedCss = fs.readFileSync(new URL('../generated/public-web-ui/static/styles/components.css', import.meta.url), 'utf8');
const mobile = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-pages.js', import.meta.url), 'utf8');
const mobileGenerated = fs.readFileSync(new URL('../generated/public-web-ui/static/mobile/mobile-pages.js', import.meta.url), 'utf8');
const legacySplit = /if \(isDesktopProgressNarration\(chunk\)\) setDesktopLiveProgressNarration\(streamState, chunk, (appendLiveTrace|appendTrace)\);\s*else appendDesktopReasoningSummary\(streamState, chunk, \1\);/g;
assert.equal([...desktop.matchAll(legacySplit)].length, 0);
assert.equal([...desktopGenerated.matchAll(legacySplit)].length, 0);
const directPattern = /setDesktopLiveProgressNarration\(streamState, chunk, (appendLiveTrace|appendTrace)\);/g;
assert.ok([...desktop.matchAll(directPattern)].length >= 4);
assert.ok([...desktopGenerated.matchAll(directPattern)].length >= 4);
for (const text of [desktop, desktopGenerated]) {
  assert.match(text, /class="t-think" data-live-trace-summary-key=/);
  assert.match(text, /animateThinkingTextSwap\(node, previousLabel\)/);
  assert.match(text, /function isDesktopSummaryThoughtEvent\(/);
  assert.match(text, /function appendDesktopDurableThought\(/);
  assert.match(text, /reasoningKind === 'summary'[\s\S]{0,180}source === 'reasoning_summary'/);
  assert.match(text, /if \(isDesktopSummaryThoughtEvent\(event\)\)[\s\S]{0,260}setDesktopLiveProgressNarration\([\s\S]{0,220}appendDesktopDurableThought/);
  assert.match(text, /if \(isDesktopSummaryThoughtEvent\(evt\)\)[\s\S]{0,260}setDesktopLiveProgressNarration\([\s\S]{0,220}appendDesktopDurableThought/);
  assert.doesNotMatch(text, /case 'agent_thought':[\s\S]{0,260}setDesktopLiveProgressNarration\(streamState, thoughtText, appendLiveTrace, \{ replace: true, visibility \}\)/);
}
for (const text of [desktop, desktopGenerated]) {
  assert.match(text, /const isSummary = chatProgressVisibility\(event\) === 'summary';[\s\S]*?setDesktopLiveProgressNarration/);
  assert.match(text, /const isSummary = chatProgressVisibility\(evt\) === 'summary';[\s\S]{0,180}if \(!isSummary\) streamState\.streamingThinkingText/);
}
for (const css of [desktopCss, desktopGeneratedCss]) {
  assert.match(css, /\.live-turn-tool-group\[data-live-trace-current="1"\] \.t-think-text::before/);
  assert.match(css, /\.live-turn-tool-group:not\(\[data-live-trace-current="1"\]\) \.t-think-text::before/);
  assert.match(css, /\.t-think-text\.is-exit[\s\S]*?transform:\s*translateY\(-8px\)[\s\S]*?filter:\s*blur\(2px\)/);
}
for (const text of [mobile, mobileGenerated]) assert.match(text, /reasoning_summary[^]*?explicit user-safe progress channel[^]*?_setMobileLiveProgressNarration\(message, chunk\)/);
console.log('desktop reasoning-summary stream parity regression passed');
