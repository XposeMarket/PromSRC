import type { TaskJournalEntry, TaskPlanStep } from './task-store.js';

export const WRITE_NOTE_COMPLETION_MARKER = 'write_note_completion';

type CompletionTask = {
  currentStepIndex: number;
  plan: TaskPlanStep[];
  parentTaskId?: string;
  subagentProfile?: string;
  teamSubagent?: unknown;
};

export function hasWriteNoteCompletionStep(task: Pick<CompletionTask, 'plan'>): boolean {
  return task.plan.some((step) => step.notes === WRITE_NOTE_COMPLETION_MARKER);
}

/** Named standalone subagents own a task panel and use normal task completion. */
export function shouldAppendWriteNoteCompletionStep(task: CompletionTask): boolean {
  const isResuming = task.currentStepIndex > 0;
  const isLegacyChildTask = !task.teamSubagent && !!task.parentTaskId;
  return !isResuming
    && !isLegacyChildTask
    && task.plan.length > 0
    && !hasWriteNoteCompletionStep(task);
}

export function buildTaskCompletionProtocol(task: Pick<CompletionTask, 'plan'>): string[] {
  const finalStep = task.plan[task.plan.length - 1];
  if (finalStep?.notes === WRITE_NOTE_COMPLETION_MARKER) {
    return [
      `- The FINAL step is "${finalStep.description}". Only in that step, call write_note`,
      `  (tag: "task_complete") with a full rundown of what was done. That note completes the task;`,
      `  do not call step_complete afterward. Then write your summary response as plain text.`,
      `  That text becomes the final message delivered to chat.`,
    ];
  }

  return [
    `- The FINAL step is "${finalStep?.description || 'the last listed plan step'}". Complete it with step_complete like any other step.`,
    `- A write_note call does not advance a normal plan step. Only a step explicitly named "Log completion" uses`,
    `  write_note(tag: "task_complete") as its completion signal.`,
  ];
}

export function hasTaskCompleteNoteSince(
  journal: TaskJournalEntry[] | undefined,
  since: number,
): boolean {
  return Array.isArray(journal) && journal.some((entry) =>
    entry.t >= since
    && entry.type === 'write_note'
    && /^\s*\[task_complete\](?:\s|$)/i.test(String(entry.content || ''))
  );
}
