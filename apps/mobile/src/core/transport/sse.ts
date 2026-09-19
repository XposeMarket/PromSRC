export interface SseFrame {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export type JsonRecord = Record<string, unknown>;

export function parseSseFrame(block: string): SseFrame | null {
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const data: string[] = [];

  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event': event = value; break;
      case 'data': data.push(value); break;
      case 'id': if (!value.includes('\0')) id = value; break;
      case 'retry': if (/^\d+$/.test(value)) retry = Number(value); break;
    }
  }

  if (!data.length) return null;
  return { ...(event ? { event } : {}), data: data.join('\n'), ...(id !== undefined ? { id } : {}), ...(retry !== undefined ? { retry } : {}) };
}

export function parseSseJson(frame: SseFrame): JsonRecord | null {
  if (!frame.data || frame.data === '[DONE]') return null;
  try {
    const value: unknown = JSON.parse(frame.data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as JsonRecord;
    return typeof record.type === 'string' || !frame.event ? record : { ...record, type: frame.event };
  } catch {
    return null;
  }
}

export type GatewayChatEvent =
  | { type: 'assistant.delta'; text: string; raw: JsonRecord }
  | { type: 'reasoning.delta'; text: string; raw: JsonRecord }
  | { type: 'reasoning.completed'; text: string; raw: JsonRecord }
  | { type: 'assistant.done'; text: string; raw: JsonRecord }
  | { type: 'assistant.error'; message: string; raw: JsonRecord }
  | { type: 'tool.activity'; phase: string; name: string; message: string; raw: JsonRecord }
  | { type: 'status'; text: string; raw: JsonRecord }
  | { type: 'approval.required'; approval: unknown; raw: JsonRecord }
  | { type: 'question.required'; question: unknown; raw: JsonRecord }
  | { type: 'unknown'; raw: JsonRecord };

export function normalizeGatewayChatEvent(raw: JsonRecord): GatewayChatEvent {
  const type = String(raw.type || '').toLowerCase();
  const text = (...values: unknown[]) => String(values.find((value) => value != null && value !== '') || '');
  switch (type) {
    case 'token':
    case 'assistant_delta':
      return { type: 'assistant.delta', text: text(raw.text, raw.delta), raw };
    case 'thinking_delta':
      return { type: 'reasoning.delta', text: text(raw.thinking, raw.text, raw.delta), raw };
    case 'thinking':
    case 'agent_thought':
      return { type: 'reasoning.completed', text: text(raw.thinking, raw.text), raw };
    case 'reasoning_summary':
    case 'reasoning_summary_delta':
      return { type: 'reasoning.delta', text: text(raw.text, raw.summary, raw.delta), raw };
    case 'final':
    case 'done':
      return { type: 'assistant.done', text: text(raw.text, raw.content, raw.reply, raw.final, raw.response), raw };
    case 'error': {
      const detail = raw.error && typeof raw.error === 'object' ? (raw.error as JsonRecord).message : raw.message || raw.error;
      return { type: 'assistant.error', message: String(detail || 'Gateway stream failed.'), raw };
    }
    case 'tool_call':
    case 'tool_progress':
    case 'tool_result':
      return { type: 'tool.activity', phase: type, name: text(raw.name, raw.tool, raw.action, (raw.function as JsonRecord | undefined)?.name, 'Tool'), message: text(raw.message, raw.summary, raw.status), raw };
    case 'info':
    case 'ui_preflight':
    case 'heartbeat':
    case 'voice_milestone':
    case 'progress_state':
    case 'runtime_registered':
      return { type: 'status', text: text(raw.message, raw.text, raw.status), raw };
    case 'approval_required':
      return { type: 'approval.required', approval: raw.approval || raw, raw };
    case 'question':
      return { type: 'question.required', question: raw.question || raw, raw };
    case 'model_stream_event': {
      const inner = raw.event && typeof raw.event === 'object' ? raw.event as JsonRecord : {};
      const innerType = String(inner.type || '').toLowerCase();
      if (innerType === 'assistant_delta') return { type: 'assistant.delta', text: text(inner.text, inner.delta), raw };
      if (innerType === 'reasoning_delta' || innerType === 'reasoning_summary_delta') return { type: 'reasoning.delta', text: text(inner.text, inner.delta), raw };
      if (innerType.startsWith('tool_')) return { type: 'tool.activity', phase: innerType, name: text(inner.name, inner.tool, inner.action, 'Tool'), message: text(inner.message, inner.summary), raw };
      break;
    }
  }
  return { type: 'unknown', raw };
}

export async function* readSseJson(response: Response, signal?: AbortSignal): AsyncGenerator<JsonRecord> {
  if (!response.body) throw new Error('Gateway did not return a readable stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      const delimiter = /\r\n\r\n|\n\n|\r\r/g;
      while ((boundary = delimiter.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        delimiter.lastIndex = 0;
        const frame = parseSseFrame(block);
        const json = frame && parseSseJson(frame);
        if (json) yield json;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const frame = parseSseFrame(buffer);
      const json = frame && parseSseJson(frame);
      if (json) yield json;
    }
  } finally {
    reader.releaseLock();
  }
}
