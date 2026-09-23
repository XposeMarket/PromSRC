import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── Mobile app left open across a mid-turn restart must keep streaming ──────
//
// Repro: with the thread open, the gateway restarts mid-turn. During the
// restart the server writes a restart_checkpoint / restart_status assistant row
// into history. The open app's recovery pass asked
// `_mobileHistoryHasCompletedTurnSince(history, runStartedAt)` and that row
// counted as "the turn completed", so recovery finalized the live assistant
// turn and cleared the active run. Post-restart frames then had no live turn
// to attach to and the UI froze until a cold reopen (which replays from seq 0).
//
// Checkpoint/status rows are continuity markers, never the turn's answer.

const pagesPath = path.join(__dirname, '..', '..', 'web-ui', 'src', 'mobile', 'mobile-pages.js');
const source = readFileSync(pagesPath, 'utf8').replace(/\r\n/g, '\n');

const start = source.indexOf('function _mobileHistoryHasCompletedTurnSince(');
assert.ok(start >= 0, '_mobileHistoryHasCompletedTurnSince must exist');
const end = source.indexOf('\n}\n', start);
const body = source.slice(start, end);

assert.ok(
  body.includes('_isMobileGatewayRestartCheckpointMessage(msg)') && body.includes('_isMobileGatewayRestartTerminalMessage(msg)'),
  'completion check must skip restart checkpoint and restart status rows',
);

// Behavioural check: evaluate the real function bodies in isolation.
function extract(name: string): string {
  const s = source.indexOf(`function ${name}(`);
  assert.ok(s >= 0, `${name} must exist`);
  const e = source.indexOf('\n}\n', s);
  return source.slice(s, e + 2);
}
const factory = new Function(`
  function _mobileMessageCopyText(msg) { return String(msg?.content || msg?.body?.text || ''); }
  ${extract('_isMobileGatewayRestartCheckpointMessage')}
  ${extract('_isMobileGatewayRestartTerminalMessage')}
  ${extract('_mobileHistoryHasCompletedTurnSince')}
  return _mobileHistoryHasCompletedTurnSince;
`);
const completedSince = factory() as (h: any[], s: number, o?: any) => boolean;

const runStartedAt = 1_000_000;
const history = [
  { role: 'user', content: 'do the thing', timestamp: runStartedAt - 1000 },
  { role: 'assistant', messageKind: 'restart_checkpoint', content: '[Hot restart checkpoint: planned by this chat]\nGateway Restart Initiated', timestamp: runStartedAt + 30_000 },
  { role: 'assistant', content: 'Gateway restart completed successfully.', timestamp: runStartedAt + 40_000 },
];
assert.equal(completedSince(history, runStartedAt), false, 'restart markers alone must not count as a completed turn');

const withAnswer = [...history, { role: 'assistant', content: 'Here is the real final answer.', timestamp: runStartedAt + 90_000 }];
assert.equal(completedSince(withAnswer, runStartedAt), true, 'a real answer after the restart still completes the turn');

console.log('mobile-restart-open-app-freeze regression: ok');
