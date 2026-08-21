import { URL } from 'node:url';

export interface GoogleDriveRequestValidationInput {
  path: unknown;
  query?: unknown;
}

export interface GoogleDriveRequestValidationResult {
  path: string;
  query?: Record<string, string>;
}

const DRIVE_API_ORIGIN = 'https://www.googleapis.com';
const DRIVE_API_PREFIX = '/drive/v3/';
const MAX_PATH_LENGTH = 2048;
const MAX_QUERY_KEYS = 64;

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

export function validateGoogleDriveGetRequest(input: GoogleDriveRequestValidationInput): GoogleDriveRequestValidationResult {
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
  if (!parsed.pathname.startsWith(DRIVE_API_PREFIX)) {
    throw new Error('Google Drive API path must remain under /drive/v3/.');
  }

  const query = plainQuery(input.query);
  if (query && Object.keys(query).length > MAX_QUERY_KEYS) {
    throw new Error('Google Drive query contains too many parameters.');
  }
  if (parsed.search) throw new Error('Google Drive API path must not include query parameters; pass them in query.');
  return { path: parsed.pathname, ...(query ? { query } : {}) };
}

export const GOOGLE_DRIVE_REQUEST_LIMITS = Object.freeze({ MAX_PATH_LENGTH, MAX_QUERY_KEYS });
