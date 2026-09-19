import { GatewayHttpClient, GatewayHttpError, type HttpClientOptions } from '../transport/http-client';
import { normalizeGatewayChatEvent, readSseJson, type GatewayChatEvent, type JsonRecord } from '../transport/sse';
import type { ChatRequest, CreateSessionInput, GatewayConnection, SessionHistoryPage, SessionListResult, SessionRecord, SessionSummary } from './types';

export interface GatewayClientOptions extends Omit<HttpClientOptions, 'origin' | 'token'>, GatewayConnection {}

export interface SessionListOptions {
  limit?: number;
  offset?: number;
  state?: 'active' | 'settled' | 'all';
}

export interface SessionHistoryOptions {
  limit?: number;
  before?: string;
}

export interface StreamChatOptions extends ChatRequest {
  signal?: AbortSignal;
  onEvent?: (event: GatewayChatEvent, raw: JsonRecord) => void;
}

export interface ChatStreamResult {
  event: GatewayChatEvent;
  raw: JsonRecord;
}

export class GatewayStreamError extends Error {
  readonly raw: JsonRecord;

  constructor(event: Extract<GatewayChatEvent, { type: 'assistant.error' }>) {
    super(event.message);
    this.name = 'GatewayStreamError';
    this.raw = event.raw;
  }
}

/** A capability scoped to exactly one gateway origin and one device credential. */
export class GatewayClient {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
  readonly sessions: {
    list: (options?: SessionListOptions & { signal?: AbortSignal }) => Promise<SessionListResult>;
    get: (sessionId: string, options?: { signal?: AbortSignal }) => Promise<SessionRecord>;
    history: <TItem = unknown>(sessionId: string, options?: SessionHistoryOptions & { signal?: AbortSignal }) => Promise<SessionHistoryPage<TItem>>;
    create: (input: CreateSessionInput, options?: { signal?: AbortSignal }) => Promise<SessionSummary>;
  };
  readonly chat: {
    stream: (options: StreamChatOptions) => Promise<ChatStreamResult>;
  };
  private readonly http: GatewayHttpClient;

  constructor(options: GatewayClientOptions) {
    this.id = String(options.id || '').trim();
    this.name = String(options.name || 'Prometheus gateway').trim();
    if (!this.id) throw new TypeError('Gateway id is required.');
    this.http = new GatewayHttpClient({ origin: options.origin, token: options.token, fetch: options.fetch, defaultTimeoutMs: options.defaultTimeoutMs });
    this.origin = this.http.origin;

    this.sessions = {
      list: (request = {}) => this.listSessions(request),
      get: (sessionId, request = {}) => this.getSession(sessionId, request),
      history: (sessionId, request = {}) => this.getHistoryPage(sessionId, request),
      create: (input, request = {}) => this.createSession(input, request),
    };
    this.chat = { stream: (request) => this.streamChat(request) };
  }

  health(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    return this.http.request('/api/health', options);
  }

  private async listSessions({ limit = 80, offset = 0, state = 'all', signal }: SessionListOptions & { signal?: AbortSignal } = {}): Promise<SessionListResult> {
    const params = new URLSearchParams({ scope: 'all', includeAutomated: '1', state, limit: String(limit), offset: String(offset) });
    const body = await this.http.request<unknown>(`/api/sessions?${params}`, { signal });
    if (Array.isArray(body)) return { sessions: body as SessionSummary[], total: body.length };
    const result = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const sessions = Array.isArray(result.sessions) ? result.sessions as SessionSummary[] : [];
    return { sessions, total: numberValue(result.total ?? result.totalCount, sessions.length) };
  }

  private async getSession(sessionId: string, { signal }: { signal?: AbortSignal } = {}): Promise<SessionRecord> {
    const body = await this.http.request<{ session?: SessionRecord }>(`/api/sessions/${encodeURIComponent(requireSessionId(sessionId))}?mobile=1`, { signal });
    if (!body?.session) throw new Error('Gateway response did not include a session.');
    return body.session;
  }

  private getHistoryPage<TItem = unknown>(sessionId: string, { limit = 40, before = '', signal }: SessionHistoryOptions & { signal?: AbortSignal } = {}): Promise<SessionHistoryPage<TItem>> {
    const params = new URLSearchParams({ limit: String(limit), mobile: '1' });
    if (before) params.set('before', before);
    return this.http.request(`/api/sessions/${encodeURIComponent(requireSessionId(sessionId))}/history-page?${params}`, { signal });
  }

  private async createSession(input: CreateSessionInput, { signal }: { signal?: AbortSignal } = {}): Promise<SessionSummary> {
    const body = await this.http.request<{ session?: SessionSummary }>('/api/sessions', {
      method: 'POST', signal,
      body: { ...(input.id ? { id: requireSessionId(input.id) } : {}), channel: 'mobile', title: input.title || 'New Chat' },
    });
    if (!body?.session) throw new Error('Gateway response did not include the created session.');
    return body.session;
  }

  private async streamChat({ message, sessionId, clientRequestId, attachments, attachmentPreviews, callerContext, excludedSkillIds, selectedSkillIds, signal, onEvent }: StreamChatOptions): Promise<ChatStreamResult> {
    if (!String(message || '').trim()) throw new TypeError('A chat message is required.');
    const sid = requireSessionId(sessionId);
    const body = {
      message,
      sessionId: sid,
      clientRequestId: optionalString(clientRequestId),
      useTools: true,
      attachments: nonEmpty(attachments),
      attachmentPreviews: nonEmpty(attachmentPreviews),
      callerContext: optionalString(callerContext),
      excludedSkillIds: nonEmpty(excludedSkillIds),
      selectedSkillIds: nonEmpty(selectedSkillIds),
      origin: { channel: 'mobile', surface: 'mobile_app', device: 'phone', label: 'Prometheus Mobile', source: 'mobile_v2' },
    };
    const response = await this.http.send('/api/chat', {
      method: 'POST', signal, timeoutMs: 0,
      headers: { Accept: 'text/event-stream' }, body,
    });
    if (!response.ok) {
      const text = await response.text();
      let payload: unknown = text;
      try { payload = text ? JSON.parse(text) : null; } catch { /* preserve plain-text error */ }
      throw new GatewayHttpError(response.status, payload);
    }

    let terminal: ChatStreamResult | undefined;
    for await (const raw of readSseJson(response, signal)) {
      const event = normalizeGatewayChatEvent(raw);
      const previousFinalText = terminal?.event.type === 'assistant.done' ? terminal.event.text : '';
      if (event.type === 'assistant.done' && previousFinalText && !event.text) continue;
      onEvent?.(event, raw);
      if (event.type === 'assistant.error') throw new GatewayStreamError(event);
      if (event.type === 'assistant.done' && (!terminal || event.text)) terminal = { event, raw };
    }
    if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
    if (!terminal) throw new Error('Chat stream ended before Prometheus sent a final response.');
    return terminal;
  }
}

function requireSessionId(value: string): string {
  const id = String(value || '').trim();
  if (!id) throw new TypeError('Session id is required.');
  return id;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonEmpty<T>(value: T[] | undefined): T[] | undefined {
  return Array.isArray(value) && value.length ? value : undefined;
}

function optionalString(value: string | undefined): string | undefined {
  const clean = String(value || '').trim();
  return clean || undefined;
}
