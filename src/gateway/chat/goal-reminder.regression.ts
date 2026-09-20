import assert from 'node:assert/strict';
import { goalReminderForTool } from './goal-reminder';

const task = 'Inspect the Vita bridge, fix the terminal runtime, and verify each change.';
for (let count = 1; count <= 30; count += 1) {
  const reminder = goalReminderForTool(task, count);
  assert.equal(Boolean(reminder), count === 12 || count === 24, `unexpected reminder at tool ${count}`);
}
assert.equal(goalReminderForTool('Rebooted', 12), '');
assert.match(goalReminderForTool(task, 12), /Vita bridge/);
console.log('goal reminder cadence regression passed');
