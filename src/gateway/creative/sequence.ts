import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { resolveRuntimeBinary } from '../../runtime/dependencies';
import {
  type CreativeCaptionTrack,
  type CreativeComposition,
  type CreativeTransitionSpec,
  cloneData,
  isPlainObject,
  normalizeCreativeComposition,
  summarizeCreativeComposition,
} from './contracts';
import {
  addClip,
  addTrack,
  createEmptyComposition,
  deleteClip,
  lintComposition,
  moveClip,
  setTransition,
  splitClip,
  trimClip,
} from './composition';

export type CreativeSequenceSource = {
  id: string;
  assetId: string | null;
  sourcePath: string;
  kind: 'video' | 'image' | 'audio' | 'social-cut';
  label: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
  receiptPath: string | null;
  sha256: string | null;
  selectedRange: Record<string, any> | null;
};

export type CreativeSequenceAudioPolicy = {
  dialogueNormalization: { enabled: boolean; targetI: number; targetTP: number; targetLRA: number };
  musicDucking: { enabled: boolean; musicSourceId: string | null; thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; floorDb: number };
};

export type CreativeSequenceCaptionPolicy = {
  mode: 'off' | 'auto-dialogue' | 'imported';
  language: string | null;
  stylePreset: 'clean' | 'kinetic' | 'minimal';
  placement: 'bottom' | 'center';
  safeArea: boolean;
  trackId: string | null;
};

export type CreativeSequenceVariant = {
  id: string;
  format: 'landscape' | 'portrait' | 'square' | 'four-five';
  width: number;
  height: number;
  reframe: 'center-crop' | 'contain' | 'manual';
  composition: CreativeComposition;
  exportPath: string | null;
  qaReceiptPath: string | null;
  status: 'draft' | 'rendered' | 'qa_passed' | 'qa_failed';
};

export type CreativeSequenceOperation =
  | { op: 'move_clip'; clipRef: string; atMs: number; trackId?: string }
  | { op: 'trim_clip'; clipRef: string; edge: 'head' | 'tail'; toMs: number }
  | { op: 'split_clip'; clipRef: string; atMs: number }
  | { op: 'delete_clip'; clipRef: string; ripple?: boolean }
  | { op: 'set_transition'; clipRef: string; edge: 'in' | 'out'; spec: CreativeTransitionSpec };

export type CreativeSequenceRenderState = {
  exportPath: string | null;
  qaReceiptPath: string | null;
  status: 'draft' | 'rendered' | 'qa_passed' | 'qa_failed';
  renderedAt: string | null;
};

export type CreativeSequenceDoc = {
  kind: 'prometheus-creative-sequence';
  version: 1;
  id: string;
  title: string;
  sources: CreativeSequenceSource[];
  composition: CreativeComposition;
  captions: CreativeSequenceCaptionPolicy;
  audio: CreativeSequenceAudioPolicy;
  variants: CreativeSequenceVariant[];
  masterRender: CreativeSequenceRenderState;
  naturalLanguageEdits: Array<{ id: string; instruction: string; operations: CreativeSequenceOperation[]; createdAt: string }>;
  insert: { clipId: string | null; kind: 'hyperframes' | 'html-motion' | null; sourceRef: string | null };
  createdAt: string;
  updatedAt: string;
};

export type CreativeSequenceStorage = { creativeDir: string; workspacePath: string };

function sequenceId(prefix = 'sequence'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeId(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'sequence';
}

function defaultAudioPolicy(): CreativeSequenceAudioPolicy {
  return {
    dialogueNormalization: { enabled: true, targetI: -16, targetTP: -1.5, targetLRA: 11 },
    musicDucking: { enabled: false, musicSourceId: null, thresholdDb: -28, ratio: 8, attackMs: 30, releaseMs: 250, floorDb: -18 },
  };
}

function defaultCaptionPolicy(): CreativeSequenceCaptionPolicy {
  return { mode: 'off', language: null, stylePreset: 'clean', placement: 'bottom', safeArea: true, trackId: null };
}

function normalizeSource(input: any, index: number): CreativeSequenceSource {
  const kindRaw = String(input?.kind || 'video').trim().toLowerCase();
  const kind = (['video', 'image', 'audio', 'social-cut'].includes(kindRaw) ? kindRaw : 'video') as CreativeSequenceSource['kind'];
  return {
    id: String(input?.id || sequenceId('source')),
    assetId: typeof input?.assetId === 'string' ? input.assetId : null,
    sourcePath: String(input?.sourcePath || input?.path || '').trim(),
    kind,
    label: String(input?.label || `Source ${index + 1}`),
    durationMs: Number.isFinite(Number(input?.durationMs)) ? Math.max(1, Number(input.durationMs)) : null,
    width: Number.isFinite(Number(input?.width)) ? Number(input.width) : null,
    height: Number.isFinite(Number(input?.height)) ? Number(input.height) : null,
    hasAudio: typeof input?.hasAudio === 'boolean' ? input.hasAudio : null,
    receiptPath: typeof input?.receiptPath === 'string' ? input.receiptPath : null,
    sha256: typeof input?.sha256 === 'string' ? input.sha256 : null,
    selectedRange: isPlainObject(input?.selectedRange) ? cloneData(input.selectedRange) : null,
  };
}

export function normalizeCreativeSequence(input: any): CreativeSequenceDoc {
  const safe = isPlainObject(input) ? input : {};
  const now = new Date().toISOString();
  const audio = isPlainObject(safe.audio) ? safe.audio : {};
  const captions = isPlainObject(safe.captions) ? safe.captions : {};
  return {
    kind: 'prometheus-creative-sequence',
    version: 1,
    id: String(safe.id || sequenceId()),
    title: String(safe.title || 'Untitled Video Sequence'),
    sources: (Array.isArray(safe.sources) ? safe.sources : []).map(normalizeSource),
    composition: normalizeCreativeComposition(safe.composition),
    captions: { ...defaultCaptionPolicy(), ...captions },
    audio: {
      dialogueNormalization: { ...defaultAudioPolicy().dialogueNormalization, ...(isPlainObject(audio.dialogueNormalization) ? audio.dialogueNormalization : {}) },
      musicDucking: { ...defaultAudioPolicy().musicDucking, ...(isPlainObject(audio.musicDucking) ? audio.musicDucking : {}) },
    },
    variants: (Array.isArray(safe.variants) ? safe.variants : []).map((variant: any) => ({
      id: String(variant?.id || sequenceId('variant')),
      format: variant?.format || 'landscape',
      width: Math.max(2, Number(variant?.width) || 1920),
      height: Math.max(2, Number(variant?.height) || 1080),
      reframe: variant?.reframe || 'center-crop',
      composition: normalizeCreativeComposition(variant?.composition || safe.composition),
      exportPath: typeof variant?.exportPath === 'string' ? variant.exportPath : null,
      qaReceiptPath: typeof variant?.qaReceiptPath === 'string' ? variant.qaReceiptPath : null,
      status: variant?.status || 'draft',
    })),
    masterRender: {
      exportPath: typeof safe.masterRender?.exportPath === 'string' ? safe.masterRender.exportPath : null,
      qaReceiptPath: typeof safe.masterRender?.qaReceiptPath === 'string' ? safe.masterRender.qaReceiptPath : null,
      status: safe.masterRender?.status || 'draft',
      renderedAt: typeof safe.masterRender?.renderedAt === 'string' ? safe.masterRender.renderedAt : null,
    },
    naturalLanguageEdits: Array.isArray(safe.naturalLanguageEdits) ? cloneData(safe.naturalLanguageEdits) : [],
    insert: isPlainObject(safe.insert) ? { clipId: safe.insert.clipId || null, kind: safe.insert.kind || null, sourceRef: safe.insert.sourceRef || null } : { clipId: null, kind: null, sourceRef: null },
    createdAt: String(safe.createdAt || now),
    updatedAt: String(safe.updatedAt || now),
  };
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    do {
      bytes = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function resolveSequenceSourcePath(storage: CreativeSequenceStorage, sourcePath: string): string {
  const absolute = path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(storage.workspacePath, sourcePath);
  const relative = path.relative(storage.workspacePath, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Sequence source must be inside the workspace: ${sourcePath}`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Sequence source not found: ${sourcePath}`);
  return absolute;
}

export function probeCreativeSequenceSources(storage: CreativeSequenceStorage, inputs: any[]): CreativeSequenceSource[] {
  return (Array.isArray(inputs) ? inputs : []).map((input, index) => {
    const source = normalizeSource(input, index);
    if (!source.sourcePath || !['video', 'audio', 'social-cut'].includes(source.kind)) return source;
    const absolute = resolveSequenceSourcePath(storage, source.sourcePath);
    const text = execFileSync(resolveRuntimeBinary('ffprobe', { allowPathFallback: true }), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', absolute], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const metadata = JSON.parse(text || '{}');
    const video = (metadata.streams || []).find((stream: any) => stream.codec_type === 'video');
    const audio = (metadata.streams || []).find((stream: any) => stream.codec_type === 'audio');
    const durationSeconds = Number(metadata.format?.duration || video?.duration || audio?.duration);
    return {
      ...source,
      sourcePath: path.relative(storage.workspacePath, absolute).replace(/\\/g, '/'),
      durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : source.durationMs,
      width: video ? Number(video.width) || source.width : source.width,
      height: video ? Number(video.height) || source.height : source.height,
      hasAudio: !!audio,
      sha256: source.sha256 || sha256File(absolute),
    };
  });
}

export function createCreativeSequence(input: { title?: string; sources: any[]; width?: number; height?: number; frameRate?: number; fit?: 'cover' | 'contain' | 'blurred-background'; captions?: Partial<CreativeSequenceCaptionPolicy>; audio?: Partial<CreativeSequenceAudioPolicy> }, storage?: CreativeSequenceStorage): CreativeSequenceDoc {
  const sources = storage ? probeCreativeSequenceSources(storage, input.sources) : (Array.isArray(input.sources) ? input.sources : []).map(normalizeSource);
  if (sources.length < 1 || sources.length > 10) throw new Error('video_compose create requires 1-10 sources.');
  const videos = sources.filter((source) => source.kind === 'video' || source.kind === 'social-cut');
  if (!videos.length) throw new Error('video_compose create requires at least one video source.');
  for (const source of videos) if (!source.sourcePath) throw new Error(`Video source "${source.label}" is missing sourcePath.`);
  const comp = createEmptyComposition({ width: input.width, height: input.height, frameRate: input.frameRate || 30, durationMs: 1000 });
  const videoTrack = comp.tracks.find((track) => track.kind === 'video') || addTrack(comp, 'video', 'V1');
  let cursor = 0;
  for (const source of videos) {
    const durationMs = Math.max(1, source.durationMs || 4000);
    addClip(comp, {
      trackId: videoTrack.id,
      lane: 'source-video',
      source: { kind: 'source-video', path: source.sourcePath, assetId: source.assetId, fit: input.fit || 'cover', preserveAudio: true },
      atMs: cursor,
      durationMs,
      label: source.label,
    });
    cursor += durationMs;
  }
  comp.durationMs = Math.max(1000, cursor);
  const now = new Date().toISOString();
  return normalizeCreativeSequence({
    id: sequenceId(), title: input.title, sources, composition: comp,
    captions: { ...defaultCaptionPolicy(), ...(input.captions || {}) },
    audio: { ...defaultAudioPolicy(), ...(input.audio || {}) }, createdAt: now, updatedAt: now,
  });
}

export function resolveSequenceClip(sequence: CreativeSequenceDoc, reference: string) {
  const raw = String(reference || '').trim();
  if (!raw) throw new Error('clipRef is required.');
  const exact = sequence.composition.clips.find((clip) => clip.id === raw);
  if (exact) return exact;
  const normalized = raw.toLowerCase();
  const indexMatch = normalized.match(/^clip\s*(\d+)$/);
  if (indexMatch) {
    const ordered = sequence.composition.clips.slice().sort((a, b) => a.inMs - b.inMs);
    const found = ordered[Number(indexMatch[1]) - 1];
    if (found) return found;
  }
  const matches = sequence.composition.clips.filter((clip) => clip.label.toLowerCase() === normalized || clip.label.toLowerCase().includes(normalized));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`clipRef "${reference}" is ambiguous (${matches.map((clip) => clip.label).join(', ')}).`);
  throw new Error(`Unknown clipRef: ${reference}`);
}

export function applyCreativeSequenceOperations(sequenceInput: CreativeSequenceDoc, operations: CreativeSequenceOperation[], instruction = ''): CreativeSequenceDoc {
  const sequence = normalizeCreativeSequence(cloneData(sequenceInput));
  for (const operation of operations || []) {
    const clip = resolveSequenceClip(sequence, operation.clipRef);
    if (operation.op === 'move_clip') moveClip(sequence.composition, clip.id, { atMs: operation.atMs, trackId: operation.trackId });
    else if (operation.op === 'trim_clip') trimClip(sequence.composition, clip.id, operation.edge, operation.toMs);
    else if (operation.op === 'split_clip') splitClip(sequence.composition, clip.id, operation.atMs);
    else if (operation.op === 'delete_clip') deleteClip(sequence.composition, clip.id, { ripple: operation.ripple === true });
    else if (operation.op === 'set_transition') {
      if (!['cut', 'fade', 'crossfade'].includes(operation.spec?.kind)) throw new Error(`Transition ${operation.spec?.kind || '(missing)'} is not supported by the composition renderer.`);
      setTransition(sequence.composition, clip.id, operation.edge, operation.spec);
    }
  }
  const lint = lintComposition(sequence.composition);
  if (!lint.ok) throw new Error(`Sequence edit failed lint: ${lint.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('; ')}`);
  if (operations.length) sequence.naturalLanguageEdits.push({ id: sequenceId('edit'), instruction, operations: cloneData(operations), createdAt: new Date().toISOString() });
  sequence.updatedAt = new Date().toISOString();
  return sequence;
}

export function retimeCaptionTrackForClip(track: CreativeCaptionTrack, clip: { inMs: number; outMs: number; trimStartMs: number }): CreativeCaptionTrack {
  const sourceStart = Math.max(0, clip.trimStartMs);
  const sourceEnd = sourceStart + Math.max(0, clip.outMs - clip.inMs);
  const segments = track.segments.flatMap((segment) => {
    const start = Math.max(sourceStart, segment.startMs);
    const end = Math.min(sourceEnd, segment.endMs);
    if (end <= start) return [];
    return [{ ...segment, startMs: clip.inMs + (start - sourceStart), endMs: clip.inMs + (end - sourceStart), words: (segment.words || []).flatMap((word) => {
      const wordStart = Math.max(sourceStart, word.startMs);
      const wordEnd = Math.min(sourceEnd, word.endMs);
      return wordEnd > wordStart ? [{ ...word, startMs: clip.inMs + (wordStart - sourceStart), endMs: clip.inMs + (wordEnd - sourceStart) }] : [];
    }) }];
  });
  return { ...cloneData(track), segments };
}

export function createCreativeSequenceVariant(sequenceInput: CreativeSequenceDoc, input: { format: CreativeSequenceVariant['format']; width?: number; height?: number; reframe?: CreativeSequenceVariant['reframe'] }): CreativeSequenceDoc {
  const sequence = normalizeCreativeSequence(cloneData(sequenceInput));
  const presets = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], 'four-five': [1080, 1350] } as const;
  const preset = presets[input.format];
  const composition = normalizeCreativeComposition(cloneData(sequence.composition));
  composition.id = sequenceId('comp');
  composition.width = Math.max(2, input.width || preset[0]);
  composition.height = Math.max(2, input.height || preset[1]);
  composition.meta = { ...composition.meta, variantOf: sequence.composition.id, reframe: input.reframe || 'center-crop' };
  sequence.variants.push({ id: sequenceId('variant'), format: input.format, width: composition.width, height: composition.height, reframe: input.reframe || 'center-crop', composition, exportPath: null, qaReceiptPath: null, status: 'draft' });
  sequence.updatedAt = new Date().toISOString();
  return sequence;
}

export function addSocialCutReceipt(sequenceInput: CreativeSequenceDoc, storage: CreativeSequenceStorage, receiptPath: string, atMs?: number): CreativeSequenceDoc {
  const sequence = normalizeCreativeSequence(cloneData(sequenceInput));
  const absolute = path.isAbsolute(receiptPath) ? receiptPath : path.resolve(storage.workspacePath, receiptPath);
  if (!fs.existsSync(absolute)) throw new Error(`Social-cut receipt not found: ${receiptPath}`);
  const receipt = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (receipt?.qa?.passed !== true) throw new Error('Social-cut receipt QA did not pass.');
  const artifactPath = String(receipt?.artifact?.rel_path || receipt?.artifact?.path || '').trim();
  if (!artifactPath) throw new Error('Social-cut receipt is missing artifact path.');
  const source = normalizeSource({ kind: 'social-cut', sourcePath: artifactPath, label: receipt?.artifact?.filename || 'Social Cut', durationMs: Number(receipt?.qa?.duration_seconds) * 1000, width: receipt?.qa?.width, height: receipt?.qa?.height, hasAudio: receipt?.qa?.has_audio, receiptPath, sha256: receipt?.artifact?.sha256, selectedRange: receipt?.selected_range }, sequence.sources.length);
  sequence.sources.push(source);
  const track = sequence.composition.tracks.find((item) => item.kind === 'video') || addTrack(sequence.composition, 'video', 'V1');
  const start = Number.isFinite(Number(atMs)) ? Math.max(0, Number(atMs)) : sequence.composition.clips.reduce((max, clip) => Math.max(max, clip.outMs), 0);
  addClip(sequence.composition, { trackId: track.id, lane: 'source-video', source: { kind: 'source-video', path: source.sourcePath, fit: 'cover', preserveAudio: true }, atMs: start, durationMs: source.durationMs || 20000, label: source.label });
  sequence.updatedAt = new Date().toISOString();
  return sequence;
}

export function sequenceFilePath(storage: CreativeSequenceStorage, id: string): string {
  const dir = path.join(storage.creativeDir, 'sequences');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safeId(id)}.json`);
}

export function saveCreativeSequence(storage: CreativeSequenceStorage, sequenceInput: CreativeSequenceDoc): { sequence: CreativeSequenceDoc; path: string } {
  const sequence = normalizeCreativeSequence({ ...sequenceInput, updatedAt: new Date().toISOString() });
  const filePath = sequenceFilePath(storage, sequence.id);
  fs.writeFileSync(filePath, JSON.stringify(sequence, null, 2), 'utf8');
  return { sequence, path: filePath };
}

export function loadCreativeSequence(storage: CreativeSequenceStorage, id: string): CreativeSequenceDoc {
  const filePath = sequenceFilePath(storage, id);
  if (!fs.existsSync(filePath)) throw new Error(`Unknown sequence: ${id}`);
  return normalizeCreativeSequence(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function inspectCreativeSequence(sequence: CreativeSequenceDoc) {
  return { id: sequence.id, title: sequence.title, sources: sequence.sources, summary: summarizeCreativeComposition(sequence.composition), composition: sequence.composition, captions: sequence.captions, audio: sequence.audio, masterRender: sequence.masterRender, variants: sequence.variants.map((variant) => ({ id: variant.id, format: variant.format, width: variant.width, height: variant.height, status: variant.status, exportPath: variant.exportPath, qaReceiptPath: variant.qaReceiptPath })), insert: sequence.insert, edits: sequence.naturalLanguageEdits.length, lint: lintComposition(sequence.composition) };
}

export function selectCreativeSequenceComposition(sequence: CreativeSequenceDoc, variantId?: string | null): { composition: CreativeComposition; variant: CreativeSequenceVariant | null } {
  const variant = variantId ? sequence.variants.find((item) => item.id === variantId) : null;
  if (variantId && !variant) throw new Error(`Unknown sequence variant: ${variantId}`);
  const composition = variant?.composition || sequence.composition;
  const videoTrackIds = new Set(composition.tracks.filter((track) => track.kind === 'video' && !track.hidden).map((track) => track.id));
  const clips = composition.clips.filter((clip) => videoTrackIds.has(clip.trackId)).sort((a, b) => a.inMs - b.inMs);
  if (!clips.length) throw new Error('Sequence has no visible video clips to render.');
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    if (index === 0 && Math.abs(clip.inMs) > 20) throw new Error('Sequence render requires the first clip to start at 0ms.');
    if (index > 0 && Math.abs(clip.inMs - clips[index - 1].outMs) > 20) throw new Error('Sequence render currently requires contiguous clips; remove timeline gaps or overlaps before export.');
  }
  return { composition, variant: variant || null };
}

export function listCreativeSequences(storage: CreativeSequenceStorage): CreativeSequenceDoc[] {
  const dir = path.join(storage.creativeDir, 'sequences');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json')).flatMap((name) => {
    try { return [normalizeCreativeSequence(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))]; } catch { return []; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
