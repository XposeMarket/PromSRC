import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');
const work = read('web-ui/src/features/chat/core/background-agent-work.js');
const api = read('web-ui/src/mobile/mobile-api.js');

assert.match(work, /mergeBackgroundAgentEvents\(records\[index\]\.events, normalized\.events\)/);
assert.match(work, /streamId/);
assert.match(work, /seq/);
assert.match(desktop, /\/api\/background-agents\/steer/);
assert.match(desktop, /data-main-composer-parity="\$\{mainComposerParity \? '1' : '0'\}"/);
assert.match(desktop, /refreshBackgroundAgentStream/);
assert.match(mobile, /sendMobileBackgroundSteer\(backgroundId, msg\)/);
assert.match(mobile, /loadMobileBackgroundStreamReplay\(cleanId, currentLane\?\.lastSeq \|\| 0\)/);
assert.doesNotMatch(mobile, /openMobileSideChat\(msg\)/);
assert.match(api, /\/api\/background\/\$\{encodeURIComponent\(id\)\}\/stream/);
assert.match(api, /\/api\/background-agents\/steer/);

console.log('background-agent side-chat contract: ok');
