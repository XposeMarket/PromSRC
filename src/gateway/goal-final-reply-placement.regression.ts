import assert from 'node:assert/strict';
import { repairReappendedAssistantRows } from './history-reconciliation';

const minute = 60_000;
const misplacedGoalReply = {
  role: 'assistant',
  messageKind: 'goal_turn',
  activeRunKind: 'main_chat_goal',
  timestamp: 11 * minute,
  content: 'The goal is complete. This is the full final summary.',
};
const damagedHistory = [
  { role: 'user', timestamp: 1 * minute, content: 'Start the work.' },
  { role: 'assistant', timestamp: 2 * minute, content: 'Here is the plan.' },
  // Reconnect/recovery put the completed goal reply near the old first turn.
  misplacedGoalReply,
  { role: 'user', timestamp: 3 * minute, content: 'Continue the work.' },
  { role: 'assistant', timestamp: 4 * minute, content: 'The work is underway.' },
  { role: 'assistant', messageKind: 'goal_restart_notice', timestamp: 10 * minute, content: 'Gateway restarted — goal continuing.' },
  { role: 'user', timestamp: 12 * minute, content: '[Timer fired] Verify after restart.' },
  { role: 'assistant', timestamp: 13 * minute, content: 'The goal was already complete.' },
];

const healed = repairReappendedAssistantRows(damagedHistory);
assert.deepEqual(
  healed.map((message: any) => message.content),
  [
    'Start the work.',
    'Here is the plan.',
    'Continue the work.',
    'The work is underway.',
    'Gateway restarted — goal continuing.',
    'The goal is complete. This is the full final summary.',
    '[Timer fired] Verify after restart.',
    'The goal was already complete.',
  ],
  'a re-appended continuation reply must return to its chronological tail position, after restart receipts and before later turns',
);
console.log('goal final reply placement regression passed');
