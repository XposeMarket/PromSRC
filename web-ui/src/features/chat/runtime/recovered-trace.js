const TOOL_EVENT_TYPES = new Set(['tool_call', 'tool_result', 'tool_progress']);
const REASONING_SUMMARY_TYPES = new Set([
  'reasoning_summary',
  'reasoning_summary_delta',
  'reasoning_delta',
]);

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function textValue(value) {
  if (value && typeof value === 'object') return '';
  return String(value ?? '').trim();
}

function rawTypeFor(entry) {
  return String(entry?.type || entry?.kind || '').trim().toLowerCase();
}

function eventTypeFor(entry, rawType = rawTypeFor(entry)) {
  const extra = asRecord(entry?.extra);
  return String(entry?.eventType || entry?.event || extra.event || rawType || '').trim().toLowerCase();
}

function visibilityFor(entry, extra = asRecord(entry?.extra)) {
  return String(entry?.visibility || extra.visibility || '').trim().toLowerCase();
}

function sourceFor(entry, extra = asRecord(entry?.extra)) {
  return String(entry?.source || extra.source || '').trim().toLowerCase();
}

function isPrivateReasoning(entry, extra = asRecord(entry?.extra)) {
  const visibility = visibilityFor(entry, extra);
  return visibility === 'private' || visibility === 'internal';
}

function isVisibleReasoning(entry, eventType, extra = asRecord(entry?.extra)) {
  if (isPrivateReasoning(entry, extra)) return false;
  const visibility = visibilityFor(entry, extra);
  const source = sourceFor(entry, extra);
  if (visibility === 'user' || visibility === 'summary' || visibility === 'visible') return true;
  if (source === 'reasoning_summary') return true;
  return eventType === 'agent_thought';
}

function parseJsonPayload(text) {
  const raw = String(text || '');
  const start = raw.search(/[\[{]/);
  if (start < 0) return null;
  const opener = raw[start];
  const closer = opener === '[' ? ']' : '}';
  const end = raw.lastIndexOf(closer);
  if (end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function inferAction(text, payload = null) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const commandMatch = raw.match(/^(?:running|ran)\s+command\s*(?:·|:|->|=>|→)?\s*(.*)$/i);
  if (commandMatch) {
    const command = String(commandMatch[1] || '').trim();
    return { action: 'workspace_run', args: command ? { command } : {} };
  }
  const namedAction = raw.match(/\b((?:browser|desktop|workspace|web|file|skill|run|request_tool|background)_[a-z0-9_]+)\b/i);
  if (namedAction?.[1]) {
    return {
      action: String(namedAction[1]).toLowerCase(),
      args: payload && typeof payload === 'object' ? payload : {},
    };
  }
  if (/^workspace\s+git\b/i.test(raw)) {
    return { action: 'workspace_git', args: payload && typeof payload === 'object' ? payload : {} };
  }
  if (/^request\s+tool\s+category\b/i.test(raw)) {
    return { action: 'request_tool_category', args: payload && typeof payload === 'object' ? payload : {} };
  }
  if (/^workspace\s+(?:read|write|edit|search)\b/i.test(raw)) {
    const label = raw.match(/^workspace\s+([a-z]+)/i)?.[1] || 'read';
    return { action: `workspace_${label}`, args: payload && typeof payload === 'object' ? payload : {} };
  }
  const payloadAction = payload && typeof payload === 'object'
    ? String(payload.action || payload.toolName || payload.name || '').trim()
    : '';
  return payloadAction ? { action: payloadAction, args: payload } : null;
}

function eventAction(entry, extra, text) {
  const explicit = String(
    extra.action
      || extra.toolName
      || entry?.action
      || entry?.toolName
      || entry?.name
      || extra.modelEvent?.name
      || extra.modelEvent?.toolName
      || '',
  ).trim();
  if (explicit) return { action: explicit, args: extra.args || entry?.args || {} };
  return inferAction(text, extra.args || parseJsonPayload(text));
}

function eventText(entry) {
  const extra = asRecord(entry?.extra);
  return textValue(
    entry?.text
      ?? entry?.content
      ?? entry?.message
      ?? extra.result
      ?? entry?.result
      ?? entry?.output,
  );
}

function normalizeThought(entry, type, event, text, extra, source = 'agent_progress', visibility = 'user') {
  if (!text) return null;
  return {
    ...entry,
    type,
    text,
    extra: {
      ...extra,
      source,
      visibility,
      event: event || type,
    },
  };
}

/**
 * Convert persisted/replayed records to the canonical trace vocabulary used by
 * the live desktop renderer. Runtime streams already use this vocabulary; old
 * sessions may still contain event-shaped records from before that contract.
 */
export function normalizeRecoveredTraceEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.activity) return entry;

  const extra = asRecord(entry.extra);
  const rawType = rawTypeFor(entry);
  const event = eventTypeFor(entry, rawType);
  const text = eventText(entry);
  const source = sourceFor(entry, extra);
  const visibility = visibilityFor(entry, extra);
  const reasoningEvent = REASONING_SUMMARY_TYPES.has(event)
    || REASONING_SUMMARY_TYPES.has(rawType)
    || source === 'reasoning_summary'
    || (event === 'thinking_delta' && source === 'reasoning_summary');

  if (reasoningEvent) {
    if (isPrivateReasoning(entry, extra)) return null;
    return normalizeThought(entry, 'think', event || rawType, text, extra, 'reasoning_summary', 'user');
  }

  if (event === 'token_narration_boundary' || rawType === 'token_narration_boundary') {
    return normalizeThought(entry, 'preamble', event || rawType, text, extra, 'agent_progress', 'user');
  }

  if (event === 'thinking' || event === 'agent_thought' || event === 'thinking_delta'
    || rawType === 'thinking' || rawType === 'agent_thought') {
    if (!isVisibleReasoning(entry, event || rawType, extra)) return null;
    return normalizeThought(
      entry,
      'think',
      event || rawType,
      text,
      extra,
      source || 'agent_progress',
      visibility || 'user',
    );
  }

  const modelType = String(extra.modelType || extra.modelEvent?.type || '').trim().toLowerCase();
  const modelToolEvent = event === 'model_stream_event'
    && /^tool_call_(?:start|done)$/i.test(modelType);
  const isCall = rawType === 'tool_call' || event === 'tool_call' || modelToolEvent;
  const isResult = rawType === 'tool_result' || event === 'tool_result';
  const isProgress = rawType === 'tool_progress' || event === 'tool_progress';
  const canonicalType = isCall ? 'tool' : isResult
    ? (entry.error === true || extra.error === true ? 'error' : 'result')
    : isProgress ? 'progress' : rawType;
  const isToolLike = TOOL_EVENT_TYPES.has(event)
    || ['tool', 'skill', 'result', 'error', 'progress'].includes(canonicalType);
  if (!isToolLike) return entry;

  const inferred = eventAction(entry, extra, text);
  const action = String(inferred?.action || '').trim();
  const args = inferred?.args && typeof inferred.args === 'object'
    ? inferred.args
    : (extra.args && typeof extra.args === 'object' ? extra.args : {});
  const nextExtra = {
    ...extra,
    ...(event ? { event } : {}),
    ...(action ? { action, toolName: extra.toolName || action, args } : {}),
    ...(canonicalType === 'result' || canonicalType === 'error'
      ? { result: extra.result ?? entry.result ?? entry.output ?? text }
      : {}),
  };
  const nextText = text
    || (canonicalType === 'tool' && action ? `Preparing ${action}` : '')
    || ((canonicalType === 'result' || canonicalType === 'error') && action
      ? `${action} ${canonicalType === 'error' ? 'failed' : 'complete'}`
      : '');
  return {
    ...entry,
    type: canonicalType || 'info',
    ...(nextText ? { text: nextText } : {}),
    extra: Object.keys(nextExtra).length ? nextExtra : undefined,
  };
}

function likelyReasoningContinuation(previous, next) {
  if (!previous || !next) return false;
  if (next.startsWith(previous) || previous.startsWith(next)) return true;
  return /^[\s,.;:!?)]/.test(next) || /^[a-z0-9]/.test(next);
}

function mergeRecoveredReasoningEntries(entries) {
  const out = [];
  for (const entry of entries) {
    const source = String(entry?.extra?.source || '').toLowerCase();
    const previous = out[out.length - 1];
    const previousSource = String(previous?.extra?.source || '').toLowerCase();
    const previousType = String(previous?.type || '').toLowerCase();
    const type = String(entry?.type || '').toLowerCase();
    if (previous && type === 'think' && previousType === 'think'
      && source === 'reasoning_summary' && previousSource === source
      && likelyReasoningContinuation(String(previous.text || ''), String(entry.text || ''))) {
      const previousText = String(previous.text || '');
      const nextText = String(entry.text || '');
      if (nextText.startsWith(previousText)) previous.text = nextText;
      else if (!previousText.startsWith(nextText)) {
        const separator = /^[,.;:!?)]/.test(nextText) ? '' : ' ';
        previous.text = `${previousText}${separator}${nextText}`.trim();
      }
      previous.extra = { ...previous.extra, ...entry.extra };
      previous.ts = entry.ts || entry.time || previous.ts;
      previous.time = entry.time || entry.ts || previous.time;
      continue;
    }
    out.push(entry);
  }
  return out;
}

export function normalizeRecoveredTraceEntries(entries) {
  return mergeRecoveredReasoningEntries(
    (Array.isArray(entries) ? entries : [])
      .map(normalizeRecoveredTraceEntry)
      .filter(Boolean),
  );
}
