import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type CreativeAssetStorage = {
  workspacePath: string;
  rootAbsPath: string;
  rootRelPath?: string;
  creativeDir: string;
};

export type CreativeAssetKind = 'image' | 'video' | 'audio' | 'lottie' | 'svg' | 'model' | 'document' | 'other' | 'remote';

export type CreativeAssetRecord = {
  id: string;
  kind: CreativeAssetKind;
  name: string;
  ext: string;
  source: string;
  sourceType: 'workspace' | 'absolute' | 'remote' | 'generated' | 'unknown';
  path: string | null;
  relativePath: string | null;
  absPath: string | null;
  mimeType: string;
  size: number | null;
  hash: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  frameRate: number | null;
  codec: string | null;
  hasAlpha: boolean | null;
  dominantColors: string[];
  tags: string[];
  brandId: string | null;
  license: Record<string, any> | null;
  thumbnailPath: string | null;
  thumbnailAbsPath: string | null;
  contactSheetPath: string | null;
  contactSheetAbsPath: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  analyzedAt: string | null;
};

export type CreativeAssetIndex = {
  kind: 'prometheus-creative-asset-index';
  version: number;
  updatedAt: string;
  assets: CreativeAssetRecord[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function isRemoteSource(source: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(String(source || '').trim());
}

function sanitizeSegment(raw: string, fallback = 'asset'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
    .replace(/^[/\\]+/, '')
    .replace(/\s+/g, '-')
    .slice(0, 120);
  return cleaned || fallback;
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = path.resolve(String(basePath || ''));
  const target = path.resolve(String(targetPath || ''));
  const rel = path.relative(base, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function buildRelativePath(basePath: string, absPath: string): string | null {
  const rel = path.relative(basePath, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
}

export function getCreativeAssetsDir(storage: CreativeAssetStorage): string {
  const dir = path.join(storage.creativeDir, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'library'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
  return dir;
}

export function getCreativeAssetIndexPath(storage: CreativeAssetStorage): string {
  return path.join(getCreativeAssetsDir(storage), 'index.json');
}

export function guessCreativeAssetMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.mp4':
    case '.m4v': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.avi': return 'video/x-msvideo';
    case '.mkv': return 'video/x-matroska';
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    case '.m4a': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.ogg': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.json': return 'application/json';
    case '.glb': return 'model/gltf-binary';
    case '.gltf': return 'model/gltf+json';
    case '.pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

export function inferCreativeAssetKind(source: string, mimeType = ''): CreativeAssetKind {
  if (isRemoteSource(source)) return 'remote';
  const ext = path.extname(source).toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('svg') || ext === '.svg') return 'svg';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('model/') || ext === '.glb' || ext === '.gltf') return 'model';
  if (ext === '.json') return 'lottie';
  if (mime === 'application/pdf' || ext === '.pdf') return 'document';
  return 'other';
}

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function hashFile(absPath: string): string | null {
  try {
    return hashBuffer(fs.readFileSync(absPath));
  } catch {
    return null;
  }
}

function assetIdFor(source: string, hash: string | null): string {
  const digest = hash || crypto.createHash('sha1').update(String(source || '')).digest('hex');
  return `asset_${digest.slice(0, 16)}`;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readGifDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10) return null;
  const sig = buffer.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function readSvgDimensions(text: string): { width: number | null; height: number | null } {
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0] || '';
  const widthMatch = svgTag.match(/\bwidth=(["'])([\d.]+)(?:px)?\1/i);
  const heightMatch = svgTag.match(/\bheight=(["'])([\d.]+)(?:px)?\1/i);
  const viewBoxMatch = svgTag.match(/\bviewBox=(["'])([-\d.\s]+)\1/i);
  const width = widthMatch ? Number(widthMatch[2]) : null;
  const height = heightMatch ? Number(heightMatch[2]) : null;
  if ((width && height) || !viewBoxMatch) return { width: width || null, height: height || null };
  const parts = viewBoxMatch[2].trim().split(/\s+/).map(Number);
  return {
    width: Number.isFinite(parts[2]) ? parts[2] : null,
    height: Number.isFinite(parts[3]) ? parts[3] : null,
  };
}

function readImageDimensions(absPath: string, mimeType: string): { width: number | null; height: number | null; hasAlpha: boolean | null } {
  try {
    if (mimeType === 'image/svg+xml') {
      const dims = readSvgDimensions(fs.readFileSync(absPath, 'utf-8'));
      return { ...dims, hasAlpha: true };
    }
    const buffer = fs.readFileSync(absPath);
    const dims = readPngDimensions(buffer) || readGifDimensions(buffer) || readJpegDimensions(buffer);
    const hasAlpha = mimeType === 'image/png' ? true : (mimeType === 'image/gif' || mimeType === 'image/webp' ? null : false);
    return { width: dims?.width || null, height: dims?.height || null, hasAlpha };
  } catch {
    return { width: null, height: null, hasAlpha: null };
  }
}

async function probeMedia(absPath: string): Promise<Record<string, any> | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      absPath,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
    return JSON.parse(String(stdout || '{}'));
  } catch {
    return null;
  }
}

function parseFrameRate(raw: any): number | null {
  const value = String(raw || '').trim();
  const match = value.match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  const top = Number(match[1]);
  const bottom = match[2] ? Number(match[2]) : 1;
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null;
  return Math.round((top / bottom) * 1000) / 1000;
}

async function createVideoThumbnail(storage: CreativeAssetStorage, absPath: string, id: string): Promise<{ thumbnailAbsPath: string | null; thumbnailPath: string | null }> {
  const thumbDir = path.join(getCreativeAssetsDir(storage), 'thumbs');
  const thumbnailAbsPath = path.join(thumbDir, `${id}.jpg`);
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', '00:00:00.500',
      '-i', absPath,
      '-frames:v', '1',
      '-vf', 'scale=480:-1',
      thumbnailAbsPath,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 * 4 });
    return {
      thumbnailAbsPath,
      thumbnailPath: buildRelativePath(storage.workspacePath, thumbnailAbsPath),
    };
  } catch {
    return { thumbnailAbsPath: null, thumbnailPath: null };
  }
}

function parseGltfJson(absPath: string): Record<string, any> | null {
  try {
    const ext = path.extname(absPath).toLowerCase();
    if (ext === '.gltf') return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    if (ext !== '.glb') return null;
    const buffer = fs.readFileSync(absPath);
    if (buffer.length < 20 || buffer.toString('utf-8', 0, 4) !== 'glTF') return null;
    const jsonLength = buffer.readUInt32LE(12);
    const chunkType = buffer.toString('utf-8', 16, 20);
    if (chunkType !== 'JSON' || jsonLength <= 0 || 20 + jsonLength > buffer.length) return null;
    return JSON.parse(buffer.toString('utf-8', 20, 20 + jsonLength).trim());
  } catch {
    return null;
  }
}

function analyzeModelAsset(absPath: string): Record<string, any> {
  const parsed = parseGltfJson(absPath);
  if (!parsed) {
    return {
      format: path.extname(absPath).toLowerCase().replace(/^\./, '') || 'model',
      parseError: 'Could not parse GLTF/GLB metadata.',
    };
  }
  let bounds: { min: number[]; max: number[]; size: number[]; maxDimension: number } | null = null;
  const accessors = Array.isArray(parsed.accessors) ? parsed.accessors : [];
  for (const accessor of accessors) {
    if (!Array.isArray(accessor?.min) || !Array.isArray(accessor?.max) || accessor.min.length < 3 || accessor.max.length < 3) continue;
    const min = accessor.min.slice(0, 3).map((value: any) => Number(value)).filter(Number.isFinite);
    const max = accessor.max.slice(0, 3).map((value: any) => Number(value)).filter(Number.isFinite);
    if (min.length !== 3 || max.length !== 3) continue;
    if (!bounds) {
      const size = max.map((value: number, index: number) => value - min[index]);
      bounds = { min, max, size, maxDimension: Math.max(...size.map(Math.abs)) };
    } else {
      bounds.min = bounds.min.map((value: number, index: number) => Math.min(value, min[index]));
      bounds.max = bounds.max.map((value: number, index: number) => Math.max(value, max[index]));
      bounds.size = bounds.max.map((value, index) => value - bounds!.min[index]);
      bounds.maxDimension = Math.max(...bounds.size.map(Math.abs));
    }
  }
  return {
    format: path.extname(absPath).toLowerCase() === '.glb' ? 'glb' : 'gltf',
    assetVersion: parsed.asset?.version || null,
    generator: parsed.asset?.generator || null,
    sceneCount: Array.isArray(parsed.scenes) ? parsed.scenes.length : null,
    nodeCount: Array.isArray(parsed.nodes) ? parsed.nodes.length : null,
    meshCount: Array.isArray(parsed.meshes) ? parsed.meshes.length : null,
    materialCount: Array.isArray(parsed.materials) ? parsed.materials.length : null,
    textureCount: Array.isArray(parsed.textures) ? parsed.textures.length : null,
    imageCount: Array.isArray(parsed.images) ? parsed.images.length : null,
    animationCount: Array.isArray(parsed.animations) ? parsed.animations.length : null,
    extensionsUsed: Array.isArray(parsed.extensionsUsed) ? parsed.extensionsUsed.slice(0, 40) : [],
    bounds,
  };
}

function normalizeTags(input: any): string[] {
  const tags = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))].slice(0, 40);
}

export function readCreativeAssetIndex(storage: CreativeAssetStorage): CreativeAssetIndex {
  const indexPath = getCreativeAssetIndexPath(storage);
  if (!fs.existsSync(indexPath)) {
    return { kind: 'prometheus-creative-asset-index', version: 1, updatedAt: nowIso(), assets: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return {
      kind: 'prometheus-creative-asset-index',
      version: Math.max(1, Number(parsed?.version) || 1),
      updatedAt: String(parsed?.updatedAt || nowIso()),
      assets: Array.isArray(parsed?.assets) ? parsed.assets.map(normalizeCreativeAssetRecord).filter(Boolean) : [],
    };
  } catch {
    return { kind: 'prometheus-creative-asset-index', version: 1, updatedAt: nowIso(), assets: [] };
  }
}

export function writeCreativeAssetIndex(storage: CreativeAssetStorage, index: CreativeAssetIndex): CreativeAssetIndex {
  const normalized: CreativeAssetIndex = {
    kind: 'prometheus-creative-asset-index',
    version: Math.max(1, Number(index?.version) || 1),
    updatedAt: nowIso(),
    assets: Array.isArray(index?.assets) ? index.assets.map(normalizeCreativeAssetRecord).filter(Boolean) : [],
  };
  fs.writeFileSync(getCreativeAssetIndexPath(storage), JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

export function normalizeCreativeAssetRecord(input: any): CreativeAssetRecord {
  const now = nowIso();
  return {
    id: String(input?.id || assetIdFor(input?.source || input?.path || input?.absPath || now, input?.hash || null)),
    kind: (['image', 'video', 'audio', 'lottie', 'svg', 'model', 'document', 'other', 'remote'].includes(String(input?.kind || '')) ? input.kind : 'other') as CreativeAssetKind,
    name: String(input?.name || path.basename(String(input?.absPath || input?.path || input?.source || 'asset'))),
    ext: String(input?.ext || path.extname(String(input?.name || input?.source || '')).toLowerCase()),
    source: String(input?.source || input?.path || input?.absPath || ''),
    sourceType: (['workspace', 'absolute', 'remote', 'generated', 'unknown'].includes(String(input?.sourceType || '')) ? input.sourceType : 'unknown') as any,
    path: input?.path ? String(input.path) : null,
    relativePath: input?.relativePath ? String(input.relativePath) : null,
    absPath: input?.absPath ? String(input.absPath) : null,
    mimeType: String(input?.mimeType || 'application/octet-stream'),
    size: Number.isFinite(Number(input?.size)) ? Math.max(0, Number(input.size)) : null,
    hash: input?.hash ? String(input.hash) : null,
    width: Number.isFinite(Number(input?.width)) ? Math.max(0, Number(input.width)) : null,
    height: Number.isFinite(Number(input?.height)) ? Math.max(0, Number(input.height)) : null,
    durationMs: Number.isFinite(Number(input?.durationMs)) ? Math.max(0, Number(input.durationMs)) : null,
    frameRate: Number.isFinite(Number(input?.frameRate)) ? Math.max(0, Number(input.frameRate)) : null,
    codec: input?.codec ? String(input.codec) : null,
    hasAlpha: input?.hasAlpha === true ? true : (input?.hasAlpha === false ? false : null),
    dominantColors: Array.isArray(input?.dominantColors) ? input.dominantColors.map(String).filter(Boolean).slice(0, 12) : [],
    tags: normalizeTags(input?.tags),
    brandId: input?.brandId ? String(input.brandId) : null,
    license: input?.license && typeof input.license === 'object' && !Array.isArray(input.license) ? input.license : null,
    thumbnailPath: input?.thumbnailPath ? String(input.thumbnailPath) : null,
    thumbnailAbsPath: input?.thumbnailAbsPath ? String(input.thumbnailAbsPath) : null,
    contactSheetPath: input?.contactSheetPath ? String(input.contactSheetPath) : null,
    contactSheetAbsPath: input?.contactSheetAbsPath ? String(input.contactSheetAbsPath) : null,
    metadata: input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {},
    createdAt: String(input?.createdAt || now),
    updatedAt: String(input?.updatedAt || now),
    analyzedAt: input?.analyzedAt ? String(input.analyzedAt) : null,
  };
}

export function upsertCreativeAssetRecord(storage: CreativeAssetStorage, record: CreativeAssetRecord): CreativeAssetRecord {
  const index = readCreativeAssetIndex(storage);
  const normalized = normalizeCreativeAssetRecord({ ...record, updatedAt: nowIso() });
  const existingIndex = index.assets.findIndex((asset) => asset.id === normalized.id || (!!asset.hash && asset.hash === normalized.hash));
  if (existingIndex >= 0) {
    normalized.createdAt = index.assets[existingIndex].createdAt || normalized.createdAt;
    index.assets[existingIndex] = normalized;
  } else {
    index.assets.unshift(normalized);
  }
  writeCreativeAssetIndex(storage, index);
  return normalized;
}

export function resolveCreativeAssetPath(storage: CreativeAssetStorage, rawSource: string): {
  source: string;
  sourceType: CreativeAssetRecord['sourceType'];
  absPath: string | null;
  path: string | null;
  relativePath: string | null;
} {
  const source = String(rawSource || '').trim();
  if (!source) throw new Error('Creative asset source is required.');
  if (isRemoteSource(source)) {
    return { source, sourceType: 'remote', absPath: null, path: source, relativePath: null };
  }
  const candidates = path.isAbsolute(source)
    ? [path.resolve(source)]
    : [
        path.resolve(storage.rootAbsPath, source),
        path.resolve(storage.workspacePath, source),
      ];
  const absPath = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || candidates[0];
  if (!isPathInside(storage.workspacePath, absPath) && !isPathInside(storage.rootAbsPath, absPath)) {
    throw new Error('Creative asset source must stay inside the workspace or creative project root.');
  }
  return {
    source,
    sourceType: path.isAbsolute(source) ? 'absolute' : 'workspace',
    absPath,
    path: buildRelativePath(storage.workspacePath, absPath),
    relativePath: buildRelativePath(storage.rootAbsPath, absPath),
  };
}

export async function analyzeCreativeAsset(storage: CreativeAssetStorage, options: {
  source: string;
  tags?: any;
  brandId?: string | null;
  license?: Record<string, any> | null;
  force?: boolean;
  upsert?: boolean;
}): Promise<CreativeAssetRecord> {
  const resolved = resolveCreativeAssetPath(storage, options.source);
  const now = nowIso();
  if (resolved.sourceType === 'remote') {
    const record = normalizeCreativeAssetRecord({
      id: assetIdFor(resolved.source, null),
      kind: 'remote',
      name: resolved.source.split('/').pop() || 'remote-asset',
      ext: path.extname(resolved.source.split('?')[0] || '').toLowerCase(),
      source: resolved.source,
      sourceType: 'remote',
      path: resolved.path,
      mimeType: 'application/octet-stream',
      tags: options.tags,
      brandId: options.brandId || null,
      license: options.license || null,
      createdAt: now,
      updatedAt: now,
      analyzedAt: now,
      metadata: { remoteAnalysis: 'deferred' },
    });
    return options.upsert === false ? record : upsertCreativeAssetRecord(storage, record);
  }
  if (!resolved.absPath || !fs.existsSync(resolved.absPath) || !fs.statSync(resolved.absPath).isFile()) {
    throw new Error('Creative asset file not found.');
  }

  const stat = fs.statSync(resolved.absPath);
  const mimeType = guessCreativeAssetMimeType(resolved.absPath);
  const hash = hashFile(resolved.absPath);
  const id = assetIdFor(resolved.absPath, hash);
  const kind = inferCreativeAssetKind(resolved.absPath, mimeType);
  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let frameRate: number | null = null;
  let codec: string | null = null;
  let hasAlpha: boolean | null = null;
  let metadata: Record<string, any> = {};
  let thumbnailPath: string | null = null;
  let thumbnailAbsPath: string | null = null;

  if (kind === 'image' || kind === 'svg') {
    const image = readImageDimensions(resolved.absPath, mimeType);
    width = image.width;
    height = image.height;
    hasAlpha = image.hasAlpha;
    thumbnailPath = resolved.path;
    thumbnailAbsPath = resolved.absPath;
  }

  if (kind === 'video' || kind === 'audio') {
    const probed = await probeMedia(resolved.absPath);
    metadata = probed || {};
    const streams = Array.isArray(probed?.streams) ? probed.streams : [];
    const stream = streams.find((entry: any) => String(entry?.codec_type || '').toLowerCase() === (kind === 'video' ? 'video' : 'audio')) || streams[0];
    const durationSeconds = Number(stream?.duration ?? probed?.format?.duration);
    durationMs = Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 1000)) : null;
    width = Number.isFinite(Number(stream?.width)) ? Number(stream.width) : null;
    height = Number.isFinite(Number(stream?.height)) ? Number(stream.height) : null;
    frameRate = parseFrameRate(stream?.avg_frame_rate || stream?.r_frame_rate);
    codec = stream?.codec_name ? String(stream.codec_name) : null;
    hasAlpha = /yuva|rgba|argb|bgra/i.test(String(stream?.pix_fmt || '')) ? true : null;
    if (kind === 'video') {
      const thumb = await createVideoThumbnail(storage, resolved.absPath, id);
      thumbnailPath = thumb.thumbnailPath;
      thumbnailAbsPath = thumb.thumbnailAbsPath;
    }
  }

  if (kind === 'lottie') {
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved.absPath, 'utf-8'));
      width = Number.isFinite(Number(parsed?.w)) ? Number(parsed.w) : null;
      height = Number.isFinite(Number(parsed?.h)) ? Number(parsed.h) : null;
      frameRate = Number.isFinite(Number(parsed?.fr)) ? Number(parsed.fr) : null;
      const ip = Number(parsed?.ip);
      const op = Number(parsed?.op);
      if (Number.isFinite(ip) && Number.isFinite(op) && frameRate) {
        durationMs = Math.max(0, Math.round(((op - ip) / frameRate) * 1000));
      }
      metadata = { lottie: { version: parsed?.v || null, layers: Array.isArray(parsed?.layers) ? parsed.layers.length : null } };
    } catch (err: any) {
      metadata = { parseError: String(err?.message || 'Could not parse Lottie JSON') };
    }
  }

  if (kind === 'model') {
    metadata = { model: analyzeModelAsset(resolved.absPath) };
  }

  const record = normalizeCreativeAssetRecord({
    id,
    kind,
    name: path.basename(resolved.absPath),
    ext: path.extname(resolved.absPath).toLowerCase(),
    source: resolved.source,
    sourceType: resolved.sourceType,
    path: resolved.path,
    relativePath: resolved.relativePath,
    absPath: resolved.absPath,
    mimeType,
    size: stat.size,
    hash,
    width,
    height,
    durationMs,
    frameRate,
    codec,
    hasAlpha,
    tags: kind === 'model'
      ? normalizeTags([...(Array.isArray(options.tags) ? options.tags : String(options.tags || '').split(',')), '3d', 'model'])
      : options.tags,
    brandId: options.brandId || null,
    license: options.license || null,
    thumbnailPath,
    thumbnailAbsPath,
    metadata,
    createdAt: now,
    updatedAt: now,
    analyzedAt: now,
  });
  return options.upsert === false ? record : upsertCreativeAssetRecord(storage, record);
}

export async function importCreativeAsset(storage: CreativeAssetStorage, options: {
  source: string;
  filename?: string;
  tags?: any;
  brandId?: string | null;
  license?: Record<string, any> | null;
  copy?: boolean;
}): Promise<CreativeAssetRecord> {
  const resolved = resolveCreativeAssetPath(storage, options.source);
  if (resolved.sourceType === 'remote') {
    return analyzeCreativeAsset(storage, {
      source: resolved.source,
      tags: options.tags,
      brandId: options.brandId,
      license: options.license,
    });
  }
  if (!resolved.absPath || !fs.existsSync(resolved.absPath)) throw new Error('Creative asset file not found.');
  const shouldCopy = options.copy !== false;
  if (!shouldCopy) {
    return analyzeCreativeAsset(storage, {
      source: resolved.absPath,
      tags: options.tags,
      brandId: options.brandId,
      license: options.license,
    });
  }
  const libraryDir = path.join(getCreativeAssetsDir(storage), 'library');
  const ext = path.extname(resolved.absPath);
  const baseName = sanitizeSegment(options.filename || path.basename(resolved.absPath, ext), 'asset');
  let targetPath = path.join(libraryDir, `${baseName}${ext}`);
  let suffix = 2;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(libraryDir, `${baseName}-${suffix}${ext}`);
    suffix += 1;
  }
  if (!isPathInside(libraryDir, targetPath)) throw new Error('Imported creative asset target escaped the library directory.');
  fs.copyFileSync(resolved.absPath, targetPath);
  return analyzeCreativeAsset(storage, {
    source: targetPath,
    tags: options.tags,
    brandId: options.brandId,
    license: options.license,
  });
}

export function searchCreativeAssets(storage: CreativeAssetStorage, options: {
  query?: string;
  kinds?: string[];
  tags?: any;
  brandId?: string | null;
  limit?: number;
} = {}): CreativeAssetRecord[] {
  const index = readCreativeAssetIndex(storage);
  const query = String(options.query || '').trim().toLowerCase();
  const kinds = new Set((Array.isArray(options.kinds) ? options.kinds : []).map((kind) => String(kind).toLowerCase()).filter(Boolean));
  const tags = normalizeTags(options.tags);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const scored = index.assets
    .map((asset) => {
      let score = 0;
      const haystack = [
        asset.name,
        asset.kind,
        asset.mimeType,
        asset.source,
        asset.path,
        asset.relativePath,
        asset.tags.join(' '),
        asset.brandId || '',
      ].join(' ').toLowerCase();
      if (query) {
        if (haystack.includes(query)) score += 20;
        query.split(/\s+/).filter(Boolean).forEach((part) => {
          if (haystack.includes(part)) score += 4;
        });
      } else {
        score += 1;
      }
      tags.forEach((tag) => {
        if (asset.tags.includes(tag)) score += 8;
      });
      if (options.brandId && asset.brandId === options.brandId) score += 10;
      if (kinds.size && !kinds.has(asset.kind)) score = -Infinity;
      if (options.brandId && asset.brandId !== options.brandId) score -= 2;
      return { asset, score };
    })
    .filter((entry) => entry.score > 0 && Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || Date.parse(right.asset.updatedAt) - Date.parse(left.asset.updatedAt));
  return scored.slice(0, limit).map((entry) => entry.asset);
}

export async function generateCreativeAssetPlaceholder(storage: CreativeAssetStorage, options: {
  prompt: string;
  width?: number;
  height?: number;
  kind?: 'image' | 'svg';
  tags?: any;
  brandId?: string | null;
}): Promise<CreativeAssetRecord> {
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new Error('creative_generate_asset requires a prompt.');
  const width = Math.max(64, Math.min(4096, Number(options.width) || 1920));
  const height = Math.max(64, Math.min(4096, Number(options.height) || 1080));
  const idSeed = crypto.createHash('sha1').update(`${prompt}:${width}:${height}:${Date.now()}`).digest('hex').slice(0, 12);
  const filename = `generated-${idSeed}.svg`;
  const generatedDir = path.join(getCreativeAssetsDir(storage), 'generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  const absPath = path.join(generatedDir, filename);
  const safePrompt = prompt.replace(/[<&>"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch] || ch));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#101828"/>
      <stop offset="0.52" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#ff4d2d"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="36"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${Math.round(width * 0.22)}" cy="${Math.round(height * 0.24)}" r="${Math.round(Math.min(width, height) * 0.2)}" fill="#ffffff" opacity="0.16" filter="url(#soft)"/>
  <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.72)}" r="${Math.round(Math.min(width, height) * 0.24)}" fill="#f7c948" opacity="0.18" filter="url(#soft)"/>
  <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.86)}" fill="#ffffff" opacity="0.72" font-family="Inter, Arial, sans-serif" font-size="${Math.max(24, Math.round(width / 38))}" font-weight="700">${safePrompt.slice(0, 110)}</text>
</svg>`;
  fs.writeFileSync(absPath, svg, 'utf-8');
  const record = await analyzeCreativeAsset(storage, {
    source: absPath,
    tags: normalizeTags(['generated', ...(Array.isArray(options.tags) ? options.tags : String(options.tags || '').split(','))]),
    brandId: options.brandId,
  });
  return upsertCreativeAssetRecord(storage, {
    ...record,
    sourceType: 'generated',
    source: prompt,
    metadata: {
      ...(record.metadata || {}),
      generator: 'prometheus-placeholder-svg',
      prompt,
    },
  });
}
