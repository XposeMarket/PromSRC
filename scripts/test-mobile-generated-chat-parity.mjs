import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const relative of [
  'features/chat/runtime/chat-runtime.js',
  'features/chat/runtime/mobile-chat-adapter.js',
  'features/chat/timeline/mobile-timeline-view.js',
]) {
  const source = fs.readFileSync(`web-ui/src/${relative}`, 'utf8');
  const generated = fs.readFileSync(`generated/public-web-ui/static/${relative}`, 'utf8');
  assert.equal(generated, source, `${relative} source/generated public mirror must stay identical`);
}

console.log('mobile generated chat parity passed');
