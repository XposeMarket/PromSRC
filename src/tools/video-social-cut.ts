

export function buildVideoSocialCutFilter(captionFilter = ''): string {
  return `[0:v]split=2[bgsrc][fgsrc];[bgsrc]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:10,eq=brightness=-0.16:saturation=0.82[bg];[fgsrc]scale=720:-2[fg];[bg][fg]overlay=0:(H-h)/2${captionFilter}[v]`;
}


export function normalizeVideoSocialCutRequests(args: VideoSocialCutArgs): NormalizedVideoSocialCutRequest[] {
  const defaultDuration = clampNumber(args.duration_seconds, DEFAULT_DURATION_SECONDS, 3, 180);
  if (args.clip_requests && args.multipart) throw new Error('Use clip_requests or multipart, not both.');
  if (args.clip_requests) {
    if (!args.clip_requests.length || args.clip_requests.length > 5) throw new Error('clip_requests must contain between 1 and 5 clips.');
    return args.clip_requests.map((request) => ({
      selection: resolveVideoSocialCutSelection(request.selection ?? args.selection),
      startSeconds: clampNumber(request.start_seconds ?? args.start_seconds, 0, 0, 24 * 60 * 60),
      durationSeconds: clampNumber(request.duration_seconds, defaultDuration, 3, 180),
      filename: request.filename,
    }));
  }
  if (args.multipart) {
    const parts = Math.floor(Number(args.multipart.parts));
    if (!Number.isFinite(parts) || parts < 1 || parts > 5) throw new Error('multipart.parts must be between 1 and 5.');
    const partDuration = clampNumber(args.multipart.part_duration_seconds, defaultDuration, 3, 180);
    const start = clampNumber(args.multipart.start_seconds ?? args.start_seconds, 0, 0, 24 * 60 * 60);
    return Array.from({ length: parts }, (_, index) => ({
      selection: 'timestamp' as const,
      startSeconds: start + (index * partDuration),
      durationSeconds: partDuration,
      filename: args.multipart?.filename_prefix ? `${safeStem(args.multipart.filename_prefix)}-part-${index + 1}.mp4` : undefined,
      partNumber: index + 1,
      totalParts: parts,
    }));
  }
  return [{
    selection: resolveVideoSocialCutSelection(args.selection),
    startSeconds: clampNumber(args.start_seconds, 0, 0, 24 * 60 * 60),
    durationSeconds: defaultDuration,
    filename: args.filename,
  }];
}
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getConfig } from '../config/config.js';
import { resolveRuntimeBinary } from '../runtime/dependencies.js';
import type { ToolResult } from '../types.js';
import { creativeTranscribeAudio } from '../gateway/creative/generative-pipeline.js';
import type { CreativeAssetStorage } from '../gateway/creative/assets.js';
import { executeDownloadMedia } from './download-tools.js';
import { getActiveWorkspace } from './workspace-context.js';

type TranscriptSelection = {
  startSeconds: number;
  endSeconds: number;
  score: number;
  excerpt: string;
  signals: string[];
};

const MODE_TERMS: Record<Exclude<VideoSocialCutSelection, 'timestamp'>, RegExp[]> = {
  best_hook: [/\b(here'?s|this is|what if|imagine|the truth|the reason|you need to|most people|nobody|stop|never|always)\b/i, /\b(shock|surpris|secret|mistake|problem|crazy|weird|actually|turns out)\w*/i, /\?/, /\b\d+(?:\.\d+)?%?\b/],
  educational: [/\b(how|why|because|means|works?|process|step|example|learn|understand|explain|difference|method)\b/i, /\b(first|second|third|next|therefore|so that|in other words)\b/i],
  controversial: [/\b(wrong|lie|myth|controvers|disagree|unpopular|nobody admits|they don'?t want|scam|fake|overrated|truth)\b/i, /\b(but|however|instead|actually|despite|versus|vs\.?|against)\b/i],
  emotional: [/\b(love|hate|fear|afraid|angry|pain|hurt|hope|excited|terrified|devastat|amazing|incredible|heart|feel|felt)\w*/i, /[!?]/],
  key_point: [/\b(the point|key|important|main|bottom line|takeaway|ultimately|essential|matter|remember|result|conclusion)\b/i, /\b(therefore|because|which means|so|in short)\b/i],
};

function splitTranscriptSentences(text: string): string[] {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).map((sentence) => sentence.trim()).filter(Boolean);
}

function transcriptCandidates(text: string, mode: Exclude<VideoSocialCutSelection, 'timestamp'>, transcriptDurationSeconds: number, clipDurationSeconds: number): TranscriptSelection[] {
  const sentences = splitTranscriptSentences(text);
  if (!sentences.length || transcriptDurationSeconds <= 0) return [];
  const weights = sentences.map((sentence) => Math.max(1, sentence.split(/\s+/).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const starts: number[] = [];
  let cursor = 0;
  for (const weight of weights) { starts.push(cursor); cursor += transcriptDurationSeconds * (weight / totalWeight); }
  const terms = MODE_TERMS[mode];
  const candidates: TranscriptSelection[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const start = starts[index];
    const endLimit = Math.min(transcriptDurationSeconds, start + clipDurationSeconds);
    const chosen: string[] = [];
    for (let inner = index; inner < sentences.length && starts[inner] < endLimit; inner += 1) chosen.push(sentences[inner]);
    const excerpt = chosen.join(' ').trim();
    const wordCount = excerpt.split(/\s+/).filter(Boolean).length;
    if (wordCount < 4) continue;
    const signals: string[] = [];
    let score = 0;
    terms.forEach((pattern, termIndex) => { if (pattern.test(excerpt)) { score += termIndex < 2 ? 5 : 3; signals.push(`mode_signal_${termIndex + 1}`); } });
    if (/^(but|and|so|because|then|also)\b/i.test(excerpt)) score -= 2;
    if (/\b(I|we|you)\b/i.test(excerpt)) score += 1;
    if (wordCount >= 28 && wordCount <= 70) score += 3; else if (wordCount >= 16) score += 1;
    if (/[.!?]$/.test(excerpt)) score += 1;
    if (start > 1) score += 0.5;
    candidates.push({
      startSeconds: Math.max(0, Math.min(start, Math.max(0, transcriptDurationSeconds - clipDurationSeconds))),
      endSeconds: Math.min(transcriptDurationSeconds, start + clipDurationSeconds),
      score,
      excerpt,
      signals: signals.length ? signals : ['structure_only'],
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.startSeconds - b.startSeconds);
}

export function selectTranscriptWindows(
  text: string,
  mode: Exclude<VideoSocialCutSelection, 'timestamp'>,
  transcriptDurationSeconds: number,
  clipDurationSeconds: number,
  count: number,
  excluded: Array<{ startSeconds: number; endSeconds: number }> = [],
): TranscriptSelection[] {
  const overlaps = (candidate: TranscriptSelection, range: { startSeconds: number; endSeconds: number }) => candidate.startSeconds < range.endSeconds && candidate.endSeconds > range.startSeconds;
  const selected: TranscriptSelection[] = [];
  for (const candidate of transcriptCandidates(text, mode, transcriptDurationSeconds, clipDurationSeconds)) {
    if (excluded.some((range) => overlaps(candidate, range)) || selected.some((range) => overlaps(candidate, range))) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, count)) break;
  }
  return selected;
}

export function selectTranscriptWindow(text: string, mode: Exclude<VideoSocialCutSelection, 'timestamp'>, transcriptDurationSeconds: number, clipDurationSeconds: number): TranscriptSelection {
  return selectTranscriptWindows(text, mode, transcriptDurationSeconds, clipDurationSeconds, 1)[0]
    || { startSeconds: 0, endSeconds: Math.min(transcriptDurationSeconds, clipDurationSeconds), score: 0, excerpt: splitTranscriptSentences(text)[0] || '', signals: ['opening_fallback'] };
}

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.opus', '.ogg', '.webm']);
const DEFAULT_DURATION_SECONDS = 20;
const DEFAULT_TRANSCRIPT_WINDOW_SECONDS = 120;

export type VideoSocialCutProgress = {
  phase: 'starting' | 'acquiring' | 'probing' | 'transcribing' | 'rendering' | 'verifying' | 'complete';
  message: string;
  percent?: number;
};

export type VideoSocialCutSelection = 'best_hook' | 'educational' | 'controversial' | 'emotional' | 'key_point' | 'timestamp';

const VIDEO_SOCIAL_CUT_SELECTIONS: VideoSocialCutSelection[] = ['best_hook', 'educational', 'controversial', 'emotional', 'key_point', 'timestamp'];

export function resolveVideoSocialCutSelection(selection: unknown): VideoSocialCutSelection {
  return VIDEO_SOCIAL_CUT_SELECTIONS.includes(selection as VideoSocialCutSelection)
    ? selection as VideoSocialCutSelection
    : 'best_hook';
}

export type VideoSocialCutArgs = {
  source: string;
  duration_seconds?: number;
  start_seconds?: number;
  selection?: VideoSocialCutSelection;
  clip_requests?: VideoSocialCutClipRequest[];
  multipart?: VideoSocialCutMultipartRequest;
  captions?: boolean;
  header?: boolean;
  output_dir?: string;
  filename?: string;
  transcript_window_seconds?: number;
  _excluded_ranges?: Array<{ startSeconds: number; endSeconds: number }>;
  signal?: AbortSignal;
  onProgress?: (progress: VideoSocialCutProgress) => void;
};

export type VideoSocialCutClipRequest = {
  selection?: VideoSocialCutSelection;
  start_seconds?: number;
  duration_seconds?: number;
  filename?: string;
};

export type VideoSocialCutMultipartRequest = {
  parts: number;
  start_seconds?: number;
  part_duration_seconds?: number;
  filename_prefix?: string;
};

export type NormalizedVideoSocialCutRequest = {
  selection: VideoSocialCutSelection;
  startSeconds: number;
  durationSeconds: number;
  filename?: string;
  partNumber?: number;
  totalParts?: number;
};


type MediaProbe = {
  duration: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

type AcquiredSource = {
  videoPath: string;
  audioPath?: string;
  sourceRelPath: string;
  reused: boolean;
  downloadWarnings: string[];
};

function workspaceRoot(): string {
  return getActiveWorkspace(getConfig().getConfig().workspace.path);
}

function ensureWorkspacePath(root: string, requested: string): string {
  const absolute = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path "${requested}" is outside the active workspace.`);
  }
  return absolute;
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).replace(/\\/g, '/');
}

function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function safeStem(raw: string): string {
  return String(raw || 'clip')
    .replace(/\.[a-z0-9]{1,6}$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'clip';
}

export function buildVideoSocialCutCacheKey(source: string): string {
  return crypto.createHash('sha256').update(String(source || '').trim()).digest('hex').slice(0, 16);
}

export function chunkCaptionText(text: string, durationSeconds: number): Array<{ text: string; start: number; end: number }> {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const chunks: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    const joined = current.join(' ');
    const terminal = /[.!?]$/.test(word);
    if (current.length >= 4 || joined.length >= 28 || (terminal && current.length >= 2)) {
      chunks.push(joined);
      current = [];
    }
  }
  if (current.length) chunks.push(current.join(' '));
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const rawDuration = durationSeconds * (weights[index] / totalWeight);
    const start = cursor;
    const end = index === chunks.length - 1 ? durationSeconds : Math.min(durationSeconds, start + Math.max(0.45, rawDuration));
    cursor = end;
    return { text: chunk, start, end };
  });
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

export function buildAssCaptions(text: string, durationSeconds: number): string {
  const entries = chunkCaptionText(text, durationSeconds);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Arial,52,&H00FFFFFF,&H0000D7FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,155,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + entries.map((entry) => `Dialogue: 0,${assTime(entry.start)},${assTime(entry.end)},Caption,,0,0,0,,${escapeAssText(entry.text)}`).join('\n') + '\n';
}

async function runBinary(
  executable: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal; timeout?: number; maxBuffer?: number } ,
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new Error('video_social_cut canceled by user');
  const result = await execFileAsync(executable, args, {
    cwd: options.cwd,
    windowsHide: true,
    timeout: options.timeout ?? 10 * 60_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    signal: options.signal,
  });
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

async function probeMedia(ffprobePath: string, filePath: string, signal?: AbortSignal): Promise<MediaProbe> {
  const { stdout } = await runBinary(ffprobePath, [
    '-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height',
    '-of', 'json', filePath,
  ], { cwd: path.dirname(filePath), signal, timeout: 45_000 });
  const parsed = JSON.parse(stdout || '{}');
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((stream: any) => stream?.codec_type === 'video');
  const audio = streams.find((stream: any) => stream?.codec_type === 'audio');
  return {
    duration: Number(parsed?.format?.duration) || 0,
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    videoCodec: video?.codec_name ? String(video.codec_name) : null,
    audioCodec: audio?.codec_name ? String(audio.codec_name) : null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

async function listMediaFiles(directory: string): Promise<string[]> {
  if (!fs.existsSync(directory)) return [];
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter((filePath) => VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
}

async function acquireSource(
  root: string,
  source: string,
  sourceDir: string,
  ffprobePath: string,
  signal: AbortSignal | undefined,
  onProgress: VideoSocialCutArgs['onProgress'],
): Promise<AcquiredSource> {
  if (!isRemoteSource(source)) {
    const local = ensureWorkspacePath(root, source);
    if (!fs.existsSync(local) || !fs.statSync(local).isFile()) throw new Error(`Local source not found: ${source}`);
    return { videoPath: local, sourceRelPath: relativePath(root, local), reused: true, downloadWarnings: [] };
  }

  await fsp.mkdir(sourceDir, { recursive: true });
  const existing = await listMediaFiles(sourceDir);
  const existingProbes = await Promise.all(existing.map(async (filePath) => ({ filePath, probe: await probeMedia(ffprobePath, filePath, signal).catch(() => null) })));
  let video = existingProbes.filter((item) => item.probe?.hasVideo).sort((a, b) => fs.statSync(b.filePath).size - fs.statSync(a.filePath).size)[0];
  let audio = existingProbes.filter((item) => item.probe?.hasAudio && !item.probe?.hasVideo).sort((a, b) => fs.statSync(b.filePath).size - fs.statSync(a.filePath).size)[0];
  if (video) {
    return {
      videoPath: video.filePath,
      audioPath: video.probe?.hasAudio ? undefined : audio?.filePath,
      sourceRelPath: relativePath(root, video.filePath),
      reused: true,
      downloadWarnings: [],
    };
  }

  onProgress?.({ phase: 'acquiring', message: 'Downloading source media…' });
  const download = await executeDownloadMedia({
    url: source,
    output_dir: relativePath(root, sourceDir),
    audio_only: false,
    merge_output_format: 'mkv',
    signal,
    onProgress: (progress) => onProgress?.({ phase: 'acquiring', message: progress.message }),
  });

  const candidates = await listMediaFiles(sourceDir);
  const probes = await Promise.all(candidates.map(async (filePath) => ({ filePath, probe: await probeMedia(ffprobePath, filePath, signal).catch(() => null) })));
  video = probes.filter((item) => item.probe?.hasVideo).sort((a, b) => fs.statSync(b.filePath).size - fs.statSync(a.filePath).size)[0];
  audio = probes.filter((item) => item.probe?.hasAudio && !item.probe?.hasVideo).sort((a, b) => fs.statSync(b.filePath).size - fs.statSync(a.filePath).size)[0];
  if (!video) throw new Error(download.error || 'Media acquisition completed without a usable video stream.');
  const warnings = Array.isArray(download.data?.warnings) ? download.data.warnings.map(String) : [];
  if (!download.success) warnings.push(String(download.error || 'yt-dlp merge failed; recovered downloaded component streams.'));
  return {
    videoPath: video.filePath,
    audioPath: video.probe?.hasAudio ? undefined : audio?.filePath,
    sourceRelPath: relativePath(root, video.filePath),
    reused: false,
    downloadWarnings: warnings.slice(0, 8),
  };
}

function buildCreativeStorage(root: string, runDir: string): CreativeAssetStorage {
  const creativeDir = path.join(runDir, '.creative-cache');
  fs.mkdirSync(creativeDir, { recursive: true });
  return {
    workspacePath: root,
    rootAbsPath: runDir,
    rootRelPath: relativePath(root, runDir),
    creativeDir,
  };
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function makeContactSheet(
  ffmpegPath: string,
  outputPath: string,
  contactSheetPath: string,
  duration: number,
  signal?: AbortSignal,
): Promise<void> {
  const sampleTimes = [Math.min(2, duration * 0.15), duration * 0.5, Math.max(0.1, duration - 2)];
  const frames: string[] = [];
  for (let index = 0; index < sampleTimes.length; index += 1) {
    const framePath = path.join(path.dirname(contactSheetPath), `qa-frame-${index + 1}.jpg`);
    await runBinary(ffmpegPath, ['-y', '-ss', sampleTimes[index].toFixed(3), '-i', outputPath, '-frames:v', '1', '-q:v', '2', framePath], {
      cwd: path.dirname(outputPath), signal, timeout: 60_000,
    });
    frames.push(framePath);
  }
  await runBinary(ffmpegPath, [
    '-y', '-i', frames[0], '-i', frames[1], '-i', frames[2],
    '-filter_complex', '[0:v]scale=240:-2[a];[1:v]scale=240:-2[b];[2:v]scale=240:-2[c];[a][b][c]hstack=inputs=3',
    '-frames:v', '1', contactSheetPath,
  ], { cwd: path.dirname(outputPath), signal, timeout: 60_000 });
}

export async function executeVideoSocialCut(args: VideoSocialCutArgs): Promise<ToolResult> {
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string, start: number) => { timings[name] = Date.now() - start; };
  const root = workspaceRoot();
  const source = String(args?.source || '').trim();
  if (!source) return { success: false, error: 'video_social_cut requires source.' };
  if (args.header === true) return { success: false, error: 'video_social_cut v1 intentionally supports no-header cuts only.' };

  try {
    const requests = normalizeVideoSocialCutRequests(args);
    if (requests.length > 1 || args.clip_requests || args.multipart) {
      const batchStarted = Date.now();
      const artifacts: any[] = [];
      const excludedRanges: Array<{ startSeconds: number; endSeconds: number }> = [];
      for (let index = 0; index < requests.length; index += 1) {
        const request = requests[index];
        args.onProgress?.({ phase: 'starting', message: `Creating clip ${index + 1} of ${requests.length}…`, percent: Math.round((index / requests.length) * 100) });
        const child = await executeVideoSocialCut({
          source,
          duration_seconds: request.durationSeconds,
          start_seconds: request.startSeconds,
          selection: request.selection,
          captions: args.captions,
          header: false,
          output_dir: args.output_dir,
          filename: request.filename || `${safeStem(path.basename(source))}-${request.partNumber ? `part-${request.partNumber}` : `clip-${index + 1}-${request.selection}`}.mp4`,
          transcript_window_seconds: args.transcript_window_seconds,
          _excluded_ranges: request.selection === 'timestamp' ? [] : excludedRanges,
          signal: args.signal,
          onProgress: args.onProgress,
        });
        if (!child.success) return { success: false, error: `Batch clip ${index + 1} failed: ${child.error}`, data: { artifacts } };
        const data: any = child.data || {};
        const range = data.selected_range;
        if (range) excludedRanges.push({ startSeconds: Number(range.start_seconds), endSeconds: Number(range.end_seconds) });
        artifacts.push({ ...data, batch_index: index + 1, part_number: request.partNumber ?? null, total_parts: request.totalParts ?? null });
      }
      const batchReceipt = {
        version: 1,
        source,
        clip_count: artifacts.length,
        multipart: Boolean(args.multipart),
        elapsed_ms: Date.now() - batchStarted,
        all_qa_passed: artifacts.every((artifact) => artifact.qa?.passed),
        artifacts,
      };
      const key = buildVideoSocialCutCacheKey(source);
      const outputDir = ensureWorkspacePath(root, String(args.output_dir || path.join('downloads', 'video-social-cut', key)));
      await fsp.mkdir(outputDir, { recursive: true });
      const batchReceiptPath = path.join(outputDir, 'batch-qa-receipt.json');
      await fsp.writeFile(batchReceiptPath, JSON.stringify(batchReceipt, null, 2), 'utf8');
      args.onProgress?.({ phase: 'complete', message: `Created ${artifacts.length} social clips.`, percent: 100 });
      return { success: true, stdout: `Created ${artifacts.length} QA-verified social clips.`, data: { ...batchReceipt, receipt_path: relativePath(root, batchReceiptPath) } };
    }

    args.onProgress?.({ phase: 'starting', message: 'Preparing deterministic social cut…' });
    const duration = clampNumber(args.duration_seconds, DEFAULT_DURATION_SECONDS, 3, 180);
    const requestedStart = clampNumber(args.start_seconds, 0, 0, 24 * 60 * 60);
    const selection = resolveVideoSocialCutSelection(args.selection);
    const transcriptWindow = clampNumber(args.transcript_window_seconds, DEFAULT_TRANSCRIPT_WINDOW_SECONDS, duration, 600);
    const key = buildVideoSocialCutCacheKey(source);
    const outputDir = ensureWorkspacePath(root, String(args.output_dir || path.join('downloads', 'video-social-cut', key)));
    const sourceDir = path.join(outputDir, 'source');
    await fsp.mkdir(outputDir, { recursive: true });

    const ffmpegPath = resolveRuntimeBinary('ffmpeg', { allowPathFallback: true });
    const ffprobePath = resolveRuntimeBinary('ffprobe', { allowPathFallback: true });
    if (!ffmpegPath || !ffprobePath) throw new Error('Packaged FFmpeg/FFprobe runtime is unavailable.');

    const acquireStarted = Date.now();
    const acquired = await acquireSource(root, source, sourceDir, ffprobePath, args.signal, args.onProgress);
    mark('acquire_ms', acquireStarted);

    args.onProgress?.({ phase: 'probing', message: 'Probing source streams and selecting the clip range…' });
    const probeStarted = Date.now();
    const sourceProbe = await probeMedia(ffprobePath, acquired.videoPath, args.signal);
    if (!sourceProbe.hasVideo) throw new Error('Source contains no video stream.');
    if (sourceProbe.duration <= 0) throw new Error('Source duration could not be determined.');
    const maxStart = Math.max(0, sourceProbe.duration - duration);
    let selectedStart = Math.min(requestedStart, maxStart);
    let selectionEvidence: TranscriptSelection | null = null;
    let selectionTranscriptPath: string | null = null;
    let selectionTranscriptProvider = 'not_required';
    let selectionTranscriptCacheHit = false;
    if (selection !== 'timestamp') {
      const boundedWindow = Math.min(transcriptWindow, sourceProbe.duration);
      const selectionAudioPath = path.join(outputDir, `selection-audio-0-${boundedWindow.toFixed(3)}.mp3`);
      const cachedSelectionPath = path.join(outputDir, `selection-transcript-0-${boundedWindow.toFixed(3)}.json`);
      selectionTranscriptPath = cachedSelectionPath;
      let selectionTranscript = '';
      try {
        const cached = JSON.parse(await fsp.readFile(cachedSelectionPath, 'utf8'));
        selectionTranscript = String(cached?.text || '').trim();
        selectionTranscriptProvider = String(cached?.provider || 'cache');
        selectionTranscriptCacheHit = Boolean(selectionTranscript);
      } catch {}
      if (!selectionTranscript) {
        const selectionAudioInput = acquired.audioPath || acquired.videoPath;
        await runBinary(ffmpegPath, ['-y', '-ss', '0', '-i', selectionAudioInput, '-t', boundedWindow.toFixed(3), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', selectionAudioPath], { cwd: outputDir, signal: args.signal, timeout: 3 * 60_000 });
        const transcribed = await creativeTranscribeAudio(buildCreativeStorage(root, outputDir), { source: selectionAudioPath, provider: 'auto', signal: args.signal });
        selectionTranscript = String(transcribed.text || '').trim();
        selectionTranscriptProvider = String(transcribed.provider || 'unknown');
        await fsp.writeFile(cachedSelectionPath, JSON.stringify({ version: 1, source, duration: boundedWindow, provider: selectionTranscriptProvider, text: selectionTranscript }, null, 2), 'utf8');
      }
      selectionEvidence = selectTranscriptWindows(selectionTranscript, selection, boundedWindow, duration, 1, args._excluded_ranges || [])[0]
        || selectTranscriptWindow(selectionTranscript, selection, boundedWindow, duration);
      selectedStart = Math.min(Math.max(0, selectionEvidence.startSeconds), maxStart);
    }
    const selectedDuration = Math.min(duration, sourceProbe.duration - selectedStart);
    mark('probe_select_ms', probeStarted);

    const clipAudioPath = path.join(outputDir, `audio-${selectedStart.toFixed(3)}-${selectedDuration.toFixed(3)}.mp3`);
    const transcriptPath = path.join(outputDir, `transcript-${selectedStart.toFixed(3)}-${selectedDuration.toFixed(3)}.json`);
    let transcript = '';
    let transcriptionProvider = 'disabled';
    let transcriptCacheHit = false;

    if (args.captions !== false) {
      args.onProgress?.({ phase: 'transcribing', message: 'Extracting and transcribing only the selected clip audio…' });
      const transcriptStarted = Date.now();
      try {
        const cached = JSON.parse(await fsp.readFile(transcriptPath, 'utf8'));
        transcript = String(cached?.text || '').trim();
        transcriptionProvider = String(cached?.provider || 'cache');
        transcriptCacheHit = Boolean(transcript);
      } catch {}
      if (!transcript) {
        const audioInputArgs = acquired.audioPath
          ? ['-ss', selectedStart.toFixed(3), '-i', acquired.audioPath]
          : ['-ss', selectedStart.toFixed(3), '-i', acquired.videoPath];
        await runBinary(ffmpegPath, [
          '-y', ...audioInputArgs, '-t', Math.min(selectedDuration, transcriptWindow).toFixed(3),
          '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', clipAudioPath,
        ], { cwd: outputDir, signal: args.signal, timeout: 2 * 60_000 });
        const transcribed = await creativeTranscribeAudio(buildCreativeStorage(root, outputDir), {
          source: clipAudioPath,
          provider: 'auto',
          signal: args.signal,
        });
        transcript = String(transcribed.text || '').trim();
        transcriptionProvider = String(transcribed.provider || 'unknown');
        await fsp.writeFile(transcriptPath, JSON.stringify({ version: 1, source, selectedStart, selectedDuration, provider: transcriptionProvider, text: transcript }, null, 2), 'utf8');
      }
      mark('transcribe_ms', transcriptStarted);
    }

    const captionPath = path.join(outputDir, 'captions.ass');
    if (args.captions !== false && transcript) {
      await fsp.writeFile(captionPath, buildAssCaptions(transcript, selectedDuration), 'utf8');
    }

    const filename = String(args.filename || `${safeStem(path.basename(acquired.videoPath))}-${selectedStart.toFixed(0)}s-${selectedDuration.toFixed(0)}s-vertical.mp4`);
    const outputPath = ensureWorkspacePath(root, path.join(outputDir, path.basename(filename).toLowerCase().endsWith('.mp4') ? path.basename(filename) : `${path.basename(filename)}.mp4`));
    const hasSeparateAudio = Boolean(acquired.audioPath);
    const inputArgs = ['-ss', selectedStart.toFixed(3), '-i', acquired.videoPath];
    if (hasSeparateAudio) inputArgs.push('-ss', selectedStart.toFixed(3), '-i', acquired.audioPath!);
    const captionFilter = args.captions !== false && transcript ? `,ass='${escapeFilterPath(captionPath)}'` : '';
    const filter = buildVideoSocialCutFilter(captionFilter);

    args.onProgress?.({ phase: 'rendering', message: 'Rendering centered vertical composition and captions…' });
    const renderStarted = Date.now();
    await runBinary(ffmpegPath, [
      '-y', ...inputArgs, '-t', selectedDuration.toFixed(3),
      '-filter_complex', filter,
      '-map', '[v]', '-map', hasSeparateAudio ? '1:a:0?' : '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', outputPath,
    ], { cwd: outputDir, signal: args.signal, timeout: 8 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    mark('render_ms', renderStarted);

    args.onProgress?.({ phase: 'verifying', message: 'Running decode, stream, frame, and artifact-identity QA…' });
    const verifyStarted = Date.now();
    const outputProbe = await probeMedia(ffprobePath, outputPath, args.signal);
    await runBinary(ffmpegPath, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], {
      cwd: outputDir, signal: args.signal, timeout: 4 * 60_000, maxBuffer: 4 * 1024 * 1024,
    });
    const contactSheetPath = path.join(outputDir, `${safeStem(path.basename(outputPath))}.qa-contact-sheet.jpg`);
    await makeContactSheet(ffmpegPath, outputPath, contactSheetPath, selectedDuration, args.signal);
    const sha256 = await sha256File(outputPath);
    const stat = await fsp.stat(outputPath);
    const durationDelta = Math.abs(outputProbe.duration - selectedDuration);
    const qaPassed = outputProbe.width === 720
      && outputProbe.height === 1280
      && outputProbe.hasVideo
      && outputProbe.hasAudio
      && durationDelta <= 0.35
      && stat.size > 0;
    mark('verify_ms', verifyStarted);
    timings.total_ms = Date.now() - startedAt;

    const receipt = {
      version: 1,
      source,
      source_file: acquired.sourceRelPath,
      source_reused: acquired.reused,
      selected_range: {
        start_seconds: selectedStart,
        duration_seconds: selectedDuration,
        end_seconds: selectedStart + selectedDuration,
        strategy: selection === 'timestamp' ? 'explicit_timestamp' : `transcript_scored_${selection}_v2`,
        mode: selection,
        score: selectionEvidence?.score ?? null,
        excerpt: selectionEvidence?.excerpt ?? null,
        signals: selectionEvidence?.signals ?? [],
        timing_basis: selection === 'timestamp' ? 'exact' : 'proportional_transcript_estimate',
        selection_transcript_provider: selectionTranscriptProvider,
        selection_transcript_cache_hit: selectionTranscriptCacheHit,
        selection_transcript_path: selectionTranscriptPath ? relativePath(root, selectionTranscriptPath) : null,
      },
      captions: {
        enabled: args.captions !== false,
        transcript_provider: transcriptionProvider,
        transcript_cache_hit: transcriptCacheHit,
        caption_cards: chunkCaptionText(transcript, selectedDuration).length,
        transcript_path: transcript ? relativePath(root, transcriptPath) : null,
        ass_path: transcript ? relativePath(root, captionPath) : null,
      },
      artifact: {
        path: outputPath,
        rel_path: relativePath(root, outputPath),
        bytes: stat.size,
        sha256,
        mime_type: 'video/mp4',
      },
      qa: {
        passed: qaPassed,
        full_decode: true,
        duration_seconds: outputProbe.duration,
        duration_delta_seconds: durationDelta,
        width: outputProbe.width,
        height: outputProbe.height,
        video_codec: outputProbe.videoCodec,
        audio_codec: outputProbe.audioCodec,
        has_audio: outputProbe.hasAudio,
        contact_sheet: relativePath(root, contactSheetPath),
      },
      timings,
      warnings: acquired.downloadWarnings,
    };
    const receiptPath = path.join(outputDir, `${safeStem(path.basename(outputPath))}.qa-receipt.json`);
    await fsp.writeFile(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');

    args.onProgress?.({ phase: 'complete', message: `Social cut complete in ${(timings.total_ms / 1000).toFixed(1)}s.`, percent: 100 });
    if (!qaPassed) {
      return { success: false, error: 'video_social_cut rendered an artifact, but consolidated QA failed.', data: { ...receipt, receipt_path: relativePath(root, receiptPath) } };
    }
    return {
      success: true,
      stdout: `Created ${relativePath(root, outputPath)} (${selectedDuration.toFixed(2)}s, SHA-256 ${sha256}).`,
      data: { ...receipt, receipt_path: relativePath(root, receiptPath) },
    };
  } catch (error: any) {
    return { success: false, error: `video_social_cut failed: ${String(error?.message || error)}` };
  }
}

export const videoSocialCutTool = {
  name: 'video_social_cut',
  description: 'Download or ingest a video and create a deterministic centered 9:16 social clip with burned captions, technical QA, representative frames, timings, and an exact SHA-256 artifact receipt.',
  execute: executeVideoSocialCut,
  schema: {
    source: 'Supported page URL or workspace-local video path',
    duration_seconds: 'Clip duration in seconds (default 20)',
    start_seconds: 'Optional exact source timestamp in seconds',
    selection: 'best_hook, educational, controversial, emotional, key_point, or timestamp',
    clip_requests: 'Optional array of 1–5 independently selected clips',
    multipart: 'Optional contiguous 1–5 part sequence',
    captions: 'Burn captions into the output (default true)',
    header: 'Must remain false in v1; no added header',
    output_dir: 'Optional workspace-relative output directory',
    filename: 'Optional MP4 filename',
    transcript_window_seconds: 'Bounded transcription window; default 120 seconds',
  },
  jsonSchema: {
    type: 'object',
    required: ['source'],
    properties: {
      source: { type: 'string', description: 'Supported page URL or workspace-local video path' },
      duration_seconds: { type: 'number', minimum: 3, maximum: 180, description: 'Clip duration in seconds. Default 20.' },
      start_seconds: { type: 'number', minimum: 0, description: 'Optional exact source timestamp in seconds.' },
      selection: { type: 'string', enum: ['best_hook', 'educational', 'controversial', 'emotional', 'key_point', 'timestamp'], description: 'Selection mode. Transcript-scored modes inspect a bounded opening window; timestamp uses start_seconds exactly.' },
      clip_requests: { type: 'array', minItems: 1, maxItems: 5, description: 'Create 1–5 distinct clips in one call. Repeated intelligent modes avoid already selected ranges.', items: { type: 'object', properties: { selection: { type: 'string', enum: ['best_hook', 'educational', 'controversial', 'emotional', 'key_point', 'timestamp'] }, start_seconds: { type: 'number', minimum: 0 }, duration_seconds: { type: 'number', minimum: 3, maximum: 180 }, filename: { type: 'string' } }, additionalProperties: false } },
      multipart: { type: 'object', description: 'Create contiguous Part 1…Part 5 clips from one section.', required: ['parts'], properties: { parts: { type: 'integer', minimum: 1, maximum: 5 }, start_seconds: { type: 'number', minimum: 0 }, part_duration_seconds: { type: 'number', minimum: 3, maximum: 180 }, filename_prefix: { type: 'string' } }, additionalProperties: false },
      captions: { type: 'boolean', description: 'Burn captions into the output. Default true.' },
      header: { type: 'boolean', description: 'Must be false in v1. The fast path adds no header.' },
      output_dir: { type: 'string', description: 'Optional workspace-relative output directory.' },
      filename: { type: 'string', description: 'Optional output MP4 filename.' },
      transcript_window_seconds: { type: 'number', minimum: 3, maximum: 600, description: 'Bounded transcription window. Default 120 seconds.' },
    },
    additionalProperties: false,
  },
};
