import assert from 'node:assert/strict';
import {
  buildTaskCompletionProtocol,
  hasTaskCompleteNoteSince,
  shouldAppendWriteNoteCompletionStep,
  WRITE_NOTE_COMPLETION_MARKER,
} from './task-completion-protocol.js';

const basePlan = [
  { index: 0, description: 'Execute Dante', status: 'pending' as const },
  { index: 1, description: 'Validate results', status: 'pending' as const },
  { index: 2, description: 'Return results', status: 'pending' as const },
];

assert.equal(shouldAppendWriteNoteCompletionStep({
  currentStepIndex: 0,
  plan: basePlan,
  subagentProfile: 'gaming_engineer_mrp3mtdz',
}), true, 'standalone named subagents must receive the completion-note step');

assert.equal(shouldAppendWriteNoteCompletionStep({
  currentStepIndex: 0,
  plan: basePlan,
  subagentProfile: 'child',
  parentTaskId: 'parent-task',
}), false, 'legacy child tasks keep their parent handoff flow');

const normalProtocol = buildTaskCompletionProtocol({ plan: basePlan });
assert.match(normalProtocol.join('\n'), /Complete it with step_complete/);
assert.doesNotMatch(normalProtocol.join('\n'), /FINAL step in every plan is "Log completion"/);

const notePlan = [
  ...basePlan,
  {
    index: 3,
    description: 'Log completion',
    status: 'pending' as const,
    notes: WRITE_NOTE_COMPLETION_MARKER,
  },
];
assert.match(buildTaskCompletionProtocol({ plan: notePlan }).join('\n'), /Only in that step, call write_note/);

const journal = [
  { t: 100, type: 'write_note' as const, content: '[task_complete] too early' },
  { t: 220, type: 'write_note' as const, content: '[task_complete] current final step' },
];
assert.equal(hasTaskCompleteNoteSince(journal, 200), true);
assert.equal(hasTaskCompleteNoteSince(journal, 221), false, 'an earlier note must not complete a later step');

console.log('task completion protocol regression checks passed');
