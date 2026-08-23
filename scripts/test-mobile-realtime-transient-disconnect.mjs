import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web-ui/src/mobile/mobile-pages.js', import.meta.url), 'utf8');
const anchor = source.indexOf("pc.addEventListener('connectionstatechange', () => logState('connectionstatechange'))");
assert.ok(anchor >= 0, 'realtime agent connection-state logging hook should exist');
const block = source.slice(anchor, anchor + 4200);
assert.match(block, /let transientDisconnectTimer = null/, 'realtime agent should track a transient disconnect grace timer');
assert.match(block, /state === 'disconnected'/, 'disconnected should have a dedicated transient path');
assert.match(block, /rtc_disconnected_timeout/, 'only an expired disconnect grace period should enter reconnect teardown');
assert.match(block, /}, 5000\)/, 'transient disconnect should receive a five-second recovery window');
assert.match(block, /state === 'connected'[\s\S]*clearTransientDisconnectTimer/, 'a recovered peer connection should cancel teardown');
assert.match(block, /state === 'closed' \|\| state === 'failed'/, 'closed and failed should remain terminal');
assert.doesNotMatch(block, /\['closed', 'failed', 'disconnected'\]/, 'disconnected must not share the immediate terminal path');

console.log('mobile realtime transient disconnect contract: ok');
