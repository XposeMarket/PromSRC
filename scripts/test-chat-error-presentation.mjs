import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const { presentChatError, presentGoalAction } = await import(pathToFileURL(path.join(root, 'web-ui/src/chat-error-presentation.js')).href);

const activeTurn = presentChatError({
  httpStatus: 409,
  rawBody: JSON.stringify({
    success: false,
    code: 'SESSION_TURN_ACTIVE',
    error: 'Another turn is already active for this session.',
    sessionId: 'mobile_internal_session',
  }),
});
assert.equal(activeTurn.key, 'session-turn-active');
assert.equal(activeTurn.title, 'Another request is still running');
assert.doesNotMatch(activeTurn.summary, /SESSION_TURN_ACTIVE|mobile_internal_session/);
assert.match(activeTurn.technicalDetails, /SESSION_TURN_ACTIVE/);

const lease = presentChatError({
  message: 'Durable turn 06de397a-40b1-46b3-b9ae-2b9824f8cef1 could not acquire its session lease.',
});
assert.equal(lease.key, 'session-lease-unavailable');
assert.equal(lease.title, 'This chat is temporarily unavailable');
assert.doesNotMatch(lease.summary, /Durable turn|lease token|06de397a/i);

const retryA = presentChatError({ httpStatus: 409, rawBody: JSON.stringify({ code: 'SESSION_TURN_ACTIVE' }) });
const retryB = presentChatError({ httpStatus: 409, rawBody: JSON.stringify({ code: 'SESSION_TURN_ACTIVE' }) });
assert.equal(retryA.key, retryB.key, 'retries must have one stable coalescing key');

const stoppedGoal = presentGoalAction('done', { goal: { id: 'goal-1', turnsUsed: 0, lastVerdict: 'stopped' } });
assert.equal(stoppedGoal.title, 'Goal stopped');
assert.equal(stoppedGoal.severity, 'info');
assert.equal(stoppedGoal.summary, 'No work was run.');

const mobileApi = read('web-ui/src/mobile/mobile-api.js');
const mobilePages = read('web-ui/src/mobile/mobile-pages.js');
const goals = read('src/gateway/main-chat-goals.ts');
assert.match(mobileApi, /presentChatError\(\{ rawBody: body, httpStatus: res\.status/, 'HTTP errors must be typed before the UI sees them');
assert.match(mobilePages, /function _coalesceMobileChatError/, 'duplicate retry errors must be coalesced');
assert.match(mobilePages, /_renderMobileChatErrorPresentation/, 'errors must render as status cards, not assistant prose');
assert.doesNotMatch(mobilePages, /targetAiTurn\.body\.text = \(targetAiTurn\.body\.text \? targetAiTurn\.body\.text \+ '\\n\\n' : ''\) \+ `Warning:/, 'primary stream errors must not be appended as assistant messages');
assert.match(goals, /lastVerdict: 'stopped'/, 'user-marked-done goals must be persisted as stopped');
assert.match(goals, /goal\.lastVerdict === 'stopped'\) return null/, 'stopped goals must not emit completion totals');

console.log('[chat-error-presentation] typed errors, retry coalescing, and neutral goal stops passed');
