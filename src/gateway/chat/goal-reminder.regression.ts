import assert from 'node:assert/strict';
import { goalReminderForTool } from './goal-reminder';

// The mid-turn [GOAL REMINDER] suffix is retired: it was appended to every
// 12th tool result, adding noise to the visible tool stream and mutating
// tool-result bytes that feed the provider prompt-cache prefix.
const goal = 'Fix the mobile restart freeze, the goal reminder noise, and search_files log access.';
for (const count of [0, 1, 11, 12, 24, 36, 120]) {
  assert.equal(goalReminderForTool(goal, count), '', `no goal reminder may be injected at tool #${count}`);
}

console.log('goal-reminder regression: ok');
