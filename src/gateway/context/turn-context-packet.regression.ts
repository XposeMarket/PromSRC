import assert from 'assert';
import {
  buildTurnContextPacket,
  formatTurnContextPacketsForPrompt,
  mergeTurnContextPackets,
  shouldPersistTurnContext,
} from './turn-context-packet';

const base = buildTurnContextPacket({
  turnId: 'turn-1',
  sessionId: 'session-1',
  status: 'aborted',
  request: 'Investigate the runtime context flow.',
  reasoningSummary: 'The active path stores tool observations but needs a separate bounded decision handoff.',
  findings: ['Tool observations are persisted out of band.'],
  decisions: ['Keep safe reasoning summaries separate from private thinking.'],
  completedActions: ['read_file: ok'],
  uncertainties: ['A tool boundary may still be in flight.'],
  pendingTasks: ['Verify the interrupted boundary before retrying.'],
  continueFromHere: 'Resume from the recorded observation and verify the in-flight boundary.',
});

assert.equal(base.status, 'aborted');
assert.match(formatTurnContextPacketsForPrompt([base]), /Reasoning\/decision summary/);
assert.match(formatTurnContextPacketsForPrompt([base]), /Verify the interrupted boundary/);
assert.equal((base as any).thinking, undefined, 'private thinking must not be persisted in a working packet');

const completed = buildTurnContextPacket({
  ...base,
  status: 'completed',
  reasoningSummary: 'The interrupted boundary was verified and the work continued.',
  completedActions: ['run_tests: ok'],
});
const merged = mergeTurnContextPackets(base, completed);
assert.equal(merged.turnId, base.turnId);
assert.equal(merged.status, 'completed');
assert.match(merged.completedActions.join('\n'), /read_file/);
assert.match(merged.completedActions.join('\n'), /run_tests/);
assert.ok(shouldPersistTurnContext({ status: 'aborted' }));
assert.ok(shouldPersistTurnContext({ status: 'completed', toolCount: 1 }));
assert.equal(shouldPersistTurnContext({ status: 'completed', reasoningSummary: 'Short answer only.' }), false);
assert.equal(shouldPersistTurnContext({ status: 'completed' }), false);

console.log('turn-context-packet regression: ok');
