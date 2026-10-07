import assert from 'node:assert/strict';
import {
  getNodeRuntimeSnapshot,
  isBundledElectronRuntime,
  isSupportedNodeVersion,
  parseNodeVersion,
} from './node-runtime';

assert.deepEqual(parseNodeVersion('v20.20.2'), { major: 20, minor: 20, patch: 2 });
assert.equal(parseNodeVersion('not-a-version'), null);
assert.equal(isSupportedNodeVersion('20.19.9'), false);
assert.equal(isSupportedNodeVersion('20.20.0'), true);
// Packaged desktop: Electron's embedded Node (20.18.x on Electron 33) must be accepted.
assert.equal(isBundledElectronRuntime({ node: '20.18.3', electron: '33.4.11' } as any, {} as any), true);
assert.equal(isBundledElectronRuntime({ node: '20.18.3' } as any, { ELECTRON_RUN_AS_NODE: '1' } as any), true);
assert.equal(isBundledElectronRuntime({ node: '20.18.3' } as any, {} as any), false);
assert.equal(isSupportedNodeVersion('22.14.0'), true);
assert.equal(isSupportedNodeVersion('23.0.0'), false);

const runtime = getNodeRuntimeSnapshot();
assert.ok(runtime.pid > 0);
assert.ok(runtime.processStartedAt > 0);
assert.equal(runtime.nodeVersion, process.versions.node);

console.log('node-runtime regression passed');
