import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync('src/gateway/routes/chat.router.ts', 'utf8');
const desktop = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
const mobile = [
  fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8'),
  fs.readFileSync('web-ui/src/mobile/mobile-chat-page-runtime.js', 'utf8'),
].join('\n');

assert.match(router, /workStartedAt: turnTiming\.startedAt[\s\S]{0,180}?workDurationMs:/, 'completed assistant history must persist authoritative turn timing');
assert.match(router, /sendSSE\('final',[\s\S]{0,260}?workDurationMs:/, 'final events must carry authoritative timing');
assert.match(router, /sendSSE\('done',[\s\S]{0,260}?workDurationMs:/, 'done events must carry authoritative timing');
assert.match(desktop, /const workStartedAt = Number\(evt\.workStartedAt/, 'desktop completion must consume the gateway start time');
assert.match(desktop, /Number\.isFinite\(Number\(evt\.workDurationMs\)\)/, 'desktop completion must consume the gateway duration');
assert.match(mobile, /case 'final':[\s\S]*?evt\.workDurationMs[\s\S]*?case 'done':/, 'mobile final path must consume gateway timing');
assert.match(mobile, /case 'done':[\s\S]*?evt\.workDurationMs[\s\S]*?case 'error':/, 'mobile done path must consume gateway timing');

console.log('chat duration contract passed');
