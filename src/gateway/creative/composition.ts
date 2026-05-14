/**
 * composition.ts — Multi-clip timeline operations.
 *
 * A CreativeComposition sequences clips across multiple tracks (video lanes
 * stacked z-order, audio lanes, caption lane). This module owns deterministic
 * mutations: add/move/trim/split/delete/transition. It does not render;
 * see renderers/composition_renderer.ts.
 */

import {
  type CreativeClip,
  type CreativeClipLane,
  type CreativeClipSource,
  type CreativeComposition,
  type CreativeTrack,
  type CreativeTrackKind,
  type CreativeTransitionSpec,
  cloneData,
  isPlainObject,
  normalizeCreativeClip,
  normalizeCreativeComposition,
  summarizeCreativeComposition,
} from './contracts';

export type CompositionLintIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  trackId?: string;
  clipId?: string;
};

export type CompositionLintResult = {
  ok: boolean;
  issues: CompositionLintIssue[];
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureTrack(comp: CreativeComposition, trackId: string): CreativeTrack | null {
  return comp.tracks.find((t) => t.id === trackId) || null;
}

function findClipIndex(comp: CreativeComposition, clipId: string): number {
  return comp.clips.findIndex((c) => c.id === clipId);
}

function recomputeDuration(comp: CreativeComposition): void {
  const computed = comp.clips.reduce((max, c) => Math.max(max, c.outMs), 0);
  comp.durationMs = Math.max(1000, computed || comp.durationMs || 1000);
}

function clipsOnTrack(comp: CreativeComposition, trackId: string): CreativeClip[] {
  return comp.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.inMs - b.inMs);
}

/** Return true if [aIn,aOut) overlaps [bIn,bOut). */
function overlaps(aIn: number, aOut: number, bIn: number, bOut: number): boolean {
  return aIn < bOut && bIn < aOut;
}

// ── public API ───────────────────────────────────────────────────────────────

export function createEmptyComposition(input: {
  width?: number;
  height?: number;
  frameRate?: number;
  durationMs?: number;
  background?: string;
} = {}): CreativeComposition {
  return normalizeCreativeComposition({
    width: input.width || 1920,
    height: input.height || 1080,
    frameRate: input.frameRate || 30,
    durationMs: input.durationMs || 12000,
    background: input.background || '#000000',
    tracks: [],
    clips: [],
  });
}

export function addTrack(
  comp: CreativeComposition,
  kind: CreativeTrackKind,
  label?: string,
): CreativeTrack {
  const sameKindCount = comp.tracks.filter((t) => t.kind === kind).length;
  const track: CreativeTrack = {
    id: newId('track'),
    kind,
    label: label || (kind === 'video' ? `V${sameKindCount + 1}` : kind === 'audio' ? `A${sameKindCount + 1}` : `C${sameKindCount + 1}`),
    index: comp.tracks.length,
    height: kind === 'video' ? 56 : kind === 'audio' ? 44 : 36,
    muted: false,
    locked: false,
    hidden: false,
  };
  comp.tracks.push(track);
  return track;
}

export function removeTrack(comp: CreativeComposition, trackId: string): boolean {
  const idx = comp.tracks.findIndex((t) => t.id === trackId);
  if (idx < 0) return false;
  comp.clips = comp.clips.filter((c) => c.trackId !== trackId);
  comp.tracks.splice(idx, 1);
  recomputeDuration(comp);
  return true;
}

export type AddClipInput = {
  trackId?: string;
  lane?: CreativeClipLane;
  source: CreativeClipSource | any;
  atMs?: number;
  durationMs?: number;
  inMs?: number;
  outMs?: number;
  trimStartMs?: number;
  trimEndMs?: number;
  label?: string;
  ripple?: boolean;
};

export function addClip(comp: CreativeComposition, input: AddClipInput): CreativeClip {
  let trackId = input.trackId || '';
  if (!trackId) {
    const firstVideo = comp.tracks.find((t) => t.kind === 'video');
    if (!firstVideo) throw new Error('Composition has no video track to host the clip.');
    trackId = firstVideo.id;
  }
  const track = ensureTrack(comp, trackId);
  if (!track) throw new Error(`Unknown trackId: ${trackId}`);
  if (track.locked) throw new Error(`Track ${track.label} is locked.`);

  const inMs = Number.isFinite(Number(input.inMs))
    ? Math.max(0, Number(input.inMs))
    : Math.max(0, Number(input.atMs) || 0);
  const explicitOut = Number.isFinite(Number(input.outMs)) ? Number(input.outMs) : null;
  const explicitDur = Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null;
  const outMs = explicitOut !== null
    ? Math.max(inMs + 1, explicitOut)
    : inMs + Math.max(1, explicitDur || 4000);
  const lane = String(input.lane || input.source?.kind || '').trim().toLowerCase();
  if (lane !== 'html-motion' && lane !== 'remotion') {
    throw new Error('Video composition clips must use html-motion or remotion lanes.');
  }

  const clip = normalizeCreativeClip({
    id: newId('clip'),
    trackId,
    label: input.label || 'Clip',
    inMs,
    outMs,
    trimStartMs: input.trimStartMs || 0,
    trimEndMs: input.trimEndMs || 0,
    lane,
    source: input.source,
  });

  if (input.ripple === true) {
    const newDuration = clip.outMs - clip.inMs;
    for (const existing of comp.clips) {
      if (existing.trackId === trackId && existing.inMs >= clip.inMs) {
        existing.inMs += newDuration;
        existing.outMs += newDuration;
      }
    }
  }

  comp.clips.push(clip);
  recomputeDuration(comp);
  return clip;
}

export function moveClip(
  comp: CreativeComposition,
  clipId: string,
  options: { trackId?: string; atMs?: number; deltaMs?: number },
): CreativeClip {
  const idx = findClipIndex(comp, clipId);
  if (idx < 0) throw new Error(`Unknown clipId: ${clipId}`);
  const clip = comp.clips[idx];
  if (clip.locked) throw new Error('Clip is locked.');

  if (options.trackId && options.trackId !== clip.trackId) {
    const target = ensureTrack(comp, options.trackId);
    if (!target) throw new Error(`Unknown trackId: ${options.trackId}`);
    if (target.locked) throw new Error(`Track ${target.label} is locked.`);
    clip.trackId = options.trackId;
  }

  const duration = clip.outMs - clip.inMs;
  let newIn = clip.inMs;
  if (Number.isFinite(Number(options.atMs))) {
    newIn = Math.max(0, Number(options.atMs));
  } else if (Number.isFinite(Number(options.deltaMs))) {
    newIn = Math.max(0, clip.inMs + Number(options.deltaMs));
  }
  clip.inMs = newIn;
  clip.outMs = newIn + duration;

  recomputeDuration(comp);
  return clip;
}

export function trimClip(
  comp: CreativeComposition,
  clipId: string,
  edge: 'head' | 'tail',
  toMs: number,
): CreativeClip {
  const idx = findClipIndex(comp, clipId);
  if (idx < 0) throw new Error(`Unknown clipId: ${clipId}`);
  const clip = comp.clips[idx];
  if (clip.locked) throw new Error('Clip is locked.');
  const target = Math.max(0, Number(toMs) || 0);
  if (edge === 'head') {
    if (target >= clip.outMs) throw new Error('Head trim would zero out the clip.');
    const delta = target - clip.inMs;
    clip.inMs = target;
    clip.trimStartMs = Math.max(0, clip.trimStartMs + delta);
  } else {
    if (target <= clip.inMs) throw new Error('Tail trim would zero out the clip.');
    const delta = clip.outMs - target;
    clip.outMs = target;
    clip.trimEndMs = Math.max(0, clip.trimEndMs + delta);
  }
  recomputeDuration(comp);
  return clip;
}

export function splitClip(
  comp: CreativeComposition,
  clipId: string,
  atMs: number,
): { left: CreativeClip; right: CreativeClip } {
  const idx = findClipIndex(comp, clipId);
  if (idx < 0) throw new Error(`Unknown clipId: ${clipId}`);
  const clip = comp.clips[idx];
  if (clip.locked) throw new Error('Clip is locked.');
  if (atMs <= clip.inMs || atMs >= clip.outMs) {
    throw new Error('Split point must be strictly inside the clip.');
  }
  const originalOutMs = clip.outMs;
  const originalTrimEndMs = clip.trimEndMs;
  const localOffsetMs = atMs - clip.inMs;
  const rightDuration = originalOutMs - atMs;
  const right = normalizeCreativeClip({
    ...cloneData(clip),
    id: newId('clip'),
    inMs: atMs,
    outMs: originalOutMs,
    trimStartMs: clip.trimStartMs + localOffsetMs,
    trimEndMs: originalTrimEndMs,
    transitionIn: null,
  });
  // shrink the left half: timeline shrinks, tail trim grows by the right portion we just split off
  clip.outMs = atMs;
  clip.trimEndMs = originalTrimEndMs + rightDuration;
  clip.transitionOut = null;

  comp.clips.splice(idx + 1, 0, right);
  recomputeDuration(comp);
  return { left: clip, right };
}

export function deleteClip(
  comp: CreativeComposition,
  clipId: string,
  options: { ripple?: boolean } = {},
): boolean {
  const idx = findClipIndex(comp, clipId);
  if (idx < 0) return false;
  const clip = comp.clips[idx];
  const removedDuration = clip.outMs - clip.inMs;
  comp.clips.splice(idx, 1);
  if (options.ripple === true) {
    for (const other of comp.clips) {
      if (other.trackId === clip.trackId && other.inMs >= clip.outMs) {
        other.inMs = Math.max(0, other.inMs - removedDuration);
        other.outMs = Math.max(0, other.outMs - removedDuration);
      }
    }
  }
  if (comp.selectedClipId === clipId) comp.selectedClipId = null;
  recomputeDuration(comp);
  return true;
}

export function setTransition(
  comp: CreativeComposition,
  clipId: string,
  edge: 'in' | 'out',
  spec: CreativeTransitionSpec | null,
): CreativeClip {
  const idx = findClipIndex(comp, clipId);
  if (idx < 0) throw new Error(`Unknown clipId: ${clipId}`);
  const clip = comp.clips[idx];
  if (edge === 'in') clip.transitionIn = spec;
  else clip.transitionOut = spec;
  return clip;
}

export function selectClip(comp: CreativeComposition, clipId: string | null): void {
  if (clipId === null) {
    comp.selectedClipId = null;
    return;
  }
  if (findClipIndex(comp, clipId) < 0) throw new Error(`Unknown clipId: ${clipId}`);
  comp.selectedClipId = clipId;
}

export function lintComposition(comp: CreativeComposition): CompositionLintResult {
  const issues: CompositionLintIssue[] = [];
  for (const track of comp.tracks) {
    const items = clipsOnTrack(comp, track.id);
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.outMs <= a.inMs) {
        issues.push({ severity: 'error', code: 'clip_zero_duration', message: 'Clip has non-positive duration.', clipId: a.id, trackId: track.id });
      }
      if (a.lane !== 'html-motion' && a.lane !== 'remotion') {
        issues.push({ severity: 'error', code: 'clip_lane_removed', message: 'Video clips must use html-motion or remotion lanes.', clipId: a.id, trackId: track.id });
      }
      if (a.lane === 'html-motion' && (a.source.kind !== 'html-motion' || !a.source.clipPath)) {
        issues.push({ severity: 'error', code: 'html_motion_source_missing', message: 'HTML Motion clips require a clipPath source.', clipId: a.id, trackId: track.id });
      }
      if (a.lane === 'remotion' && (a.source.kind !== 'remotion' || !a.source.templateId)) {
        issues.push({ severity: 'error', code: 'remotion_source_missing', message: 'Remotion clips require a templateId source.', clipId: a.id, trackId: track.id });
      }
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (overlaps(a.inMs, a.outMs, b.inMs, b.outMs)) {
          issues.push({
            severity: track.kind === 'video' ? 'warning' : 'info',
            code: 'clip_overlap',
            message: `Clips overlap on ${track.label}.`,
            clipId: a.id,
            trackId: track.id,
          });
        }
      }
    }
  }
  if (comp.tracks.filter((t) => t.kind === 'video').length === 0) {
    issues.push({ severity: 'error', code: 'no_video_track', message: 'Composition has no video track.' });
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, issues };
}

/**
 * Resolve which clips are visible/active at a given master-timeline position.
 * Returns one entry per video lane plus the active audio + caption clips.
 */
export function resolveCompositionAt(comp: CreativeComposition, atMs: number): {
  videoClips: CreativeClip[];
  audioClips: CreativeClip[];
  captionClips: CreativeClip[];
  trackById: Record<string, CreativeTrack>;
} {
  const trackById: Record<string, CreativeTrack> = {};
  for (const t of comp.tracks) trackById[t.id] = t;
  const videoClips: CreativeClip[] = [];
  const audioClips: CreativeClip[] = [];
  const captionClips: CreativeClip[] = [];
  for (const clip of comp.clips) {
    if (atMs < clip.inMs || atMs >= clip.outMs) continue;
    const track = trackById[clip.trackId];
    if (!track || track.hidden || track.muted) continue;
    if (track.kind === 'video') videoClips.push(clip);
    else if (track.kind === 'audio') audioClips.push(clip);
    else captionClips.push(clip);
  }
  // sort video clips by track index ascending so caller can z-stack
  videoClips.sort((a, b) => (trackById[a.trackId]?.index || 0) - (trackById[b.trackId]?.index || 0));
  return { videoClips, audioClips, captionClips, trackById };
}

export { summarizeCreativeComposition };
