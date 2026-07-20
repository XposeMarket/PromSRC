import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appendFinalResponseDelta, reconcileFinalResponse } from '../web-ui/src/chat-final-response.js';

const root = process.cwd();
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const desktop = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');
const subagents = fs.readFileSync(path.join(root, 'web-ui/src/pages/SubagentsPage.js'), 'utf8');
const gateway = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');

const splitMarkdown = ['### Exact', ' heading\n\n', '- first', '\n- second\n\n', '```ts\n', 'const value = `ok`;\n', '```'];
const expected = splitMarkdown.join('');
const streamed = splitMarkdown.reduce(appendFinalResponseDelta, '');
assert.equal(streamed, expected, 'split Markdown tokens must retain every delimiter and newline');
assert.equal(reconcileFinalResponse(streamed, '### Canonical\n\n- complete'), '### Canonical\n\n- complete', 'completed final must replace the live preview');
assert.equal(reconcileFinalResponse(streamed, ''), streamed, 'missing canonical final must retain the exact preview');
assert.equal(appendFinalResponseDelta('ha', 'ha'), 'haha', 'repeated final text is content, not a duplicate frame');

for (const [name, source] of [['mobile', mobile], ['desktop', desktop], ['subagent', subagents]]) {
  assert.match(source, /appendFinalResponseDelta/, `${name} must use the shared exact final-delta append`);
  assert.match(source, /reconcileFinalResponse/, `${name} must reconcile the canonical completed final`);
  assert.match(source, /final_response_start/, `${name} must recognize the explicit final-response boundary`);
}
assert.match(gateway, /final_response_start/, 'gateway must publish the final-response boundary before visible token deltas');
assert.match(mobile, /function _moveMobileAnswerTextIntoTrace\(message, type = 'think'\) \{\s+if \(!message\) return;/, 'mobile tool boundaries must move provisional model prose into activity');
assert.doesNotMatch(mobile, /function _moveMobileAnswerTextIntoTrace\(message, type = 'think'\) \{\s+if \(!message \|\| message\.finalResponseStarted\) return;/, 'the first-token boundary must not prevent later tool boundaries from separating commentary rounds');
assert.doesNotMatch(desktop, /moveVisibleAnswerTextIntoWorkflowTrace = \(\) => \{\s+if \(streamState\.finalResponseStarted\) return;/, 'desktop tool boundaries must separate provisional commentary rounds too');

console.log('Chat final-response stream contracts passed.');
