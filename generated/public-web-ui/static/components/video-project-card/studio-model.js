// Pure studio flow logic for the video project card. No DOM, no fetch: importable from node tests.
// Step ids: 'frame' | 'setup' | 'prompt' | 'take' | 'done'. 'prompt' is UI-local (sheet state),
// so shotStep never returns it; it returns 'setup' for any shot that still needs setup.

function takesOf(shot) {
  return Array.isArray(shot?.takes) ? shot.takes : [];
}

/**
 * Which step a shot is on.
 * @param {object} shot
 * @param {number} index position in project.shots
 * @param {Array} shots all shots (kept for callers that want previous-shot context)
 * @param {Array} [characters] project characters, used to detect an anchored start frame
 */
export function shotStep(shot, index, shots = [], characters = []) {
  if (!shot) return 'setup';
  if (shot.approvedAt) return 'done';
  if (takesOf(shot).length || shot.status === 'generating') return 'take';
  const hasStart = !!(shot.storyboard || shot.startImage);
  const chained = !!shot.chainFromPrevious && index > 0;
  const anchored = shot.anchorMode === 'start' && (shot.characterIds || []).some((cid) => {
    const c = (characters || []).find((x) => x.id === cid);
    return !!(c && (c.anchors || []).length);
  });
  if (!hasStart && !chained && !anchored) return 'frame';
  return 'setup';
}

/** Index of the first shot that is not done; -1 when every shot is kept (or there are none). */
export function currentShotIndex(project) {
  const shots = project?.shots || [];
  for (let i = 0; i < shots.length; i++) {
    if (shotStep(shots[i], i, shots, project?.characters) !== 'done') return i;
  }
  return -1;
}

/** One-line "what do I do next" for the compact card and the sheet header. */
export function nextAction(project) {
  const shots = project?.shots || [];
  if (!shots.length) return { label: 'Add shots to get started', shotIndex: -1 };
  const idx = currentShotIndex(project);
  if (idx >= 0) {
    const step = shotStep(shots[idx], idx, shots, project?.characters);
    const n = idx + 1;
    if (step === 'frame') return { label: `Pick a start frame for shot ${n}`, shotIndex: idx };
    if (step === 'take') return { label: `Review shot ${n}`, shotIndex: idx };
    return { label: `Set up shot ${n}`, shotIndex: idx };
  }
  if ((project?.exports || []).length) return { label: 'Watch the final cut', shotIndex: -1 };
  return { label: 'Render the final cut', shotIndex: -1 };
}

/**
 * Duration choices for a model. Same rule as backend durationsFor (catalog.ts):
 * explicit durations list wins; otherwise integers min..max, capped at 15 entries.
 * @param {object} model catalog entry from /models (limits: durations | minDurationSec | maxDurationSec)
 */
export function durationOptions(model) {
  const l = model?.limits || {};
  if (Array.isArray(l.durations) && l.durations.length) return l.durations.slice().sort((a, b) => a - b);
  const lo = Math.max(1, Math.ceil(l.minDurationSec ?? 1));
  const hi = Math.floor(l.maxDurationSec ?? 10);
  const out = [];
  for (let s = lo; s <= hi && out.length < 15; s++) out.push(s);
  return out;
}

/** 'step' | 'auto'. Explicit project.mode wins; otherwise a project with a run is 'auto', else 'step'. */
export function resolveMode(project) {
  if (project?.mode === 'step' || project?.mode === 'auto') return project.mode;
  return project?.lastRun ? 'auto' : 'step';
}
