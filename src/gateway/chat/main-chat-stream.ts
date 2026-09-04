export type MainChatStreamDelivery = {
  retain: boolean;
  live: boolean;
};

// Token deltas and provider-internal stream events are already delivered live
// through SSE. Retaining every one for reconnect replay makes a long tool turn
// grow the gateway heap for no user-visible benefit. Keep structural lifecycle
// events in the replay buffer; a reconnect can still recover tool boundaries,
// progress, and the terminal result.
export const MAIN_CHAT_STREAM_EPHEMERAL_EVENTS: ReadonlySet<string> = new Set([
  'heartbeat',
  'token',
  'thinking_delta',
  'reasoning_summary_delta',
  'model_stream_event',
]);

export const MAIN_CHAT_WS_DIRECT_EVENTS: ReadonlySet<string> = new Set([
  'user_message',
  'session_title',
  'agent_mode',
  'ui_preflight',
  'info',
  'tool_call',
  'tool_result',
  'tool_progress',
  'progress_state',
  'thinking',
  'agent_thought',
  'final',
  'done',
  'error',
  'warn',
  'runtime_registered',
]);

export function classifyMainChatStreamEvent(type: string, data: any): MainChatStreamDelivery {
  const normalized = String(type || '').trim().toLowerCase();
  const modelType = String(data?.event?.type || '').trim().toLowerCase();
  const retain = normalized === 'model_stream_event'
    ? modelType === 'tool_call_start' || modelType === 'tool_call_done'
    : !MAIN_CHAT_STREAM_EPHEMERAL_EVENTS.has(normalized);
  return {
    retain,
    // Every non-replayable frame still has to be broadcast to connected
    // clients. Replay retention and live delivery are separate contracts.
    live: !retain || MAIN_CHAT_WS_DIRECT_EVENTS.has(normalized),
  };
}
