import assert from 'node:assert/strict';
import { DEFAULT_BROWSER_SESSION_ID, normalizeBrowserSessionId } from './browser-session-identity';

assert.equal(normalizeBrowserSessionId(undefined), DEFAULT_BROWSER_SESSION_ID);
assert.equal(normalizeBrowserSessionId(null), DEFAULT_BROWSER_SESSION_ID);
assert.equal(normalizeBrowserSessionId('   '), DEFAULT_BROWSER_SESSION_ID);
assert.equal(normalizeBrowserSessionId('  session-42  '), 'session-42');
assert.equal(normalizeBrowserSessionId('CaseSensitive-ID'), 'CaseSensitive-ID');
assert.equal(normalizeBrowserSessionId('task_abc::detached'), 'task_abc::detached');
console.log('browser session identity normalization regression checks passed');
