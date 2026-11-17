import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8');
const start = source.indexOf('let mobileReplayRenderDepth');
const stop = source.indexOf('// Reasoning deltas', start);
assert.ok(start >= 0 && stop > start);
const calls = [];
const ctx = vm.createContext({mainPlanDock: {}, requestedSession: 'example', threadEl: {}, body: {}, mobileStreamRenderScheduler: {cancel() {}}, _renderMobileMainPlanDock: () => calls.push('dock'), renderThreadNow: () => calls.push('paint'), updateChatComposerSpace: () => calls.push('space'), _patchLatestMobileStreamingMessage: () => calls.push('live')});
vm.runInContext(source.slice(start, stop), ctx);
ctx.beginMobileReplayRenderBatch(); ctx.beginMobileReplayRenderBatch();
for (let n = 0; n < 500; n++) { ctx.renderStreamingThreadNow(); ctx.renderThreadSoon(); }
ctx.endMobileReplayRenderBatch(); ctx.flushMobileReplayRenderBatch();
assert.deepEqual(calls, []);
ctx.endMobileReplayRenderBatch(); ctx.flushMobileReplayRenderBatch(); ctx.flushMobileReplayRenderBatch();
assert.deepEqual(calls, ['dock', 'paint', 'space']);
ctx.renderStreamingThreadNow(); assert.equal(calls.at(-1), 'live');
console.log('PASS nested replay paints once; ordinary live stream still paints immediately');
