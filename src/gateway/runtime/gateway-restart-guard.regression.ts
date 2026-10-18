import assert from 'node:assert/strict';
import { otherActiveRestartRuntimes, restartDeferredMessage } from './gateway-restart-guard';
const running = (sessionId: string, label = 'Chat') => ({ sessionId, label, status: 'running' as const });
const own = running('caller');
const other = running('other');
const agent = { ...running('background_other', 'Agent'), recoveryData: { ownerSessionId: 'other' } };
const team = { ...running('team_member', 'Team'), recoveryData: { ownerSessionId: 'other' } };
const ownAgent = { ...running('background_caller'), recoveryData: { ownerSessionId: 'caller' } };
assert.deepEqual(otherActiveRestartRuntimes([own, ownAgent, other, agent, team], 'caller'), [other, agent, team]);
assert.deepEqual(otherActiveRestartRuntimes([own, ownAgent, other], 'background_caller'), [other]);
assert.deepEqual(otherActiveRestartRuntimes([
  own, { ...other, status: 'interrupted' }, { ...other, status: 'completed' },
  { ...other, abortRequestedAt: 1 }, { ...other, completedAt: 1 },
], 'caller'), []);
assert.match(restartDeferredMessage([other, agent]), /Restart deferred: 2 other active turn\(s\): other \(Chat\), other \(Agent\)/);
assert.match(restartDeferredMessage([other]), /force:true if the user explicitly asked/);
console.log('gateway restart guard regressions passed');
