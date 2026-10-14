/**
 * Restart replay guard.
 *
 * An interrupted main-chat runtime stays in the durable ledger until a recovery
 * path marks it recovered. Several paths can replay it later: the deferred
 * post-listener drain, the planned-restart BOOT resume, and the background
 * completion wake (wakeInterruptedBackgroundOwner). When the ORIGINAL turn kept
 * running anyway (a warm-handoff drain whose replacement died, or a stale
 * ledger entry written by a replacement that crashed), the replay re-answers a
 * request the user already got an answer to. Users saw this as "Prom responds
 * twice" (11 sessions over 10 days, e.g. mobile_mv756r24_ubnpah 2026-10-14
 * 02:15:42 + 02:16:17 for the same _clientRequestId).
 *
 * A replay is only correct when nothing has answered the request since the
 * interruption and the conversation has not moved on to a newer request.
 */

export interface ReplayGuardRuntime {
  clientRequestId?: string;
  startedAt?: number;
  updatedAt?: number;
  interruptedAt?: number;
}

export interface ReplayGuardMessage {
  role?: string;
  content?: unknown;
  timestamp?: number;
  messageKind?: string;
  workflowPart?: string;
  _clientRequestId?: string;
}

export type ReplayGuardVerdict =
  | { replay: true }
  | { replay: false; reason: 'already_answered' | 'superseded_by_newer_request'; at: number };

/** Ignore rows written within this window of the interruption (pre-restart partials). */
const INTERRUPTION_MARGIN_MS = 2_000;

const MARKER_PREFIXES = [
  '[Interrupted by gateway restart]',
  '[Interrupted by user]',
  '[Hot restart checkpoint',
  '[Internal tool observation omitted.]',
  'Gateway restarted',
];

function textOf(message: ReplayGuardMessage): string {
  return String(message?.content ?? '').trim();
}

/** A durable assistant row that is an actual reply, not restart/goal/tool bookkeeping. */
export function isRealAssistantReply(message: ReplayGuardMessage): boolean {
  if (message?.role !== 'assistant') return false;
  const text = textOf(message);
  if (!text) return false;
  if (MARKER_PREFIXES.some((prefix) => text.startsWith(prefix))) return false;
  const kind = String(message.messageKind || '').trim();
  if (kind && (kind.startsWith('restart') || kind.startsWith('goal_'))) return false;
  if (String(message.workflowPart || '').trim() === 'before_interruption') return false;
  return true;
}

/** A user row that starts a new request (steers belong to the running turn). */
function isNewUserRequest(message: ReplayGuardMessage): boolean {
  if (message?.role !== 'user') return false;
  if (String(message.workflowPart || '').trim() === 'interruption') return false;
  return textOf(message).length > 0;
}

export interface ReplayGuardOptions {
  /**
   * The turn itself requested this restart (gateway_restart / dev apply). Such
   * turns legitimately post a pre-restart reply and must continue afterwards,
   * so only answers written after the interruption count.
   */
  plannedRestart?: boolean;
}

export function evaluateRestartReplay(
  runtime: ReplayGuardRuntime,
  history: ReplayGuardMessage[],
  options: ReplayGuardOptions = {},
): ReplayGuardVerdict {
  const cutoff = Number(runtime?.interruptedAt || runtime?.updatedAt || runtime?.startedAt || 0) + INTERRUPTION_MARGIN_MS;
  const requestId = String(runtime?.clientRequestId || '').trim();
  // An unplanned interruption never leaves a real reply for its own request
  // behind: the final row is written only when the turn finished. So a reply
  // tagged with this request id anywhere after the turn started means the turn
  // completed and the runtime record outlived it (crash/restart between the
  // final write and runtime cleanup, or a stale ledger entry).
  const startedAt = Number(runtime?.startedAt || 0);
  const sameRequestCutoff = !options.plannedRestart && requestId && startedAt > 0 ? startedAt : cutoff;
  for (const message of Array.isArray(history) ? history : []) {
    const at = Number(message?.timestamp || 0);
    if (isRealAssistantReply(message)) {
      const rowRequestId = String(message._clientRequestId || '').trim();
      if (requestId && rowRequestId === requestId && at > sameRequestCutoff) {
        return { replay: false, reason: 'already_answered', at };
      }
      if (at > cutoff && (!requestId || !rowRequestId)) {
        return { replay: false, reason: 'already_answered', at };
      }
    }
    if (!(at > cutoff)) continue;
    if (isNewUserRequest(message)) {
      return { replay: false, reason: 'superseded_by_newer_request', at };
    }
  }
  return { replay: true };
}
