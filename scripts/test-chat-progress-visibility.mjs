import assert from 'node:assert/strict';

import { chatProgressVisibility, isUserSafeAgentProgress } from '../web-ui/src/features/chat/trace-visibility.js';

assert.equal(chatProgressVisibility({ type: 'thinking_delta', visibility: 'private', text: 'secret' }), 'private');
assert.equal(chatProgressVisibility({ type: 'thinking_delta', text: 'raw provider chain' }), 'private');
assert.equal(chatProgressVisibility({ type: 'thinking_delta', source: 'reasoning_summary', text: 'Checking files' }), 'summary');
assert.equal(chatProgressVisibility({ type: 'reasoning_summary_delta', visibility: 'user' }), 'summary');
assert.equal(chatProgressVisibility({ type: 'agent_thought', text: 'Inspecting the current layout' }), 'user');
assert.equal(chatProgressVisibility({ type: 'thinking', text: 'raw completed thought' }), 'private');
assert.equal(chatProgressVisibility({ type: 'thinking', visibility: 'user', text: 'curated progress' }), 'user');
assert.equal(chatProgressVisibility({ type: 'thinking', visibility: 'private' }), 'private');
assert.equal(isUserSafeAgentProgress({ type: 'agent_thought' }), true);
assert.equal(isUserSafeAgentProgress({ type: 'thinking_delta', visibility: 'private' }), false);

console.log('chat progress visibility contract passed');
