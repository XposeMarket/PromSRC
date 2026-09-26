import type { BackgroundAgentStreamFrame } from './background-agent-stream';

function backgroundTraceText(value: unknown, max = 4_000): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const text = JSON.stringify(value);
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    const text = String(value).trim();
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }
}

export function backgroundProcessEntryFromSseEvent(event: string, data: any): Record<string, any> | null {
  const eventType = String(event || '').trim();
  const source = String(data?.source || data?.extra?.source || '').trim().toLowerCase();
  const visibility = String(data?.visibility || data?.extra?.visibility || '').trim().toLowerCase();
  const explicitlyPrivateReasoning = visibility === 'private' || visibility === 'internal';
  const isReasoningSummary = eventType === 'reasoning_summary_delta'
    || eventType === 'reasoning_summary'
    || eventType === 'reasoning_delta'
    || source === 'reasoning_summary';
  if (eventType === 'progress_state' && data?.source === 'declared' && Array.isArray(data.items)) {
    return { type: 'info', actor: 'Prom', text: 'Plan updated', extra: { event: eventType, source: 'declared', items: data.items, activeIndex: data.activeIndex, total: data.total } };
  }
  if (eventType === 'vision_injected' && data?.preview?.dataUrl) {
    return { type: 'vision', actor: 'Prom', text: String(data.label || 'Image preview'), preview: data.preview, previewTitle: data.previewTitle || data.preview.title, extra: { event: eventType, source, tool: data.tool, preview: data.preview } };
  }
  if (!eventType || eventType === 'heartbeat' || eventType === 'token'
    || eventType === 'thinking_delta'
    // These packets describe provider setup and timing. The background agent
    // stream is already represented by its tool calls, results, and thoughts.
    || ['ui_preflight', 'progress_state', 'model_stream_event', 'latency'].includes(eventType)) return null;
  const action = String(data?.action || data?.name || data?.toolName || '').trim();
  const baseExtra = {
    source: source || 'background_sse',
    event: eventType,
    ...(action ? { action, toolName: data?.toolName || action } : {}),
    ...(data?.args && typeof data.args === 'object' ? { args: data.args } : {}),
    ...(data?.toolCallId || data?.tool_call_id ? { toolCallId: data.toolCallId || data.tool_call_id } : {}),
    ...(data?.error ? { error: true } : {}),
  };
  if (explicitlyPrivateReasoning) return null;
  // Keep the public summary channel distinct from commentary during recovery.
  if (isReasoningSummary) {
    const text = backgroundTraceText(data?.text || data?.summary || data?.thinking);
    return text ? { type: 'think', actor: 'Prom', text, extra: { ...baseExtra, source: 'reasoning_summary', visibility: 'summary', reasoningKind: 'summary' } } : null;
  }
  if (eventType === 'token_narration_boundary') {
    const text = backgroundTraceText(data?.text || data?.message || data?.narration);
    return text ? {
      type: 'preamble',
      actor: 'Prom',
      text,
      extra: { ...baseExtra, source: 'agent_thought', visibility: 'user', reasoningKind: 'full_thought' },
    } : null;
  }
  if (eventType === 'tool_call') {
    const text = backgroundTraceText(action ? `Preparing ${action}` : data?.message || 'Preparing tool');
    return text ? { type: 'tool', actor: 'Prom', text, extra: baseExtra } : null;
  }
  if (eventType === 'tool_result') {
    const rawResult = data?.result ?? data?.output;
    const structuredResult = rawResult !== null && typeof rawResult === 'object' ? rawResult : undefined;
    const resultText = structuredResult === undefined ? backgroundTraceText(rawResult, 4_000) : '';
    const text = resultText
      ? (action && !resultText.startsWith(action) ? `${action} -> ${resultText}` : resultText)
      : `${action || 'Tool'} complete`;
    return {
      type: data?.error ? 'error' : 'result',
      actor: 'Prom',
      text,
      extra: {
        ...baseExtra,
        ...(structuredResult !== undefined
          ? { result: structuredResult, resultType: Array.isArray(structuredResult) ? 'array' : 'object' }
          : {}),
      },
    };
  }
  if (eventType === 'thinking' || eventType === 'agent_thought') {
    if (visibility === 'private' || visibility === 'internal') return null;
    const text = backgroundTraceText(data?.thinking || data?.text || data?.message);
    return text ? { type: 'think', actor: 'Prom', text, extra: { ...baseExtra, visibility: visibility || 'user' } } : null;
  }
  const text = backgroundTraceText(data?.message || data?.text || data?.result || data?.summary, 2_000);
  if (!text || /^(?:undefined|null|nan|\[object object\])$/i.test(text)
    || /^latency:\s*[a-z0-9_]+(?:\s+at\b.*)?$/i.test(text)) return null;
  return { type: eventType === 'error' ? 'error' : eventType === 'warn' ? 'warn' : 'info', actor: 'Prom', text, extra: baseExtra };
}

// Token packets are replayable in memory but are not durable process entries.
// Retain the public answer tail until a tool proves it was commentary, matching
// the live UI reducer. Weak keys keep this state scoped to one run/checkpoint.
const backgroundNarrationTails = new WeakMap<Record<string, any>[], {
  text: string;
  frame: BackgroundAgentStreamFrame;
}>();

export function appendBackgroundSseTrace(
  processEntries: Record<string, any>[],
  liveTraceEntries: Record<string, any>[],
  event: string,
  data: any,
  frame: BackgroundAgentStreamFrame,
): void {
  if (backgroundNarrationTails.get(liveTraceEntries)?.frame.streamId !== frame.streamId) {
    backgroundNarrationTails.delete(liveTraceEntries);
  }
  if (event === 'token') {
    const visibility = String(data?.visibility || data?.extra?.visibility || '').toLowerCase();
    if (visibility !== 'private' && visibility !== 'internal') {
      const previous = backgroundNarrationTails.get(liveTraceEntries)?.text || '';
      backgroundNarrationTails.set(liveTraceEntries, { text: (previous + String(data?.text || '')).slice(-12_000), frame });
    }
    return;
  }
  const pendingNarration = backgroundNarrationTails.get(liveTraceEntries);
  if (event === 'tool_call' && pendingNarration?.text.trim()) {
    appendBackgroundSseTrace(processEntries, liveTraceEntries, 'token_narration_boundary',
      { text: pendingNarration.text }, pendingNarration.frame);
  }
  if (event === 'token_narration_boundary') {
    data = { ...data, text: data?.text || data?.message || data?.narration || pendingNarration?.text };
  }
  if (['tool_call', 'token_narration_boundary', 'final_response_start', 'final', 'done', 'error'].includes(event)) {
    backgroundNarrationTails.delete(liveTraceEntries);
  }
  const raw = backgroundProcessEntryFromSseEvent(event, data);
  if (!raw) return;
  const at = Number(frame.at || Date.now()) || Date.now();
  const streamId = String(frame.streamId || '').trim();
  const seq = Math.max(0, Math.floor(Number(frame.seq || 0)) || 0);
  const id = streamId && seq ? `trace_${streamId}_${seq}` : `trace_background_${processEntries.length + 1}`;
  const entry = {
    ...raw,
    id,
    at,
    ...(streamId ? { streamId } : {}),
    ...(seq ? { seq } : {}),
    time: new Date(at).toLocaleTimeString(),
  };
  processEntries.push(entry);
  if (processEntries.length > 12_000) processEntries.splice(0, processEntries.length - 12_000);
  const trace = {
    id,
    type: raw.type,
    text: raw.text,
    time: at,
    ...(streamId ? { streamId } : {}),
    ...(seq ? { seq } : {}),
    extra: raw.extra,
    ...(raw.preview ? { preview: raw.preview, previewTitle: raw.previewTitle } : {}),
  };
  const previous = liveTraceEntries[liveTraceEntries.length - 1];
  if ((raw.type === 'think' || raw.type === 'preamble')
    && previous?.type === raw.type
    && previous?.streamId === streamId
    && Number(previous?.seq || 0) === seq - 1
    && String(previous.extra?.source || '').toLowerCase() === String(raw.extra?.source || '').toLowerCase()) {
    previous.text = `${String(previous.text || '')}${String(raw.text || '')}`.slice(-12_000);
    previous.time = at;
    previous.seq = seq;
  } else {
    liveTraceEntries.push(trace);
    if (liveTraceEntries.length > 12_000) liveTraceEntries.splice(0, liveTraceEntries.length - 12_000);
  }
}
