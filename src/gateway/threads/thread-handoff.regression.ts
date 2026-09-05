import assert from 'node:assert/strict';
import { managedPrompt } from './thread-handoff';
for (const follow of [true, false]) {
  const result = managedPrompt('Full plan: reproduce exact browser error; preserve dirty files.', 'Fix reliability', follow, 'Tests pass; open PR; do not merge.', 'owner-123');
  assert.ok(result.includes('Full plan: reproduce exact browser error; preserve dirty files.'));
  assert.ok(result.includes('[OBJECTIVE]\nFix reliability'));
  assert.ok(result.includes('[ACCEPTANCE CRITERIA]\nTests pass; open PR; do not merge.'));
  assert.ok(result.includes('Source session: owner-123'));
  assert.equal(result.startsWith('/goal '), follow);
}
assert.equal(managedPrompt('', '', true), '');
assert.ok(managedPrompt('', 'Objective-only compatibility', true).startsWith('/goal Objective-only compatibility'));
assert.equal((managedPrompt('/goal detailed assignment', 'summary', true).match(/\/goal/g) || []).length, 1);
assert.equal((managedPrompt('same', 'same', false, 'same').match(/same/g) || []).length, 1);
console.log('thread handoff regression: passed');
