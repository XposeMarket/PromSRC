const DEVICE_TOKEN_KEY = 'pm_device_token';

function readDeviceToken() {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY) || ''; }
  catch { return ''; }
}

function buildRequestError(response, body) {
  const message = body?.error || body?.message || `Gateway request failed (${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.code = body?.code || '';
  error.body = body;
  return error;
}

function parseSseBlock(block) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try { return JSON.parse(data); }
  catch { return null; }
}

function publicReasoningFromEvent(event) {
  const type = String(event?.type || '').toLowerCase();
  if (type === 'reasoning_summary' || type === 'reasoning_summary_delta') {
    return String(event.text || event.summary || event.delta || '');
  }
  if (type === 'model_stream_event') {
    const inner = event.event || {};
    const innerType = String(inner.type || '').toLowerCase();
    if ((innerType === 'reasoning_delta' || innerType === 'reasoning_summary_delta') && inner.summary === true) {
      return String(inner.text || inner.delta || '');
    }
  }
  return '';
}

export function normalizeGatewayStreamEvent(event) {
  const type = String(event?.type || '').toLowerCase();
  if (!type) return { type: 'unknown', raw: event };

  if (type === 'token') {
    return { type: 'assistant.delta', text: String(event.text || event.delta || '') };
  }
  if (type === 'done') {
    return {
      type: 'assistant.done',
      text: String(event.text || event.final || event.response || ''),
      raw: event,
    };
  }
  if (type === 'error') {
    const detail = event.error && typeof event.error === 'object' ? event.error.message : (event.message || event.error);
    return { type: 'assistant.error', message: String(detail || 'Gateway stream failed.'), raw: event };
  }

  const reasoning = publicReasoningFromEvent(event);
  if (reasoning) return { type: 'reasoning.summary.delta', text: reasoning, raw: event };

  if (type === 'tool_call' || type === 'tool_progress' || type === 'tool_result') {
    return {
      type: 'tool.activity',
      phase: type,
      name: String(event.name || event.tool || event.action || event.function?.name || 'Tool'),
      message: String(event.message || event.summary || event.status || ''),
      raw: event,
    };
  }

  if (type === 'model_stream_event') {
    const inner = event.event || {};
    const innerType = String(inner.type || '').toLowerCase();
    if (innerType === 'assistant_delta') {
      return { type: 'assistant.delta', text: String(inner.text || inner.delta || '') };
    }
    if (innerType.startsWith('tool_')) {
      return {
        type: 'tool.activity',
        phase: innerType,
        name: String(inner.name || inner.tool || inner.action || 'Tool'),
        message: String(inner.message || inner.summary || ''),
        raw: event,
      };
    }
  }

  return { type: 'unknown', raw: event };
}

export class GatewayClient {
  constructor({ id, name, origin, tokenProvider = readDeviceToken }) {
    this.id = String(id || 'current');
    this.name = String(name || 'Gateway');
    this.origin = String(origin || window.location.origin).replace(/\/+$/, '');
    this.tokenProvider = tokenProvider;
  }

  get token() { return String(this.tokenProvider?.() || ''); }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = this.token;
    if (token) headers.set('X-Pairing-Token', token);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${this.origin}${path}`, { ...options, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (response.status === 401 && token) {
      window.dispatchEvent(new Event('pm-v2-device-revoked'));
    }
    if (!response.ok) throw buildRequestError(response, body);
    return body;
  }

  health() { return this.request('/api/health'); }

  async listSessions({ limit = 80, offset = 0, state = 'all' } = {}) {
    const params = new URLSearchParams({
      scope: 'all',
      includeAutomated: '1',
      state,
      limit: String(limit),
      offset: String(offset),
    });
    const body = await this.request(`/api/sessions?${params.toString()}`);
    if (Array.isArray(body)) return { sessions: body, total: body.length };
    return {
      sessions: Array.isArray(body?.sessions) ? body.sessions : [],
      total: Number(body?.total || body?.totalCount || body?.sessions?.length || 0),
    };
  }

  getSession(sessionId) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  getHistoryPage(sessionId, { limit = 80, before = '' } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/history-page?${params.toString()}`);
  }

  createSession({ id, title = 'New Chat' }) {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ id, channel: 'mobile', title }),
    });
  }

  async streamChat({ sessionId, message, clientRequestId, signal, onEvent }) {
    const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
    const token = this.token;
    if (token) headers.set('X-Pairing-Token', token);
    const response = await fetch(`${this.origin}/api/chat`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        message,
        sessionId,
        clientRequestId,
        useTools: true,
        origin: {
          channel: 'mobile',
          surface: 'mobile_app',
          device: 'phone',
          label: 'Prometheus Mobile V2',
          source: 'mobile_v2',
        },
      }),
    });
    if (response.status === 401 && token) window.dispatchEvent(new Event('pm-v2-device-revoked'));
    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch {}
      throw buildRequestError(response, body);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Gateway did not return a readable chat stream.');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const raw = parseSseBlock(block);
          if (!raw) continue;
          const event = normalizeGatewayStreamEvent(raw);
          onEvent?.(event);
          if (event.type === 'assistant.done' || event.type === 'assistant.error') return event;
        }
      }
      const raw = parseSseBlock(buffer);
      if (raw) onEvent?.(normalizeGatewayStreamEvent(raw));
      return { type: 'assistant.done' };
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
}
