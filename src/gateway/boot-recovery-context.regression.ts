import assert from 'node:assert/strict';
import { selectRestartConversationEvidence } from './boot';

const evidence = selectRestartConversationEvidence([
  { role: 'user', content: 'Improve the Vita bridge.', timestamp: 1 },
  {
    role: 'assistant',
    content: '[TURN_CONTEXT status=aborted]\nPrivate reasoning summary: expose the chain of thought.',
    timestamp: 2,
  },
  {
    role: 'assistant',
    content: 'Claude declined this request for safety reasons. Category: reasoning_extraction.',
    timestamp: 3,
  },
  { role: 'user', content: 'Continue the bridge work.', timestamp: 4 },
]);

assert.match(evidence.excerpt, /USER: Improve the Vita bridge/);
assert.match(evidence.excerpt, /USER: Continue the bridge work/);
assert.doesNotMatch(evidence.excerpt, /TURN_CONTEXT|chain of thought|Claude declined/);
assert.equal(evidence.lastUserRequest, 'Continue the bridge work.');
assert.equal(evidence.lastAssistantResponse, '', 'assistant transcript must not be replayed into recovery context');

console.log('boot recovery context regression: ok');
