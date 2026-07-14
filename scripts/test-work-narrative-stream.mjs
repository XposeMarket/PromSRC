import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const gateway = read('src/gateway/routes/chat.router.ts');
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');

assert.match(gateway, /sendSSE\('reasoning_summary_delta'.*visibility: 'user'/s);
assert.match(gateway, /sendSSE\('thinking_delta'.*visibility: 'private'/s);
assert.match(gateway, /after important tool results, report what you found and what you will do next/);

for (const [name, source] of [['desktop', desktop], ['mobile', mobile]]) {
  assert.match(source, /reasoning_summary_delta/, `${name} must handle safe reasoning summaries`);
  assert.match(source, /source: 'reasoning_summary'/, `${name} must label summary provenance`);
}

assert.doesNotMatch(
  desktop.match(/const flushPendingThinkingBurst[\s\S]*?\n\s*};/)?.[0] || '',
  /logThinkingToProcess/,
  'desktop must not render raw provider thinking as process narrative',
);
assert.doesNotMatch(
  mobile.match(/function _flushMobilePendingThinkingBurst[\s\S]*?\n}/)?.[0] || '',
  /_appendMobileProcess/,
  'mobile must not render raw provider thinking as process narrative',
);

console.log('work narrative stream checks passed');
