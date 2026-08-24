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
  const userVisibleReasoning = eventType === 'reasoning_summary_delta'
    || eventType === 'reasoning_summary'
    || eventType === 'reasoning_delta'
    || source === 'reasoning_summary'
    || visibility === 'user';
  if (!eventType || eventType === 'heartbeat' || eventType === 'token'
    || (eventType === 'thinking_delta' && !userVisibleReasoning)) return null;
  const action = String(data?.action || data?.name || data?.toolName || '').trim();
  const baseExtra = {
    source: source || 'background_sse',
    event: eventType,
    ...(action ? { toolName: action } : {}),
    ...(data?.args && typeof data.args === 'object' ? { args: data.args } : {}),
    ...(data?.toolCallId || data?.tool_call_id ? { toolCallId: data.toolCallId || data.tool_call_id } : {}),
    ...(data?.error ? { error: true } : {}),
  };
  if (userVisibleReasoning && (eventType === 'thinking_delta'
    || eventType === 'reasoning_summary_delta'
    || eventType === 'reasoning_summary'
    || eventType === 'reasoning_delta')) {
    const text = backgroundTraceText(data?.text || data?.thinking || data?.summary || data?.message);
    return text ? {
      type: 'think',
      actor: 'Prom',
      text,
      extra: { ...baseExtra, source: 'reasoning_summary', visibility: 'user' },
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
  if (eventType === 'model_stream_event') {
    const modelEvent = data?.event && typeof data.event === 'object' ? data.event : {};
    const modelType = String(modelEvent.type || '').trim().toLowerCase();
    if (!/^tool_call_(?:start|done)$/.test(modelType)) return null;
    const modelAction = String(modelEvent.name || modelEvent.toolName || action || 'tool').trim();
    return { type: 'info', actor: 'Prom', text: `${modelType.endsWith('start') ? 'Preparing' : 'Prepared'} ${modelAction}`, extra: { ...baseExtra, source: 'model_stream_event', modelType, toolName: modelAction } };
  }
  if (eventType === 'progress_state') {
    const items = Array.isArray(data?.items)
      ? data.items.map((item: any) => String(item?.label || item?.text || item?.title || '').trim()).filter(Boolean).slice(-8)
      : [];
    const content = [String(data?.reason || '').trim(), items.length ? items.join(' | ') : ''].filter(Boolean).join(': ');
    return content ? { type: 'info', actor: 'Prom', text: `Progress: ${content}`, extra: baseExtra } : null;
  }
  if (eventType === 'thinking' || eventType === 'agent_thought') {
    if (visibility === 'private' || visibility === 'internal') return null;
    const text = backgroundTraceText(data?.thinking || data?.text || data?.message);
    return text ? { type: 'think', actor: 'Prom', text, extra: { ...baseExtra, visibility: visibility || 'user' } } : null;
  }
  const text = backgroundTraceText(data?.message || data?.text || data?.result || data?.summary, 2_000);
  if (!text) return null;
  return { type: eventType === 'error' ? 'error' : eventType === 'warn' ? 'warn' : 'info', actor: 'Prom', text, extra: baseExtra };
}

export function appendBackgroundSseTrace(
  processEntries: Record<string, any>[],
  liveTraceEntries: Record<string, any>[],
  event: string,
  data: any,
  frame: BackgroundAgentStreamFrame,
): void {
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
  if (processEntries.length > 500) processEntries.splice(0, processEntries.length - 500);
  const trace = {
    id,
    type: raw.type,
    text: raw.text,
    time: at,
    ...(streamId ? { streamId } : {}),
    ...(seq ? { seq } : {}),
    extra: raw.extra,
  };
  const previous = liveTraceEntries[liveTraceEntries.length - 1];
  if (raw.type === 'think' && String(raw.extra?.source || '').toLowerCase() === 'reasoning_summary'
    && previous?.type === 'think'
    && String(previous.extra?.source || '').toLowerCase() === 'reasoning_summary') {
    previous.text = `${String(previous.text || '')}${String(raw.text || '')}`.slice(-12_000);
    previous.time = at;
  } else {
    liveTraceEntries.push(trace);
    if (liveTraceEntries.length > 500) liveTraceEntries.splice(0, liveTraceEntries.length - 500);
  }
}
