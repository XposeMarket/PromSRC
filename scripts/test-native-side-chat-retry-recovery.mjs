import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const sourcePath = path.join(root, 'web-ui/src/features/chat/multi-chat-workspace-v2.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/multi-chat-workspace-v2.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');

assert.equal(generated, source, 'generated multi-chat workspace must mirror source');
assert.match(
  source,
  /function revealNativeSide\(attempt = 0, expectedSessionId = state\.sideSessionId\)/,
  'native-side retry chain must capture the session it is opening',
);
assert.match(
  source,
  /if \(!sid \|\| !expectedSid \|\| sid !== expectedSid\) return false;/,
  'a stale retry chain must stop after the requested side session changes',
);
assert.match(
  source,
  /setTimeout\(\(\) => revealNativeSide\(attempt \+ 1, expectedSid\), 100\)/,
  'retries must stay bound to the original side session',
);
assert.match(
  source,
  /if \(pendingSideSessionId === expectedSid && state\.sideSessionId === expectedSid\) \{[\s\S]*?pendingSideSessionId = '';[\s\S]*?state\.sideSessionId = '';[\s\S]*?persistState\(\);[\s\S]*?renderTabStrip\(\);/,
  'retry exhaustion must clear phantom side-pane state while keeping the retained tab available',
);

console.log('native side-chat retry recovery contract: ok');
