// src/integrations/public-media-share.ts
// Short-lived, unguessable public URLs for local media files.
//
// Official publishing APIs (Instagram Content Publishing, Threads, LinkedIn
// pull-from-URL style flows) download media from a public URL instead of
// accepting an upload. We expose exactly one file per random 32-byte token on
// the gateway's public origin (Tailscale Funnel), for a bounded time, then
// forget it. Nothing else in the workspace becomes reachable.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { gatewayPublicOrigin } from './gateway-oauth-callback.js';

export const PUBLIC_MEDIA_PREFIX = '/public-media/';
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_TTL_MS = 6 * 60 * 60 * 1000;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm',
};

interface Share { filePath: string; fileName: string; mime: string; expiresAt: number }
const shares = new Map<string, Share>();

function sweep(now = Date.now()): void {
  for (const [token, share] of shares) if (share.expiresAt <= now) shares.delete(token);
}

export function mimeForFile(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/** Register a local file and return its public URL. Throws when no public origin is configured. */
export function sharePublicMedia(filePath: string, ttlMs = DEFAULT_TTL_MS): { url: string; token: string; expiresAt: number } {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
  const mime = mimeForFile(resolved);
  if (mime === 'application/octet-stream') throw new Error(`Unsupported media type: ${path.extname(resolved) || '(none)'}`);
  const origin = gatewayPublicOrigin();
  if (!origin) {
    throw new Error('No public HTTPS URL is configured for this gateway. Enable Remote Access (Tailscale Funnel) in Settings so the provider can fetch the media, or pass a public media URL instead.');
  }
  sweep();
  const token = crypto.randomBytes(32).toString('base64url');
  const fileName = path.basename(resolved).replace(/[^A-Za-z0-9._-]/g, '_') || 'media';
  const expiresAt = Date.now() + Math.min(Math.max(ttlMs, 60_000), MAX_TTL_MS);
  shares.set(token, { filePath: resolved, fileName, mime, expiresAt });
  return { url: `${origin}${PUBLIC_MEDIA_PREFIX}${token}/${encodeURIComponent(fileName)}`, token, expiresAt };
}

export function revokePublicMedia(token: string): void {
  shares.delete(token);
}

export function resolvePublicMedia(token: string): Share | null {
  sweep();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return shares.get(token) || null;
}
