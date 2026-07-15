import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config.js';
import type { DeliveryReferenceCandidate } from '../turn-delivery/bounded-payload.js';
import { TurnJobBlobStore, type TurnJobBlobDescriptor } from './blob-store.js';

const BLOB_HASH_PATTERN = /^[a-f0-9]{64}$/;
const BASE64_SOURCE_CHUNK_CODE_UNITS = 64 * 1024;
const MAX_SYNC_REUSE_DATA_URI_CODE_UNITS = 256 * 1024;
const SAFE_INLINE_TURN_BLOB_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/ogg',
  'video/quicktime',
  'video/webm',
]);
let blobStore: TurnJobBlobStore | null = null;
let blobStoreRoot = '';
let signingKey: Buffer | null = null;
let signingKeyPath = '';

export function getTurnJobBlobRoot(): string {
  return path.join(getConfig().getConfigDir(), 'runtime', 'turn-blobs');
}

export function getTurnJobBlobStore(): TurnJobBlobStore {
  const root = getTurnJobBlobRoot();
  if (!blobStore || blobStoreRoot !== root) {
    blobStore = new TurnJobBlobStore(root);
    blobStoreRoot = root;
  }
  return blobStore;
}

export function turnBlobRefForHash(hashInput: string): string {
  const hash = String(hashInput || '').trim().toLowerCase();
  if (!BLOB_HASH_PATTERN.test(hash)) throw new TypeError('Invalid turn blob hash.');
  return `turnblob:sha256:${hash}`;
}

export function readTurnBlobByHash(hash: string): { descriptor: TurnJobBlobDescriptor; body: Buffer } {
  const ref = turnBlobRefForHash(hash);
  const store = getTurnJobBlobStore();
  return { descriptor: store.readDescriptor(ref), body: store.getBuffer(ref) };
}

function getTurnBlobSigningKey(): Buffer {
  const keyPath = path.join(getConfig().getConfigDir(), 'runtime', 'turn-blob-signing.key');
  if (signingKey && signingKeyPath === keyPath) return signingKey;
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  let key: Buffer;
  try {
    key = fs.readFileSync(keyPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    key = crypto.randomBytes(32);
    const temporary = `${keyPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, key, { mode: 0o600, flag: 'wx' });
    try {
      fs.renameSync(temporary, keyPath);
    } catch (renameError) {
      try { fs.unlinkSync(temporary); } catch {}
      key = fs.readFileSync(keyPath);
      void renameError;
    }
  }
  if (key.length !== 32) throw new Error('Turn blob signing key is invalid.');
  signingKey = key;
  signingKeyPath = keyPath;
  return key;
}

function signTurnBlobGrant(hash: string, expiresAt: number): string {
  return crypto.createHmac('sha256', getTurnBlobSigningKey())
    .update(`${hash}.${expiresAt}`)
    .digest('base64url');
}

export function createSignedTurnBlobUrl(hashInput: string, ttlMs = 30 * 24 * 60 * 60_000): string {
  const hash = String(hashInput || '').trim().toLowerCase();
  if (!BLOB_HASH_PATTERN.test(hash)) throw new TypeError('Invalid turn blob hash.');
  const expiresAt = Date.now() + Math.max(60_000, Math.min(90 * 24 * 60 * 60_000, Number(ttlMs) || 0));
  const signature = signTurnBlobGrant(hash, expiresAt);
  return `/api/turn-blobs/${hash}?tbexp=${expiresAt}&tbsig=${encodeURIComponent(signature)}`;
}

export function verifyTurnBlobGrant(hashInput: string, expiresInput: unknown, signatureInput: unknown, now = Date.now()): boolean {
  const hash = String(hashInput || '').trim().toLowerCase();
  const expiresAt = Number(expiresInput);
  const signature = String(signatureInput || '').trim();
  if (!BLOB_HASH_PATTERN.test(hash) || !Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + 90 * 24 * 60 * 60_000 || !signature) {
    return false;
  }
  const expected = signTurnBlobGrant(hash, expiresAt);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isSafeInlineTurnBlobContentType(contentTypeInput: string): boolean {
  const contentType = String(contentTypeInput || '').split(';', 1)[0].trim().toLowerCase();
  return SAFE_INLINE_TURN_BLOB_TYPES.has(contentType);
}

function decodeDataUri(value: string, mediaType: string): { body: Buffer; contentType: string } | null {
  const match = /^data:([^;,\s]+)?(?:;[^;,\s]+)*;base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  return {
    body: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
    contentType: String(match[1] || mediaType || 'application/octet-stream'),
  };
}

function parseDataUriHeader(value: string, mediaType: string): { payloadStart: number; contentType: string } | null {
  const comma = value.slice(0, 512).indexOf(',');
  if (comma < 0) return null;
  const header = value.slice(0, comma + 1);
  const match = /^data:([^;,\s]+)?(?:;[^;,\s]+)*;base64,$/i.exec(header);
  if (!match || value.length <= comma + 1) return null;
  return {
    payloadStart: comma + 1,
    contentType: String(match[1] || mediaType || 'application/octet-stream'),
  };
}

async function* decodeDataUriChunks(value: string, payloadStart: number): AsyncGenerator<Buffer> {
  let carry = '';
  let paddingSeen = false;
  for (let start = payloadStart; start < value.length; start += BASE64_SOURCE_CHUNK_CODE_UNITS) {
    const raw = value.slice(start, Math.min(value.length, start + BASE64_SOURCE_CHUNK_CODE_UNITS));
    if (/[^a-z0-9+/=\s]/i.test(raw)) throw new TypeError('Invalid base64 data URI payload.');
    const clean = raw.replace(/\s+/g, '');
    if (paddingSeen && /[^=]/.test(clean)) throw new TypeError('Invalid base64 padding in data URI payload.');
    let available = carry + clean;
    const paddingIndex = available.indexOf('=');
    let readyLength: number;
    if (paddingIndex >= 0) {
      paddingSeen = true;
      if (/[^=]/.test(available.slice(paddingIndex)) || available.length - paddingIndex > 2) {
        throw new TypeError('Invalid base64 padding in data URI payload.');
      }
      readyLength = paddingIndex - (paddingIndex % 4);
    } else {
      readyLength = available.length - (available.length % 4);
    }
    if (readyLength > 0) yield Buffer.from(available.slice(0, readyLength), 'base64');
    carry = available.slice(readyLength);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (carry.length > 0) yield Buffer.from(carry, 'base64');
}

function persistDataUri(value: string, mediaType: string): TurnJobBlobDescriptor | null {
  const decoded = decodeDataUri(value, mediaType);
  if (!decoded) return null;
  return getTurnJobBlobStore().putBuffer(decoded.body, {
    contentType: decoded.contentType,
    compress: false,
  });
}

async function persistDataUriAsync(value: string, mediaType: string): Promise<TurnJobBlobDescriptor | null> {
  const parsed = parseDataUriHeader(value, mediaType);
  if (!parsed) return null;
  return getTurnJobBlobStore().putChunkStreamAsync(decodeDataUriChunks(value, parsed.payloadStart), {
    contentType: parsed.contentType,
    compress: false,
  });
}

/**
 * Persist content removed from a bounded client frame. Media data URIs return a
 * same-origin URL so existing image/video fields remain directly renderable;
 * text and raw values use their immutable internal content reference.
 */
export function createTurnDeliveryReference(candidate: DeliveryReferenceCandidate): string | null {
  const store = getTurnJobBlobStore();
  if (candidate.kind === 'base64' && typeof candidate.value === 'string' && candidate.mediaType) {
    const descriptor = persistDataUri(candidate.value, candidate.mediaType);
    if (!descriptor) return null;
    return isSafeInlineTurnBlobContentType(descriptor.contentType)
      ? createSignedTurnBlobUrl(descriptor.hash)
      : descriptor.ref;
  }
  if (Buffer.isBuffer(candidate.value)) {
    return store.putBuffer(candidate.value, {
      contentType: candidate.mediaType || 'application/octet-stream',
      compress: false,
    }).ref;
  }
  return store.putText(String(candidate.value || '')).ref;
}

/** Persist a delivery replacement without blocking the gateway event loop. */
export async function createTurnDeliveryReferenceAsync(candidate: DeliveryReferenceCandidate): Promise<string | null> {
  const store = getTurnJobBlobStore();
  if (candidate.kind === 'base64' && typeof candidate.value === 'string' && candidate.mediaType) {
    const descriptor = await persistDataUriAsync(candidate.value, candidate.mediaType);
    if (!descriptor) return null;
    return isSafeInlineTurnBlobContentType(descriptor.contentType)
      ? createSignedTurnBlobUrl(descriptor.hash)
      : descriptor.ref;
  }
  if (Buffer.isBuffer(candidate.value)) {
    return (await store.putBufferAsync(candidate.value, {
      contentType: candidate.mediaType || 'application/octet-stream',
      compress: false,
    })).ref;
  }
  return (await store.putTextAsync(String(candidate.value || ''))).ref;
}

function expectedDeliveryReference(candidate: DeliveryReferenceCandidate): string | null {
  if (candidate.kind === 'base64' && typeof candidate.value === 'string' && candidate.mediaType) {
    const decoded = decodeDataUri(candidate.value, candidate.mediaType);
    if (!decoded) return null;
    const hash = crypto.createHash('sha256').update(decoded.body).digest('hex');
    return isSafeInlineTurnBlobContentType(decoded.contentType)
      ? createSignedTurnBlobUrl(hash)
      : turnBlobRefForHash(hash);
  }
  return turnBlobRefForHash(candidate.sha256);
}

/**
 * Stream replay must never perform a new large synchronous write. It may reuse
 * a reference already made durable by final persistence; otherwise bounding
 * falls back to its normal preview/omission marker.
 */
export function reuseExistingTurnDeliveryReference(candidate: DeliveryReferenceCandidate): string | null {
  if (
    candidate.kind === 'base64'
    && typeof candidate.value === 'string'
    && candidate.value.length > MAX_SYNC_REUSE_DATA_URI_CODE_UNITS
  ) {
    // Progress and live-stream hooks are synchronous. They may only reuse a
    // media ref when deriving its decoded hash is itself bounded.
    return null;
  }
  const expected = expectedDeliveryReference(candidate);
  if (!expected) return null;
  const ref = expected.startsWith('/')
    ? turnBlobRefForHash(new URL(expected, 'http://prometheus.local').pathname.split('/').pop() || '')
    : expected;
  try {
    return getTurnJobBlobStore().has(ref) ? expected : null;
  } catch {
    return null;
  }
}
