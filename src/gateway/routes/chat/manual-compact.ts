import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { mainChatTurnCoordinator } from '../../chat/turn-coordinator';
import { captureChatTurnRouteSnapshot } from '../../chat/chat-model-route';
import { COMPACT_BUSY, compactLabels, manualCompactions, type CompactReply } from '../../chat/manual-compact-state';
import { getSession, flushSession, getHistoryForApiCall, getWorkingContextForContext, getRecentToolObservationsForContext, type ChatMessage } from '../../session';
import { assertSafeStorageId } from '../../storage/storage-paths';
import { gatewayRuntimeAdmission } from '../../runtime-admission';
import { listInterruptedRuntimes, listLiveRuntimes } from '../../live-runtime-registry';
import { mobileQueueBlocksNewTurn } from './mobile-queue';
import { formatCompactionArtifactPaths, isCompactionSummaryMessage, runContextCompactor } from './pipeline/compaction';

class Refused extends Error { constructor(readonly code: number, message: string) { super(message); } }
export async function requestManualCompact(sid: string, body: Record<string, any>, signal?: AbortSignal): Promise<CompactReply> {
  assertSafeStorageId(sid, 'session id');
  if (String(body.message || '').trim().toLowerCase() !== '/compact' || body.attachments?.length || body.attachmentPreviews?.length)
    throw new Refused(400, 'Send /compact by itself, without attachments.');
  const id = String(body.clientMessageId || body.clientRequestId || randomUUID());
  if (!/^[\w.:~-]{1,160}$/.test(id)) throw new Refused(400, 'Invalid command request ID.');
  const session = getSession(sid);
  const agent = body.agent?.id || body.agent;
  if (session.externalAgent || session.externalImport || /^subagent_chat_/i.test(sid) || (agent && agent !== 'prometheus'))
    throw new Refused(409, '/compact is available in native Prometheus chats only.');
  const owner = manualCompactions.get(sid);
  if (owner?.id === id) return owner.done;
  const statusId = `manual_compact:${id}:status`;
  const prior = session.history.find(m => m.messageId === statusId && m.messageKind === 'manual_compact_status');
  if (prior?.compactStatus && prior.compactStatus !== 'running') return { status: prior.compactStatus, message: prior.content };
  if (owner || session.mainChatGoal?.status === 'active' || mobileQueueBlocksNewTurn(sid)
    || [...listLiveRuntimes(), ...listInterruptedRuntimes()].some(r => r.sessionId === sid && (r.kind === 'main_chat' || r.kind === 'main_chat_goal')))
    throw new Refused(409, COMPACT_BUSY);
  const lease = mainChatTurnCoordinator.tryAcquire(sid);
  if (!lease) throw new Refused(409, COMPACT_BUSY);
  // Schedule the operation only after its owner is published; reconnects with this id join the same promise.
  const done = Promise.resolve().then(async (): Promise<CompactReply> => {
    const at = Date.now();
    const status: ChatMessage = { role: 'assistant', messageKind: 'manual_compact_status', messageId: statusId,
      compactStatus: 'running', content: compactLabels.running, timestamp: at + 1 };
    session.history.push({ role: 'user', messageKind: 'manual_compact_command', messageId: `manual_compact:${id}:command`, content: '/compact', timestamp: at }, status);
    session.lastActiveAt = at;
    if (!flushSession(sid)) { session.history.splice(-2); throw new Refused(503, 'Could not save the command. No compaction was started.'); }
    const window = getHistoryForApiCall(sid, 60, { fullActiveHistory: true, includeCommentaryContext: true }).filter(m => !(m.channel === 'system' && isCompactionSummaryMessage(m)) && !(m.channel === 'system' && m.content.startsWith('[Active goal progress summary]')));
    let result: CompactReply['status'] = 'skipped';
    if (window.length) {
      result = 'failed';
      const boundary = session.history.length;
      try {
        const { snapshot } = captureChatTurnRouteSnapshot(sid);
        const admission = await gatewayRuntimeAdmission.acquire({ lane: 'interactive', resourceWeight: 1, signal, metadata: { sessionId: sid, executionMode: 'manual_compact' } });
        try {
          const compacted = await runContextCompactor({ sessionId: sid, strategy: 'manual', recentWindow: window,
            previousSummary: session.latestContextSummary || '', reasoningTrailBlock: getWorkingContextForContext(sid),
            recentToolLogsBlock: getRecentToolObservationsForContext(sid, 5), artifactPathsBlock: formatCompactionArtifactPaths(sid),
            targetLengthText: 'adaptive', maxWords: Number.MAX_SAFE_INTEGER, provider: snapshot.provider, model: snapshot.model,
            numCtx: snapshot.contextProfile.contextWindowTokens, numPredict: snapshot.contextProfile.maxOutputTokens, routeSnapshot: snapshot,
            abortSignal: { get aborted() { return !!signal?.aborted; }, signal }, recordMeta: { manualStatusId: statusId },
            manualBoundary: { count: boundary, row: status },
          });
          if (compacted.compacted) result = 'success';
        } finally { admission.release(); }
      } catch (error) { console.warn('[manual-compact] Compaction unavailable:', (error as Error).message); }
    }
    status.compactStatus = result; status.content = compactLabels[result];
    if (result !== 'success' && !flushSession(sid)) throw new Refused(503, 'Could not persist compaction status. Reload the conversation to check it.');
    return { status: result, message: status.content };
  }).finally(() => { manualCompactions.delete(sid); mainChatTurnCoordinator.release(lease); });
  manualCompactions.set(sid, { id, done });
  return done;
}
export async function manualCompactHttp(req: Request, res: Response): Promise<void> {
  let sid: string;
  try { sid = assertSafeStorageId(String(req.body?.sessionId || 'default'), 'session id'); }
  catch { res.status(400).json({ error: 'Invalid session id.' }); return; }
  try { res.json(await requestManualCompact(sid, req.body || {})); }
  catch (err) { res.status(err instanceof Refused ? err.code : 500).json({ error: err instanceof Refused ? err.message : 'Manual compaction unavailable.' }); }
}
