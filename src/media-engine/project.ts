/**
 * Video project engine: the single server-owned source of truth for a
 * generative video project (brief -> characters/styles -> shots -> takes ->
 * timeline). The user (editor UI / HTTP) and Prom (video_project tool) both
 * change it only through operations, so undo/redo covers both, and nothing
 * depends on a browser editor being open.
 *
 * Storage: <workspace>/video-projects/<projectId>/project.json with media/
 * beside it. Writes are serialized per project.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const PROJECT_SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 60;

export type TrackKind = 'video' | 'overlay' | 'audio' | 'caption';

export interface ProjectTarget {
  aspect: string; // "16:9" | "9:16" | "1:1" ...
  resolution: string; // "480p" | "720p" | "1080p"
  fps: number;
  durationSec?: number;
}

export interface Character {
  id: string;
  name: string;
  /** Workspace-relative anchor stills. The first is used as the identity frame. */
  anchors: string[];
  refs: string[];
  notes?: string;
  /** Provider identity handles, e.g. { higgsfieldSoulId }. */
  identity?: Record<string, string>;
  /** Generated anchor stills waiting for the user to approve one (chat card / Studio). */
  candidates?: string[];
  /** Last anchor prompt/model, reused by reroll. */
  anchorPrompt?: string;
  anchorModel?: string;
  /** person = a creator/actor; product = a product photo used as a reference. */
  kind?: 'person' | 'product';
  /** Source cast member in the persistent library (video-library/cast). */
  castId?: string;
}

export interface Style {
  id: string;
  name: string;
  refs: string[];
  promptSuffix?: string;
}

export interface Take {
  id: string;
  jobId: string;
  modelId: string;
  kind: 'video' | 'image';
  /** Workspace-relative media path. */
  path: string;
  prompt: string;
  costUsd: number;
  createdAt: number;
  durationSec?: number;
  /** First-frame JPG of a video take (thumbnails). */
  poster?: string;
  /** Vision QA verdict. */
  qa?: TakeQa;
  /** What the clip actually says (transcribed from its own audio, word-timed, ms relative to the take). */
  transcript?: TakeTranscript;
}

export interface TakeTranscript { text: string; words: Array<{ text: string; startMs: number; endMs: number }>; provider: string; at: number }

/**
 * native: the video model speaks each shot's line on camera; captions come from
 *         transcribing the clip audio.
 * voiceover: silent-dialogue clips + TTS narrator track; captions follow the VO.
 */
export type AudioMode = 'native' | 'voiceover';

export interface TakeQa { score: number; issues: string[]; verdict: 'pass' | 'reroll'; model: string; at: number }

export interface CaptionCue { startMs: number; endMs: number; text: string; words?: Array<{ text: string; startMs: number; endMs: number }> }
export type CaptionStyle = 'bold' | 'pop' | 'minimal' | 'karaoke';

export interface RunStep { step: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'needs_approval'; note?: string }
export interface RunState {
  id: string;
  state: 'running' | 'done' | 'failed' | 'needs_approval';
  steps: RunStep[];
  needsApproval?: { usd: number; breakdown: Array<{ item: string; usd: number }> };
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface Shot {
  id: string;
  title: string;
  prompt: string;
  camera?: string;
  durationSec: number;
  characterIds: string[];
  styleId?: string;
  startImage?: string;
  endImage?: string;
  /** Chain from the previous shot's last frame when no explicit start image. */
  chainFromPrevious?: boolean;
  /** How character anchors feed the model: as the first frame, or as reference images. */
  anchorMode?: 'start' | 'reference';
  modelId?: string;
  params?: Record<string, unknown>;
  status: 'draft' | 'generating' | 'ready' | 'failed';
  takes: Take[];
  selectedTakeId?: string;
  notes?: string;
  /** Spoken voiceover/dialogue line for this shot. */
  line?: string;
  /** Approved storyboard still; image-to-video models animate from it. */
  storyboard?: string;
  storyboardCandidates?: string[];
  voiceover?: { path: string; durationSec: number; text: string; voice: string };
  /** Video-to-video source: workspace path or take ref "shotId:takeId" (recast, lipsync, upscale, foley). */
  sourceVideo?: string;
  /** Driving audio (lipsync / talking photo); auto-TTS from line when missing. */
  audio?: string;
  /** Draw-to-video sketch (workspace path). */
  sketch?: string;
  /** Motion/VFX/look preset id (see video_project presets). */
  presetId?: string;
  /** Render still takes with a slow Ken Burns push-in instead of a frozen frame. */
  kenBurns?: boolean;
}

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  muted: boolean;
  locked: boolean;
}

export type ClipSource = { shotId: string } | { assetPath: string };

export interface Clip {
  id: string;
  trackId: string;
  source: ClipSource;
  /** Timeline position. */
  startMs: number;
  /** Trim window inside the source media. */
  inMs: number;
  outMs: number;
  volume?: number;
  label?: string;
}

export interface Asset {
  id: string;
  kind: 'image' | 'video' | 'audio';
  path: string;
  label?: string;
  origin: 'generated' | 'import';
  modelId?: string;
  prompt?: string;
  createdAt: number;
}

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface Job {
  id: string;
  target: { shotId: string } | { characterId: string } | { storyboardShotId: string } | { asset: true };
  modelId: string;
  input: Record<string, unknown>;
  count: number;
  state: JobState;
  requestId?: string;
  statusUrl?: string;
  responseUrl?: string;
  estimateUsd: number;
  /** Repriced on successful delivery; failed/canceled jobs never have actual spend. */
  actualUsd?: number;
  error?: string;
  errorType?: string;
  takeIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface OpRecord {
  seq: number;
  at: number;
  actor: 'user' | 'agent' | 'system';
  op: string;
  summary: string;
}

export interface VideoProject {
  schema: number;
  id: string;
  title: string;
  brief: string;
  target: ProjectTarget;
  defaults: { videoModel: string; imageModel: string };
  budget: { capUsd?: number; autoApproveUsd: number; spentUsd: number };
  characters: Character[];
  styles: Style[];
  shots: Shot[];
  tracks: Track[];
  clips: Clip[];
  assets: Asset[];
  jobs: Job[];
  /** Finished MP4 renders, newest last. */
  exports: Array<{ path: string; createdAt: number; durationSec: number; aspect?: string; variant?: string }>;
  voice?: { provider: 'openai' | 'xai'; voice: string; speed?: number };
  /** Where the spoken audio comes from. See AudioMode. */
  audioMode: AudioMode;
  captions?: { enabled: boolean; style: CaptionStyle; cues: CaptionCue[] };
  music?: { path: string; volume: number; duck: boolean; label?: string };
  brand?: { id?: string; name: string; logo?: string; colors?: string[]; watermark?: boolean };
  /** Autopilot progress (bookkeeping; never rewound by undo). */
  lastRun?: RunState;
  templateId?: string;
  hookVariants?: string[];
  opLog: OpRecord[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

interface StoredProject {
  project: VideoProject;
  undo: string[];
  redo: string[];
}

// ── ids / paths ─────────────────────────────────────────────────────────

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/i;

export function assertProjectId(id: string): string {
  const v = String(id || '').trim();
  if (!SAFE_ID.test(v)) throw new Error(`Invalid project id "${id}".`);
  return v;
}

export function projectsRoot(workspacePath: string): string {
  return path.join(workspacePath, 'video-projects');
}

export function projectDir(workspacePath: string, id: string): string {
  return path.join(projectsRoot(workspacePath), assertProjectId(id));
}

export function mediaDir(workspacePath: string, id: string): string {
  return path.join(projectDir(workspacePath, id), 'media');
}

function projectFile(workspacePath: string, id: string): string {
  return path.join(projectDir(workspacePath, id), 'project.json');
}

export function toWorkspaceRel(workspacePath: string, abs: string): string {
  return path.relative(workspacePath, abs).split(path.sep).join('/');
}

export function fromWorkspaceRel(workspacePath: string, rel: string): string {
  const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(workspacePath, rel);
  const back = path.relative(workspacePath, abs);
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error(`Path "${rel}" is outside the workspace.`);
  return abs;
}

// ── persistence + locking ───────────────────────────────────────────────

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  const chained = prev.then(() => next);
  locks.set(key, chained);
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

function readStored(workspacePath: string, id: string): StoredProject {
  const file = projectFile(workspacePath, id);
  if (!fs.existsSync(file)) throw new Error(`Video project "${id}" not found.`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (parsed?.project) return { project: normalizeProject(parsed.project), undo: parsed.undo || [], redo: parsed.redo || [] };
  return { project: normalizeProject(parsed), undo: [], redo: [] };
}

function writeStored(workspacePath: string, stored: StoredProject): void {
  const file = projectFile(workspacePath, stored.project.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 1), 'utf-8');
  fs.renameSync(tmp, file);
}

type ChangeListener = (event: { workspacePath: string; projectId: string; version: number; op: string }) => void;
const listeners = new Set<ChangeListener>();
export function onProjectChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(workspacePath: string, project: VideoProject, op: string): void {
  for (const fn of listeners) {
    try { fn({ workspacePath, projectId: project.id, version: project.version, op }); } catch { /* ignore */ }
  }
}

// ── normalization ───────────────────────────────────────────────────────

function arr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

export function normalizeProject(raw: any): VideoProject {
  const now = Date.now();
  const tracks = arr<Track>(raw.tracks);
  return {
    schema: PROJECT_SCHEMA_VERSION,
    id: assertProjectId(raw.id),
    title: String(raw.title || 'Untitled video'),
    brief: String(raw.brief || ''),
    target: {
      aspect: String(raw.target?.aspect || '16:9'),
      resolution: String(raw.target?.resolution || '720p'),
      fps: num(raw.target?.fps, 30),
      durationSec: raw.target?.durationSec != null ? num(raw.target.durationSec, 0) : undefined,
    },
    defaults: {
      videoModel: String(raw.defaults?.videoModel || 'xai/grok-imagine-video-1.5'),
      imageModel: String(raw.defaults?.imageModel || 'xai/grok-imagine-image-2.0'),
    },
    budget: {
      capUsd: raw.budget?.capUsd != null ? num(raw.budget.capUsd, 0) : undefined,
      autoApproveUsd: num(raw.budget?.autoApproveUsd, 1),
      spentUsd: num(raw.budget?.spentUsd, 0),
    },
    characters: arr<Character>(raw.characters).map((c) => ({ ...c, anchors: arr(c.anchors), refs: arr(c.refs), candidates: arr(c.candidates) })),
    styles: arr<Style>(raw.styles).map((s) => ({ ...s, refs: arr(s.refs) })),
    shots: arr<Shot>(raw.shots).map((s) => ({
      ...s,
      title: String(s.title || 'Shot'),
      prompt: String(s.prompt || ''),
      durationSec: num(s.durationSec, 5),
      characterIds: arr(s.characterIds),
      status: s.status || 'draft',
      takes: arr(s.takes),
      storyboardCandidates: arr(s.storyboardCandidates),
    })),
    tracks: tracks.length ? tracks : [{ id: 'track_v1', kind: 'video', label: 'V1', muted: false, locked: false }],
    clips: arr<Clip>(raw.clips),
    assets: arr<Asset>(raw.assets),
    jobs: arr<Job>(raw.jobs),
    exports: arr<VideoProject['exports'][number]>(raw.exports).slice(-30),
    // Legacy projects that already carry a TTS voiceover stay in voiceover mode.
    audioMode: raw.audioMode === 'native' || raw.audioMode === 'voiceover'
      ? raw.audioMode
      : (arr<any>(raw.shots).some((s) => s?.voiceover?.path) ? 'voiceover' : 'native'),
    voice: raw.voice && raw.voice.voice ? { provider: raw.voice.provider === 'xai' ? 'xai' : 'openai', voice: String(raw.voice.voice), speed: raw.voice.speed != null ? num(raw.voice.speed, 1) : undefined } : undefined,
    captions: raw.captions ? { enabled: !!raw.captions.enabled, style: (['bold', 'pop', 'minimal', 'karaoke'].includes(raw.captions.style) ? raw.captions.style : 'pop'), cues: arr<CaptionCue>(raw.captions.cues) } : undefined,
    music: raw.music?.path ? { path: String(raw.music.path), volume: num(raw.music.volume, 0.25), duck: raw.music.duck !== false, label: raw.music.label } : undefined,
    brand: raw.brand?.name ? raw.brand : undefined,
    lastRun: raw.lastRun || undefined,
    templateId: raw.templateId || undefined,
    hookVariants: raw.hookVariants ? arr<string>(raw.hookVariants) : undefined,
    opLog: arr<OpRecord>(raw.opLog).slice(-200),
    version: num(raw.version, 0),
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  };
}

// ── public CRUD ─────────────────────────────────────────────────────────

export function listProjects(workspacePath: string): Array<Pick<VideoProject, 'id' | 'title' | 'updatedAt'> & { shots: number; clips: number }> {
  const root = projectsRoot(workspacePath);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const id of fs.readdirSync(root)) {
    if (!SAFE_ID.test(id)) continue;
    try {
      const p = readStored(workspacePath, id).project;
      out.push({ id: p.id, title: p.title, updatedAt: p.updatedAt, shots: p.shots.length, clips: p.clips.length });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(workspacePath: string, input: {
  title?: string; brief?: string; target?: Partial<ProjectTarget>;
  defaults?: Partial<VideoProject['defaults']>; budget?: Partial<VideoProject['budget']>;
}): Promise<VideoProject> {
  const id = newId('vp');
  const project = normalizeProject({
    id,
    title: input.title,
    brief: input.brief,
    target: input.target,
    defaults: input.defaults,
    budget: input.budget,
  });
  project.opLog.push({ seq: 1, at: Date.now(), actor: 'system', op: 'project.create', summary: `Created "${project.title}"` });
  project.version = 1;
  await withLock(id, () => writeStored(workspacePath, { project, undo: [], redo: [] }));
  emit(workspacePath, project, 'project.create');
  return project;
}

export function loadProject(workspacePath: string, id: string): VideoProject {
  return readStored(workspacePath, id).project;
}

export function deleteProject(workspacePath: string, id: string): boolean {
  const dir = projectDir(workspacePath, id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Low-level mutation that bypasses undo history (used by the job runner for
 * status/progress so generation bookkeeping never pollutes the user's undo stack).
 */
export async function mutateProject(workspacePath: string, id: string, op: string, fn: (p: VideoProject) => void): Promise<VideoProject> {
  return withLock(id, () => {
    const stored = readStored(workspacePath, id);
    fn(stored.project);
    stored.project.version += 1;
    stored.project.updatedAt = Date.now();
    writeStored(workspacePath, stored);
    emit(workspacePath, stored.project, op);
    return stored.project;
  });
}

// ── operations ──────────────────────────────────────────────────────────

export interface ProjectOp { op: string; [key: string]: any }

function snapshotForUndo(p: VideoProject): string {
  // Jobs and budget are generation bookkeeping, not edits: never rewound by undo.
  const { jobs: _j, opLog: _l, budget: _b, version: _v, updatedAt: _u, lastRun: _r, exports: _x, ...editable } = p;
  return JSON.stringify(editable);
}

function restoreFromUndo(p: VideoProject, snap: string): VideoProject {
  const editable = JSON.parse(snap);
  // Takes generated after the snapshot must survive undo (they cost money).
  const liveTakes = new Map<string, Take[]>(p.shots.map((s) => [s.id, s.takes]));
  const liveBoards = new Map<string, string[]>(p.shots.map((s) => [s.id, s.storyboardCandidates || []]));
  const restored = normalizeProject({ ...p, ...editable, jobs: p.jobs, opLog: p.opLog, budget: p.budget, version: p.version, lastRun: p.lastRun, exports: p.exports });
  for (const shot of restored.shots) {
    const live = liveTakes.get(shot.id);
    if (live) {
      const known = new Set(shot.takes.map((t) => t.id));
      for (const t of live) if (!known.has(t.id)) shot.takes.push(t);
    }
    // Paid storyboard stills survive undo too.
    const boards = liveBoards.get(shot.id) || [];
    const have = new Set([...(shot.storyboardCandidates || []), shot.storyboard || '']);
    shot.storyboardCandidates = [...(shot.storyboardCandidates || []), ...boards.filter((b) => !have.has(b))];
  }
  return restored;
}

function findShot(p: VideoProject, id: string): Shot {
  const s = p.shots.find((x) => x.id === id);
  if (!s) throw new Error(`Shot "${id}" not found.`);
  return s;
}
function findClip(p: VideoProject, id: string): Clip {
  const c = p.clips.find((x) => x.id === id);
  if (!c) throw new Error(`Clip "${id}" not found.`);
  return c;
}
function findTrack(p: VideoProject, id?: string, kind: TrackKind = 'video'): Track {
  const t = id ? p.tracks.find((x) => x.id === id) : p.tracks.find((x) => x.kind === kind);
  if (!t) throw new Error(id ? `Track "${id}" not found.` : `No ${kind} track.`);
  if (t.locked) throw new Error(`Track ${t.label} is locked.`);
  return t;
}

export function selectedTake(shot: Shot): Take | undefined {
  return shot.takes.find((t) => t.id === shot.selectedTakeId) || shot.takes[shot.takes.length - 1];
}

function sourceDurationMs(p: VideoProject, source: ClipSource): number {
  if ('shotId' in source) {
    const shot = p.shots.find((s) => s.id === source.shotId);
    const take = shot && selectedTake(shot);
    return Math.round(1000 * (take?.durationSec || shot?.durationSec || 5));
  }
  return 5000;
}

function trackEndMs(p: VideoProject, trackId: string): number {
  return p.clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, c.startMs + (c.outMs - c.inMs)), 0);
}

const SHOT_FIELDS = ['title', 'prompt', 'camera', 'durationSec', 'characterIds', 'styleId', 'startImage', 'endImage', 'chainFromPrevious', 'anchorMode', 'modelId', 'params', 'notes', 'line', 'storyboard', 'sourceVideo', 'audio', 'sketch', 'presetId', 'kenBurns'] as const;

export const VO_TRACK_LABEL = 'VO';

/** Main video track = first video track. */
export function mainVideoTrack(p: VideoProject): Track | undefined {
  return p.tracks.find((t) => t.kind === 'video');
}

/**
 * Place each shot's voiceover on the VO audio track, aligned to where that
 * shot sits on the main video track. Pure layout: safe to call after any
 * timeline change.
 */
export function layoutVoiceover(p: VideoProject): number {
  const main = mainVideoTrack(p);
  // Native dialogue: the clips carry the voice, so no narrator track (voiceover data is kept for undo/switch-back).
  const voShots = p.audioMode === 'native' ? [] : p.shots.filter((s) => s.voiceover?.path);
  let vo = p.tracks.find((t) => t.kind === 'audio' && t.label === VO_TRACK_LABEL);
  if (!voShots.length) {
    if (vo) p.clips = p.clips.filter((c) => c.trackId !== vo!.id);
    return 0;
  }
  if (!vo) {
    vo = { id: newId('track'), kind: 'audio', label: VO_TRACK_LABEL, muted: false, locked: false };
    p.tracks.push(vo);
  }
  p.clips = p.clips.filter((c) => c.trackId !== vo!.id);
  let placed = 0;
  let cursor = 0;
  for (const shot of p.shots) {
    const clip = main ? p.clips.find((c) => c.trackId === main.id && 'shotId' in c.source && c.source.shotId === shot.id) : undefined;
    const shotStart = clip ? clip.startMs : cursor;
    cursor = shotStart + (clip ? clip.outMs - clip.inMs : Math.round(shot.durationSec * 1000));
    if (!shot.voiceover?.path) continue;
    const dur = Math.round(shot.voiceover.durationSec * 1000);
    p.clips.push({ id: newId('clip'), trackId: vo.id, source: { assetPath: shot.voiceover.path }, startMs: shotStart + 150, inMs: 0, outMs: Math.max(200, dur), volume: 1, label: `VO ${shot.title}` });
    placed += 1;
  }
  return placed;
}

function pickShotFields(src: any): Partial<Shot> {
  const out: any = {};
  for (const k of SHOT_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  if (out.durationSec !== undefined) out.durationSec = Math.max(1, Math.min(60, num(out.durationSec, 5)));
  return out;
}

/** Apply one op in place. Returns a short human summary. */
function applyOp(p: VideoProject, o: ProjectOp): string {
  switch (o.op) {
    case 'project.update': {
      if (o.title !== undefined) p.title = String(o.title);
      if (o.brief !== undefined) p.brief = String(o.brief);
      if (o.target) p.target = { ...p.target, ...o.target };
      if (o.defaults) p.defaults = { ...p.defaults, ...o.defaults };
      if (o.brand !== undefined) p.brand = o.brand && o.brand.name ? o.brand : undefined;
      if (o.templateId !== undefined) p.templateId = o.templateId ? String(o.templateId) : undefined;
      if (o.hookVariants !== undefined) p.hookVariants = arr<string>(o.hookVariants);
      if (o.audioMode === 'native' || o.audioMode === 'voiceover') {
        p.audioMode = o.audioMode;
        layoutVoiceover(p); // native drops the VO clips; voiceover restores them
      }
      if (o.budget) {
        if (o.budget.capUsd !== undefined) p.budget.capUsd = o.budget.capUsd === null ? undefined : num(o.budget.capUsd, 0);
        if (o.budget.autoApproveUsd !== undefined) p.budget.autoApproveUsd = Math.max(0, num(o.budget.autoApproveUsd, 1));
      }
      return 'Updated project settings';
    }
    case 'character.upsert': {
      const existing = o.id ? p.characters.find((c) => c.id === o.id) : undefined;
      const next: Character = {
        id: existing?.id || o.id || newId('char'),
        name: String(o.name ?? existing?.name ?? 'Character'),
        anchors: o.anchors !== undefined ? arr<string>(o.anchors) : existing?.anchors || [],
        refs: o.refs !== undefined ? arr<string>(o.refs) : existing?.refs || [],
        notes: o.notes !== undefined ? String(o.notes) : existing?.notes,
        identity: o.identity !== undefined ? o.identity : existing?.identity,
        candidates: o.candidates !== undefined ? arr<string>(o.candidates) : existing?.candidates || [],
        anchorPrompt: o.anchorPrompt !== undefined ? String(o.anchorPrompt) : existing?.anchorPrompt,
        anchorModel: o.anchorModel !== undefined ? String(o.anchorModel) : existing?.anchorModel,
        kind: o.kind === 'product' || o.kind === 'person' ? o.kind : existing?.kind,
        castId: o.castId !== undefined ? String(o.castId) : existing?.castId,
      };
      if (existing) Object.assign(existing, next); else p.characters.push(next);
      return `${existing ? 'Updated' : 'Added'} character ${next.name} (${next.id})`;
    }
    case 'character.approveAnchor': {
      // Promote a generated candidate (or any workspace still) to the identity frame.
      const c = p.characters.find((x) => x.id === o.id);
      if (!c) throw new Error(`Character "${o.id}" not found.`);
      const pick = String(o.path || c.candidates?.[0] || '');
      if (!pick) throw new Error('character.approveAnchor needs path (no candidates to approve).');
      c.anchors = [pick, ...c.anchors.filter((a) => a !== pick)];
      c.candidates = (c.candidates || []).filter((a) => a !== pick);
      return `Approved anchor for ${c.name}`;
    }
    case 'character.rejectAnchor': {
      const c = p.characters.find((x) => x.id === o.id);
      if (!c) throw new Error(`Character "${o.id}" not found.`);
      const drop = String(o.path || '');
      c.candidates = drop ? (c.candidates || []).filter((a) => a !== drop) : [];
      if (o.fromAnchors) c.anchors = c.anchors.filter((a) => a !== drop);
      return `Rejected anchor for ${c.name}`;
    }
    case 'character.remove': {
      p.characters = p.characters.filter((c) => c.id !== o.id);
      for (const s of p.shots) s.characterIds = s.characterIds.filter((id) => id !== o.id);
      return `Removed character ${o.id}`;
    }
    case 'style.upsert': {
      const existing = o.id ? p.styles.find((s) => s.id === o.id) : undefined;
      const next: Style = {
        id: existing?.id || o.id || newId('style'),
        name: String(o.name ?? existing?.name ?? 'Style'),
        refs: o.refs !== undefined ? arr<string>(o.refs) : existing?.refs || [],
        promptSuffix: o.promptSuffix !== undefined ? String(o.promptSuffix) : existing?.promptSuffix,
      };
      if (existing) Object.assign(existing, next); else p.styles.push(next);
      return `${existing ? 'Updated' : 'Added'} style ${next.name}`;
    }
    case 'style.remove': {
      p.styles = p.styles.filter((s) => s.id !== o.id);
      for (const s of p.shots) if (s.styleId === o.id) s.styleId = undefined;
      return `Removed style ${o.id}`;
    }
    case 'plan.setShots': {
      const shots = arr<any>(o.shots);
      if (!shots.length) throw new Error('plan.setShots needs a non-empty shots array.');
      const keep = new Map(p.shots.map((s) => [s.id, s]));
      p.shots = shots.map((raw) => {
        const prev = raw.id ? keep.get(raw.id) : undefined;
        return {
          id: prev?.id || raw.id || newId('shot'),
          title: 'Shot', prompt: '', durationSec: 5, characterIds: [], status: 'draft', takes: [],
          ...(prev || {}),
          ...pickShotFields(raw),
        } as Shot;
      });
      const live = new Set(p.shots.map((s) => s.id));
      p.clips = p.clips.filter((c) => !('shotId' in c.source) || live.has(c.source.shotId));
      return `Planned ${p.shots.length} shots`;
    }
    case 'shot.add': {
      const shot: Shot = {
        id: newId('shot'), title: `Shot ${p.shots.length + 1}`, prompt: '', durationSec: 5,
        characterIds: [], status: 'draft', takes: [], ...pickShotFields(o),
      };
      const index = o.index != null ? Math.max(0, Math.min(p.shots.length, num(o.index, p.shots.length))) : p.shots.length;
      p.shots.splice(index, 0, shot);
      return `Added ${shot.title} (${shot.id})`;
    }
    case 'shot.update': {
      const shot = findShot(p, o.id);
      Object.assign(shot, pickShotFields(o));
      return `Updated ${shot.title}`;
    }
    case 'shot.remove': {
      p.shots = p.shots.filter((s) => s.id !== o.id);
      p.clips = p.clips.filter((c) => !('shotId' in c.source) || c.source.shotId !== o.id);
      return `Removed shot ${o.id}`;
    }
    case 'shot.move': {
      const from = p.shots.findIndex((s) => s.id === o.id);
      if (from < 0) throw new Error(`Shot "${o.id}" not found.`);
      const [shot] = p.shots.splice(from, 1);
      p.shots.splice(Math.max(0, Math.min(p.shots.length, num(o.index, from))), 0, shot);
      return `Moved ${shot.title} to position ${p.shots.indexOf(shot) + 1}`;
    }
    case 'take.select': {
      const shot = findShot(p, o.shotId);
      const take = shot.takes.find((t) => t.id === o.takeId);
      if (!take) throw new Error(`Take "${o.takeId}" not found on ${shot.title}.`);
      shot.selectedTakeId = take.id;
      shot.status = 'ready';
      // Keep clip trims valid for the new take length.
      const maxMs = Math.round(1000 * (take.durationSec || shot.durationSec));
      for (const c of p.clips) {
        if ('shotId' in c.source && c.source.shotId === shot.id) {
          c.outMs = Math.min(c.outMs, maxMs);
          c.inMs = Math.min(c.inMs, Math.max(0, c.outMs - 100));
        }
      }
      return `Selected take ${take.id} for ${shot.title}`;
    }
    case 'take.remove': {
      const shot = findShot(p, o.shotId);
      shot.takes = shot.takes.filter((t) => t.id !== o.takeId);
      if (shot.selectedTakeId === o.takeId) shot.selectedTakeId = shot.takes[shot.takes.length - 1]?.id;
      return `Removed take ${o.takeId}`;
    }
    case 'track.add': {
      const kind = (['video', 'overlay', 'audio', 'caption'].includes(o.kind) ? o.kind : 'video') as TrackKind;
      const n = p.tracks.filter((t) => t.kind === kind).length + 1;
      const track: Track = { id: newId('track'), kind, label: o.label || `${kind[0].toUpperCase()}${n}`, muted: false, locked: false };
      p.tracks.push(track);
      return `Added track ${track.label} (${track.id})`;
    }
    case 'track.update': {
      const t = p.tracks.find((x) => x.id === o.id);
      if (!t) throw new Error(`Track "${o.id}" not found.`);
      if (o.label !== undefined) t.label = String(o.label);
      if (o.muted !== undefined) t.muted = Boolean(o.muted);
      if (o.locked !== undefined) t.locked = Boolean(o.locked);
      return `Updated track ${t.label}`;
    }
    case 'clip.add': {
      const track = findTrack(p, o.trackId, o.assetPath && /\.(mp3|wav|m4a|aac|ogg)$/i.test(o.assetPath) ? 'audio' : 'video');
      let source: ClipSource;
      if (o.shotId) { findShot(p, o.shotId); source = { shotId: o.shotId }; }
      else if (o.assetPath) source = { assetPath: String(o.assetPath) };
      else throw new Error('clip.add needs shotId or assetPath.');
      const full = sourceDurationMs(p, source);
      const inMs = Math.max(0, num(o.inMs, 0));
      const outMs = Math.max(inMs + 100, num(o.outMs, o.durationMs != null ? inMs + num(o.durationMs, full) : full));
      const clip: Clip = {
        id: newId('clip'), trackId: track.id, source,
        startMs: o.startMs != null ? Math.max(0, num(o.startMs, 0)) : trackEndMs(p, track.id),
        inMs, outMs, volume: o.volume != null ? num(o.volume, 1) : undefined, label: o.label,
      };
      p.clips.push(clip);
      return `Added clip ${clip.id} on ${track.label} at ${(clip.startMs / 1000).toFixed(2)}s`;
    }
    case 'clip.trim': {
      const c = findClip(p, o.id);
      if (o.inMs != null) c.inMs = Math.max(0, num(o.inMs, c.inMs));
      if (o.outMs != null) c.outMs = num(o.outMs, c.outMs);
      if (o.durationMs != null) c.outMs = c.inMs + Math.max(100, num(o.durationMs, c.outMs - c.inMs));
      if (o.deltaEndMs != null) c.outMs += num(o.deltaEndMs, 0);
      if (c.outMs <= c.inMs + 50) c.outMs = c.inMs + 100;
      return `Trimmed ${c.id} to ${((c.outMs - c.inMs) / 1000).toFixed(2)}s`;
    }
    case 'clip.move': {
      const c = findClip(p, o.id);
      if (o.trackId) { findTrack(p, o.trackId); c.trackId = o.trackId; }
      if (o.startMs != null) c.startMs = Math.max(0, num(o.startMs, c.startMs));
      return `Moved ${c.id} to ${(c.startMs / 1000).toFixed(2)}s`;
    }
    case 'clip.split': {
      const c = findClip(p, o.id);
      const at = num(o.atMs, NaN); // timeline time
      const local = at - c.startMs;
      if (!Number.isFinite(at) || local <= 50 || local >= c.outMs - c.inMs - 50) throw new Error('clip.split atMs must fall inside the clip.');
      const right: Clip = { ...c, id: newId('clip'), startMs: at, inMs: c.inMs + local };
      c.outMs = c.inMs + local;
      p.clips.push(right);
      return `Split ${c.id} at ${(at / 1000).toFixed(2)}s -> ${right.id}`;
    }
    case 'clip.remove': {
      p.clips = p.clips.filter((c) => c.id !== o.id);
      return `Removed clip ${o.id}`;
    }
    case 'clip.update': {
      const c = findClip(p, o.id);
      if (o.volume !== undefined) c.volume = num(o.volume, 1);
      if (o.label !== undefined) c.label = String(o.label);
      return `Updated clip ${c.id}`;
    }
    case 'timeline.assemble': {
      // Lay every shot's selected take back-to-back on the main video track.
      const track = findTrack(p, o.trackId);
      const shotIds = new Set(p.shots.map((s) => s.id));
      p.clips = p.clips.filter((c) => !(c.trackId === track.id && 'shotId' in c.source && shotIds.has(c.source.shotId)));
      let at = 0;
      let placed = 0;
      for (const shot of p.shots) {
        if (!selectedTake(shot) && !o.includeDrafts) continue;
        const dur = sourceDurationMs(p, { shotId: shot.id });
        p.clips.push({ id: newId('clip'), trackId: track.id, source: { shotId: shot.id }, startMs: at, inMs: 0, outMs: dur, label: shot.title });
        at += dur;
        placed += 1;
      }
      layoutVoiceover(p);
      return `Assembled ${placed} shots on ${track.label} (${(at / 1000).toFixed(1)}s)`;
    }
    case 'shot.approveStoryboard': {
      const shot = findShot(p, o.id);
      const pick = String(o.path || shot.storyboardCandidates?.[0] || '');
      if (!pick) throw new Error('shot.approveStoryboard needs path (no candidates).');
      if (shot.storyboard && shot.storyboard !== pick) shot.storyboardCandidates = [...(shot.storyboardCandidates || []), shot.storyboard];
      shot.storyboard = pick;
      shot.storyboardCandidates = (shot.storyboardCandidates || []).filter((x) => x !== pick);
      return `Approved storyboard for ${shot.title}`;
    }
    case 'shot.rejectStoryboard': {
      const shot = findShot(p, o.id);
      const drop = String(o.path || '');
      if (!drop || drop === shot.storyboard) shot.storyboard = undefined;
      shot.storyboardCandidates = drop ? (shot.storyboardCandidates || []).filter((x) => x !== drop) : [];
      return `Rejected storyboard for ${shot.title}`;
    }
    case 'captions.set': {
      const style = (['bold', 'pop', 'minimal', 'karaoke'].includes(o.style) ? o.style : p.captions?.style || 'pop') as CaptionStyle;
      p.captions = { enabled: o.enabled !== undefined ? !!o.enabled : p.captions?.enabled ?? true, style, cues: o.cues !== undefined ? arr<CaptionCue>(o.cues) : p.captions?.cues || [] };
      return `Captions ${p.captions.enabled ? 'on' : 'off'} (${style})`;
    }
    case 'music.set': {
      const pth = String(o.path || p.music?.path || '');
      if (!pth) throw new Error('music.set needs path.');
      p.music = { path: pth, volume: Math.max(0, Math.min(1, num(o.volume, p.music?.volume ?? 0.25))), duck: o.duck !== undefined ? !!o.duck : p.music?.duck ?? true, label: o.label ?? p.music?.label };
      return `Music ${p.music.label || pth} at ${Math.round(p.music.volume * 100)}%`;
    }
    case 'music.clear':
      p.music = undefined;
      return 'Removed music';
    case 'voice.set': {
      const voice = String(o.voice || '').trim();
      if (!voice) throw new Error('voice.set needs voice.');
      p.voice = { provider: o.provider === 'xai' ? 'xai' : 'openai', voice, speed: o.speed != null ? num(o.speed, 1) : p.voice?.speed };
      return `Voice ${p.voice.provider}/${voice}`;
    }
    case 'timeline.layoutVoiceover':
      return `Placed ${layoutVoiceover(p)} voiceover clips`;
    case 'asset.add': {
      const asset: Asset = {
        id: newId('asset'), kind: o.kind === 'video' || o.kind === 'audio' ? o.kind : 'image',
        path: String(o.path || ''), label: o.label, origin: 'import', createdAt: Date.now(),
      };
      if (!asset.path) throw new Error('asset.add needs path.');
      p.assets.push(asset);
      return `Added asset ${asset.id}`;
    }
    default:
      throw new Error(`Unknown op "${o.op}". See video_project help for the op list.`);
  }
}

export const OP_NAMES = [
  'project.update', 'character.upsert', 'character.approveAnchor', 'character.rejectAnchor', 'character.remove', 'style.upsert', 'style.remove',
  'plan.setShots', 'shot.add', 'shot.update', 'shot.remove', 'shot.move', 'take.select', 'take.remove',
  'track.add', 'track.update', 'clip.add', 'clip.trim', 'clip.move', 'clip.split', 'clip.remove', 'clip.update',
  'timeline.assemble', 'asset.add',
  'shot.approveStoryboard', 'shot.rejectStoryboard', 'captions.set', 'music.set', 'music.clear', 'voice.set', 'timeline.layoutVoiceover',
];

/**
 * Apply a batch of ops atomically (all or nothing) as ONE undo step.
 */
export async function applyOps(workspacePath: string, id: string, ops: ProjectOp[], actor: OpRecord['actor'] = 'agent'): Promise<{ project: VideoProject; summaries: string[] }> {
  if (!Array.isArray(ops) || !ops.length) throw new Error('ops must be a non-empty array.');
  return withLock(id, () => {
    const stored = readStored(workspacePath, id);
    const before = snapshotForUndo(stored.project);
    const working = normalizeProject(JSON.parse(JSON.stringify(stored.project)));
    const summaries: string[] = [];
    ops.forEach((o, i) => {
      try { summaries.push(applyOp(working, o)); }
      catch (e: any) { throw new Error(`op #${i + 1} (${o?.op}) failed: ${e?.message || e}. No changes were applied.`); }
    });
    working.version = stored.project.version + 1;
    working.updatedAt = Date.now();
    const seq = (working.opLog[working.opLog.length - 1]?.seq || 0) + 1;
    working.opLog.push({ seq, at: working.updatedAt, actor, op: ops.map((o) => o.op).join('+'), summary: summaries.join('; ').slice(0, 400) });
    working.opLog = working.opLog.slice(-200);
    stored.undo = [...stored.undo, before].slice(-HISTORY_LIMIT);
    stored.redo = [];
    stored.project = working;
    writeStored(workspacePath, stored);
    emit(workspacePath, working, 'ops');
    return { project: working, summaries };
  });
}

export async function undoRedo(workspacePath: string, id: string, direction: 'undo' | 'redo', actor: OpRecord['actor'] = 'agent'): Promise<{ project: VideoProject; applied: boolean }> {
  return withLock(id, () => {
    const stored = readStored(workspacePath, id);
    const from = direction === 'undo' ? stored.undo : stored.redo;
    const to = direction === 'undo' ? stored.redo : stored.undo;
    const snap = from.pop();
    if (!snap) return { project: stored.project, applied: false };
    to.push(snapshotForUndo(stored.project));
    const restored = restoreFromUndo(stored.project, snap);
    restored.version = stored.project.version + 1;
    restored.updatedAt = Date.now();
    restored.opLog.push({ seq: (restored.opLog[restored.opLog.length - 1]?.seq || 0) + 1, at: restored.updatedAt, actor, op: direction, summary: direction === 'undo' ? 'Undid last change' : 'Redid change' });
    stored.project = restored;
    writeStored(workspacePath, stored);
    emit(workspacePath, restored, direction);
    return { project: restored, applied: true };
  });
}

export function historyDepth(workspacePath: string, id: string): { undo: number; redo: number } {
  const s = readStored(workspacePath, id);
  return { undo: s.undo.length, redo: s.redo.length };
}

export function timelineDurationMs(p: VideoProject): number {
  return p.clips.reduce((m, c) => Math.max(m, c.startMs + (c.outMs - c.inMs)), 0);
}

/** Compact view for the agent: small enough to fetch every turn. */
export function summarizeProject(p: VideoProject, depth: { undo: number; redo: number }) {
  return {
    id: p.id,
    title: p.title,
    brief: p.brief.slice(0, 400),
    target: p.target,
    defaults: p.defaults,
    budget: p.budget,
    version: p.version,
    history: depth,
    characters: p.characters.map((c) => ({ id: c.id, name: c.name, kind: c.kind || 'person', castId: c.castId, anchors: c.anchors, candidates: c.candidates || [], notes: c.notes })),
    voice: p.voice,
    audioMode: p.audioMode,
    captions: p.captions ? { enabled: p.captions.enabled, style: p.captions.style, cues: p.captions.cues.length } : undefined,
    music: p.music,
    brand: p.brand ? { id: p.brand.id, name: p.brand.name, watermark: p.brand.watermark } : undefined,
    lastRun: p.lastRun,
    styles: p.styles.map((s) => ({ id: s.id, name: s.name, promptSuffix: s.promptSuffix, refs: s.refs.length })),
    shots: p.shots.map((s, i) => {
      const take = selectedTake(s);
      return {
        n: i + 1, id: s.id, title: s.title, status: s.status, durationSec: s.durationSec,
        model: s.modelId || p.defaults.videoModel, camera: s.camera, characters: s.characterIds,
        presetId: s.presetId, sourceVideo: s.sourceVideo, audio: s.audio, kenBurns: s.kenBurns || undefined,
        prompt: s.prompt.slice(0, 220), line: s.line, storyboard: s.storyboard, storyboardCandidates: s.storyboardCandidates?.length || 0,
        voiceover: s.voiceover ? { durationSec: s.voiceover.durationSec } : undefined,
        takes: s.takes.length, selectedTake: take ? { id: take.id, path: take.path, model: take.modelId, qa: take.qa ? { score: take.qa.score, verdict: take.qa.verdict, issues: take.qa.issues } : undefined } : null,
      };
    }),
    tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, label: t.label, clips: p.clips.filter((c) => c.trackId === t.id).length })),
    clips: p.clips
      .slice()
      .sort((a, b) => a.startMs - b.startMs)
      .map((c) => ({ id: c.id, track: c.trackId, src: 'shotId' in c.source ? `shot:${c.source.shotId}` : c.source.assetPath, startMs: c.startMs, durMs: c.outMs - c.inMs, inMs: c.inMs })),
    durationSec: +(timelineDurationMs(p) / 1000).toFixed(2),
    activeJobs: p.jobs.filter((j) => j.state === 'queued' || j.state === 'running').map((j) => ({ id: j.id, model: j.modelId, state: j.state, target: j.target })),
    recentOps: p.opLog.slice(-5).map((o) => `${o.actor}:${o.summary}`),
    latestExport: p.exports?.length ? p.exports[p.exports.length - 1] : null,
    chatCard: `\`\`\`video-project\n{"projectId":"${p.id}"}\n\`\`\``,
  };
}
