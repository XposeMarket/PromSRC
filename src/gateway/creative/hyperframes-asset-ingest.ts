/**
 * Fetches HyperFrames asset URLs, hashes their bytes, and registers them in
 * the Prometheus creative asset index. The index already dedupes by content
 * hash (assets.ts:upsertCreativeAssetRecord), so re-importing the same
 * HyperFrames block N times produces a single asset record.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import {
  type CreativeAssetStorage,
  type CreativeAssetRecord,
  type CreativeAssetKind,
  getCreativeAssetsDir,
  guessCreativeAssetMimeType,
  inferCreativeAssetKind,
  readCreativeAssetIndex,
  upsertCreativeAssetRecord,
} from './assets';

export type HyperframesAssetIngestInput = {
  placeholderId: string;
  remoteUrl: string;
  fileName: string;
};

export type HyperframesAssetIngestResult = {
  placeholderId: string;
  registryId: string;
  hash: string;
  bytes: number;
  reused: boolean;
  absPath: string;
  relativePath: string | null;
  kind: CreativeAssetKind;
};

function fetchBuffer(url: string, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects fetching ${url}`));
      return;
    }
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchBuffer(next, redirects + 1).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`GET ${url} failed with status ${res.statusCode || 'unknown'}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sanitizeFilename(name: string): string {
  return String(name || 'asset')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'asset';
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function ingestHyperframesAsset(
  storage: CreativeAssetStorage,
  input: HyperframesAssetIngestInput,
): Promise<HyperframesAssetIngestResult> {
  const buffer = await fetchBuffer(input.remoteUrl);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  const index = readCreativeAssetIndex(storage);
  const existing = index.assets.find((asset) => asset.hash === hash);
  if (existing && existing.absPath && fs.existsSync(existing.absPath)) {
    return {
      placeholderId: input.placeholderId,
      registryId: existing.id,
      hash,
      bytes: buffer.length,
      reused: true,
      absPath: existing.absPath,
      relativePath: existing.relativePath,
      kind: existing.kind,
    };
  }

  const assetsDir = getCreativeAssetsDir(storage);
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  const safeName = sanitizeFilename(input.fileName);
  const ext = path.extname(safeName) || '';
  const baseName = path.basename(safeName, ext);
  const fileName = `${baseName}-${hash.slice(0, 12)}${ext}`;
  const absPath = path.join(assetsDir, fileName);
  fs.writeFileSync(absPath, buffer);

  const mimeType = guessCreativeAssetMimeType(absPath);
  const kind = inferCreativeAssetKind(absPath, mimeType);
  const relativePath = path.relative(storage.rootAbsPath, absPath).replace(/\\/g, '/');
  const record: CreativeAssetRecord = {
    id: `hyperframes-${input.placeholderId}-${hash.slice(0, 8)}`,
    kind,
    name: input.fileName,
    ext: ext.replace(/^\./, ''),
    source: input.remoteUrl,
    sourceType: 'remote',
    path: relativePath,
    relativePath,
    absPath,
    mimeType,
    size: buffer.length,
    hash,
    width: null,
    height: null,
    durationMs: null,
    frameRate: null,
    codec: null,
    hasAlpha: null,
    dominantColors: [],
    tags: ['hyperframes', 'imported'],
    brandId: null,
    license: null,
    thumbnailPath: null,
    thumbnailAbsPath: null,
    contactSheetPath: null,
    contactSheetAbsPath: null,
    metadata: { hyperframesPlaceholderId: input.placeholderId },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    analyzedAt: null,
  };
  const stored = upsertCreativeAssetRecord(storage, record);
  return {
    placeholderId: input.placeholderId,
    registryId: stored.id,
    hash,
    bytes: buffer.length,
    reused: false,
    absPath,
    relativePath,
    kind,
  };
}

export async function ingestHyperframesAssets(
  storage: CreativeAssetStorage,
  inputs: HyperframesAssetIngestInput[],
): Promise<{ results: HyperframesAssetIngestResult[]; failed: Array<{ placeholderId: string; error: string }> }> {
  const results: HyperframesAssetIngestResult[] = [];
  const failed: Array<{ placeholderId: string; error: string }> = [];
  for (const input of inputs) {
    try {
      results.push(await ingestHyperframesAsset(storage, input));
    } catch (err: any) {
      failed.push({ placeholderId: input.placeholderId, error: err?.message || String(err) });
    }
  }
  return { results, failed };
}
