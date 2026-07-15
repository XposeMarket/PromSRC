import fs from 'fs';
import path from 'path';
import {
  estimateTextTokensForModel,
  type TokenizerFamily,
} from '../context/model-context.js';

export interface StoredThreadFootprint {
  visibleChatTokens: number;
  processEntryTokens: number;
  legacyToolLogTokens: number;
  attachmentMetadataTokens: number;
  sessionJsonTokens: number;
  toolObservationStoredTokens: number;
  rawToolResultTokens: number;
  rawToolResultBytes: number;
  rawToolResultFiles: number;
  fullStoredThreadTokens: number;
}

export interface StoredThreadFootprintInput {
  sessionId: string;
  session: any;
  configDir: string;
  tokenizer: TokenizerFamily;
}

export function safeFootprintSessionFileName(sessionId: string): string {
  return String(sessionId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

function estimateJsonTokens(value: unknown, tokenizer: TokenizerFamily): number {
  try {
    return estimateTextTokensForModel(JSON.stringify(value || null), tokenizer);
  } catch {
    return estimateTextTokensForModel(String(value || ''), tokenizer);
  }
}

function readStoredObservations(configDir: string, sessionId: string): any[] {
  const filePath = path.join(configDir, 'tool-observations', `${safeFootprintSessionFileName(sessionId)}.jsonl`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const maxBytes = 32 * 1024 * 1024;
    const size = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - size);
    const buffer = Buffer.allocUnsafe(size);
    const bytesRead = fs.readSync(fd, buffer, 0, size, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift();
    const boundedLines = lines.filter(Boolean).slice(-100_000);
    const out: any[] = [];
    for (const line of boundedLines) {
      if (Buffer.byteLength(line, 'utf8') > 256 * 1024) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out;
  } catch {
    return [];
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
}

function estimateRawObservationFootprint(
  configDir: string,
  sessionId: string,
  tokenizer: TokenizerFamily,
): { tokens: number; bytes: number; files: number } {
  let tokens = 0;
  let bytes = 0;
  let files = 0;
  const dir = path.join(configDir, 'tool-observations', 'raw', safeFootprintSessionFileName(sessionId));
  try {
    if (!fs.existsSync(dir)) return { tokens, bytes, files };
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;
      files += 1;
      bytes += stat.size;
      if (stat.size > 32 * 1024 * 1024) {
        tokens += Math.ceil(stat.size / 3.5);
        continue;
      }
      try {
        tokens += estimateTextTokensForModel(fs.readFileSync(full, 'utf8'), tokenizer);
      } catch {
        tokens += Math.ceil(stat.size / 3.5);
      }
    }
  } catch {}
  return { tokens, bytes, files };
}

/** CPU/filesystem-heavy diagnostic calculation. Run this only in its child. */
export function calculateStoredThreadFootprint(input: StoredThreadFootprintInput): StoredThreadFootprint {
  const history = Array.isArray(input.session?.history) ? input.session.history : [];
  let visibleChatTokens = 0;
  let processEntryTokens = 0;
  let legacyToolLogTokens = 0;
  let attachmentMetadataTokens = 0;
  for (const message of history) {
    visibleChatTokens += estimateTextTokensForModel(message?.content || '', input.tokenizer);
    if (Array.isArray(message?.processEntries)) processEntryTokens += estimateJsonTokens(message.processEntries, input.tokenizer);
    if (message?.toolLog) legacyToolLogTokens += estimateTextTokensForModel(message.toolLog, input.tokenizer);
    attachmentMetadataTokens += estimateJsonTokens({
      artifacts: message?.artifacts,
      generatedImages: message?.generatedImages,
      generatedVideos: message?.generatedVideos,
      attachmentPreviews: message?.attachmentPreviews,
      canvasFiles: message?.canvasFiles,
      fileChanges: message?.fileChanges,
      productCarousel: message?.productCarousel,
      richArtifacts: message?.richArtifacts,
    }, input.tokenizer);
  }
  const sessionJsonTokens = estimateJsonTokens(input.session, input.tokenizer);
  const observations = readStoredObservations(input.configDir, input.sessionId);
  const toolObservationStoredTokens = estimateJsonTokens(observations, input.tokenizer);
  const raw = estimateRawObservationFootprint(input.configDir, input.sessionId, input.tokenizer);
  return {
    visibleChatTokens,
    processEntryTokens,
    legacyToolLogTokens,
    attachmentMetadataTokens,
    sessionJsonTokens,
    toolObservationStoredTokens,
    rawToolResultTokens: raw.tokens,
    rawToolResultBytes: raw.bytes,
    rawToolResultFiles: raw.files,
    fullStoredThreadTokens: sessionJsonTokens + toolObservationStoredTokens + raw.tokens,
  };
}
