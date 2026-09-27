import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { backgroundSpawnContinuityForSession, formatBackgroundSpawnContinuity, persistBackgroundSpawnReceipt } from './background-spawn-continuity';

const sessionId = `background-receipt-regression-${randomUUID()}`;
const startedAt = Date.now() - 5000;
const id = `bg_${randomUUID()}`;
persistBackgroundSpawnReceipt({ id, spawnerSessionId: sessionId, state: 'in_progress', startedAt, promptPreview: 'Generate an asset' });
assert.match(formatBackgroundSpawnContinuity(sessionId, startedAt - 1000), /completion not yet verified/, 'started agent remains visible in interrupted context');
persistBackgroundSpawnReceipt({ id, spawnerSessionId: sessionId, state: 'completed', startedAt, completedAt: Date.now(), promptPreview: 'Generate an asset', result: 'Asset built successfully.' });
const receipts = backgroundSpawnContinuityForSession(sessionId, startedAt - 1000);
assert.equal(receipts.length, 1, 'completion replaces the started receipt instead of duplicating the agent');
assert.equal(receipts[0].result, 'Asset built successfully.');
assert.match(formatBackgroundSpawnContinuity(sessionId, startedAt - 1000), /Asset built successfully/, 'restart context includes the terminal result');
assert.equal(backgroundSpawnContinuityForSession(sessionId, Date.now() + 1000).length, 0, 'an earlier unrelated turn does not contaminate recovery');
console.log('background spawn continuity regression passed');
