export interface HttpClientOptions {
  origin: string;
  token?: string;
  fetch?: typeof fetch;
  defaultTimeoutMs?: number;
}

export interface HttpRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
}

export class GatewayHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, body: unknown, fallbackMessage?: string) {
    const detail = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    super(String(detail.error || detail.message || fallbackMessage || `Gateway request failed (${status})`));
    this.name = 'GatewayHttpError';
    this.status = status;
    this.code = String(detail.code || '');
    this.body = body;
  }
}

export class GatewayHttpClient {
  readonly origin: string;
  readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpClientOptions) {
    this.origin = normalizeGatewayOrigin(options.origin);
    this.token = String(options.token || '');
    this.fetcher = options.fetch || fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 20_000;
  }

  async send(path: string, options: HttpRequestOptions = {}): Promise<Response> {
    const url = new URL(path, `${this.origin}/`);
    const headers = new Headers(options.headers || {});
    if (this.token) headers.set('X-Pairing-Token', this.token);

    const body = encodeRequestBody(options.body, headers);
    const parentSignal = options.signal;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const { timeoutMs: _timeoutMs, body: _body, signal: _signal, ...fetchOptions } = options;
    if (timeoutMs <= 0) {
      return this.fetcher(url, { ...fetchOptions, headers, body, signal: parentSignal });
    }
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new DOMException('Gateway request timed out.', 'TimeoutError')), timeoutMs) : undefined;

    try {
      return await this.fetcher(url, {
        ...fetchOptions,
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  }

  async request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);
    const text = await response.text();
    const body = parseResponseBody(text);
    if (!response.ok) throw new GatewayHttpError(response.status, body);
    return body as T;
  }
}

export function normalizeGatewayOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new TypeError('A valid gateway origin is required.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('Gateway origin must use HTTP or HTTPS.');
  }
  if (url.username || url.password) throw new TypeError('Gateway origin cannot contain credentials.');
  return url.origin;
}

function encodeRequestBody(value: unknown, headers: Headers): BodyInit | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof URLSearchParams || isBodyInit(value)) return value;
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return JSON.stringify(value);
}

function isBodyInit(value: unknown): value is BodyInit {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true;
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true;
  if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) return true;
  return ArrayBuffer.isView(value);
}

function parseResponseBody(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text) as unknown; }
  catch { return text; }
}
