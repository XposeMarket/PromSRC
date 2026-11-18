import { URL } from 'node:url';

export type GoogleDriveRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type GoogleDriveRequestBody = Record<string, unknown> | string;
export type GoogleDriveUploadType = 'media' | 'multipart' | 'resumable';
export type GoogleDriveResponseMode = 'auto' | 'json' | 'text' | 'base64';

export interface GoogleDriveRequestValidationInput {
  method?: unknown;
  path: unknown;
  query?: unknown;
  body?: unknown;
  operationIntent?: unknown;
  uploadType?: unknown;
  contentType?: unknown;
  responseMode?: unknown;
}

export interface GoogleDriveRequestValidationResult {
  method: GoogleDriveRequestMethod;
  path: string;
  query?: Record<string, string>;
  body?: GoogleDriveRequestBody;
  operationIntent?: string;
  uploadType?: GoogleDriveUploadType;
  contentType?: string;
  responseMode?: GoogleDriveResponseMode;
}

const DRIVE_API_ORIGIN = 'https://www.googleapis.com';
const DRIVE_API_PREFIX = '/drive/v3/';
const DRIVE_UPLOAD_PREFIX = '/upload/drive/v3/';
const METHODS = new Set<GoogleDriveRequestMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const UPLOAD_TYPES = new Set<GoogleDriveUploadType>(['media', 'multipart', 'resumable']);
const RESPONSE_MODES = new Set<GoogleDriveResponseMode>(['auto', 'json', 'text', 'base64']);
const MAX_PATH_LENGTH = 2048;
const MAX_QUERY_KEYS = 64;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_CONTENT_BYTES = 8 * 1024 * 1024;

function plainQuery(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('query must be a JSON object.');
  }
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) throw new Error('query keys must not be empty.');
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
      throw new Error('query values must be strings, numbers, or booleans.');
    }
    result[key] = String(raw);
  }
  return result;
}

function plainBody(value: unknown): GoogleDriveRequestBody | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_BODY_BYTES) throw new Error('Google Drive request body is too large.');
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('body must be a JSON object or string.');
  }
  const body = value as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
    throw new Error('Google Drive request body is too large.');
  }
  return body;
}

function uploadContentBytes(body: Record<string, unknown>): number {
  const content = body.content;
  const contentBase64 = body.content_base64;
  if (content !== undefined && typeof content !== 'string') throw new Error('upload body content must be a string.');
  if (contentBase64 !== undefined && typeof contentBase64 !== 'string') throw new Error('upload body content_base64 must be a string.');
  if (content === undefined && contentBase64 === undefined) throw new Error('upload body requires content or content_base64.');
  if (content !== undefined && contentBase64 !== undefined) throw new Error('upload body must use content or content_base64, not both.');
  const bytes = content !== undefined ? Buffer.byteLength(content, 'utf8') : Buffer.from(contentBase64 as string, 'base64').byteLength;
  if (bytes > MAX_UPLOAD_CONTENT_BYTES) throw new Error('Google Drive upload content is too large.');
  return bytes;
}

function normalizeIntent(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const intent = String(value || '').trim().slice(0, 256);
  return intent || undefined;
}

export function validateGoogleDriveRequest(input: GoogleDriveRequestValidationInput): GoogleDriveRequestValidationResult {
  const method = String(input.method || 'GET').trim().toUpperCase() as GoogleDriveRequestMethod;
  if (!METHODS.has(method)) throw new Error('method must be GET, POST, PUT, PATCH, or DELETE.');

  const rawPath = String(input.path || '').trim();
  if (!rawPath || rawPath.length > MAX_PATH_LENGTH || !rawPath.startsWith('/') || rawPath.startsWith('//') || /^\/\\/.test(rawPath)) {
    throw new Error('Google Drive API path must begin with / and remain relative to www.googleapis.com.');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(rawPath) || rawPath.includes('\\')) {
    throw new Error('Google Drive API path must not include a scheme, host, or backslash.');
  }

  const parsed = new URL(rawPath, DRIVE_API_ORIGIN);
  if (parsed.origin !== DRIVE_API_ORIGIN || parsed.username || parsed.password || parsed.port || parsed.host !== 'www.googleapis.com') {
    throw new Error('Google Drive API path must remain under www.googleapis.com.');
  }
  if (parsed.search) throw new Error('Google Drive API path must not include query parameters; pass them in query.');

  const uploadType = input.uploadType === undefined ? undefined : String(input.uploadType).trim().toLowerCase() as GoogleDriveUploadType;
  if (uploadType !== undefined && !UPLOAD_TYPES.has(uploadType)) {
    throw new Error('upload_type must be media, multipart, or resumable.');
  }

  const isUpload = parsed.pathname.startsWith(DRIVE_UPLOAD_PREFIX) || uploadType !== undefined;
  const allowedPrefix = isUpload ? DRIVE_UPLOAD_PREFIX : DRIVE_API_PREFIX;
  if (!parsed.pathname.startsWith(allowedPrefix)) {
    throw new Error(`Google Drive API path must remain under ${allowedPrefix}.`);
  }
  if (uploadType !== undefined && !parsed.pathname.startsWith(DRIVE_UPLOAD_PREFIX)) {
    throw new Error('upload_type requires an /upload/drive/v3/ path.');
  }
  if (parsed.pathname.startsWith(DRIVE_UPLOAD_PREFIX) && uploadType === undefined) {
    throw new Error('Upload paths require upload_type.');
  }

  const query = plainQuery(input.query);
  if (query && Object.keys(query).length > MAX_QUERY_KEYS) {
    throw new Error('Google Drive query contains too many parameters.');
  }
  const body = plainBody(input.body);
  if (method === 'GET' && body !== undefined) throw new Error('GET requests cannot include a body.');
  if (method === 'DELETE' && body !== undefined) throw new Error('DELETE requests cannot include a body.');

  if (uploadType === 'media') {
    if (typeof body !== 'string') throw new Error('media uploads require a string body containing content.');
    if (Buffer.byteLength(body, 'utf8') > MAX_UPLOAD_CONTENT_BYTES) throw new Error('Google Drive upload content is too large.');
  }
  if (uploadType === 'multipart' || uploadType === 'resumable') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`${uploadType} uploads require an object body with metadata and content.`);
    }
    uploadContentBytes(body);
    if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
      throw new Error('upload body metadata must be a JSON object.');
    }
  }

  const contentType = input.contentType === undefined ? undefined : String(input.contentType).trim().slice(0, 128);
  if (contentType === '') throw new Error('content_type must not be empty.');
  const responseMode = input.responseMode === undefined ? undefined : String(input.responseMode).trim().toLowerCase() as GoogleDriveResponseMode;
  if (responseMode !== undefined && !RESPONSE_MODES.has(responseMode)) throw new Error('response_mode must be auto, json, text, or base64.');
  const operationIntent = normalizeIntent(input.operationIntent);
  if (method !== 'GET' && !operationIntent) throw new Error('operation_intent is required for Google Drive mutations.');

  return {
    method,
    path: parsed.pathname,
    ...(query ? { query } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(operationIntent ? { operationIntent } : {}),
    ...(uploadType ? { uploadType } : {}),
    ...(contentType ? { contentType } : {}),
    ...(responseMode ? { responseMode } : {}),
  };
}

/** Compatibility wrapper retained for callers of the original PR #83 policy. */
export function validateGoogleDriveGetRequest(input: Pick<GoogleDriveRequestValidationInput, 'path' | 'query'>): Pick<GoogleDriveRequestValidationResult, 'path' | 'query'> {
  const result = validateGoogleDriveRequest({ ...input, method: 'GET' });
  return { path: result.path, ...(result.query ? { query: result.query } : {}) };
}

export const GOOGLE_DRIVE_REQUEST_LIMITS = Object.freeze({
  MAX_PATH_LENGTH,
  MAX_QUERY_KEYS,
  MAX_BODY_BYTES,
  MAX_UPLOAD_CONTENT_BYTES,
});
