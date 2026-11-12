/**
 * Whether a task can own a gateway restart requested from its session.
 *
 * A main chat that once hosted a scheduled task run (for example an X Editor
 * job bound to the chat) keeps that task's sessionId after the task finishes.
 * When gateway_restart treated that finished task as the restart owner, BOOT
 * skipped the chat (task-owned restarts are reported by the task) while task
 * recovery had nothing to relaunch. The user's turn was never resumed and no
 * reply arrived after the restart. Only a task that can still run owns it.
 */
export function isLiveRestartOwnerStatus(status: unknown): boolean {
  const value = String(status ?? '').trim();
  return value !== 'complete' && value !== 'failed';
}
