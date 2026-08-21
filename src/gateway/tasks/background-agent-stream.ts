import crypto from 'crypto';

export interface BackgroundAgentStreamFrame {
  seq: number;
  type: string;
  at: number;
  streamId: string;
  data: Record<string, any>;
}

export interface BackgroundAgentStreamState {
  streamId: string;
  startedAt: number;
  updatedAt: number;
  active: boolean;
  nextSeq: number;
  events: BackgroundAgentStreamFrame[];
  completedAt?: number;
}

export const BACKGROUND_AGENT_STREAM_MAX_EVENTS = 12_000;

export function createBackgroundAgentStream(startedAt = Date.now()): BackgroundAgentStreamState {
  return {
    streamId: crypto.randomUUID(),
    startedAt,
    updatedAt: startedAt,
    active: true,
    nextSeq: 1,
    events: [],
  };
}

export function appendBackgroundAgentStreamEvent(
  stream: BackgroundAgentStreamState,
  type: string,
  data: any,
  at = Date.now(),
): BackgroundAgentStreamFrame {
  const frame: BackgroundAgentStreamFrame = {
    seq: stream.nextSeq++,
    type: String(type || 'event'),
    at,
    streamId: stream.streamId,
    data: data && typeof data === 'object' ? { ...data } : { message: String(data ?? '') },
  };
  stream.events.push(frame);
  if (stream.events.length > BACKGROUND_AGENT_STREAM_MAX_EVENTS) {
    stream.events.splice(0, stream.events.length - BACKGROUND_AGENT_STREAM_MAX_EVENTS);
  }
  stream.updatedAt = at;
  return frame;
}

export function finishBackgroundAgentStream(stream: BackgroundAgentStreamState, at = Date.now()): void {
  stream.active = false;
  stream.completedAt = at;
  stream.updatedAt = at;
}

export function replayBackgroundAgentStream(
  stream: BackgroundAgentStreamState | null | undefined,
  after = 0,
): BackgroundAgentStreamFrame[] {
  if (!stream) return [];
  const cursor = Math.max(0, Math.floor(Number(after) || 0));
  return stream.events.filter((frame) => frame.seq > cursor);
}

export function backgroundAgentStreamSummary(stream: BackgroundAgentStreamState | null | undefined): Record<string, any> | null {
  if (!stream) return null;
  return {
    streamId: stream.streamId,
    active: stream.active,
    startedAt: stream.startedAt,
    updatedAt: stream.updatedAt,
    completedAt: stream.completedAt || null,
    nextSeq: stream.nextSeq,
    firstSeq: stream.events[0]?.seq || 0,
    lastSeq: stream.events[stream.events.length - 1]?.seq || 0,
  };
}
