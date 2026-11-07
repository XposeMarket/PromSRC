import type { TaskPlanStep } from '../tasks/task-store';

/**
 * Scheduled-run plan. Order is always:
 * Prepare -> (read / collect / search / write steps) -> Execute -> [Verify] -> Deliver.
 */
export function buildScheduledTaskPlan(job: { prompt?: string }): TaskPlanStep[] {
  const lower = String(job?.prompt || '').toLowerCase();
  const descriptions: string[] = ['Prepare scheduled run context and activate required tools'];
  if (lower.includes('source-preferences.md') || lower.includes('read first')) {
    descriptions.push('Read or seed required workspace source files');
  }
  if (lower.includes('x.com/home') || lower.includes('browser') || lower.includes('collect')) {
    descriptions.push('Collect the bounded browser/source sample without side effects');
  }
  if (lower.includes('search') || lower.includes('targeted')) {
    descriptions.push('Run targeted searches and extract concrete signals');
  }
  if (lower.includes('output files') || lower.includes('write workspace') || lower.includes('save both')) {
    descriptions.push('Write the required workspace output files');
  }
  descriptions.push('Execute the scheduled prompt');
  if (lower.includes('verify') || lower.includes('read_file') || lower.includes('completion')) {
    descriptions.push('Verify outputs and record completion or blockers');
  }
  descriptions.push('Deliver the final scheduled-task result');
  return Array.from(new Set(descriptions)).slice(0, 8).map((description, index) => ({
    index,
    description,
    status: 'pending' as const,
  }));
}

/**
 * Final plan state for a finished scheduled run.
 * Success: every open (pending/running) step becomes done.
 * Failure: the current step (first running, else first pending) becomes failed; the rest stay pending.
 * Returns a new array; never mutates the input.
 */
export function finalizeScheduledPlanSteps(plan: TaskPlanStep[] | undefined, success: boolean, notes = '', now = Date.now()): TaskPlanStep[] {
  const steps = Array.isArray(plan) ? plan.map((step) => ({ ...step })) : [];
  const note = String(notes || '').slice(0, 200);
  if (success) {
    let lastOpen = -1;
    steps.forEach((step, index) => { if (step.status === 'pending' || step.status === 'running') lastOpen = index; });
    steps.forEach((step, index) => {
      if (step.status !== 'pending' && step.status !== 'running') return;
      step.status = 'done';
      step.completedAt = step.completedAt || now;
      if (index === lastOpen && note) step.notes = note;
    });
    return steps;
  }
  let current = steps.findIndex((step) => step.status === 'running');
  if (current < 0) current = steps.findIndex((step) => step.status === 'pending');
  if (current >= 0) {
    steps[current].status = 'failed';
    if (note) steps[current].notes = note;
  }
  return steps;
}
