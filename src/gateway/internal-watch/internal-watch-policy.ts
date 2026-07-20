import { AsyncLocalStorage } from 'node:async_hooks';
import type { InternalWatchActionPolicy } from './internal-watch-store';

export interface InternalWatchTurnContext {
  watchId: string;
  actionPolicy: InternalWatchActionPolicy;
  targetTaskId?: string;
  delivery: 'follow_up' | 'live_steer';
}

interface InternalWatchTurnState {
  context?: InternalWatchTurnContext;
}

export interface InternalWatchPolicyDenial {
  success: false;
  action: string;
  code: 'internal_watch_policy_denied';
  watch_id: string;
  policy: InternalWatchActionPolicy;
  target_task_id: string | null;
  allowed_actions: string[];
  message: string;
}

const turnState = new AsyncLocalStorage<InternalWatchTurnState>();
const READ_ONLY_ACTIONS = new Set(['get', 'list', 'latest', 'list_approvals']);
const SAME_RUN_ACTIONS = new Set(['steer', 'message', 'resume', 'continue']);
const FULL_RERUN_ACTIONS = new Set([...SAME_RUN_ACTIONS, 'rerun']);

export function runWithInternalWatchTurnContext<T>(
  context: InternalWatchTurnContext | undefined,
  callback: () => T,
): T {
  return turnState.run({ context }, callback);
}

export function setCurrentInternalWatchTurnContext(context: InternalWatchTurnContext): void {
  const state = turnState.getStore();
  if (state) state.context = context;
}

export function getCurrentInternalWatchTurnContext(): InternalWatchTurnContext | undefined {
  return turnState.getStore()?.context;
}

export function evaluateInternalWatchTaskControlPolicy(
  context: InternalWatchTurnContext | undefined,
  args: any,
): InternalWatchPolicyDenial | null {
  if (!context) return null;
  const action = String(args?.action || '').trim().toLowerCase();
  const explicitTaskId = String(args?.task_id || args?.taskId || args?.id || '').trim();
  const isReadOnly = READ_ONLY_ACTIONS.has(action);
  const actionPermitted = context.actionPolicy === 'review_only'
    ? isReadOnly
    : context.actionPolicy === 'recover_same_run'
      ? isReadOnly || SAME_RUN_ACTIONS.has(action)
      : isReadOnly || FULL_RERUN_ACTIONS.has(action);
  const exactWatchedTask = !!context.targetTaskId && !!explicitTaskId && explicitTaskId === context.targetTaskId;
  if (actionPermitted && (isReadOnly || exactWatchedTask)) return null;

  const allowedActions = context.actionPolicy === 'review_only'
    ? [...READ_ONLY_ACTIONS]
    : context.actionPolicy === 'recover_same_run'
      ? [...READ_ONLY_ACTIONS, ...SAME_RUN_ACTIONS]
      : [...READ_ONLY_ACTIONS, ...FULL_RERUN_ACTIONS];
  return {
    success: false,
    action,
    code: 'internal_watch_policy_denied',
    watch_id: context.watchId,
    policy: context.actionPolicy,
    target_task_id: context.targetTaskId || null,
    allowed_actions: allowedActions,
    message: context.actionPolicy === 'review_only'
      ? 'This watch delivery is review_only: inspect, verify, or report. It cannot mutate tasks.'
      : context.actionPolicy === 'recover_same_run'
        ? 'This watch delivery permits only same-run recovery or scoped continuation of its explicitly identified watched task. Full rerun/reset and unrelated task mutation are blocked.'
        : 'This watch delivery permits recovery or rerun only for its explicitly identified watched task. Unrelated mutation, pause, cancellation, deletion, and approval decisions are blocked.',
  };
}
