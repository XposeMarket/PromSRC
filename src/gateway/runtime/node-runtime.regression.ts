import assert from 'node:assert/strict';
import {
  getNodeRuntimeSnapshot,
  isSupportedNodeVersion,
  parseNodeVersion,
} from './node-runtime';

assert.deepEqual(parseNodeVersion('v20.20.2'), { major: 20, minor: 20, patch: 2 });
assert.equal(parseNodeVersion('not-a-version'), null);
assert.equal(isSupportedNodeVersion('20.19.9'), false);
assert.equal(isSupportedNodeVersion('20.20.0'), true);
assert.equal(isSupportedNodeVersion('22.14.0'), true);
assert.equal(isSupportedNodeVersion('23.0.0'), false);

const runtime = getNodeRuntimeSnapshot();
assert.ok(runtime.pid > 0);
assert.ok(runtime.processStartedAt > 0);
assert.equal(runtime.nodeVersion, process.versions.node);

console.log('node-runtime regression passed');
