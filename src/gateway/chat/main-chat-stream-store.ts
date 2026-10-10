import crypto from 'crypto';
import { classifyMainChatStreamEvent } from './main-chat-stream';
import { isMainChatSemanticProgressEvent } from './main-chat-execution-owner';
import { buildDurableChatTraceFromFrames } from '../durable-chat-trace';

export type MainChatStreamFrame = {
  seq: number;
  type: string;
  at: number;
  data: Record<string, any>;
};

export type MainChatStreamState = {
  sessionId: string;
  streamId: string;
  startedAt: number;
  updatedAt: number;
  lastSemanticProgressAt: number;
  lastSemanticEvent?: string;
  runtimeId?: string;
  admissionLeaseId?: string;
  active: boolean;
  nextSeq: number;
  events: MainChatStreamFrame[];
  completedAt?: number;
  terminalReason?: string;
  abortExecution?: (reason: string) => void;
  /** Latest declared plan; replay cursors can skip its frames. */
  progressState?: any;
};

/** Replay retention and delivery only; runtime reconciliation stays in the router. */
export function createMainChatStreamStore(deps: {
  broadcastWS: (event: any) => void;
  listLiveRuntimes: () => any[];
}) {
const { broadcastWS, listLiveRuntimes } = deps;
const mainChatStreams = new Map<string, MainChatStreamState>();
const MAIN_CHAT_STREAM_MAX_EVENTS = 12000;
const MAIN_CHAT_STREAM_TTL_MS = 45 * 60 * 1000;
const MAIN_CHAT_WS_UPDATE_THROTTLE_MS = 900;
const mainChatStreamUpdateTimers = new Map<string, NodeJS.Timeout>();

function getMainChatStream(sessionId: string): MainChatStreamState | null {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  return mainChatStreams.get(sid) || null;
}

function pruneMainChatStreams(): void {
  const cutoff = Date.now() - MAIN_CHAT_STREAM_TTL_MS;
  for (const [sessionId, stream] of mainChatStreams.entries()) {
    if (!stream.active && Number(stream.completedAt || stream.updatedAt || 0) < cutoff) {
      mainChatStreams.delete(sessionId);
    }
  }
}

function beginMainChatStream(sessionId: string, runtimeId?: string, admissionLeaseId?: string): MainChatStreamState {
  pruneMainChatStreams();
  const sid = String(sessionId || 'default').trim() || 'default';
  const stream: MainChatStreamState = {
    sessionId: sid,
    streamId: crypto.randomUUID(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    lastSemanticProgressAt: Date.now(),
    runtimeId: runtimeId || undefined,
    admissionLeaseId: admissionLeaseId || undefined,
    active: true,
    nextSeq: 1,
    events: [],
  };
  mainChatStreams.set(sid, stream);
  return stream;
}

function broadcastMainChatStreamUpdate(stream: MainChatStreamState, frame: MainChatStreamFrame): void {
  try {
    broadcastWS({
      type: 'main_chat_stream_update',
      sessionId: stream.sessionId,
      streamId: stream.streamId,
      lastSeq: frame.seq,
      event: frame.type,
      at: frame.at,
      active: stream.active,
    });
  } catch {}
}

function scheduleMainChatStreamUpdate(stream: MainChatStreamState, frame: MainChatStreamFrame): void {
  const key = `${stream.sessionId}:${stream.streamId}`;
  if (mainChatStreamUpdateTimers.has(key)) return;
  const timer = setTimeout(() => {
    mainChatStreamUpdateTimers.delete(key);
    const latest = stream.events[stream.events.length - 1] || frame;
    broadcastMainChatStreamUpdate(stream, latest);
  }, MAIN_CHAT_WS_UPDATE_THROTTLE_MS);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
  mainChatStreamUpdateTimers.set(key, timer);
}

function finishMainChatStream(sessionId: string, streamId: string): void {
  const stream = getMainChatStream(sessionId);
  if (!stream || stream.streamId !== streamId) return;
  stream.active = false;
  stream.completedAt = Date.now();
  stream.updatedAt = stream.completedAt;
  const key = `${stream.sessionId}:${stream.streamId}`;
  const timer = mainChatStreamUpdateTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    mainChatStreamUpdateTimers.delete(key);
  }
  const latest = stream.events[stream.events.length - 1];
  if (latest) broadcastMainChatStreamUpdate(stream, latest);
}

function findSessionMainChatRuntime(sessionId: string): { id: string } | null {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const match = listLiveRuntimes().find((runtime: any) =>
    (runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal')
    && String(runtime.sessionId || '') === sid
    && String(runtime.status || 'running') === 'running'
    && !runtime.abortRequestedAt
    // A runtime mirrored from a draining previous gateway belongs to a turn
    // running in that other process. Adopting it made a new timer turn look
    // owned until the old gateway exited, then the owner watchdog killed it
    // as runtime_missing.
    && !(Number(runtime.remoteHostPid || 0) > 0));
  return match ? { id: match.id } : null;
}

function finishMainChatStreamAsOrphaned(sessionId: string, stream: MainChatStreamState, reason: string): void {
  if (!stream.active) return;
  try {
    // The durable runtime is already gone, so there is no registry abort hook
    // left to call. Abort the request-owned controller directly before
    // releasing the stream/coordinator; otherwise the provider promise could
    // continue consuming memory behind a stream that the gateway considers
    // finished.
    stream.abortExecution?.(reason);
  } catch (error: any) {
    console.warn(`[main-chat-owner] failed to abort orphaned stream=${stream.streamId}:`, error?.message || error);
  }
  appendMainChatStreamEvent(sessionId, stream.streamId, 'error', {
    code: 'MAIN_CHAT_RUNTIME_OWNER_LOST',
    message: 'The active Chat execution owner was lost. This turn was interrupted and must be retried.',
    reason: String(reason || 'runtime_owner_lost').slice(0, 160),
    runtimeId: stream.runtimeId,
  });
  stream.terminalReason = String(reason || 'runtime_owner_lost').slice(0, 160);
  finishMainChatStream(sessionId, stream.streamId);
}

function appendMainChatStreamEvent(sessionId: string, streamId: string, type: string, data: any): MainChatStreamFrame | null {
  const stream = getMainChatStream(sessionId);
  if (!stream || stream.streamId !== streamId) return null;
  const cleanData = data && typeof data === 'object' ? { ...data } : {};
  const frame: MainChatStreamFrame = {
    seq: stream.nextSeq++,
    type: String(type || 'event'),
    at: Date.now(),
    data: cleanData,
  };
  if (frame.type === 'progress_state') stream.progressState = frame.data;
  const delivery = classifyMainChatStreamEvent(frame.type, frame.data);
  const retain = delivery.retain;
  if (retain) {
    stream.events.push(frame);
    if (stream.events.length > MAIN_CHAT_STREAM_MAX_EVENTS) {
      stream.events.splice(0, stream.events.length - MAIN_CHAT_STREAM_MAX_EVENTS);
    }
  }
  stream.updatedAt = frame.at;
  if (isMainChatSemanticProgressEvent(frame.type)) {
    stream.lastSemanticProgressAt = frame.at;
    stream.lastSemanticEvent = frame.type;
  }
  if (delivery.live) {
    try {
      broadcastWS({
        type: 'main_chat_stream_event',
        sessionId: stream.sessionId,
        streamId: stream.streamId,
        seq: frame.seq,
        event: frame.type,
        at: frame.at,
        data: frame.data,
      });
    } catch {}
  } else if (retain) {
    scheduleMainChatStreamUpdate(stream, frame);
  }
  return frame;
}

function buildDurableToolStreamTrace(sessionId: string): Record<string, any>[] | undefined {
  const stream = getMainChatStream(sessionId);
  if (!stream) return undefined;
  // A tool trace is useful even when a turn contains no screenshot. The old
  // vision-only gate silently discarded every recovered tool/result/thought
  // entry for ordinary mobile turns.
  return buildDurableChatTraceFromFrames(stream.events, `trace_${stream.streamId}`);
}

return {
  mainChatStreams, getMainChatStream, pruneMainChatStreams, beginMainChatStream, finishMainChatStream,
  findSessionMainChatRuntime, finishMainChatStreamAsOrphaned,
  appendMainChatStreamEvent, buildDurableToolStreamTrace,
};
}
