/**
 * Convert stream/checkpoint events into the bounded, user-visible trace shape
 * consumed by the mobile and desktop activity renderers.
 *
 * This module deliberately does not persist private provider thinking. The
 * only reasoning entries it emits are explicit user-visible summaries or
 * agent progress/narration events.
 */

export type DurableChatTraceFrame = {
  seq?: number;
  type?: string;
  at?: number | string;
  data?: Record<string, any>;
};

const MAX_TRACE_TEXT = 4_000;
const CONTEXT_COMPACTION_ACTION = 'context_compaction';

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function textValue(value: unknown, max = MAX_TRACE_TEXT): string {
  if (value && typeof value === 'object') return '';
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function traceTime(value: unknown): number | string {
  if (typeof value === 'number' || typeof value === 'string') return value;
  return Date.now();
}

function eventAction(data: Record<string, any>): string {
  const nested = asRecord(data.extra);
  return String(data.action || data.name || data.toolName || nested.action || nested.toolName || '').trim();
}

function eventCallId(data: Record<string, any>): string {
  return String(data.callId || data.call_id || data.toolCallId || data.tool_call_id || '').trim();
}

function eventText(data: Record<string, any>, keys: string[], max = MAX_TRACE_TEXT): string {
  for (const key of keys) {
    const value = textValue(data[key], max);
    if (value) return value;
  }
  return '';
}

function compactionStatus(eventType: string, data: Record<string, any>): string {
  const nested = asRecord(data.extra);
  const explicit = String(data.status || nested.status || '').trim().toLowerCase();
  if (explicit === 'compacting' || explicit === 'running' || explicit === 'in_progress') return 'compacting';
  if (explicit === 'skipped') return 'skipped';
  if (explicit === 'failed' || explicit === 'error') return 'failed';
  if (explicit === 'compacted' || explicit === 'done' || explicit === 'complete' || explicit === 'completed' || explicit === 'success') return 'compacted';
  if (data.error === true || data.ok === false || data.success === false || nested.error === true || nested.ok === false || nested.success === false) return 'failed';
  return eventType === 'tool_result' ? 'compacted' : 'compacting';
}

function compactionLabel(status: string): string {
  if (status === 'compacting') return 'Compacting context';
  if (status === 'failed') return 'Context compaction failed';
  if (status === 'skipped') return 'Context compaction skipped';
  return 'Context compacted';
}

function compactionEntry(
  eventType: string,
  data: Record<string, any>,
  time: unknown,
  id: string,
): Record<string, any> {
  const nested = asRecord(data.extra);
  const source = { ...nested, ...data };
  const status = compactionStatus(eventType, source);
  const summary = textValue(source.summary, MAX_TRACE_TEXT);
  const action = eventAction(source) || CONTEXT_COMPACTION_ACTION;
  const callId = eventCallId(source);
  const extra = {
    ...data,
    ...(action ? { action, toolName: data.toolName || action } : {}),
    ...(callId ? { toolCallId: data.toolCallId || data.tool_call_id || callId } : {}),
    status,
    ...(summary ? { summary } : {}),
    event: eventType,
  };
  return {
    id,
    type: 'compaction',
    text: compactionLabel(status),
    status,
    ...(summary ? { summary } : {}),
    time: traceTime(time),
    extra,
  };
}

function appendDurableTraceEntry(entries: Record<string, any>[], entry: Record<string, any> | null): void {
  if (!entry) return;
  const previous = entries[entries.length - 1];
  const previousStatus = String(previous?.status || '').trim().toLowerCase();
  const previousAction = String(previous?.extra?.action || previous?.extra?.toolName || '').trim().toLowerCase();
  const entryAction = String(entry?.extra?.action || entry?.extra?.toolName || '').trim().toLowerCase();
  const duplicateTerminalCompaction = previousStatus !== 'compacting'
    && String(entry.status || '').trim().toLowerCase() !== 'compacting'
    && previousAction === CONTEXT_COMPACTION_ACTION
    && entryAction === CONTEXT_COMPACTION_ACTION;
  if (entry.type === 'compaction' && previous?.type === 'compaction'
    && (previousStatus === 'compacting' || duplicateTerminalCompaction)) {
    entries[entries.length - 1] = {
      ...previous,
      ...entry,
      // Keep the start id stable so a replay/cache refresh updates the same
      // boundary instead of painting a second row.
      id: previous.id || entry.id,
      summary: entry.summary || previous.summary,
      extra: { ...(previous.extra || {}), ...(entry.extra || {}) },
    };
    return;
  }
  entries.push(entry);
}

function visibleReasoning(data: Record<string, any>, eventType: string): boolean {
  const visibility = String(
    data.visibility
      || (eventType === 'agent_thought' ? 'user' : '')
      || (data.source === 'reasoning_summary' ? 'user' : ''),
  ).toLowerCase();
  return visibility === 'user' || visibility === 'summary' || visibility === 'visible';
}

function privateReasoning(data: Record<string, any>): boolean {
  const visibility = String(data.visibility || '').toLowerCase();
  return visibility === 'private' || visibility === 'internal';
}

function reasoningExtra(data: Record<string, any>, eventType: string): Record<string, any> {
  const explicitKind = String(data.reasoningKind || data.presentationKind || '').trim().toLowerCase();
  const reasoningKind = explicitKind === 'private'
    ? 'private'
    : (eventType === 'reasoning_summary' || eventType === 'reasoning_summary_delta'
      || String(data.source || '').toLowerCase() === 'reasoning_summary'
      ? 'summary'
      : 'full_thought');
  return {
    ...data,
    source: eventType === 'reasoning_summary' || eventType === 'reasoning_summary_delta'
      ? 'reasoning_summary'
      : String(data.source || 'agent_progress'),
    visibility: 'user',
    event: eventType,
    reasoningKind,
  };
}

function likelyReasoningContinuation(previous: string, next: string): boolean {
  if (!previous || !next) return false;
  if (next.startsWith(previous)) return true;
  if (previous.startsWith(next)) return true;
  // Provider summary deltas commonly arrive as whitespace-prefixed or
  // lowercase fragments. Markdown headings and capitalized sentences are
  // treated as separate thoughts so the recovered UI retains its breaks.
  return /^[\s,.;:!?)]/.test(next) || /^[a-z0-9]/.test(next);
}

function appendVisibleThought(
  entries: Record<string, any>[],
  text: unknown,
  time: unknown,
  extra: Record<string, any>,
  id: string,
  type = 'think',
): void {
  const next = textValue(text);
  if (!next) return;
  const previous = entries[entries.length - 1];
  const previousSource = String(previous?.extra?.source || '').toLowerCase();
  const source = String(extra.source || '').toLowerCase();
  if (previous && (previous.type === 'think' || previous.type === 'preamble')
    && previousSource === source && likelyReasoningContinuation(String(previous.text || ''), next)) {
    const previousText = String(previous.text || '');
    if (next.startsWith(previousText)) previous.text = next;
    else if (!previousText.startsWith(next)) {
      const separator = /^[,.;:!?)]/.test(next) ? '' : ' ';
      previous.text = textValue(`${previousText}${separator}${next}`);
    }
    previous.extra = { ...previous.extra, ...extra };
    previous.time = traceTime(time);
    return;
  }
  entries.push({ id, type, text: next, time: traceTime(time), extra });
}

function traceId(prefix: string, seq: unknown, index: number): string {
  const suffix = Number.isFinite(Number(seq)) ? String(seq) : String(index + 1);
  return `${prefix}_${suffix}`;
}

function toolEntry(
  eventType: string,
  data: Record<string, any>,
  time: unknown,
  id: string,
): Record<string, any> | null {
  const action = eventAction(data);
  const extra = {
    ...data,
    ...(action ? { action, toolName: data.toolName || action } : {}),
    ...(eventCallId(data) ? { toolCallId: data.toolCallId || data.toolCall_id || eventCallId(data) } : {}),
    event: eventType,
  };
  if (eventType === 'tool_call') {
    return {
      id,
      type: 'tool',
      text: textValue(data.message) || (action ? `Preparing ${action}` : 'Preparing tool'),
      time: traceTime(time),
      extra,
    };
  }
  if (eventType === 'tool_progress') {
    return {
      id,
      type: 'progress',
      text: eventText(data, ['message', 'progress', 'status', 'text']) || (action ? `${action} in progress` : 'Tool in progress'),
      time: traceTime(time),
      extra,
    };
  }
  if (eventType === 'tool_result') {
    const result = eventText(data, ['result', 'output', 'message', 'text'], 500);
    return {
      id,
      type: data.error || data.ok === false || data.success === false ? 'error' : 'result',
      text: result || (action ? `${action} complete` : 'Tool complete'),
      time: traceTime(time),
      extra,
    };
  }
  return null;
}

function visionEntry(data: Record<string, any>, time: unknown, id: string): Record<string, any> | null {
  const preview = data.preview && typeof data.preview === 'object' ? data.preview : null;
  const dataUrl = String(preview?.dataUrl || data.dataUrl || '').trim();
  if (!/^data:image\//i.test(dataUrl)
    && !/^\/api\/canvas\/inline\?path=/i.test(dataUrl)
    && !/^\/api\/canvas\/generated-image-preview\?cache=/i.test(dataUrl)
    && !/^\/api\/chat\/desktop-screenshot-preview\//i.test(dataUrl)) return null;
  const sourceValue = String(data.source || '').toLowerCase();
  const source = sourceValue === 'browser'
    ? 'Browser'
    : sourceValue === 'media_analysis'
      ? 'Media analysis'
      : sourceValue === 'generated_image' ? 'Generated image' : 'Desktop';
  return {
    id,
    type: 'vision',
    text: textValue(data.label) || `Vision captured: ${eventAction(data) || source}`,
    time: traceTime(time),
    preview,
    previewTitle: textValue(data.previewTitle || preview?.title) || `${source} preview`,
  };
}

export function buildDurableChatTraceFromFrames(
  frames: DurableChatTraceFrame[],
  idPrefix = 'trace',
): Record<string, any>[] | undefined {
  const entries: Record<string, any>[] = [];
  for (let index = 0; index < (Array.isArray(frames) ? frames.length : 0); index += 1) {
    const frame = frames[index] || {};
    const eventType = String(frame.type || '').trim().toLowerCase();
    const data = asRecord(frame.data);
    const id = traceId(`${idPrefix}_${String(data.streamId || 'chat')}`, frame.seq, index);
    const time = traceTime(frame.at);

    if (eventType === 'tool_call' || eventType === 'tool_progress' || eventType === 'tool_result') {
      const entry = eventAction(data).toLowerCase() === CONTEXT_COMPACTION_ACTION
        ? compactionEntry(eventType, data, time, id)
        : toolEntry(eventType, data, time, id);
      appendDurableTraceEntry(entries, entry);
      continue;
    }
    if (eventType === 'vision_injected') {
      const entry = visionEntry(data, time, id);
      if (entry) entries.push(entry);
      continue;
    }
    // Reasoning summaries are mutable header/status packets, not the model's
    // full user-visible commentary. Do not materialize them as recovered body
    // rows; the durable narration boundary and agent_thought events below own
    // the actual thought timeline.
    if (eventType === 'reasoning_summary_delta' || eventType === 'reasoning_summary') continue;
    if (eventType === 'agent_thought' || eventType === 'thinking') {
      if (!visibleReasoning(data, eventType)) continue;
      appendVisibleThought(entries, eventText(data, ['text', 'thinking', 'message', 'summary']), time, reasoningExtra(data, eventType), id);
      continue;
    }
    if (eventType === 'token_narration_boundary') {
      appendVisibleThought(entries, eventText(data, ['text', 'message', 'narration']), time, {
        ...data,
        source: 'agent_thought',
        visibility: 'user',
        event: eventType,
        reasoningKind: 'full_thought',
      }, id, 'preamble');
    }
  }
  return entries.length ? entries : undefined;
}

function normalizedProcessEntry(entry: Record<string, any>, index: number): Record<string, any> | null {
  const extra = asRecord(entry.extra);
  // Older task/team trackers stored source and visibility beside `type` and
  // `content`, while newer session traces put them under `extra`. Treat both
  // shapes identically so visible commentary survives every resume path.
  const presentation = { ...entry, ...extra };
  const eventType = String(extra.event || entry.event || entry.type || '').trim().toLowerCase();
  const type = String(entry.type || entry.kind || 'info').trim().toLowerCase();
  const content = textValue(entry.text || entry.content || entry.message);
  const action = String(extra.action || extra.toolName || entry.action || entry.toolName || '').trim();
  const time = entry.time || entry.ts || entry.timestamp || Date.now();
  const id = String(entry.id || `process_trace_${index + 1}`);

  if (eventType === 'reasoning_summary_delta' || eventType === 'reasoning_summary') return null;
  if (eventType === 'token_narration_boundary') {
    if (!content) return null;
    return {
      id,
      type: 'preamble',
      text: content,
      time,
      extra: {
        ...extra,
        source: 'agent_thought',
        visibility: 'user',
        event: eventType,
        reasoningKind: 'full_thought',
      },
    };
  }
  if (eventType === 'thinking' || eventType === 'agent_thought') {
    if (!visibleReasoning(presentation, eventType) || !content) return null;
    return {
      ...entry,
      id,
      type: 'think',
      text: content,
      time,
      extra: reasoningExtra(presentation, eventType),
    };
  }
  if (type === 'compaction') {
    const rawStatus = String(entry.status || extra.status || '').trim().toLowerCase();
    const compactEventType = eventType === 'tool_call' || eventType === 'tool_progress' || eventType === 'tool_result'
      ? eventType
      : rawStatus === 'compacting' || /\bcompacting\b|\bpreparing context compaction\b/i.test(content)
        ? 'tool_call'
        : 'tool_result';
    return compactionEntry(compactEventType, {
      ...entry,
      ...extra,
      extra,
      action: CONTEXT_COMPACTION_ACTION,
      toolName: extra.toolName || action || CONTEXT_COMPACTION_ACTION,
    }, time, id);
  }
  if (eventType === 'tool_call' || eventType === 'tool_progress' || eventType === 'tool_result') {
    if (action.toLowerCase() === CONTEXT_COMPACTION_ACTION) {
      return compactionEntry(eventType, {
        ...entry,
        ...extra,
        extra,
        action: CONTEXT_COMPACTION_ACTION,
        toolName: extra.toolName || action,
      }, time, id);
    }
    return {
      ...entry,
      id,
      type: eventType === 'tool_call' ? 'tool' : eventType === 'tool_progress' ? 'progress' : (type === 'error' || extra.error ? 'error' : 'result'),
      text: content,
      time,
      extra: {
        ...extra,
        ...(action ? { action, toolName: extra.toolName || action } : {}),
        event: eventType,
      },
    };
  }
  // Runtime checkpoint status/preflight rows are not workflow trace cards.
  // Keep legacy tool/result rows so the mobile adapter can infer their action
  // and feed them through the normal activity renderer.
  if (['tool', 'skill', 'result', 'error', 'progress'].includes(type)) {
    return {
      ...entry,
      id,
      type,
      text: content,
      time,
      extra: Object.keys(extra).length ? extra : undefined,
    };
  }
  if ((type === 'think' || type === 'preamble' || type === 'assistant')
    && content && visibleReasoning(presentation, String(presentation.event || presentation.source || type))) {
    return { ...entry, id, type, text: content, time, extra: presentation };
  }
  return null;
}

export function buildDurableChatTraceFromProcessEntries(
  processEntries: Record<string, any>[],
): Record<string, any>[] | undefined {
  const entries: Record<string, any>[] = [];
  for (let index = 0; index < (Array.isArray(processEntries) ? processEntries.length : 0); index += 1) {
    const entry = asRecord(processEntries[index]);
    const normalized = normalizedProcessEntry(entry, index);
    if (!normalized) continue;
    if ((normalized.type === 'think' || normalized.type === 'preamble')
      && String(normalized.extra?.source || '').toLowerCase() === 'reasoning_summary') {
      appendVisibleThought(entries, normalized.text, normalized.time, normalized.extra || {}, normalized.id, normalized.type);
    } else {
      appendDurableTraceEntry(entries, normalized);
    }
  }
  return entries.length ? entries : undefined;
}
