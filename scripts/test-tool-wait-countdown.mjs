// Regression: live wait countdown + activity pill guard (shared desktop/mobile module).
import assert from 'node:assert/strict';
import {
  toolWaitDeadline,
  formatCountdown,
  openToolWaitDeadline,
  waitCountdownHtml,
  shouldShowActivityPill,
  MAX_TOOL_WAIT_MS,
} from '../web-ui/src/features/chat/tool-wait-countdown.js';

const t0 = 1_000_000;

// Known-duration waits get a deadline.
assert.equal(toolWaitDeadline('background_ops', { action: 'wait', wait_ms: 60000 }, t0), t0 + 60000);
assert.equal(toolWaitDeadline('background_ops', JSON.stringify({ action: 'wait', timeout_ms: 5000 }), t0), t0 + 5000);
assert.equal(toolWaitDeadline('workspace_run', { action: 'wait', runId: 'r', timeout_ms: 120000 }, t0), t0 + 120000);
assert.equal(toolWaitDeadline('background_ops', { action: 'wait', wait_ms: 10 * 60 * 60 * 1000 }, t0), t0 + MAX_TOOL_WAIT_MS, 'clamped');
// No countdown without a known wait.
assert.equal(toolWaitDeadline('await_prometheus_question_response', { question_id: 'q', timeout_ms: 60000 }, t0), 0);
assert.equal(toolWaitDeadline('ask_prometheus_questions', { questions: [] }, t0), 0);
assert.equal(toolWaitDeadline('workspace_run', { action: 'run', command: 'x', timeout_ms: 60000 }, t0), 0, 'timeout_ms on non-wait action is not a wait');
assert.equal(toolWaitDeadline('background_ops', { action: 'wait' }, t0), 0, 'wait without duration');
assert.equal(toolWaitDeadline('background_ops', { action: 'spawn', prompt: 'x' }, t0), 0);

// Formatting.
assert.equal(formatCountdown(42_000), '0:42');
assert.equal(formatCountdown(61_500), '1:02');
assert.equal(formatCountdown(-5000), '0:00');
assert.equal(formatCountdown(3_725_000), '1:02:05');

// Open wait in a trace group → countdown span; result → none.
const open = [{ activity: { kind: 'operation', action: 'background_ops', args: { action: 'wait', wait_ms: 60000 }, status: 'running', startedAt: t0 } }];
assert.equal(openToolWaitDeadline(open), t0 + 60000);
const html = waitCountdownHtml(open, t0 + 18_000);
assert.match(html, /class="pm-tool-wait-countdown"/);
assert.match(html, /data-deadline="1060000"/);
assert.match(html, /Waiting · 0:42 left/);
const done = [{ activity: { ...open[0].activity, kind: 'result', status: 'succeeded' } }];
assert.equal(openToolWaitDeadline(done), 0);
assert.equal(waitCountdownHtml(done, t0), '');
const nonWait = [{ activity: { kind: 'operation', action: 'web_search', args: { query: 'x' }, status: 'running', startedAt: t0 } }];
assert.equal(waitCountdownHtml(nonWait, t0), '');

// Activity pill guard (defends against old gateways' early pills).
assert.equal(shouldShowActivityPill(''), false);
assert.equal(shouldShowActivityPill('Still connected. Waiting for background operation result (46s).'), false);
assert.equal(shouldShowActivityPill('Still connected. No new model or tool update for 30s.'), false);
assert.equal(shouldShowActivityPill('Still connected. Waiting for the next update.'), false);
assert.equal(shouldShowActivityPill('Still connected. Waiting for web search result (61s).'), true);
assert.equal(shouldShowActivityPill('Still connected. No new model or tool update for 61s.'), true);
assert.equal(shouldShowActivityPill('Still connected. Terminal command is open; waiting for output (75s since last tool update).'), true);

console.log('tool wait countdown regression passed.');
