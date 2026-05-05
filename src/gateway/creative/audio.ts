import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  type CreativeAudioAnalysis,
  type CreativeAudioSourceType,
  type CreativeAudioTrack,
  type CreativeSceneDoc,
  clampNumber,
  cloneData,
  normalizeCreativeAudioAnalysis,
  normalizeCreativeAudioTrack,
  normalizeCreativeSceneDoc,
} from './contracts';

const execFileAsync = promisify(execFile);
const DEFAULT_WAVEFORM_BUCKETS = 240;

type LocalAudioSource = {
  source: string;
  sourceType: CreativeAudioSourceType;
  absPath: string | null;
  relativePath: string | null;
  error: string | null;
};

type CreativeStorageContext = {
  workspacePath: string;
  rootAbsPath: string;
  creativeDir: string;
};

type WaveformResult = {
  sampleRate: number | null;
  channels: number | null;
  durationMs: number | null;
  waveformPeaks: number[];
  waveformBucketCount: number;
};

function isRemoteSource(source: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(String(source || '').trim());
}

function guessAudioMimeType(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  switch (ext) {
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
      return 'audio/ogg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.webm':
      return 'audio/webm';
    default:
      return 'audio/unknown';
  }
}

function getCreativeAudioAnalysisDir(storage: CreativeStorageContext): string {
  const dir = path.join(storage.creativeDir, 'audio-analysis');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCreativeAudioAnalysisCachePath(storage: CreativeStorageContext, source: string): string {
  const hash = crypto.createHash('sha1').update(String(source || '').trim()).digest('hex');
  return path.join(getCreativeAudioAnalysisDir(storage), `${hash}.json`);
}

function buildRelativePath(basePath: string, absPath: string): string | null {
  const relative = path.relative(basePath, absPath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

function readUInt32LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function readUInt16LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function parseWavHeader(buffer: Buffer): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  formatCode: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
} | null {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let formatCode = 0;
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = readUInt32LE(buffer, offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkDataOffset + chunkSize <= buffer.length) {
      formatCode = readUInt16LE(buffer, chunkDataOffset);
      channels = readUInt16LE(buffer, chunkDataOffset + 2);
      sampleRate = readUInt32LE(buffer, chunkDataOffset + 4);
      blockAlign = readUInt16LE(buffer, chunkDataOffset + 12);
      bitsPerSample = readUInt16LE(buffer, chunkDataOffset + 14);
    } else if (chunkId === 'data' && chunkDataOffset + chunkSize <= buffer.length) {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!dataOffset || !dataSize || !sampleRate || !channels || !blockAlign || !bitsPerSample) return null;
  return {
    sampleRate,
    channels,
    bitsPerSample,
    formatCode,
    blockAlign,
    dataOffset,
    dataSize,
  };
}

function readWavSample(buffer: Buffer, offset: number, bitsPerSample: number, formatCode: number): number {
  if (formatCode === 3 && bitsPerSample === 32) {
    return clampNumber(buffer.readFloatLE(offset), -1, 1);
  }
  if (bitsPerSample === 8) {
    return (buffer.readUInt8(offset) - 128) / 128;
  }
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset) / 32768;
  }
  if (bitsPerSample === 24) {
    const value = buffer.readIntLE(offset, 3);
    return value / 8388608;
  }
  if (bitsPerSample === 32) {
    return buffer.readInt32LE(offset) / 2147483648;
  }
  return 0;
}

function buildWaveformFromWavBuffer(buffer: Buffer, bucketCount = DEFAULT_WAVEFORM_BUCKETS): WaveformResult | null {
  const header = parseWavHeader(buffer);
  if (!header) return null;
  const { sampleRate, channels, bitsPerSample, formatCode, blockAlign, dataOffset, dataSize } = header;
  const totalFrames = Math.max(1, Math.floor(dataSize / blockAlign));
  const durationMs = Math.round((totalFrames / sampleRate) * 1000);
  const safeBucketCount = Math.max(24, Math.min(1024, Number(bucketCount) || DEFAULT_WAVEFORM_BUCKETS));
  const peaks = new Array<number>(safeBucketCount).fill(0);

  for (let bucketIndex = 0; bucketIndex < safeBucketCount; bucketIndex += 1) {
    const frameStart = Math.floor((bucketIndex / safeBucketCount) * totalFrames);
    const frameEnd = Math.min(totalFrames, Math.floor(((bucketIndex + 1) / safeBucketCount) * totalFrames));
    let peak = 0;
    for (let frameIndex = frameStart; frameIndex < frameEnd; frameIndex += 1) {
      let framePeak = 0;
      const frameOffset = dataOffset + frameIndex * blockAlign;
      for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
        const sampleOffset = frameOffset + channelIndex * Math.max(1, bitsPerSample / 8);
        const amplitude = Math.abs(readWavSample(buffer, sampleOffset, bitsPerSample, formatCode));
        if (amplitude > framePeak) framePeak = amplitude;
      }
      if (framePeak > peak) peak = framePeak;
    }
    peaks[bucketIndex] = clampNumber(peak, 0, 1);
  }

  return {
    sampleRate,
    channels,
    durationMs,
    waveformPeaks: peaks,
    waveformBucketCount: safeBucketCount,
  };
}

async function probeWithFfprobe(absPath: string): Promise<Partial<CreativeAudioAnalysis> | null> {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    absPath,
  ];
  try {
    const { stdout } = await execFileAsync('ffprobe', args, { windowsHide: true, maxBuffer: 1024 * 1024 * 4 });
    const parsed = JSON.parse(String(stdout || '{}'));
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const audioStream = streams.find((stream: any) => String(stream?.codec_type || '').toLowerCase() === 'audio') || streams[0];
    const format = parsed?.format && typeof parsed.format === 'object' ? parsed.format : {};
    const durationSeconds = Number(audioStream?.duration ?? format?.duration);
    return {
      durationMs: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 1000)) : null,
      sampleRate: Number.isFinite(Number(audioStream?.sample_rate)) ? Math.max(1, Number(audioStream.sample_rate)) : null,
      channels: Number.isFinite(Number(audioStream?.channels)) ? Math.max(1, Number(audioStream.channels)) : null,
      bitRate: Number.isFinite(Number(audioStream?.bit_rate ?? format?.bit_rate)) ? Math.max(0, Number(audioStream?.bit_rate ?? format?.bit_rate)) : null,
      codec: audioStream?.codec_name ? String(audioStream.codec_name) : null,
      mimeType: guessAudioMimeType(absPath),
      size: Number.isFinite(Number(format?.size)) ? Math.max(0, Number(format.size)) : null,
    };
  } catch {
    return null;
  }
}

function loadCachedCreativeAudioAnalysis(storage: CreativeStorageContext, source: string): CreativeAudioAnalysis | null {
  const cachePath = getCreativeAudioAnalysisCachePath(storage, source);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    return normalizeCreativeAudioAnalysis(parsed);
  } catch {
    return null;
  }
}

function writeCreativeAudioAnalysisCache(storage: CreativeStorageContext, source: string, analysis: CreativeAudioAnalysis): CreativeAudioAnalysis {
  const cachePath = getCreativeAudioAnalysisCachePath(storage, source);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const cachePayload = {
    ...analysis,
    cachePath,
    cachePathRelative: buildRelativePath(storage.workspacePath, cachePath),
  };
  fs.writeFileSync(cachePath, JSON.stringify(cachePayload, null, 2), 'utf-8');
  return normalizeCreativeAudioAnalysis(cachePayload) as CreativeAudioAnalysis;
}

function normalizeResolvedSource(
  storage: CreativeStorageContext,
  source: string,
  resolveLocalPath?: (rawSource: string) => string,
): LocalAudioSource {
  const trimmed = String(source || '').trim();
  if (!trimmed) {
    return { source: '', sourceType: 'empty', absPath: null, relativePath: null, error: null };
  }
  if (isRemoteSource(trimmed)) {
    return { source: trimmed, sourceType: 'remote', absPath: null, relativePath: null, error: null };
  }
  try {
    const absPath = resolveLocalPath
      ? resolveLocalPath(trimmed)
      : path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(storage.rootAbsPath || storage.workspacePath, trimmed));
    const sourceType: CreativeAudioSourceType = path.isAbsolute(trimmed) ? 'absolute' : 'workspace';
    return {
      source: trimmed,
      sourceType,
      absPath,
      relativePath: buildRelativePath(storage.workspacePath, absPath),
      error: null,
    };
  } catch (err: any) {
    return {
      source: trimmed,
      sourceType: 'missing',
      absPath: null,
      relativePath: null,
      error: String(err?.message || 'Could not resolve creative audio source.'),
    };
  }
}

export async function analyzeCreativeAudioSource(options: {
  storage: CreativeStorageContext;
  source: string;
  resolveLocalPath?: (rawSource: string) => string;
  force?: boolean;
  bucketCount?: number;
}): Promise<CreativeAudioAnalysis> {
  const { storage, source, resolveLocalPath } = options;
  const resolved = normalizeResolvedSource(storage, source, resolveLocalPath);
  if (!resolved.source) {
    return {
      status: 'unavailable',
      sourceType: 'empty',
      source: '',
      resolvedPath: null,
      resolvedPathRelative: null,
      analyzedAt: new Date().toISOString(),
      durationMs: null,
      sampleRate: null,
      channels: null,
      bitRate: null,
      codec: null,
      mimeType: null,
      size: null,
      waveformBucketCount: 0,
      waveformPeaks: [],
      cachePath: null,
      cachePathRelative: null,
      error: null,
    };
  }

  if (!options.force) {
    const cached = loadCachedCreativeAudioAnalysis(storage, resolved.source);
    if (cached) return cached;
  }

  if (resolved.sourceType === 'remote') {
    return {
      status: 'unavailable',
      sourceType: 'remote',
      source: resolved.source,
      resolvedPath: null,
      resolvedPathRelative: null,
      analyzedAt: new Date().toISOString(),
      durationMs: null,
      sampleRate: null,
      channels: null,
      bitRate: null,
      codec: null,
      mimeType: null,
      size: null,
      waveformBucketCount: 0,
      waveformPeaks: [],
      cachePath: null,
      cachePathRelative: null,
      error: 'Remote audio analysis is deferred until a fetch-backed pipeline is added.',
    };
  }

  if (!resolved.absPath || !fs.existsSync(resolved.absPath) || !fs.statSync(resolved.absPath).isFile()) {
    const missingAnalysis: CreativeAudioAnalysis = {
      status: 'error',
      sourceType: 'missing',
      source: resolved.source,
      resolvedPath: resolved.absPath,
      resolvedPathRelative: resolved.relativePath,
      analyzedAt: new Date().toISOString(),
      durationMs: null,
      sampleRate: null,
      channels: null,
      bitRate: null,
      codec: null,
      mimeType: null,
      size: null,
      waveformBucketCount: 0,
      waveformPeaks: [],
      cachePath: null,
      cachePathRelative: null,
      error: resolved.error || 'Creative audio file not found.',
    };
    return writeCreativeAudioAnalysisCache(storage, resolved.source, missingAnalysis);
  }

  try {
    const stat = fs.statSync(resolved.absPath);
    const buffer = fs.readFileSync(resolved.absPath);
    const waveform = buildWaveformFromWavBuffer(buffer, options.bucketCount || DEFAULT_WAVEFORM_BUCKETS);
    const ffprobe = await probeWithFfprobe(resolved.absPath);
    const analysis: CreativeAudioAnalysis = {
      status: waveform || ffprobe ? 'ready' : 'unavailable',
      sourceType: resolved.sourceType,
      source: resolved.source,
      resolvedPath: resolved.absPath,
      resolvedPathRelative: resolved.relativePath,
      analyzedAt: new Date().toISOString(),
      durationMs: waveform?.durationMs ?? ffprobe?.durationMs ?? null,
      sampleRate: waveform?.sampleRate ?? ffprobe?.sampleRate ?? null,
      channels: waveform?.channels ?? ffprobe?.channels ?? null,
      bitRate: ffprobe?.bitRate ?? null,
      codec: ffprobe?.codec ?? null,
      mimeType: ffprobe?.mimeType || guessAudioMimeType(resolved.absPath),
      size: stat.size,
      waveformBucketCount: waveform?.waveformBucketCount || 0,
      waveformPeaks: waveform?.waveformPeaks || [],
      cachePath: null,
      cachePathRelative: null,
      error: waveform || ffprobe ? null : 'Audio metadata probing is limited for this format without ffprobe or WAV PCM data.',
    };
    return writeCreativeAudioAnalysisCache(storage, resolved.source, analysis);
  } catch (err: any) {
    const analysis: CreativeAudioAnalysis = {
      status: 'error',
      sourceType: resolved.sourceType,
      source: resolved.source,
      resolvedPath: resolved.absPath,
      resolvedPathRelative: resolved.relativePath,
      analyzedAt: new Date().toISOString(),
      durationMs: null,
      sampleRate: null,
      channels: null,
      bitRate: null,
      codec: null,
      mimeType: guessAudioMimeType(resolved.absPath || ''),
      size: null,
      waveformBucketCount: 0,
      waveformPeaks: [],
      cachePath: null,
      cachePathRelative: null,
      error: String(err?.message || 'Could not analyze creative audio source.'),
    };
    return writeCreativeAudioAnalysisCache(storage, resolved.source, analysis);
  }
}

export async function enrichCreativeAudioTrack(
  storage: CreativeStorageContext,
  input: any,
  options: {
    resolveLocalPath?: (rawSource: string) => string;
    forceAnalysis?: boolean;
    bucketCount?: number;
  } = {},
): Promise<CreativeAudioTrack> {
  const track = normalizeCreativeAudioTrack(input);
  if (!track.source) return track;
  const analysis = await analyzeCreativeAudioSource({
    storage,
    source: track.source,
    resolveLocalPath: options.resolveLocalPath,
    force: options.forceAnalysis === true,
    bucketCount: options.bucketCount,
  });
  return normalizeCreativeAudioTrack({
    ...track,
    analysis,
  });
}

export async function enrichCreativeSceneDocAudio(
  storage: CreativeStorageContext,
  input: any,
  options: {
    resolveLocalPath?: (rawSource: string) => string;
    forceAnalysis?: boolean;
    bucketCount?: number;
  } = {},
): Promise<CreativeSceneDoc> {
  const doc = normalizeCreativeSceneDoc(input);
  if (!doc.audioTrack.source) return doc;
  return normalizeCreativeSceneDoc({
    ...doc,
    audioTrack: await enrichCreativeAudioTrack(storage, doc.audioTrack, options),
  });
}

export function cloneCreativeAudioAnalysis(analysis: CreativeAudioAnalysis | null): CreativeAudioAnalysis | null {
  return analysis ? normalizeCreativeAudioAnalysis(cloneData(analysis)) : null;
}
