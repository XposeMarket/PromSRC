export type CreativeRenderFormat =
  | 'render'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'svg'
  | 'pdf'
  | 'webm'
  | 'mp4'
  | 'gif';

export type CreativeRenderJobStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'uploading'
  | 'completed'
  | 'cancel_requested'
  | 'canceled'
  | 'failed';

export type CreativeAudioAnalysisStatus = 'ready' | 'unavailable' | 'error';
export type CreativeAudioSourceType = 'empty' | 'workspace' | 'absolute' | 'remote' | 'missing';

export type CreativeAudioAnalysis = {
  status: CreativeAudioAnalysisStatus;
  sourceType: CreativeAudioSourceType;
  source: string;
  resolvedPath: string | null;
  resolvedPathRelative: string | null;
  analyzedAt: string | null;
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
  codec: string | null;
  mimeType: string | null;
  size: number | null;
  waveformBucketCount: number;
  waveformPeaks: number[];
  cachePath: string | null;
  cachePathRelative: string | null;
  error: string | null;
};

export type CreativeAudioTrack = {
  source: string;
  label: string;
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  volume: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  analysis: CreativeAudioAnalysis | null;
};

export type CreativeSocialFormat = 'reel' | 'short' | 'story' | 'square' | 'feed45' | 'youtube';

export type CreativeBrandKit = {
  id: string;
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  logo: string | null;
};

export type CreativeCaptionWord = {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
};

export type CreativeCaptionSegment = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words: CreativeCaptionWord[];
};

export type CreativeCaptionTrack = {
  id: string;
  language: string | null;
  source: string | null;
  segments: CreativeCaptionSegment[];
};

export type CreativeMotionTemplateCategory =
  | 'captions'
  | 'audio-reactive'
  | 'product'
  | 'social'
  | 'typography'
  | 'promo';

export type CreativeMotionPreset = {
  id: string;
  label: string;
  description: string;
  style: Record<string, any>;
};

export type CreativeMotionTemplate = {
  id: string;
  name: string;
  description: string;
  category: CreativeMotionTemplateCategory;
  supportedModes: Array<'image' | 'video'>;
  supportedFormats: CreativeSocialFormat[];
  defaultDurationMs: number;
  defaultFps: number;
  compositionId: string;
  presets: CreativeMotionPreset[];
  schema: Record<string, any>;
};

export type CreativeMotionInput = {
  templateId: string;
  presetId: string | null;
  socialFormat: CreativeSocialFormat;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  brand: CreativeBrandKit | null;
  assets: any[];
  captions: CreativeCaptionTrack | null;
  audioAnalysis: CreativeAudioAnalysis | null;
  text: {
    title: string;
    subtitle: string;
    body: string;
    cta: string;
  };
  style: Record<string, any>;
};

export type CreativeMotionTemplateInstance = {
  id: string;
  type: 'motionTemplate';
  templateId: string;
  presetId: string | null;
  socialFormat: CreativeSocialFormat;
  startMs: number;
  durationMs: number;
  locked: boolean;
  input: CreativeMotionInput;
  preview: Record<string, any> | null;
};

export type CreativeSceneDoc = {
  id: string;
  version: number;
  width: number;
  height: number;
  background: string;
  durationMs: number;
  frameRate: number;
  audioTrack: CreativeAudioTrack;
  elements: any[];
  motionTemplates: CreativeMotionTemplateInstance[];
  captions: CreativeCaptionTrack[];
  brandKit: CreativeBrandKit | null;
  selectedId: string | null;
};

export type CreativeSceneSummary = {
  width: number | null;
  height: number | null;
  background: string | null;
  durationMs: number | null;
  frameRate: number | null;
  elementCount: number;
  textCount: number;
  imageCount: number;
  iconCount: number;
  groupCount: number;
  animatedCount: number;
  hasAudio: boolean;
  audioDurationMs: number | null;
};

export type CreativeRenderJobOutput = {
  filename: string | null;
  path: string | null;
  absPath: string | null;
  mimeType: string | null;
  size: number | null;
} | null;

export type CreativeRenderJobErrorEntry = {
  at: string;
  phase: string | null;
  message: string;
};

export type CreativeRenderExportOptions = {
  durationMs: number;
  frameRate: number;
  width: number;
  height: number;
  frameCount: number | null;
  audioRequested: boolean;
  audioAnalysisStatus: CreativeAudioAnalysisStatus | null;
  audioSourceDurationMs: number | null;
  audioActiveDurationMs: number | null;
  audioTrimStartMs: number;
  audioTrimEndMs: number;
};

export type CreativeRenderAudioPlan = {
  requested: boolean;
  source: string | null;
  sourceType: CreativeAudioSourceType | null;
  ready: boolean;
  outcome: 'not_requested' | 'ready' | 'silent_export' | 'analysis_warning' | 'missing_audio';
  includeInCapture: boolean;
  requiresServerMix: boolean;
  activeDurationMs: number | null;
  trimStartMs: number;
  trimEndMs: number;
  fadeInMs: number;
  fadeOutMs: number;
};

export type CreativeRenderManifest = {
  version: number;
  pipeline: 'static-browser-export' | 'browser-capture' | 'server-browser-capture';
  requestedFormat: CreativeRenderFormat;
  captureFormat: CreativeRenderFormat;
  captureMimeType: string | null;
  deliveredFormat: CreativeRenderFormat;
  deliveredMimeType: string | null;
  renderer: string;
  durationMs: number;
  frameRate: number;
  frameCount: number;
  width: number;
  height: number;
  audio: CreativeRenderAudioPlan;
  serverFinish: {
    requested: boolean;
    preferred: boolean;
    tool: string | null;
    available: boolean | null;
    status: string | null;
    reason: string | null;
  };
};

export type CreativeRenderPreflight = {
  status: 'ready' | 'warning' | 'blocked';
  format: CreativeRenderFormat;
  renderer: string;
  requiresVideoMode: boolean;
  requiresServerWorker: boolean;
  browserExportPossible: boolean;
  serverExportPossible: boolean;
  audioRequested: boolean;
  audioReady: boolean;
  audioOutcome: 'not_requested' | 'ready' | 'silent_export' | 'analysis_warning' | 'missing_audio';
  warnings: string[];
  blockers: string[];
};

export type CreativeRenderWorkerInput = {
  format: CreativeRenderFormat;
  renderer: string;
  creativeMode: string | null;
  sceneDoc: CreativeSceneDoc | null;
  exportOptions: CreativeRenderExportOptions | null;
  audioTrack: CreativeAudioTrack | null;
  preflight: CreativeRenderPreflight;
  manifest: CreativeRenderManifest;
};

export type CreativeRenderJobRecord = {
  kind: 'prometheus-creative-render-job';
  version: number;
  id: string;
  sessionId: string;
  creativeMode: string | null;
  format: CreativeRenderFormat;
  renderer: string;
  requestedAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: CreativeRenderJobStatus;
  progress: number;
  progressLabel: string | null;
  storageRoot: string;
  storageRootRelative: string;
  usesProjectRoot: boolean;
  summary: CreativeSceneSummary | Record<string, any> | null;
  sceneDoc: CreativeSceneDoc | null;
  exportOptions: CreativeRenderExportOptions | null;
  metadata: Record<string, any> | null;
  cancelRequested: boolean;
  error: string | null;
  lastError: string | null;
  errorHistory: CreativeRenderJobErrorEntry[];
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  workerToken: string | null;
  preflight: CreativeRenderPreflight;
  output: CreativeRenderJobOutput;
};

export function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function cloneData<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value: any, fallback = ''): string {
  return typeof value === 'string' ? value : (value == null ? fallback : String(value));
}

export function normalizeCreativeRenderFormat(raw: any, fallback: CreativeRenderFormat = 'render'): CreativeRenderFormat {
  const normalized = String(raw || '').trim().toLowerCase();
  switch (normalized) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'pdf':
    case 'webm':
    case 'mp4':
    case 'gif':
    case 'render':
      return normalized;
    default:
      return fallback;
  }
}

function normalizeCreativeRenderPreflightStatus(raw: any, fallback: CreativeRenderPreflight['status'] = 'ready'): CreativeRenderPreflight['status'] {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'ready' || normalized === 'warning' || normalized === 'blocked') return normalized;
  return fallback;
}

function mimeTypeForCreativeRenderFormat(format: CreativeRenderFormat): string | null {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'webm':
      return 'video/webm';
    case 'mp4':
      return 'video/mp4';
    case 'gif':
      return 'image/gif';
    default:
      return null;
  }
}

export function normalizeCreativeRenderJobStatus(raw: any, fallback: CreativeRenderJobStatus = 'queued'): CreativeRenderJobStatus {
  const normalized = String(raw || '').trim().toLowerCase();
  switch (normalized) {
    case 'queued':
    case 'running':
    case 'retrying':
    case 'uploading':
    case 'completed':
    case 'cancel_requested':
    case 'canceled':
    case 'failed':
      return normalized;
    default:
      return fallback;
  }
}

export function isCreativeRenderJobTerminal(status: any): boolean {
  const normalized = normalizeCreativeRenderJobStatus(status, 'queued');
  return normalized === 'completed' || normalized === 'canceled' || normalized === 'failed';
}

export function normalizeCreativeAudioAnalysis(input: any = {}): CreativeAudioAnalysis | null {
  if (!isPlainObject(input)) return null;
  const peaks = Array.isArray(input.waveformPeaks)
    ? input.waveformPeaks
        .map((value) => clampNumber(Number(value) || 0, 0, 1))
        .filter((value) => Number.isFinite(value))
    : [];
  const sourceTypeRaw = String(input.sourceType || '').trim().toLowerCase();
  const sourceType: CreativeAudioSourceType = (
    sourceTypeRaw === 'workspace'
    || sourceTypeRaw === 'absolute'
    || sourceTypeRaw === 'remote'
    || sourceTypeRaw === 'missing'
    || sourceTypeRaw === 'empty'
  )
    ? sourceTypeRaw as CreativeAudioSourceType
    : 'missing';
  const statusRaw = String(input.status || '').trim().toLowerCase();
  const status: CreativeAudioAnalysisStatus = (
    statusRaw === 'ready'
    || statusRaw === 'unavailable'
    || statusRaw === 'error'
  )
    ? statusRaw as CreativeAudioAnalysisStatus
    : (peaks.length || Number.isFinite(Number(input.durationMs)) ? 'ready' : 'unavailable');
  return {
    status,
    sourceType,
    source: normalizeString(input.source),
    resolvedPath: input.resolvedPath ? normalizeString(input.resolvedPath) : null,
    resolvedPathRelative: input.resolvedPathRelative ? normalizeString(input.resolvedPathRelative) : null,
    analyzedAt: input.analyzedAt ? normalizeString(input.analyzedAt) : null,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Math.max(0, Number(input.durationMs)) : null,
    sampleRate: Number.isFinite(Number(input.sampleRate)) ? Math.max(1, Number(input.sampleRate)) : null,
    channels: Number.isFinite(Number(input.channels)) ? Math.max(1, Number(input.channels)) : null,
    bitRate: Number.isFinite(Number(input.bitRate)) ? Math.max(0, Number(input.bitRate)) : null,
    codec: input.codec ? normalizeString(input.codec) : null,
    mimeType: input.mimeType ? normalizeString(input.mimeType) : null,
    size: Number.isFinite(Number(input.size)) ? Math.max(0, Number(input.size)) : null,
    waveformBucketCount: Math.max(0, Number(input.waveformBucketCount) || peaks.length || 0),
    waveformPeaks: peaks,
    cachePath: input.cachePath ? normalizeString(input.cachePath) : null,
    cachePathRelative: input.cachePathRelative ? normalizeString(input.cachePathRelative) : null,
    error: input.error ? normalizeString(input.error) : null,
  };
}

export function normalizeCreativeAudioTrack(input: any = {}): CreativeAudioTrack {
  const analysis = normalizeCreativeAudioAnalysis(input.analysis);
  return {
    source: normalizeString(input.source),
    label: normalizeString(input.label),
    startMs: Math.max(0, Number(input.startMs) || 0),
    durationMs: Math.max(0, Number(input.durationMs) || 0),
    trimStartMs: Math.max(0, Number(input.trimStartMs) || 0),
    trimEndMs: Math.max(0, Number(input.trimEndMs) || 0),
    volume: clampNumber(Number.isFinite(Number(input.volume)) ? Number(input.volume) : 1, 0, 1),
    muted: input.muted === true,
    fadeInMs: Math.max(0, Number(input.fadeInMs) || 0),
    fadeOutMs: Math.max(0, Number(input.fadeOutMs) || 0),
    analysis,
  };
}

function normalizeCreativeSocialFormat(raw: any, fallback: CreativeSocialFormat = 'reel'): CreativeSocialFormat {
  const normalized = String(raw || '').trim().toLowerCase();
  switch (normalized) {
    case 'reel':
    case 'short':
    case 'story':
    case 'square':
    case 'feed45':
    case 'youtube':
      return normalized;
    case 'feed':
    case '4:5':
      return 'feed45';
    case '16:9':
      return 'youtube';
    case '1:1':
      return 'square';
    default:
      return fallback;
  }
}

export function normalizeCreativeBrandKit(input: any = {}): CreativeBrandKit | null {
  if (!isPlainObject(input)) return null;
  const colors = isPlainObject(input.colors) ? input.colors : {};
  const fonts = isPlainObject(input.fonts) ? input.fonts : {};
  return {
    id: normalizeString(input.id, 'brand'),
    name: normalizeString(input.name, 'Brand'),
    colors: {
      primary: normalizeString(colors.primary, '#ff4d2d') || '#ff4d2d',
      secondary: normalizeString(colors.secondary, '#111827') || '#111827',
      accent: normalizeString(colors.accent, '#f7c948') || '#f7c948',
      background: normalizeString(colors.background, '#0f172a') || '#0f172a',
      text: normalizeString(colors.text, '#ffffff') || '#ffffff',
    },
    fonts: {
      heading: normalizeString(fonts.heading, 'Inter') || 'Inter',
      body: normalizeString(fonts.body, 'Inter') || 'Inter',
    },
    logo: input.logo ? normalizeString(input.logo) : null,
  };
}

export function normalizeCreativeCaptionTrack(input: any = {}): CreativeCaptionTrack | null {
  if (!isPlainObject(input)) return null;
  const segments = Array.isArray(input.segments)
    ? input.segments.map((segment: any, index: number) => {
        const startMs = Math.max(0, Number(segment?.startMs) || 0);
        const endMs = Math.max(startMs + 1, Number(segment?.endMs) || startMs + 1400);
        return {
          id: normalizeString(segment?.id, `caption_${index + 1}`),
          startMs,
          endMs,
          text: normalizeString(segment?.text),
          words: Array.isArray(segment?.words)
            ? segment.words.map((word: any, wordIndex: number) => {
                const wordStartMs = Math.max(startMs, Number(word?.startMs) || startMs);
                const wordEndMs = Math.max(wordStartMs + 1, Number(word?.endMs) || wordStartMs + 250);
                return {
                  text: normalizeString(word?.text),
                  startMs: wordStartMs,
                  endMs: wordEndMs,
                  confidence: Number.isFinite(Number(word?.confidence)) ? clampNumber(Number(word.confidence), 0, 1) : null,
                };
              }).filter((word: CreativeCaptionWord) => !!word.text)
            : normalizeString(segment?.text).split(/\s+/).filter(Boolean).map((word: string, wordIndex: number, words: string[]) => {
                const span = Math.max(1, endMs - startMs);
                const wordStartMs = startMs + Math.round((span / Math.max(1, words.length)) * wordIndex);
                const wordEndMs = wordIndex >= words.length - 1
                  ? endMs
                  : startMs + Math.round((span / Math.max(1, words.length)) * (wordIndex + 1));
                return { text: word, startMs: wordStartMs, endMs: wordEndMs, confidence: null };
              }),
        };
      }).filter((segment: CreativeCaptionSegment) => !!segment.text || segment.words.length > 0)
    : [];
  return {
    id: normalizeString(input.id, 'captions'),
    language: input.language ? normalizeString(input.language) : null,
    source: input.source ? normalizeString(input.source) : null,
    segments,
  };
}

export function normalizeCreativeMotionInput(input: any = {}): CreativeMotionInput {
  const safeInput = isPlainObject(input) ? input : {};
  const socialFormat = normalizeCreativeSocialFormat(safeInput.socialFormat, 'reel');
  return {
    templateId: normalizeString(safeInput.templateId, 'caption-reel'),
    presetId: safeInput.presetId ? normalizeString(safeInput.presetId) : null,
    socialFormat,
    width: Math.max(1, Number(safeInput.width) || (socialFormat === 'youtube' ? 1920 : 1080)),
    height: Math.max(1, Number(safeInput.height) || (socialFormat === 'youtube' ? 1080 : (socialFormat === 'square' ? 1080 : 1920))),
    fps: Math.max(1, Number(safeInput.fps) || Number(safeInput.frameRate) || 30),
    durationMs: Math.max(1000, Number(safeInput.durationMs) || 12000),
    brand: normalizeCreativeBrandKit(safeInput.brand),
    assets: Array.isArray(safeInput.assets) ? cloneData(safeInput.assets) : [],
    captions: normalizeCreativeCaptionTrack(safeInput.captions),
    audioAnalysis: normalizeCreativeAudioAnalysis(safeInput.audioAnalysis),
    text: {
      title: normalizeString(safeInput.text?.title || safeInput.title),
      subtitle: normalizeString(safeInput.text?.subtitle || safeInput.subtitle),
      body: normalizeString(safeInput.text?.body || safeInput.body),
      cta: normalizeString(safeInput.text?.cta || safeInput.cta),
    },
    style: isPlainObject(safeInput.style) ? cloneData(safeInput.style) : {},
  };
}

export function normalizeCreativeMotionTemplateInstance(input: any = {}): CreativeMotionTemplateInstance | null {
  if (!isPlainObject(input)) return null;
  const motionInput = normalizeCreativeMotionInput(input.input || input);
  return {
    id: normalizeString(input.id, `motion_${Date.now().toString(36)}`),
    type: 'motionTemplate',
    templateId: normalizeString(input.templateId || motionInput.templateId, motionInput.templateId),
    presetId: input.presetId ? normalizeString(input.presetId) : motionInput.presetId,
    socialFormat: normalizeCreativeSocialFormat(input.socialFormat || motionInput.socialFormat, motionInput.socialFormat),
    startMs: Math.max(0, Number(input.startMs) || 0),
    durationMs: Math.max(1000, Number(input.durationMs) || motionInput.durationMs || 12000),
    locked: input.locked === true,
    input: motionInput,
    preview: isPlainObject(input.preview) ? cloneData(input.preview) : null,
  };
}

export function normalizeCreativeSceneDoc(input: any = {}): CreativeSceneDoc {
  const safeInput = isPlainObject(input) ? input : {};
  return {
    id: normalizeString(safeInput.id, 'scene'),
    version: Number.isFinite(Number(safeInput.version)) ? Number(safeInput.version) : 2,
    width: Number.isFinite(Number(safeInput.width)) ? Number(safeInput.width) : 1280,
    height: Number.isFinite(Number(safeInput.height)) ? Number(safeInput.height) : 720,
    background: normalizeString(safeInput.background, '#ffffff') || '#ffffff',
    durationMs: Math.max(1000, Number(safeInput.durationMs) || 12000),
    frameRate: Math.max(1, Number(safeInput.frameRate) || 30),
    audioTrack: normalizeCreativeAudioTrack(safeInput.audioTrack),
    elements: Array.isArray(safeInput.elements) ? cloneData(safeInput.elements) : [],
    motionTemplates: Array.isArray(safeInput.motionTemplates)
      ? safeInput.motionTemplates.map(normalizeCreativeMotionTemplateInstance).filter(Boolean) as CreativeMotionTemplateInstance[]
      : [],
    captions: Array.isArray(safeInput.captions)
      ? safeInput.captions.map(normalizeCreativeCaptionTrack).filter(Boolean) as CreativeCaptionTrack[]
      : [],
    brandKit: normalizeCreativeBrandKit(safeInput.brandKit),
    selectedId: safeInput.selectedId ? normalizeString(safeInput.selectedId) : null,
  };
}

export function summarizeCreativeSceneDoc(doc: any): CreativeSceneSummary {
  const normalized = normalizeCreativeSceneDoc(doc);
  const elements = Array.isArray(normalized.elements) ? normalized.elements : [];
  return {
    width: normalized.width,
    height: normalized.height,
    background: normalized.background,
    durationMs: normalized.durationMs,
    frameRate: normalized.frameRate,
    elementCount: elements.length,
    textCount: elements.filter((element: any) => element?.type === 'text').length,
    imageCount: elements.filter((element: any) => element?.type === 'image').length,
    iconCount: elements.filter((element: any) => element?.type === 'icon').length,
    groupCount: elements.filter((element: any) => element?.type === 'group').length,
    animatedCount: elements.filter((element: any) => Array.isArray(element?.meta?.keyframes) && element.meta.keyframes.length > 0).length,
    hasAudio: !!normalized.audioTrack.source,
    audioDurationMs: normalized.audioTrack.durationMs || normalized.audioTrack.analysis?.durationMs || null,
  };
}

// ── Composition (multi-clip timeline) ────────────────────────────────────────

export type CreativeClipLane = 'html-motion' | 'remotion';

export type CreativeTransitionKind =
  | 'cut'
  | 'fade'
  | 'crossfade'
  | 'wipe-left'
  | 'wipe-right'
  | 'dip-to-color';

export type CreativeTransitionSpec = {
  kind: CreativeTransitionKind;
  durationMs: number;
  color?: string;
};

export type CreativeTrackKind = 'video' | 'audio' | 'caption';

export type CreativeTrack = {
  id: string;
  kind: CreativeTrackKind;
  label: string;
  index: number;
  height: number;
  muted: boolean;
  locked: boolean;
  hidden: boolean;
};

export type CreativeClipSource =
  | { kind: 'html-motion'; clipPath: string; compositionId?: string | null }
  | { kind: 'remotion'; templateId: string; presetId?: string | null; input: any };

export type CreativeClip = {
  id: string;
  trackId: string;
  label: string;
  inMs: number;            // master-timeline start
  outMs: number;           // master-timeline end (exclusive)
  trimStartMs: number;     // skipped from clip head
  trimEndMs: number;       // skipped from clip tail
  lane: CreativeClipLane;
  source: CreativeClipSource;
  transitionIn: CreativeTransitionSpec | null;
  transitionOut: CreativeTransitionSpec | null;
  locked: boolean;
  meta: Record<string, any>;
};

export type CreativeComposition = {
  id: string;
  version: number;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;        // master timeline duration
  background: string;
  tracks: CreativeTrack[];
  clips: CreativeClip[];
  audioTracks: CreativeAudioTrack[];
  captions: CreativeCaptionTrack[];
  brandKit: CreativeBrandKit | null;
  selectedClipId: string | null;
  meta: Record<string, any>;
};

export type CreativeCompositionSummary = {
  width: number;
  height: number;
  durationMs: number;
  frameRate: number;
  trackCount: number;
  clipCount: number;
  videoClipCount: number;
  audioTrackCount: number;
  captionTrackCount: number;
  hasGaps: boolean;
  hasOverlaps: boolean;
};

function compositionId(prefix = 'comp'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTransitionSpec(input: any): CreativeTransitionSpec | null {
  if (!isPlainObject(input)) return null;
  const kindRaw = String(input.kind || 'cut').trim().toLowerCase();
  const kindAllowed: CreativeTransitionKind[] = ['cut', 'fade', 'crossfade', 'wipe-left', 'wipe-right', 'dip-to-color'];
  const kind = (kindAllowed.includes(kindRaw as CreativeTransitionKind) ? kindRaw : 'cut') as CreativeTransitionKind;
  const durationMs = Math.max(0, Number(input.durationMs) || 0);
  if (kind === 'cut' || durationMs <= 0) return { kind: 'cut', durationMs: 0 };
  const out: CreativeTransitionSpec = { kind, durationMs };
  if (typeof input.color === 'string' && input.color.trim()) out.color = input.color.trim();
  return out;
}

function normalizeCreativeTrack(input: any, fallbackIndex = 0): CreativeTrack {
  const safe = isPlainObject(input) ? input : {};
  const kindRaw = String(safe.kind || 'video').trim().toLowerCase();
  const kind = (['video', 'audio', 'caption'].includes(kindRaw) ? kindRaw : 'video') as CreativeTrackKind;
  return {
    id: normalizeString(safe.id, '') || compositionId('track'),
    kind,
    label: normalizeString(safe.label, kind === 'video' ? `V${fallbackIndex + 1}` : kind === 'audio' ? `A${fallbackIndex + 1}` : `C${fallbackIndex + 1}`),
    index: Number.isFinite(Number(safe.index)) ? Number(safe.index) : fallbackIndex,
    height: Math.max(24, Number(safe.height) || (kind === 'video' ? 56 : kind === 'audio' ? 44 : 36)),
    muted: safe.muted === true,
    locked: safe.locked === true,
    hidden: safe.hidden === true,
  };
}

function normalizeClipSource(input: any): CreativeClipSource {
  const safe = isPlainObject(input) ? input : {};
  const kindRaw = String(safe.kind || 'html-motion').trim().toLowerCase();
  if (kindRaw === 'html-motion') {
    return {
      kind: 'html-motion',
      clipPath: normalizeString(safe.clipPath, ''),
      compositionId: typeof safe.compositionId === 'string' ? safe.compositionId : null,
    };
  }
  if (kindRaw === 'remotion') {
    return {
      kind: 'remotion',
      templateId: normalizeString(safe.templateId, ''),
      presetId: typeof safe.presetId === 'string' ? safe.presetId : null,
      input: cloneData(safe.input ?? {}),
    };
  }
  return {
    kind: 'html-motion',
    clipPath: '',
    compositionId: null,
  };
}

export function normalizeCreativeClip(input: any, fallback: { fps?: number } = {}): CreativeClip {
  const safe = isPlainObject(input) ? input : {};
  const inMs = Math.max(0, Number(safe.inMs) || 0);
  let outMs = Math.max(inMs, Number(safe.outMs) || 0);
  if (outMs <= inMs) outMs = inMs + Math.max(1, Number(safe.durationMs) || 4000);
  const laneRaw = String(safe.lane || safe.source?.kind || '').trim().toLowerCase();
  const lane = (['html-motion', 'remotion'].includes(laneRaw) ? laneRaw : 'html-motion') as CreativeClipLane;
  return {
    id: normalizeString(safe.id, '') || compositionId('clip'),
    trackId: normalizeString(safe.trackId, ''),
    label: normalizeString(safe.label, 'Clip'),
    inMs,
    outMs,
    trimStartMs: Math.max(0, Number(safe.trimStartMs) || 0),
    trimEndMs: Math.max(0, Number(safe.trimEndMs) || 0),
    lane,
    source: normalizeClipSource(safe.source),
    transitionIn: normalizeTransitionSpec(safe.transitionIn),
    transitionOut: normalizeTransitionSpec(safe.transitionOut),
    locked: safe.locked === true,
    meta: isPlainObject(safe.meta) ? cloneData(safe.meta) : {},
  };
}

function defaultCompositionTracks(): CreativeTrack[] {
  return [
    normalizeCreativeTrack({ kind: 'video', label: 'V1' }, 0),
    normalizeCreativeTrack({ kind: 'audio', label: 'A1' }, 0),
    normalizeCreativeTrack({ kind: 'caption', label: 'C1' }, 0),
  ];
}

export function normalizeCreativeComposition(input: any = {}): CreativeComposition {
  const safe = isPlainObject(input) ? input : {};
  const tracksIn = Array.isArray(safe.tracks) ? safe.tracks : [];
  const tracks = tracksIn.length > 0
    ? tracksIn.map((track: any, idx: number) => normalizeCreativeTrack(track, idx))
    : defaultCompositionTracks();
  const clipsIn = Array.isArray(safe.clips) ? safe.clips : [];
  const clips = clipsIn.map((clip: any) => normalizeCreativeClip(clip));
  // assign a default trackId to clips that don't have one yet
  const firstVideoTrack = tracks.find((t) => t.kind === 'video');
  if (firstVideoTrack) {
    for (const clip of clips) {
      if (!clip.trackId) clip.trackId = firstVideoTrack.id;
    }
  }
  const audioTracks = Array.isArray(safe.audioTracks)
    ? safe.audioTracks.map(normalizeCreativeAudioTrack)
    : [];
  const captions = Array.isArray(safe.captions)
    ? safe.captions.map(normalizeCreativeCaptionTrack).filter(Boolean) as CreativeCaptionTrack[]
    : [];
  const computedDurationMs = clips.length > 0
    ? clips.reduce((max, c) => Math.max(max, c.outMs), 0)
    : 0;
  const durationMs = Math.max(1000, Number(safe.durationMs) || computedDurationMs || 12000);
  return {
    id: normalizeString(safe.id, '') || compositionId(),
    version: Number.isFinite(Number(safe.version)) ? Number(safe.version) : 1,
    width: Number.isFinite(Number(safe.width)) ? Number(safe.width) : 1920,
    height: Number.isFinite(Number(safe.height)) ? Number(safe.height) : 1080,
    frameRate: Math.max(1, Number(safe.frameRate) || 30),
    durationMs,
    background: normalizeString(safe.background, '#000000') || '#000000',
    tracks,
    clips,
    audioTracks,
    captions,
    brandKit: normalizeCreativeBrandKit(safe.brandKit),
    selectedClipId: safe.selectedClipId ? normalizeString(safe.selectedClipId) : null,
    meta: isPlainObject(safe.meta) ? cloneData(safe.meta) : {},
  };
}

export function summarizeCreativeComposition(comp: any): CreativeCompositionSummary {
  const c = normalizeCreativeComposition(comp);
  const sortedByTrackThenIn = c.clips.slice().sort((a, b) => (a.trackId === b.trackId ? a.inMs - b.inMs : a.trackId.localeCompare(b.trackId)));
  let hasOverlaps = false;
  let hasGaps = false;
  let prevEnd = 0;
  let prevTrack = '';
  for (const clip of sortedByTrackThenIn) {
    if (clip.trackId !== prevTrack) {
      prevEnd = 0;
      prevTrack = clip.trackId;
      if (clip.inMs > 0) hasGaps = true;
    }
    if (clip.inMs < prevEnd) hasOverlaps = true;
    if (clip.inMs > prevEnd) hasGaps = true;
    prevEnd = Math.max(prevEnd, clip.outMs);
  }
  const videoTrackIds = new Set(c.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  return {
    width: c.width,
    height: c.height,
    durationMs: c.durationMs,
    frameRate: c.frameRate,
    trackCount: c.tracks.length,
    clipCount: c.clips.length,
    videoClipCount: c.clips.filter((clip) => videoTrackIds.has(clip.trackId)).length,
    audioTrackCount: c.audioTracks.length,
    captionTrackCount: c.captions.length,
    hasGaps,
    hasOverlaps,
  };
}

export function getCreativeAudioTrackWindow(trackInput: any = {}, durationMs = 12000): {
  startMs: number;
  trimStartMs: number;
  trimEndMs: number;
  sourceDurationMs: number;
  activeDurationMs: number;
  endMs: number;
} {
  const track = normalizeCreativeAudioTrack(trackInput);
  const startMs = Math.max(0, Number(track.startMs) || 0);
  const trimStartMs = Math.max(0, Number(track.trimStartMs) || 0);
  const trimEndMs = Math.max(0, Number(track.trimEndMs) || 0);
  const sourceDurationMs = Math.max(0, Number(track.analysis?.durationMs) || 0);
  const availableSourceMs = Math.max(0, sourceDurationMs - trimStartMs - trimEndMs);
  const explicitDurationMs = Math.max(0, Number(track.durationMs) || 0);
  const activeDurationMs = explicitDurationMs
    ? Math.min(explicitDurationMs, availableSourceMs || explicitDurationMs)
    : (availableSourceMs || Math.max(0, Number(durationMs) - startMs));
  return {
    startMs,
    trimStartMs,
    trimEndMs,
    sourceDurationMs,
    activeDurationMs: Math.max(0, activeDurationMs),
    endMs: startMs + Math.max(0, activeDurationMs),
  };
}

export function buildCreativeRenderPreflight({
  format,
  renderer,
  creativeMode = null,
  exportOptions = null,
  audioTrack = null,
  sceneDoc = null,
}: {
  format: any;
  renderer: any;
  creativeMode?: string | null;
  exportOptions?: CreativeRenderExportOptions | null;
  audioTrack?: CreativeAudioTrack | null;
  sceneDoc?: CreativeSceneDoc | null;
}): CreativeRenderPreflight {
  const normalizedFormat = normalizeCreativeRenderFormat(format, 'render');
  const normalizedRenderer = normalizeString(renderer, 'browser-hybrid') || 'browser-hybrid';
  const requiresVideoMode = ['webm', 'mp4', 'gif'].includes(normalizedFormat);
  const requiresServerWorker = normalizedRenderer === 'server-browser';
  const browserExportPossible = ['webm', 'mp4', 'gif', 'png', 'jpg', 'jpeg', 'svg', 'pdf'].includes(normalizedFormat);
  const serverExportPossible = requiresServerWorker
    ? ['webm', 'mp4', 'gif'].includes(normalizedFormat)
    : true;
  const warnings: string[] = [];
  const blockers: string[] = [];
  const normalizedSceneDoc = sceneDoc ? normalizeCreativeSceneDoc(sceneDoc) : null;
  const normalizedExportOptions = normalizeCreativeRenderExportOptions(exportOptions, normalizedSceneDoc);
  const normalizedAudioTrack = audioTrack ? normalizeCreativeAudioTrack(audioTrack) : (normalizedSceneDoc?.audioTrack || null);
  const audioRequested = normalizedExportOptions?.audioRequested === true || !!normalizedAudioTrack?.source;
  let audioReady = false;
  let audioOutcome: CreativeRenderPreflight['audioOutcome'] = 'not_requested';
  const analysisStatus = normalizedExportOptions?.audioAnalysisStatus || normalizedAudioTrack?.analysis?.status || null;

  if (requiresVideoMode && String(creativeMode || '').trim().toLowerCase() !== 'video') {
    blockers.push('Video export formats require video mode.');
  }
  if (requiresServerWorker && !serverExportPossible) {
    blockers.push(`Renderer ${normalizedRenderer} does not support ${normalizedFormat.toUpperCase()} server export.`);
  }
  if (!normalizedSceneDoc) {
    blockers.push('Render job is missing a normalized scene document.');
  }

  if (audioRequested) {
    if (normalizedFormat === 'gif') {
      audioOutcome = 'silent_export';
      warnings.push('GIF export does not include audio.');
    } else if (!normalizedAudioTrack?.source) {
      audioOutcome = 'missing_audio';
      warnings.push('Audio was requested but no source is attached.');
    } else if (analysisStatus === 'error') {
      audioOutcome = 'analysis_warning';
      warnings.push('Audio analysis reported an error; export may continue silently.');
    } else {
      audioOutcome = 'ready';
      audioReady = true;
    }
  }

  const status = blockers.length
    ? 'blocked'
    : (warnings.length ? 'warning' : 'ready');

  return {
    status,
    format: normalizedFormat,
    renderer: normalizedRenderer,
    requiresVideoMode,
    requiresServerWorker,
    browserExportPossible,
    serverExportPossible,
    audioRequested,
    audioReady,
    audioOutcome,
    warnings,
    blockers,
  };
}

export function buildCreativeRenderManifest(record: Partial<CreativeRenderJobRecord> = {}): CreativeRenderManifest {
  const sceneDoc = record.sceneDoc ? normalizeCreativeSceneDoc(record.sceneDoc) : null;
  const exportOptions = normalizeCreativeRenderExportOptions(record.exportOptions, sceneDoc);
  const requestedFormat = normalizeCreativeRenderFormat(record.format, 'render');
  const renderer = normalizeString(record.renderer, 'browser-hybrid') || 'browser-hybrid';
  const preflight = isPlainObject(record.preflight)
    ? buildCreativeRenderPreflight({
        format: record.preflight.format || requestedFormat,
        renderer: record.preflight.renderer || renderer,
        creativeMode: record.creativeMode || null,
        exportOptions,
        audioTrack: sceneDoc?.audioTrack || null,
        sceneDoc,
      })
    : buildCreativeRenderPreflight({
        format: requestedFormat,
        renderer,
        creativeMode: record.creativeMode || null,
        exportOptions,
        audioTrack: sceneDoc?.audioTrack || null,
        sceneDoc,
      });
  const metadata = isPlainObject(record.metadata) ? record.metadata : {};
  const isVideoFormat = ['webm', 'mp4', 'gif'].includes(requestedFormat);
  const pipeline = renderer === 'server-browser'
    ? 'server-browser-capture'
    : (isVideoFormat ? 'browser-capture' : 'static-browser-export');
  const defaultCaptureFormat = requestedFormat === 'mp4' ? 'webm' : requestedFormat;
  const captureFormat = normalizeCreativeRenderFormat(metadata.sourceFormat, defaultCaptureFormat);
  const deliveredFormat = normalizeCreativeRenderFormat(
    metadata.outputFormat,
    record.output?.mimeType ? requestedFormat : requestedFormat,
  );
  const width = Math.max(1, Number(exportOptions?.width) || Number(sceneDoc?.width) || 1280);
  const height = Math.max(1, Number(exportOptions?.height) || Number(sceneDoc?.height) || 720);
  const durationMs = Math.max(0, Number(exportOptions?.durationMs) || Number(sceneDoc?.durationMs) || 0);
  const frameRate = Math.max(1, Number(exportOptions?.frameRate) || Number(sceneDoc?.frameRate) || 30);
  const frameCount = Math.max(
    1,
    Number(exportOptions?.frameCount)
      || (durationMs > 0 ? Math.ceil((durationMs / 1000) * frameRate) + 1 : 1),
  );
  const audioTrack = sceneDoc?.audioTrack ? normalizeCreativeAudioTrack(sceneDoc.audioTrack) : null;
  const audioTiming = audioTrack ? getCreativeAudioTrackWindow(audioTrack, durationMs) : null;
  const audioRequested = preflight.audioRequested === true;
  const audioIncluded = metadata.audioIncluded === true;
  const serverFinishRequested = metadata.serverFinishRequested === true || (requestedFormat === 'mp4' && captureFormat !== 'mp4');

  return {
    version: 1,
    pipeline,
    requestedFormat,
    captureFormat,
    captureMimeType: metadata.sourceMimeType ? normalizeString(metadata.sourceMimeType) : mimeTypeForCreativeRenderFormat(captureFormat),
    deliveredFormat,
    deliveredMimeType: metadata.outputMimeType
      ? normalizeString(metadata.outputMimeType)
      : (record.output?.mimeType ? normalizeString(record.output.mimeType) : mimeTypeForCreativeRenderFormat(deliveredFormat)),
    renderer,
    durationMs,
    frameRate,
    frameCount,
    width,
    height,
    audio: {
      requested: audioRequested,
      source: audioTrack?.source || null,
      sourceType: audioTrack?.analysis?.sourceType || null,
      ready: preflight.audioReady === true,
      outcome: preflight.audioOutcome,
      includeInCapture: audioRequested && audioIncluded,
      requiresServerMix: audioRequested && isVideoFormat && !audioIncluded && requestedFormat !== 'gif',
      activeDurationMs: exportOptions?.audioActiveDurationMs ?? audioTiming?.activeDurationMs ?? null,
      trimStartMs: exportOptions?.audioTrimStartMs ?? audioTiming?.trimStartMs ?? 0,
      trimEndMs: exportOptions?.audioTrimEndMs ?? audioTiming?.trimEndMs ?? 0,
      fadeInMs: Math.max(0, Number(audioTrack?.fadeInMs) || 0),
      fadeOutMs: Math.max(0, Number(audioTrack?.fadeOutMs) || 0),
    },
    serverFinish: {
      requested: serverFinishRequested,
      preferred: metadata.serverFinishPreferred === true || requestedFormat === 'mp4',
      tool: metadata.serverFinishTool ? normalizeString(metadata.serverFinishTool) : (serverFinishRequested ? 'ffmpeg' : null),
      available: metadata.serverFinishToolAvailable === undefined ? null : metadata.serverFinishToolAvailable === true,
      status: metadata.serverFinishStatus ? normalizeString(metadata.serverFinishStatus) : null,
      reason: metadata.serverFinishReason ? normalizeString(metadata.serverFinishReason) : null,
    },
  };
}

export function normalizeCreativeRenderExportOptions(raw: any, sceneDoc: CreativeSceneDoc | null = null): CreativeRenderExportOptions | null {
  if (!isPlainObject(raw) && !sceneDoc) return null;
  const width = Number.isFinite(Number(raw?.width)) ? Number(raw.width) : (sceneDoc?.width || 1280);
  const height = Number.isFinite(Number(raw?.height)) ? Number(raw.height) : (sceneDoc?.height || 720);
  const durationMs = Math.max(1000, Number(raw?.durationMs) || (sceneDoc?.durationMs || 12000));
  const frameRate = Math.max(1, Number(raw?.frameRate) || (sceneDoc?.frameRate || 30));
  const audioTrack = sceneDoc?.audioTrack ? normalizeCreativeAudioTrack(sceneDoc.audioTrack) : null;
  const audioTiming = audioTrack ? getCreativeAudioTrackWindow(audioTrack, durationMs) : null;
  return {
    durationMs,
    frameRate,
    width,
    height,
    frameCount: Number.isFinite(Number(raw?.frameCount)) ? Math.max(1, Number(raw.frameCount)) : null,
    audioRequested: raw?.audioRequested === true || !!sceneDoc?.audioTrack?.source,
    audioAnalysisStatus: raw?.audioAnalysisStatus
      ? (String(raw.audioAnalysisStatus).trim().toLowerCase() as CreativeAudioAnalysisStatus)
      : (audioTrack?.analysis?.status || null),
    audioSourceDurationMs: Number.isFinite(Number(raw?.audioSourceDurationMs))
      ? Math.max(0, Number(raw.audioSourceDurationMs))
      : (audioTiming?.sourceDurationMs || null),
    audioActiveDurationMs: Number.isFinite(Number(raw?.audioActiveDurationMs))
      ? Math.max(0, Number(raw.audioActiveDurationMs))
      : (audioTiming?.activeDurationMs || null),
    audioTrimStartMs: Number.isFinite(Number(raw?.audioTrimStartMs))
      ? Math.max(0, Number(raw.audioTrimStartMs))
      : (audioTiming?.trimStartMs || 0),
    audioTrimEndMs: Number.isFinite(Number(raw?.audioTrimEndMs))
      ? Math.max(0, Number(raw.audioTrimEndMs))
      : (audioTiming?.trimEndMs || 0),
  };
}

export function buildCreativeRenderWorkerInput(record: CreativeRenderJobRecord): CreativeRenderWorkerInput {
  const sceneDoc = record.sceneDoc ? normalizeCreativeSceneDoc(record.sceneDoc) : null;
  const exportOptions = normalizeCreativeRenderExportOptions(record.exportOptions, record.sceneDoc);
  const audioTrack = record.sceneDoc?.audioTrack ? normalizeCreativeAudioTrack(record.sceneDoc.audioTrack) : null;
  const preflight = buildCreativeRenderPreflight({
    format: record.format,
    renderer: record.renderer,
    creativeMode: record.creativeMode,
    exportOptions,
    audioTrack,
    sceneDoc,
  });
  return {
    format: normalizeCreativeRenderFormat(record.format, 'render'),
    renderer: normalizeString(record.renderer, 'browser-hybrid'),
    creativeMode: record.creativeMode || null,
    sceneDoc,
    exportOptions,
    audioTrack,
    preflight,
    manifest: buildCreativeRenderManifest({ ...record, sceneDoc, exportOptions, preflight }),
  };
}

export function normalizeCreativeRenderJobRecord(
  input: any = {},
  defaults: Partial<CreativeRenderJobRecord> = {},
): CreativeRenderJobRecord {
  const safeInput = isPlainObject(input) ? input : {};
  const safeDefaults = isPlainObject(defaults) ? defaults : {};
  const sceneDoc = safeInput.sceneDoc || safeDefaults.sceneDoc
    ? normalizeCreativeSceneDoc(safeInput.sceneDoc || safeDefaults.sceneDoc)
    : null;
  const errorHistory = Array.isArray(safeInput.errorHistory)
    ? safeInput.errorHistory
        .map((entry) => (
          isPlainObject(entry)
            ? {
                at: normalizeString(entry.at || safeInput.updatedAt || new Date().toISOString()),
                phase: entry.phase ? normalizeString(entry.phase) : null,
                message: normalizeString(entry.message),
              }
            : null
        ))
        .filter(Boolean) as CreativeRenderJobErrorEntry[]
    : (Array.isArray(safeDefaults.errorHistory) ? cloneData(safeDefaults.errorHistory) : []);
  const record: CreativeRenderJobRecord = {
    kind: 'prometheus-creative-render-job',
    version: Number.isFinite(Number(safeInput.version)) ? Number(safeInput.version) : (Number.isFinite(Number(safeDefaults.version)) ? Number(safeDefaults.version) : 2),
    id: normalizeString(safeInput.id, normalizeString(safeDefaults.id, 'render-job')),
    sessionId: normalizeString(safeInput.sessionId, normalizeString(safeDefaults.sessionId, 'default')),
    creativeMode: safeInput.creativeMode !== undefined ? (safeInput.creativeMode ? normalizeString(safeInput.creativeMode) : null) : (safeDefaults.creativeMode || null),
    format: normalizeCreativeRenderFormat(safeInput.format, normalizeCreativeRenderFormat(safeDefaults.format, 'render')),
    renderer: normalizeString(safeInput.renderer, normalizeString(safeDefaults.renderer, 'browser-hybrid')) || 'browser-hybrid',
    requestedAt: normalizeString(safeInput.requestedAt, normalizeString(safeDefaults.requestedAt, new Date().toISOString())),
    updatedAt: normalizeString(safeInput.updatedAt, normalizeString(safeDefaults.updatedAt, new Date().toISOString())),
    startedAt: safeInput.startedAt ? normalizeString(safeInput.startedAt) : (safeDefaults.startedAt || null),
    finishedAt: safeInput.finishedAt ? normalizeString(safeInput.finishedAt) : (safeDefaults.finishedAt || null),
    status: normalizeCreativeRenderJobStatus(safeInput.status, normalizeCreativeRenderJobStatus(safeDefaults.status, 'queued')),
    progress: clampNumber(Number(safeInput.progress ?? safeDefaults.progress) || 0, 0, 1),
    progressLabel: safeInput.progressLabel !== undefined ? (safeInput.progressLabel ? normalizeString(safeInput.progressLabel) : null) : (safeDefaults.progressLabel || null),
    storageRoot: normalizeString(safeInput.storageRoot, normalizeString(safeDefaults.storageRoot)),
    storageRootRelative: normalizeString(safeInput.storageRootRelative, normalizeString(safeDefaults.storageRootRelative)),
    usesProjectRoot: safeInput.usesProjectRoot === true || safeDefaults.usesProjectRoot === true,
    summary: safeInput.summary
      ? (isPlainObject(safeInput.summary) ? cloneData(safeInput.summary) : safeInput.summary)
      : (sceneDoc ? summarizeCreativeSceneDoc(sceneDoc) : (safeDefaults.summary ? cloneData(safeDefaults.summary) : null)),
    sceneDoc,
    exportOptions: normalizeCreativeRenderExportOptions(safeInput.exportOptions ?? safeDefaults.exportOptions, sceneDoc),
    metadata: isPlainObject(safeInput.metadata)
      ? cloneData(safeInput.metadata)
      : (isPlainObject(safeDefaults.metadata) ? cloneData(safeDefaults.metadata) : null),
    cancelRequested: safeInput.cancelRequested === true || safeDefaults.cancelRequested === true,
    error: safeInput.error ? normalizeString(safeInput.error) : (safeDefaults.error || null),
    lastError: safeInput.lastError ? normalizeString(safeInput.lastError) : (safeInput.error ? normalizeString(safeInput.error) : (safeDefaults.lastError || null)),
    errorHistory,
    attemptCount: Math.max(0, Number(safeInput.attemptCount ?? safeDefaults.attemptCount) || 0),
    maxAttempts: Math.max(1, Number(safeInput.maxAttempts ?? safeDefaults.maxAttempts) || 1),
    retryable: safeInput.retryable === true || (safeInput.retryable === undefined && safeDefaults.retryable === true),
    workerToken: safeInput.workerToken ? normalizeString(safeInput.workerToken) : (safeDefaults.workerToken || null),
    preflight: {
      status: 'ready',
      format: 'render',
      renderer: 'browser-hybrid',
      requiresVideoMode: false,
      requiresServerWorker: false,
      browserExportPossible: true,
      serverExportPossible: true,
      audioRequested: false,
      audioReady: false,
      audioOutcome: 'not_requested',
      warnings: [],
      blockers: [],
    },
    output: safeInput.output && isPlainObject(safeInput.output)
      ? {
          filename: safeInput.output.filename ? normalizeString(safeInput.output.filename) : null,
          path: safeInput.output.path ? normalizeString(safeInput.output.path) : null,
          absPath: safeInput.output.absPath ? normalizeString(safeInput.output.absPath) : null,
          mimeType: safeInput.output.mimeType ? normalizeString(safeInput.output.mimeType) : null,
          size: Number.isFinite(Number(safeInput.output.size)) ? Math.max(0, Number(safeInput.output.size)) : null,
        }
      : (safeDefaults.output ? cloneData(safeDefaults.output) : null),
  };
  record.preflight = buildCreativeRenderPreflight({
    format: safeInput.preflight?.format || record.format,
    renderer: safeInput.preflight?.renderer || record.renderer,
    creativeMode: record.creativeMode,
    exportOptions: record.exportOptions,
    audioTrack: sceneDoc?.audioTrack || null,
    sceneDoc,
  });
  if (isPlainObject(safeInput.preflight)) {
    record.preflight = {
      ...record.preflight,
      status: normalizeCreativeRenderPreflightStatus(safeInput.preflight.status, record.preflight.status),
      browserExportPossible: safeInput.preflight.browserExportPossible === undefined ? record.preflight.browserExportPossible : safeInput.preflight.browserExportPossible === true,
      serverExportPossible: safeInput.preflight.serverExportPossible === undefined ? record.preflight.serverExportPossible : safeInput.preflight.serverExportPossible === true,
      audioRequested: safeInput.preflight.audioRequested === undefined ? record.preflight.audioRequested : safeInput.preflight.audioRequested === true,
      audioReady: safeInput.preflight.audioReady === undefined ? record.preflight.audioReady : safeInput.preflight.audioReady === true,
      audioOutcome: ['not_requested', 'ready', 'silent_export', 'analysis_warning', 'missing_audio'].includes(String(safeInput.preflight.audioOutcome || '').trim().toLowerCase())
        ? String(safeInput.preflight.audioOutcome).trim().toLowerCase() as CreativeRenderPreflight['audioOutcome']
        : record.preflight.audioOutcome,
      warnings: Array.isArray(safeInput.preflight.warnings)
        ? safeInput.preflight.warnings.map((entry: any) => normalizeString(entry)).filter(Boolean)
        : record.preflight.warnings,
      blockers: Array.isArray(safeInput.preflight.blockers)
        ? safeInput.preflight.blockers.map((entry: any) => normalizeString(entry)).filter(Boolean)
        : record.preflight.blockers,
    };
  }
  if (record.status === 'completed') record.progress = 1;
  if (record.cancelRequested && !isCreativeRenderJobTerminal(record.status)) {
    record.status = record.status === 'running' ? 'cancel_requested' : record.status;
  }
  return record;
}

export function appendCreativeRenderJobError(
  record: CreativeRenderJobRecord,
  error: any,
  phase: string | null = null,
): CreativeRenderJobRecord {
  const message = normalizeString(error?.message || error || 'Creative render job failed.');
  const nextHistory = [...(Array.isArray(record.errorHistory) ? record.errorHistory : []), {
    at: new Date().toISOString(),
    phase: phase ? normalizeString(phase) : null,
    message,
  }].slice(-12);
  return normalizeCreativeRenderJobRecord({
    ...record,
    error: message,
    lastError: message,
    errorHistory: nextHistory,
  }, record);
}

export function bumpCreativeRenderJobAttempt(record: CreativeRenderJobRecord, workerToken: string | null = null): CreativeRenderJobRecord {
  return normalizeCreativeRenderJobRecord({
    ...record,
    attemptCount: Math.max(0, Number(record.attemptCount) || 0) + 1,
    workerToken: workerToken || null,
  }, record);
}

export function normalizeCreativeSceneEnvelope(
  raw: any,
  options: { sessionId?: string; creativeMode?: string | null; storageRoot?: string | null; savedAt?: string } = {},
): {
  kind: 'prometheus-creative-scene';
  version: number;
  savedAt: string;
  sessionId: string | null;
  creativeMode: string | null;
  storageRoot: string | null;
  summary: CreativeSceneSummary;
  doc: CreativeSceneDoc;
} {
  const sourceDoc = isPlainObject(raw?.doc) ? raw.doc : raw;
  const doc = normalizeCreativeSceneDoc(sourceDoc);
  return {
    kind: 'prometheus-creative-scene',
    version: Math.max(2, Number(raw?.version) || 2),
    savedAt: normalizeString(options.savedAt || raw?.savedAt, new Date().toISOString()),
    sessionId: options.sessionId ? normalizeString(options.sessionId) : (raw?.sessionId ? normalizeString(raw.sessionId) : null),
    creativeMode: options.creativeMode !== undefined ? options.creativeMode : (raw?.creativeMode ? normalizeString(raw.creativeMode) : null),
    storageRoot: options.storageRoot !== undefined ? options.storageRoot : (raw?.storageRoot ? normalizeString(raw.storageRoot) : null),
    summary: summarizeCreativeSceneDoc(doc),
    doc,
  };
}
