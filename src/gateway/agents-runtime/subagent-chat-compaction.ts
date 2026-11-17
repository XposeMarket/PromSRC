/**
 * Storage compaction for agent chat messages (agent-chats/<agentId>.json).
 *
 * Nov 16 2026: Reel's chat file reached 131 MB with only 71 messages because
 * each team-task reply stored the run's full live trace twice (top level and
 * metadata), including inline base64 screenshots (~500 KB each, up to 12 MB
 * per message). Reading 20 messages took 62 s, returned 73 MB and blocked the
 * gateway. This module keeps the trace (the UI renders it) but:
 *   - moves inline data:image URLs to files in <configDir>/cache/images and
 *     replaces them with the existing generated-image-preview route URL, so
 *     the thumbnail still renders;
 *   - caps very long strings, deep nesting and array lengths.
 * It is idempotent and cheap on entries that are already small.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';

export const AGENT_TRACE_MAX_ENTRIES = 320;
// Trace rows render as one-line activity items; tool results are already cut to
// 500 chars by durable-chat-trace. 1,500 keeps args/previews readable.
export const AGENT_TRACE_MAX_STRING_CHARS = 1_500;
export const AGENT_TRACE_INLINE_IMAGE_MIN_CHARS = 2_048;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 200;
const PREVIEW_ROUTE = '/api/canvas/generated-image-preview';

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Returns a URL that serves the image, or null when it cannot be stored. */
export type InlineImageExternalizer = (dataUrl: string) => string | null;

export function agentTraceImageCacheDir(): string {
  return path.join(getConfig().getConfigDir(), 'cache', 'images');
}

export function externalizeInlineImage(dataUrl: string, dir = agentTraceImageCacheDir()): string | null {
  try {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl);
    if (!match) return null;
    const ext = IMAGE_EXT[match[1].toLowerCase()];
    if (!ext) return null;
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length) return null;
    const name = `agent-trace-${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, file);
    }
    return `${PREVIEW_ROUTE}?cache=${encodeURIComponent(name)}`;
  } catch {
    return null;
  }
}

function compactString(value: string, externalize: InlineImageExternalizer): string {
  if (value.length >= AGENT_TRACE_INLINE_IMAGE_MIN_CHARS && /^data:/i.test(value)) {
    if (/^data:image\//i.test(value)) return externalize(value) || '[inline image omitted]';
    return '[inline data omitted]';
  }
  if (value.length > AGENT_TRACE_MAX_STRING_CHARS) {
    return `${value.slice(0, AGENT_TRACE_MAX_STRING_CHARS)}… [truncated ${value.length - AGENT_TRACE_MAX_STRING_CHARS} chars]`;
  }
  return value;
}

export function compactTraceValue(value: unknown, externalize: InlineImageExternalizer, depth = 0): unknown {
  if (typeof value === 'string') return compactString(value, externalize);
  if (!value || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[nested list omitted]' : '[nested object omitted]';
  if (Array.isArray(value)) {
    const kept = value.length > MAX_ARRAY_ITEMS ? value.slice(-MAX_ARRAY_ITEMS) : value;
    return kept.map((item) => compactTraceValue(item, externalize, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // Raw binary carriers have no UI use once the preview URL exists.
    if ((key === 'base64' || key === 'buffer' || key === 'bytes' || key === 'raw')
      && typeof item === 'string' && item.length >= AGENT_TRACE_INLINE_IMAGE_MIN_CHARS) {
      out.previewTruncated = true;
      continue;
    }
    out[key] = compactTraceValue(item, externalize, depth + 1);
  }
  return out;
}

export function compactTraceEntries(
  entries: unknown,
  externalize: InlineImageExternalizer = externalizeInlineImage,
): Array<Record<string, any>> | undefined {
  if (!Array.isArray(entries)) return undefined;
  return entries
    .slice(-AGENT_TRACE_MAX_ENTRIES)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => compactTraceValue(entry, externalize) as Record<string, any>);
}
