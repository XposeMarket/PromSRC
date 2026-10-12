import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { voiceContextRequestHash, voiceContextEntryMatches } from './context-cache-key';

const request = { workspacePath: '/workspace/a', historyLength: 4, targetKey: 'main', requestHash: voiceContextRequestHash('look into voice mode') };
assert.equal(voiceContextEntryMatches({ ...request }, request), true);
assert.equal(voiceContextEntryMatches({ ...request, requestHash: voiceContextRequestHash('show my trading plan') }, request), false, 'changed utterance cannot reuse memory/skill matches');
assert.equal(voiceContextEntryMatches({ ...request, workspacePath: '/workspace/b' }, request), false);
assert.equal(voiceContextEntryMatches({ ...request, historyLength: 5 }, request), false);
assert.equal(voiceContextEntryMatches({ ...request, targetKey: 'subagent:one' }, request), false);
assert.equal(voiceContextEntryMatches({ workspacePath: request.workspacePath, historyLength: 4, targetKey: 'main' }, request), false, 'legacy entries without request hashes are invalid');
assert.notEqual(voiceContextRequestHash('hi'), voiceContextRequestHash('Hi'));
assert.equal(voiceContextRequestHash(undefined), voiceContextRequestHash(''));
const source = fs.readFileSync(path.join(__dirname, '../routes/chat.router.ts'), 'utf8');
assert.ok(source.includes('voiceContextEntryMatches(cached, contextRequest)'), 'cached context must use request identity');
assert.ok(source.includes('voiceContextEntryMatches(entry, contextRequest)'), 'pending context must use request identity');
assert.ok(source.includes('targetKey, requestHash, contextBlock'), 'persist identity with entry');
console.log('voice context cache regression: 11 assertions passed');
