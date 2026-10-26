import { AsyncLocalStorage } from 'node:async_hooks';

export class ScheduledApprovalRequiredError extends Error {
  readonly code = 'NEEDS_APPROVAL';
  constructor() {
    super('ERROR: NEEDS_APPROVAL: Scheduled runs cannot wait for final-action approval.');
    this.name = 'ScheduledApprovalRequiredError';
  }
}

export interface ScheduledApprovalPolicyContext {
  onNeedsApproval(error: ScheduledApprovalRequiredError): void;
  getCancellationError?(): Error | undefined;
}

const scheduledApprovalPolicy = new AsyncLocalStorage<ScheduledApprovalPolicyContext>();

/** Only the trusted scheduler may establish this context; never infer it from prompts or session names. */
export function withScheduledApprovalPolicy<T>(context: ScheduledApprovalPolicyContext, operation: () => T): T {
  return scheduledApprovalPolicy.run(context, operation);
}

/** Stops later tool dispatches even when a provider catches the original tool error. */
export function assertScheduledRunActive(): void {
  const error = scheduledApprovalPolicy.getStore()?.getCancellationError?.();
  if (error) throw error;
}

export function rejectScheduledFinalAction(): void {
  const context = scheduledApprovalPolicy.getStore();
  if (!context) return;
  assertScheduledRunActive();
  const error = new ScheduledApprovalRequiredError();
  // Signal the owning scheduler before throwing: tool loops may catch exceptions.
  try { context.onNeedsApproval(error); } finally { throw error; }
}
