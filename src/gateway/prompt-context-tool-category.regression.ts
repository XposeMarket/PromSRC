import assert from 'node:assert/strict';
import { detectToolCategories } from './prompt-context';

function has(message: string, category: string): boolean {
  return detectToolCategories(message).has(category);
}

// A casual acknowledgement must not activate schedule -> automations merely
// because it contains the letters `at ` at the word boundary in "Great".
assert.deepEqual([...detectToolCategories('Great thanks')], []);

// Timed requests without another scheduling keyword still need the schedule
// category so the normal category activation path can make automation tools
// available when appropriate.
assert.equal(has('Start the report at 5:30 PM.', 'schedule'), true);
assert.equal(has('Run it at noon.', 'schedule'), true);

console.log('prompt-context tool-category regression passed');
