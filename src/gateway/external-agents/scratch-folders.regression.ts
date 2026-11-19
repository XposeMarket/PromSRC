import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { isPickableAgentFolder } from './scratch-folders';

const yes = () => true;
const ws = path.resolve(os.homedir(), 'prom-ws-fixture');
const project = path.resolve(os.homedir(), 'code', 'my-app');

assert.equal(isPickableAgentFolder(project, { workspacePath: ws, exists: yes }), true, 'real project folder stays');
assert.equal(isPickableAgentFolder(path.join(os.tmpdir(), 'prom-real-codex-x'), { workspacePath: ws, exists: yes }), false, 'OS temp hidden');
assert.equal(isPickableAgentFolder(os.tmpdir(), { workspacePath: ws, exists: yes }), false, 'temp root hidden');
assert.equal(isPickableAgentFolder(path.join(ws, 'temp', 'npc-brain-probe-a'), { workspacePath: ws, exists: yes }), false, 'workspace scratch hidden');
assert.equal(isPickableAgentFolder(path.join(ws, 'projects', 'site'), { workspacePath: ws, exists: yes }), true, 'other workspace folders stay');
assert.equal(isPickableAgentFolder(path.join(ws, 'temperature'), { workspacePath: ws, exists: yes }), true, 'prefix match is not a parent match');
assert.equal(isPickableAgentFolder(project, { workspacePath: ws, exists: () => false }), false, 'missing folder hidden');
assert.equal(isPickableAgentFolder('relative/dir', { exists: yes }), false, 'relative path rejected');
assert.equal(isPickableAgentFolder('', { exists: yes }), false, 'empty rejected');
console.log('scratch-folders regression: ok');
