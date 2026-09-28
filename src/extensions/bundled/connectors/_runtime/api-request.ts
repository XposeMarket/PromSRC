// Shared raw-API escape hatch for native bundled connectors.
//
// Every native connector ships a small set of first-class tools. Anything the
// provider API supports beyond that used to be impossible from Prometheus.
// This helper registers `connector_<id>_api_request`, which reuses the
// connector's live, authenticated instance (token refresh stays in the
// connector class) and calls a relative path on a FIXED provider base URL.
//
// Safety: the host is never caller-controlled (relative paths only, no scheme,
// no traversal); GET/HEAD are credential reads, everything else goes through
// the external-write approval gate (see gateway/tool-capabilities.ts).
import type { PrometheusExtensionApi, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, getLiveConnector, notConnected, toolError, toolOk } from './connector-helpers.js';

export const API_REQUEST_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const MAX_PATH_CHARS = 2000;
const MAX_BODY_CHARS = 200_000;
const MAX_RESULT_CHARS = 60_000;

export type ApiBodyEncoding = 'json' | 'form';

export interface ConnectorApiRequestSpec<C> {
  connectorId: string;
  displayName: string;
  /** Named base URLs. The first key is the default. Paths are appended verbatim. */
  bases: Record<string, string | ((c: C) => string | Promise<string>)>;
  /** Extra headers (Notion-Version, User-Agent, ...). Authorization is added automatically. */
  headers?: Record<string, string>;
  bodyEncoding?: ApiBodyEncoding;
  /** Example path shown to the model. */
  examplePath: string;
  /** Short hint listing what the API covers beyond the first-class tools. */
  coverageHint: string;
  /** Custom token getter; defaults to connector.getValidAccessToken(). */
  getToken?: (c: C) => Promise<string>;
}

export function apiRequestToolName(connectorId: string): string {
  return `connector_${connectorId}_api_request`;
}

/** Relative provider paths only: no scheme, host, traversal, whitespace, or control chars. */
export function validateConnectorApiPath(path: unknown): string | null {
  const value = typeof path === 'string' ? path.trim() : '';
  if (!value) return 'path is required.';
  if (!value.startsWith('/') || value.startsWith('//')) return 'path must be a relative API path starting with a single /.';
  if (/[\s\x00-\x1f\\@]/.test(value) || /:\/\//.test(value)) return 'path must not contain whitespace, backslashes, @, control characters, or a URL scheme.';
  if (value.split('?')[0].split('/').some((seg) => seg === '..' || seg === '.' || /^%2e/i.test(seg))) return 'path must not contain . or .. segments.';
  if (value.length > MAX_PATH_CHARS) return `path must be ${MAX_PATH_CHARS} characters or fewer.`;
  return null;
}

/** Stripe-style form flattening: {a:{b:1}, c:[x,y]} -> a[b]=1&c[0]=x&c[1]=y */
export function encodeFormBody(body: unknown): string {
  const params = new URLSearchParams();
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${key}[${i}]`)); return; }
    if (typeof value === 'object') { for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, key ? `${key}[${k}]` : k); return; }
    params.append(key, String(value));
  };
  walk(body, '');
  return params.toString();
}

async function resolveBase<C>(spec: ConnectorApiRequestSpec<C>, c: C, name: string): Promise<string> {
  const entry = spec.bases[name];
  const raw = typeof entry === 'function' ? await entry(c) : entry;
  const base = String(raw || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/i.test(base)) throw new Error(`${spec.displayName} API base URL is not configured.`);
  return base;
}

export async function executeConnectorApiRequest<C>(spec: ConnectorApiRequestSpec<C>, c: C, args: any): Promise<PrometheusToolExecutionResult> {
  const path = typeof args?.path === 'string' ? args.path.trim() : '';
  const pathError = validateConnectorApiPath(path);
  if (pathError) return toolError(`${pathError} Example: ${spec.examplePath}`);
  const method = String(args?.method || 'GET').trim().toUpperCase();
  if (!(API_REQUEST_METHODS as readonly string[]).includes(method)) return toolError(`method must be one of ${API_REQUEST_METHODS.join(', ')}.`);
  const baseNames = Object.keys(spec.bases);
  const baseName = String(args?.api || baseNames[0]).trim();
  if (!baseNames.includes(baseName)) return toolError(`api must be one of ${baseNames.join(', ')}.`);

  const hasBody = args?.body !== undefined && args?.body !== null && method !== 'GET' && method !== 'HEAD';
  const encoding = spec.bodyEncoding || 'json';
  let payload: string | undefined;
  if (hasBody) {
    try { payload = encoding === 'form' ? encodeFormBody(args.body) : JSON.stringify(args.body); } catch { return toolError('body must be JSON-serializable.'); }
    if (payload === undefined) return toolError('body must be a JSON value.');
    if (payload.length > MAX_BODY_CHARS) return toolError(`body must be ${MAX_BODY_CHARS} characters or fewer.`);
  }

  let url: string;
  let token: string;
  try {
    url = `${await resolveBase(spec, c, baseName)}${path}`;
    token = spec.getToken ? await spec.getToken(c) : await (c as any).getValidAccessToken();
  } catch (err: any) {
    return toolError(err?.message || `${spec.displayName} credentials are unavailable.`);
  }

  const res = await fetch(url, {
    method,
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(spec.headers || {}),
      ...(hasBody ? { 'Content-Type': encoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json' } : {}),
    },
    body: hasBody ? payload : undefined,
  });
  const text = method === 'HEAD' ? '' : await res.text().catch(() => '');
  let out = text;
  if (text) { try { out = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw text */ } }
  if (out.length > MAX_RESULT_CHARS) out = `${out.slice(0, MAX_RESULT_CHARS)}\n...[truncated ${out.length - MAX_RESULT_CHARS} chars]`;
  const head = `${spec.displayName} API ${method} ${baseNames.length > 1 ? `[${baseName}] ` : ''}${path} -> ${res.status}`;
  return res.ok ? toolOk(out ? `${head}\n${out}` : head) : toolError(out ? `${head}\n${out}` : head);
}

export function registerConnectorApiRequestTool<C>(api: PrometheusExtensionApi, spec: ConnectorApiRequestSpec<C>): void {
  const baseNames = Object.keys(spec.bases);
  const properties: Record<string, any> = {
    path: { type: 'string', description: `Relative ${spec.displayName} API path beginning with /, query string allowed, e.g. ${spec.examplePath}` },
    method: { type: 'string', enum: [...API_REQUEST_METHODS], description: 'HTTP method, default GET' },
    body: { type: 'object', description: `Optional ${spec.bodyEncoding === 'form' ? 'body (sent form-encoded, nested keys flattened like a[b]=c)' : 'JSON body'} for write methods` },
  };
  if (baseNames.length > 1) properties.api = { type: 'string', enum: baseNames, description: `Which ${spec.displayName} API host to call (default ${baseNames[0]})` };
  api.registerTool({
    name: apiRequestToolName(spec.connectorId),
    description: `[${spec.displayName}] Call any ${spec.displayName} API endpoint not covered by a first-class tool (${spec.coverageHint}). The host is fixed to the ${spec.displayName} API. GET/HEAD are read-only; other methods use the normal external-write approval gate.`,
    parameters: { type: 'object', required: ['path'], properties },
    connectorId: spec.connectorId,
    capability: 'api',
    execute: async (args: any) => {
      if (!connectorConnected(spec.connectorId)) return notConnected(spec.displayName);
      const c = getLiveConnector<C>(spec.connectorId);
      if (!c) return toolError(`${spec.displayName} is unavailable.`);
      try {
        return await executeConnectorApiRequest(spec, c, args);
      } catch (err: any) {
        return toolError(`${spec.displayName} API request failed: ${err?.message || String(err)}`);
      }
    },
  } as any);
}
