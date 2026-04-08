/**
 * task-step-auditor.ts — DELETED
 *
 * The step auditor has been removed. Step completion is now agent-driven via
 * the step_complete tool. See background-task-runner.ts and task-self-healer.ts.
 *
 * This file is kept as a stub to avoid breaking any stale imports during the
 * transition. It exports empty/null implementations only.
 */

export interface TaskStepAuditResult {
  completed_steps: number[];
  notes: Record<number, string>;
  plan_mutations?: Array<
    | { op: 'add'; after_index: number; description: string }
    | { op: 'skip'; step_index: number; reason: string }
    | { op: 'modify'; step_index: number; description: string }
  >;
  raw_response?: string;
}

/** @deprecated The step auditor has been removed. Use step_complete tool instead. */
export async function callTaskStepAuditor(_input: {
  pendingSteps: Array<{ index: number; description: string }>;
  toolCallLog: Array<{ tool: string; args: any; result: string; error: boolean }>;
  resultText: string;
}): Promise<TaskStepAuditResult | null> {
  console.warn('[TaskStepAuditor] callTaskStepAuditor() called but auditor has been removed. Use step_complete tool.');
  return null;
}
