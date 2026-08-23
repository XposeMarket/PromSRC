import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('web-ui/src/features/chat/runtime/mobile-chat-adapter.js', 'utf8');
const generated = fs.readFileSync('generated/public-web-ui/static/features/chat/runtime/mobile-chat-adapter.js', 'utf8');

assert.equal(source, generated, 'mobile chat runtime adapter source/generated mirror must stay identical');
assert.match(source, /mobile-request:\$\{requestId\}:\$\{role\}/, 'request-owned mobile rows need role-scoped runtime ids');
assert.match(source, /runtime\.replaceHistory\(mobileRuntimeHistory\(thread\)/, 'mobile runtime sync must use role-scoped history projection');
assert.match(source, /turnId:\s*mobileRuntimeTurnId\(turn, event, 'assistant'\)/, 'stream begin must target the assistant-scoped runtime row');
assert.match(source, /runtime\.appendStreamDelta\(chunk,[\s\S]{0,220}turnId:\s*mobileRuntimeTurnId\(turn, event, 'assistant'\)/, 'allow-start stream deltas must retain assistant row identity');

console.log('mobile chat live-turn identity contract passed');
