import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import type { ToolResult } from './tool-builder';

export const GATEWAY_TOOL_RESULT_INLINE_MAX_CHARS = 64 * 1024;
const TOOL_RESULT_HEAD_CHARS = 42 * 1024;
const TOOL_RESULT_TAIL_CHARS = 14 * 1024;
const RAW_REF_PREFIX = 'tool-result-raw:';

export interface ToolResultEnvelopeMetadata {
  bounded: true;
  originalChars: number;
  originalBytes: number;
  sha256: string;
  rawRef?: string;
  rawPersistence: 'stored' | 'failed';
  previewChars: number;
}

function safeSegment(value: unknown, fallback: string): string {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || fallback;
}

function sessionStorageKey(sessionId: string): string {
  const value = String(sessionId || 'unknown');
  const prefix = safeSegment(value, 'unknown').slice(0, 64);
  const identityHash = crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
  return `${prefix}-${identityHash}`;
}

function rawResultRoot(): string {
  return path.join(getConfig().getConfigDir(), 'tool-results', 'raw');
}

function rawResultPath(sessionId: string, sha256: string): string {
  return path.join(rawResultRoot(), sessionId, `${sha256}.txt`);
}

function scrubSensitivePreview(text: string): string {
  return String(text || '')
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1***')
    .replace(/(["']?(?:password|token|secret|api[_-]?key|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?)[^"'\r\n,;}\s]+/gi, '$1***')
    .replace(/([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&#\s]+/gi, '$1***');
}

function buildBoundedPreview(text: string, metadata: Omit<ToolResultEnvelopeMetadata, 'previewChars'>): string {
  const head = scrubSensitivePreview(text.slice(0, TOOL_RESULT_HEAD_CHARS)).trimEnd();
  const tail = scrubSensitivePreview(text.slice(-TOOL_RESULT_TAIL_CHARS)).trimStart();
  const omitted = Math.max(0, text.length - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS);
  return [
    head,
    '',
    `[TOOL_RESULT_BOUNDED] ${omitted.toLocaleString('en-US')} chars omitted from gateway memory.${metadata.rawRef ? ' Full output is stored out-of-band.' : ''}`,
    metadata.rawRef
      ? `raw_ref=${metadata.rawRef}`
      : 'raw_ref=unavailable (raw persistence failed; the bounded preview remains valid)',
    `sha256=${metadata.sha256} original_chars=${metadata.originalChars} original_bytes=${metadata.originalBytes}`,
    metadata.rawRef
      ? 'Use tool_result_read with this raw reference only when the exact omitted payload is required.'
      : 'The omitted content cannot be recovered from this result; rerun the source tool with narrower filters if exact content is required.',
    '',
    tail,
  ].join('\n');
}

async function persistRawResult(sessionId: string, sha256: string, text: string): Promise<string> {
  const safeSession = sessionStorageKey(sessionId);
  const target = rawResultPath(safeSession, sha256);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.promises.access(target, fs.constants.R_OK);
    return `${RAW_REF_PREFIX}${safeSession}/${sha256}.txt`;
  } catch {}

  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.promises.open(temporary, 'wx');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.promises.rename(temporary, target);
    } catch (error: any) {
      try {
        await fs.promises.access(target, fs.constants.R_OK);
      } catch {
        throw error;
      }
      await fs.promises.unlink(temporary).catch(() => {});
    }
  } catch (error: any) {
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
  return `${RAW_REF_PREFIX}${safeSession}/${sha256}.txt`;
}

export async function envelopeOversizedToolResult(
  toolResult: ToolResult,
  options: { sessionId: string; toolName?: string; maxChars?: number },
): Promise<ToolResult> {
  const text = String(toolResult?.result || '');
  const maxChars = Math.max(16 * 1024, Math.floor(Number(options.maxChars) || GATEWAY_TOOL_RESULT_INLINE_MAX_CHARS));
  const toolName = String(options.toolName || toolResult?.name || '').trim();

  // A skill is not considered loaded if its entrypoint is clipped. Skill bundles
  // already use progressive resource reads, so keep the selected entrypoint intact.
  if (toolName === 'skill_read' || text.length <= maxChars) return toolResult;

  const originalBytes = Buffer.byteLength(text, 'utf8');
  const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  let rawRef: string | undefined;
  try {
    rawRef = await persistRawResult(options.sessionId, sha256, text);
  } catch (error: any) {
    console.warn(`[tool-result-envelope] Raw persistence failed for ${toolName || 'tool'}; retaining bounded preview: ${String(error?.message || error)}`);
  }
  const baseMetadata = {
    bounded: true as const,
    originalChars: text.length,
    originalBytes,
    sha256,
    rawRef,
    rawPersistence: rawRef ? 'stored' as const : 'failed' as const,
  };
  const preview = buildBoundedPreview(text, baseMetadata);
  const metadata: ToolResultEnvelopeMetadata = {
    ...baseMetadata,
    previewChars: preview.length,
  };

  return {
    ...toolResult,
    result: preview,
    extra: {
      ...(toolResult.extra || {}),
      toolResultEnvelope: metadata,
    },
  };
}

export async function readRawToolResult(rawRef: string): Promise<string> {
  const value = String(rawRef || '').trim();
  if (!value.startsWith(RAW_REF_PREFIX)) throw new Error('Unsupported tool-result raw reference.');
  const relative = value.slice(RAW_REF_PREFIX.length).replace(/\\/g, '/');
  const match = /^([a-zA-Z0-9._-]{1,96})\/([a-f0-9]{64})\.txt$/.exec(relative);
  if (!match) throw new Error('Invalid tool-result raw reference.');
  const target = rawResultPath(match[1], match[2]);
  const root = path.resolve(rawResultRoot());
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Tool-result raw reference escaped its storage root.');
  }
  return fs.promises.readFile(resolved, 'utf8');
}

export async function readRawToolResultRange(input: {
  rawRef: string;
  sessionId: string;
  offsetBytes?: number;
  maxChars?: number;
}): Promise<{
  rawRef: string;
  offsetBytes: number;
  nextOffsetBytes: number | null;
  maxChars: number;
  totalBytes: number;
  content: string;
}> {
  const value = String(input.rawRef || '').trim();
  if (!value.startsWith(RAW_REF_PREFIX)) throw new Error('Unsupported tool-result raw reference.');
  const relative = value.slice(RAW_REF_PREFIX.length).replace(/\\/g, '/');
  const match = /^([a-zA-Z0-9._-]{1,96})\/([a-f0-9]{64})\.txt$/.exec(relative);
  if (!match) throw new Error('Invalid tool-result raw reference.');
  if (match[1] !== sessionStorageKey(input.sessionId)) {
    throw new Error('Tool-result raw reference does not belong to the current session.');
  }

  const target = rawResultPath(match[1], match[2]);
  const root = path.resolve(rawResultRoot());
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Tool-result raw reference escaped its storage root.');
  }

  const stat = await fs.promises.stat(resolved);
  const offsetBytes = Math.max(0, Math.min(stat.size, Math.floor(Number(input.offsetBytes) || 0)));
  const maxChars = Math.max(256, Math.min(16_000, Math.floor(Number(input.maxChars) || 8_000)));
  const maxReadBytes = Math.min(stat.size - offsetBytes, maxChars * 4);
  const buffer = Buffer.alloc(Math.max(0, maxReadBytes));
  const handle = await fs.promises.open(resolved, 'r');
  let bytesRead = 0;
  try {
    if (buffer.length > 0) {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.length, offsetBytes));
    }
  } finally {
    await handle.close();
  }
  const decoded = buffer.subarray(0, bytesRead).toString('utf8');
  const content = decoded.slice(0, maxChars);
  const consumedBytes = Buffer.byteLength(content, 'utf8');
  const nextOffsetBytes = offsetBytes + consumedBytes < stat.size ? offsetBytes + consumedBytes : null;
  return { rawRef: value, offsetBytes, nextOffsetBytes, maxChars, totalBytes: stat.size, content };
}
