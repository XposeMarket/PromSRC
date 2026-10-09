import assert from 'node:assert/strict';
import { summarizeTeamForList } from './team-list-summary';

const big = 'x'.repeat(50_000);
const team = {
  id: 't1',
  name: 'T',
  subagentIds: ['a', 'b'],
  totalRuns: 3,
  lastActivityAt: 1000,
  teamChat: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, content: big, timestamp: 2000 + i })),
  runHistory: [{ startedAt: 500, finishedAt: 9000, trace: big }],
  roomState: { memberStates: { a: { status: 'ready' } }, events: [big] },
};

const s = summarizeTeamForList(team);
assert.equal(s.teamChat, undefined, 'teamChat stripped');
assert.equal(s.runHistory, undefined, 'runHistory stripped');
assert.equal(s.roomState, undefined, 'roomState stripped');
assert.equal(s.teamChatCount, 40);
assert.equal(s.runHistoryCount, 1);
assert.equal(s.lastActivityAt, 9000, 'last activity = newest of chat/run/lastActivityAt');
assert.deepEqual(s.subagentIds, ['a', 'b'], 'other fields kept');
assert.equal(s.totalRuns, 3);
assert.ok(JSON.stringify(s).length < 1000, 'summary is small');
assert.equal(team.teamChat.length, 40, 'input not mutated');
assert.equal(summarizeTeamForList(null), null);
console.log('team-list-summary regression: PASS');
