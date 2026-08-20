import { URL } from 'node:url';

export type XApiRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface XApiRequestValidationInput {
  method: unknown;
  path: unknown;
  body?: unknown;
  operationIntent?: unknown;
}

export interface XApiRequestValidationResult {
  method: XApiRequestMethod;
  path: string;
  body?: Record<string, unknown>;
  operationIntent?: string;
}

const METHODS = new Set<XApiRequestMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PATH_LENGTH = 2048;
const MAX_QUERY_KEYS = 64;
const MAX_BODY_BYTES = 64 * 1024;

function plainObject(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function validateXApiRequest(input: XApiRequestValidationInput): XApiRequestValidationResult {
  const method = String(input.method || 'GET').trim().toUpperCase() as XApiRequestMethod;
  if (!METHODS.has(method)) throw new Error('method must be GET, POST, PUT, PATCH, or DELETE.');

  const rawPath = String(input.path || '').trim();
  if (!rawPath || rawPath.length > MAX_PATH_LENGTH || !rawPath.startsWith('/') || rawPath.startsWith('//') || /^\/\\/.test(rawPath)) {
    throw new Error('X API path must begin with / and remain relative to api.x.com.');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(rawPath) || rawPath.includes('\\')) {
    throw new Error('X API path must not include a scheme, host, or backslash.');
  }

  const parsed = new URL(rawPath, 'https://api.x.com');
  if (parsed.origin !== 'https://api.x.com') throw new Error('X API path must remain under api.x.com.');
  if (parsed.username || parsed.password || parsed.port || parsed.host !== 'api.x.com') {
    throw new Error('X API path must remain under api.x.com.');
  }
  if (parsed.searchParams.size > MAX_QUERY_KEYS) throw new Error('X API query contains too many parameters.');

  const body = plainObject(input.body, 'body');
  if (body && JSON.stringify(body).length > MAX_BODY_BYTES) throw new Error('X API request body is too large.');
  if (method === 'GET' && body) throw new Error('GET requests cannot include a body.');

  const operationIntent = input.operationIntent === undefined
    ? undefined
    : String(input.operationIntent || '').trim().slice(0, 256);
  if (method !== 'GET' && !operationIntent) {
    throw new Error('operation_intent is required for X API mutations.');
  }

  return { method, path: `${parsed.pathname}${parsed.search}`, ...(body ? { body } : {}), ...(operationIntent ? { operationIntent } : {}) };
}

export const X_API_REQUEST_LIMITS = Object.freeze({ MAX_PATH_LENGTH, MAX_QUERY_KEYS, MAX_BODY_BYTES });
