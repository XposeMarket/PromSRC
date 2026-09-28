/**
 * webhook-endpoints.ts - named inbound webhook endpoints for the trigger engine.
 *
 * Each endpoint owns a random secret. A request is accepted when it proves
 * knowledge of that secret in one of these ways:
 *   - URL path token:            POST /triggers/hook/<id>/<secret>
 *   - GitHub HMAC:               X-Hub-Signature-256: sha256=<hmac(secret, rawBody)>
 *   - Generic HMAC:              X-Prometheus-Signature: sha256=<hmac(secret, rawBody)>
 *   - Header / bearer token:     X-Prometheus-Token: <secret> | Authorization: Bearer <secret>
 *
 * Endpoints only normalize and authenticate events. Matching and execution stay
 * in the existing TriggerEngine so there is exactly one rule/dedupe/run ledger.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type WebhookEndpointKind = 'generic' | 'github';

export interface WebhookEndpoint {
  id: string;
  name: string;
  kind: WebhookEndpointKind;
  secret: string;
  enabled: boolean;
  description?: string;
  createdAt: number;
  updatedAt: number;
  lastReceivedAt?: number;
  lastEventType?: string;
  receivedCount?: number;
}

interface EndpointStoreFile {
  version: 1;
  publicBaseUrl?: string;
  endpoints: WebhookEndpoint[];
}

export const WEBHOOK_ENDPOINT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const MAX_ENDPOINTS = 200;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function header(headers: Record<string, unknown>, name: string): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

export function newWebhookSecret(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function hmacSha256Hex(secret: string, rawBody: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export class WebhookEndpointStore {
  private cache: EndpointStoreFile | null = null;

  constructor(private readonly filePath: string, private readonly now: () => number = Date.now) {}

  private read(): EndpointStoreFile {
    if (this.cache) return this.cache;
    let parsed: any = null;
    try {
      if (fs.existsSync(this.filePath)) parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch (error: any) {
      console.warn(`[WebhookEndpoints] Could not parse ${this.filePath}: ${String(error?.message || error).slice(0, 200)}`);
    }
    const endpoints = Array.isArray(parsed?.endpoints) ? parsed.endpoints : [];
    this.cache = {
      version: 1,
      publicBaseUrl: typeof parsed?.publicBaseUrl === 'string' ? parsed.publicBaseUrl : undefined,
      endpoints: endpoints
        .filter((ep: any) => ep && WEBHOOK_ENDPOINT_ID_RE.test(String(ep.id || '')) && typeof ep.secret === 'string' && ep.secret.length >= 16)
        .map((ep: any) => ({
          id: String(ep.id),
          name: String(ep.name || ep.id).slice(0, 160),
          kind: ep.kind === 'github' ? 'github' : 'generic',
          secret: String(ep.secret),
          enabled: ep.enabled !== false,
          description: ep.description ? String(ep.description).slice(0, 1000) : undefined,
          createdAt: Number(ep.createdAt) || this.now(),
          updatedAt: Number(ep.updatedAt) || this.now(),
          lastReceivedAt: Number(ep.lastReceivedAt) || undefined,
          lastEventType: ep.lastEventType ? String(ep.lastEventType).slice(0, 240) : undefined,
          receivedCount: Number(ep.receivedCount) || 0,
        })),
    };
    return this.cache;
  }

  private write(): void {
    const store = this.read();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${this.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  list(): WebhookEndpoint[] {
    return this.read().endpoints.map((ep) => ({ ...ep }));
  }

  get(id: string): WebhookEndpoint | null {
    const ep = this.read().endpoints.find((candidate) => candidate.id === String(id || '').trim());
    return ep ? { ...ep } : null;
  }

  getPublicBaseUrl(): string {
    return String(this.read().publicBaseUrl || process.env.PROMETHEUS_PUBLIC_URL || '').replace(/\/+$/, '');
  }

  setPublicBaseUrl(url: string): string {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (clean && !/^https?:\/\/[^\s/]+/i.test(clean)) throw new Error('public_base_url must be an http(s) origin, e.g. https://host.example.net');
    this.read().publicBaseUrl = clean || undefined;
    this.write();
    return clean;
  }

  create(input: { id: string; name?: string; kind?: string; description?: string; secret?: string }): WebhookEndpoint {
    const id = String(input.id || '').trim().toLowerCase();
    if (!WEBHOOK_ENDPOINT_ID_RE.test(id)) throw new Error('endpoint_id must be 1-63 chars: lowercase letters, digits, dot, dash, underscore.');
    const store = this.read();
    if (store.endpoints.some((ep) => ep.id === id)) throw new Error(`Webhook endpoint already exists: ${id}`);
    if (store.endpoints.length >= MAX_ENDPOINTS) throw new Error(`Webhook endpoint limit reached (${MAX_ENDPOINTS}).`);
    const secret = String(input.secret || '').trim() || newWebhookSecret();
    if (secret.length < 16) throw new Error('secret must be at least 16 characters.');
    const now = this.now();
    const ep: WebhookEndpoint = {
      id,
      name: String(input.name || id).trim().slice(0, 160),
      kind: input.kind === 'github' ? 'github' : 'generic',
      secret,
      enabled: true,
      description: input.description ? String(input.description).slice(0, 1000) : undefined,
      createdAt: now,
      updatedAt: now,
      receivedCount: 0,
    };
    store.endpoints.push(ep);
    this.write();
    return { ...ep };
  }

  update(id: string, patch: { name?: string; enabled?: boolean; description?: string; kind?: string; rotateSecret?: boolean }): WebhookEndpoint {
    const store = this.read();
    const ep = store.endpoints.find((candidate) => candidate.id === String(id || '').trim());
    if (!ep) throw new Error(`Webhook endpoint not found: ${id}`);
    if (patch.name !== undefined) ep.name = String(patch.name || ep.id).slice(0, 160);
    if (patch.enabled !== undefined) ep.enabled = patch.enabled !== false;
    if (patch.description !== undefined) ep.description = String(patch.description || '').slice(0, 1000) || undefined;
    if (patch.kind !== undefined) ep.kind = patch.kind === 'github' ? 'github' : 'generic';
    if (patch.rotateSecret) ep.secret = newWebhookSecret();
    ep.updatedAt = this.now();
    this.write();
    return { ...ep };
  }

  delete(id: string): boolean {
    const store = this.read();
    const before = store.endpoints.length;
    store.endpoints = store.endpoints.filter((ep) => ep.id !== String(id || '').trim());
    if (store.endpoints.length === before) return false;
    this.write();
    return true;
  }

  recordDelivery(id: string, eventType: string): void {
    const ep = this.read().endpoints.find((candidate) => candidate.id === id);
    if (!ep) return;
    ep.lastReceivedAt = this.now();
    ep.lastEventType = String(eventType || '').slice(0, 240);
    ep.receivedCount = Number(ep.receivedCount || 0) + 1;
    this.write();
  }
}

export function maskSecret(secret: string): string {
  const s = String(secret || '');
  return s.length <= 6 ? '***' : `${s.slice(0, 4)}…${s.slice(-2)}`;
}

export function hookPathFor(ep: Pick<WebhookEndpoint, 'id' | 'secret'>, includeToken: boolean): string {
  return includeToken ? `/triggers/hook/${ep.id}/${ep.secret}` : `/triggers/hook/${ep.id}`;
}

export function publicEndpointView(ep: WebhookEndpoint, opts: { reveal?: boolean; baseUrl?: string } = {}): Record<string, unknown> {
  const base = String(opts.baseUrl || '').replace(/\/+$/, '');
  const view: Record<string, unknown> = {
    id: ep.id,
    name: ep.name,
    kind: ep.kind,
    enabled: ep.enabled,
    description: ep.description,
    secret: opts.reveal ? ep.secret : maskSecret(ep.secret),
    hmac_url: `${base}${hookPathFor(ep, false)}`,
    receivedCount: ep.receivedCount || 0,
    lastReceivedAt: ep.lastReceivedAt ? new Date(ep.lastReceivedAt).toISOString() : null,
    lastEventType: ep.lastEventType || null,
  };
  if (opts.reveal) view.token_url = `${base}${hookPathFor(ep, true)}`;
  return view;
}

export type WebhookAuthMethod = 'path_token' | 'github_hmac' | 'hmac' | 'header_token';

export function verifyWebhookRequest(
  ep: WebhookEndpoint,
  req: { pathToken?: string; headers: Record<string, unknown>; rawBody: Buffer },
): { ok: true; method: WebhookAuthMethod } | { ok: false; reason: string } {
  const pathToken = String(req.pathToken || '').trim();
  if (pathToken) {
    return safeEqual(pathToken, ep.secret)
      ? { ok: true, method: 'path_token' }
      : { ok: false, reason: 'bad_path_token' };
  }
  const expected = `sha256=${hmacSha256Hex(ep.secret, req.rawBody)}`;
  const githubSig = header(req.headers, 'x-hub-signature-256');
  if (githubSig) {
    return safeEqual(githubSig.toLowerCase(), expected) ? { ok: true, method: 'github_hmac' } : { ok: false, reason: 'bad_github_signature' };
  }
  const genericSig = header(req.headers, 'x-prometheus-signature');
  if (genericSig) {
    const normalized = genericSig.toLowerCase().startsWith('sha256=') ? genericSig.toLowerCase() : `sha256=${genericSig.toLowerCase()}`;
    return safeEqual(normalized, expected) ? { ok: true, method: 'hmac' } : { ok: false, reason: 'bad_signature' };
  }
  const bearer = header(req.headers, 'authorization').replace(/^bearer\s+/i, '');
  const token = header(req.headers, 'x-prometheus-token') || bearer;
  if (token) {
    return safeEqual(token, ep.secret) ? { ok: true, method: 'header_token' } : { ok: false, reason: 'bad_token' };
  }
  return { ok: false, reason: 'missing_credentials' };
}

export function parseWebhookBody(rawBody: Buffer, contentType: string): Record<string, unknown> {
  const text = rawBody.toString('utf8');
  if (!text.trim()) return {};
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    // GitHub "form" content type sends the JSON document in payload=.
    const payload = params.get('payload');
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return Object.fromEntries(params.entries());
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return { value: parsed };
  } catch {
    return { text: text.slice(0, 64_000) };
  }
}

function str(value: unknown, max = 240): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '';
}

export function extractWebhookEventMeta(
  ep: WebhookEndpoint,
  headers: Record<string, unknown>,
  body: Record<string, any>,
): { eventType: string; deliveryId: string; subject?: string } {
  const githubEvent = header(headers, 'x-github-event');
  if (githubEvent || ep.kind === 'github') {
    const base = githubEvent || str(body.event) || 'unknown';
    const action = str(body.action, 80);
    const subject = str(body.pull_request?.title, 300)
      || str(body.issue?.title, 300)
      || str(body.head_commit?.message, 300)
      || str(body.release?.name, 300)
      || str(body.workflow_run?.name, 300)
      || str(body.repository?.full_name, 300)
      || undefined;
    return {
      eventType: action ? `${base}.${action}` : base,
      deliveryId: header(headers, 'x-github-delivery') || crypto.randomUUID(),
      subject,
    };
  }
  return {
    eventType: header(headers, 'x-event-type') || str(body.event) || str(body.type) || str(body.eventType) || 'post',
    deliveryId: header(headers, 'x-delivery-id') || header(headers, 'x-request-id') || str(body.delivery_id) || str(body.id) || crypto.randomUUID(),
    subject: str(body.subject, 300) || str(body.title, 300) || undefined,
  };
}
