/**
 * Generation + render engine on top of the project document.
 *
 *  - estimate(): cost per shot from manifest pricing
 *  - generate(): cost gate -> persisted jobs -> provider submit -> poll -> takes
 *  - jobs survive gateway restarts for queue providers (fal / Higgsfield)
 *  - render(): layered FFmpeg export straight from the project (tracks stack,
 *    audio mixes) — no end-to-end concatenation
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { resolveRuntimeBinary } from '../runtime/dependencies.js';
import { estimateCostUsd, getModel, type MediaModelManifest } from './catalog.js';
import { syncFalModels, priceForModel } from './fal-catalog.js';
import { cancel, downloadOutput, falBilledUsd, missingRequiredFields, poll, submit, type ShotInput } from './providers.js';
import {
  fromWorkspaceRel, loadProject, mediaDir, mutateProject, newId, projectDir, selectedTake,
  timelineDurationMs, toWorkspaceRel, VO_TRACK_LABEL, type Job, type Shot, type Take, type VideoProject,
} from './project.js';
import { buildAss, buildCaptionCues } from './captions.js';
import { getPreset } from './presets.js';
import { characterRefs, refLimitFor } from './refs.js';

// ── ffmpeg helpers ──────────────────────────────────────────────────────

function ffmpeg(args: string[], timeoutMs = 15 * 60_000, cwd?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveRuntimeBinary('ffmpeg', { allowPathFallback: true }), args, { windowsHide: true, cwd });
    let stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, timeoutMs);
    proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-8000); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stderr }); });
  });
}

function probeDurationSec(stderr: string): number | undefined {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function mediaDurationSec(absPath: string): Promise<number | undefined> {
  const { stderr } = await ffmpeg(['-hide_banner', '-i', absPath], 30_000).catch(() => ({ code: 1, stderr: '' }));
  return probeDurationSec(stderr);
}

async function hasAudioStream(absPath: string): Promise<boolean> {
  const { stderr } = await ffmpeg(['-hide_banner', '-i', absPath], 30_000).catch(() => ({ code: 1, stderr: '' }));
  return /Stream #\d+:\d+.*Audio:/.test(stderr);
}

/** Shared ffmpeg runner for the studio/captions/music helpers. */
export const runFfmpeg = ffmpeg;

/** Grab one frame at atSec (optionally downscaled to maxWidth). */
export async function extractFrameAt(videoAbs: string, atSec: number, outAbs: string, maxWidth?: number): Promise<string> {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const vf = maxWidth ? ['-vf', `scale='min(${maxWidth},iw)':-2`] : [];
  const { code, stderr } = await ffmpeg(['-y', '-ss', Math.max(0, atSec).toFixed(3), '-i', videoAbs, '-frames:v', '1', ...vf, '-q:v', '3', outAbs], 60_000);
  if (code !== 0 || !fs.existsSync(outAbs)) throw new Error(`Could not extract frame: ${stderr.slice(-300)}`);
  return outAbs;
}

async function extractLastFrame(videoAbs: string, outAbs: string): Promise<string> {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const { code, stderr } = await ffmpeg(['-y', '-sseof', '-0.15', '-i', videoAbs, '-frames:v', '1', '-q:v', '2', outAbs], 60_000);
  if (code !== 0 || !fs.existsSync(outAbs)) throw new Error(`Could not extract last frame: ${stderr.slice(-300)}`);
  return outAbs;
}

// ── shot -> provider input ──────────────────────────────────────────────

export function shotModel(p: VideoProject, shot: Shot, override?: string): MediaModelManifest {
  const id = override || shot.modelId || p.defaults.videoModel;
  const model = getModel(id);
  if (!model) throw new Error(`Unknown model "${id}". Use video_project models to list ids.`);
  return model;
}

/**
 * Dialogue direction for the video model. native: the on-screen person speaks
 * the shot's line (lip-synced), so captions can transcribe the clip itself.
 * voiceover: a narrator track carries the words, so the clip must stay
 * dialogue-free or two voices talk over each other.
 */
export function dialogueDirection(p: VideoProject, shot: Shot): string {
  const line = shot.line?.trim().replace(/"/g, "'");
  if (p.audioMode === 'voiceover') return line ? 'No dialogue and no talking: natural ambient sound only.' : '';
  if (!line) return '';
  const speaker = shot.characterIds
    .map((id) => p.characters.find((c) => c.id === id))
    .find((c) => c && (c.kind || 'person') === 'person');
  return speaker
    ? `${speaker.name} speaks directly to camera, clearly and naturally, with lip-synced dialogue, saying exactly: "${line}" No other dialogue, no background music.`
    : `An off-camera voice says exactly: "${line}" No other dialogue, no background music.`;
}

export function composePrompt(p: VideoProject, shot: Shot): string {
  const parts = [shot.prompt.trim()];
  const preset = getPreset(shot.presetId);
  const camera = shot.camera || preset?.camera;
  if (camera) parts.push(`Camera: ${camera}.`);
  if (preset?.promptSuffix) parts.push(preset.promptSuffix);
  for (const cid of shot.characterIds) {
    const c = p.characters.find((x) => x.id === cid);
    if (c?.notes) parts.push(`${c.name}: ${c.notes}.`);
  }
  const style = shot.styleId ? p.styles.find((s) => s.id === shot.styleId) : undefined;
  if (style?.promptSuffix) parts.push(style.promptSuffix);
  parts.push(dialogueDirection(p, shot));
  return parts.filter(Boolean).join(' ');
}

/**
 * Resolve a media ref to an absolute path / URL: http(s)/data pass through,
 * "shotId" or "shotId:takeId" picks a take, anything else is workspace-relative.
 */
export function resolveMediaRef(workspacePath: string, p: VideoProject, ref: string | undefined): string | undefined {
  const r = String(ref || '').trim();
  if (!r) return undefined;
  if (/^(https?:|data:)/i.test(r)) return r;
  const m = r.match(/^(shot_[a-z0-9_-]+)(?::(take_[a-z0-9_-]+))?$/i);
  if (m) {
    const s = p.shots.find((x) => x.id === m[1]);
    const t = s && (m[2] ? s.takes.find((x) => x.id === m[2]) : selectedTake(s));
    if (!t) throw new Error(`Media ref "${r}" has no take yet: generate that shot first or pass a workspace file path.`);
    return fromWorkspaceRel(workspacePath, t.path);
  }
  return fromWorkspaceRel(workspacePath, r);
}

/** What the user should add when a required neutral field is missing. */
const FIELD_HINT: Record<string, string> = {
  startImage: 'add a character anchor, startImage, storyboard or chainFromPrevious',
  sourceVideo: 'set shot.sourceVideo to a workspace clip or "shotId:takeId" (import_asset role footage)',
  audio: 'set shot.audio to an audio file, or give the shot a line to auto-voice',
  prompt: 'write a shot prompt',
  referenceImages: 'add a character anchor or style reference',
};

export function missingFieldsMessage(model: MediaModelManifest, missing: string[]): string {
  return `${model.id} needs ${missing.map((f) => `${f} (${FIELD_HINT[f] || 'set it on the shot'})`).join(', ')}`;
}

async function resolveShotInput(workspacePath: string, p: VideoProject, shot: Shot, model: MediaModelManifest): Promise<ShotInput> {
  const refs: string[] = [];
  for (const cid of shot.characterIds) {
    const c = p.characters.find((x) => x.id === cid);
    if (c) refs.push(...characterRefs(workspacePath, c));
  }
  const style = shot.styleId ? p.styles.find((s) => s.id === shot.styleId) : undefined;
  if (style) refs.push(...style.refs);

  // An approved storyboard still is the strongest first frame (identity + product + framing).
  let startImage = shot.startImage || (model.map.startImage ? shot.storyboard : undefined);
  if (!startImage && shot.chainFromPrevious) {
    const idx = p.shots.findIndex((s) => s.id === shot.id);
    const prev = idx > 0 ? p.shots[idx - 1] : undefined;
    const prevTake = prev && selectedTake(prev);
    if (prevTake?.kind === 'video') {
      const frameAbs = path.join(mediaDir(workspacePath, p.id), 'frames', `${prev!.id}_${prevTake.id}_last.jpg`);
      if (!fs.existsSync(frameAbs)) await extractLastFrame(fromWorkspaceRel(workspacePath, prevTake.path), frameAbs);
      startImage = toWorkspaceRel(workspacePath, frameAbs);
    }
  }
  // Identity frame: when the model animates from a still and nothing else was
  // chosen, the first character anchor carries identity (Higgsfield-style).
  if (!startImage && model.map.startImage && refs.length
    && (shot.anchorMode === 'start' || (!shot.anchorMode && !model.map.referenceImages))) {
    startImage = refs[0];
  }
  const abs = (ref: string | undefined) => (!ref || /^(https?:|data:)/i.test(ref) ? ref : fromWorkspaceRel(workspacePath, ref));
  const preset = getPreset(shot.presetId);
  return {
    prompt: composePrompt(p, shot),
    negativePrompt: preset?.negativePrompt,
    sourceVideo: model.map.sourceVideo ? resolveMediaRef(workspacePath, p, shot.sourceVideo) : undefined,
    audio: model.map.audio ? resolveMediaRef(workspacePath, p, shot.audio) : undefined,
    startImage: abs(startImage),
    endImage: abs(shot.endImage),
    referenceImages: model.map.referenceImages && !startImage ? Array.from(new Set(refs)).slice(0, refLimitFor(model)).map((r) => abs(r)!) : undefined,
    durationSec: shot.durationSec,
    aspectRatio: p.target.aspect,
    resolution: p.target.resolution,
    extra: shot.params,
  };
}

// ── estimate ────────────────────────────────────────────────────────────

/** Repair historical budget totals from completed jobs, using the current model price when known. */
export async function reconcileProjectSpend(workspacePath: string, projectId: string, project = loadProject(workspacePath, projectId)): Promise<VideoProject> {
  let spent = 0;
  const actual = new Map<string, number>();
  for (const job of project.jobs) {
    if (job.state !== 'done') continue;
    const model = getModel(job.modelId);
    const knownLive = model?.provider === 'fal' ? priceForModel(model, {
      durationSec: Number(job.input.durationSec) || undefined,
      resolution: String(job.input.resolution || project.target.resolution),
      aspectRatio: String(job.input.aspectRatio || project.target.aspect),
    }) : undefined;
    const usd = (knownLive !== undefined || model?.pricing?.includedInSubscription || model?.pricing?.byResolutionPerSecondUsd) && model
      ? estimateCostUsd(model, { durationSec: Number(job.input.durationSec) || undefined,
        resolution: String(job.input.resolution || project.target.resolution),
        aspectRatio: String(job.input.aspectRatio || project.target.aspect), count: job.count })
      : job.actualUsd ?? job.estimateUsd;
    const chargedUsd = job.billedUsd ?? usd;
    actual.set(job.id, chargedUsd);
    spent += chargedUsd;
  }
  spent = Math.round(spent * 1000) / 1000;
  if (Math.abs(spent - project.budget.spentUsd) < 0.0001
      && project.jobs.every((job) => job.state !== 'done' || job.actualUsd === actual.get(job.id))) return project;
  return mutateProject(workspacePath, projectId, 'budget.reconcile', (p) => {
    for (const job of p.jobs) if (actual.has(job.id)) job.actualUsd = actual.get(job.id);
    p.budget.spentUsd = spent;
  });
}

export interface ShotEstimate { shotId: string; title: string; modelId: string; count: number; usd: number; problems: string[] }

export async function estimate(workspacePath: string, projectId: string, args: { shotIds?: string[]; count?: number; modelId?: string; sourceFromSelectedTake?: boolean; resolution?: string }): Promise<{ total: number; shots: ShotEstimate[]; budget: VideoProject['budget'] }> {
  let p = loadProject(workspacePath, projectId);
  if (args.modelId?.startsWith('fal/') || p.shots.some((s) => (s.modelId || p.defaults.videoModel).startsWith('fal/'))) await syncFalModels();
  p = await reconcileProjectSpend(workspacePath, projectId, p);
  const ids = args.shotIds?.length ? args.shotIds : p.shots.map((s) => s.id);
  const count = Math.max(1, Math.min(4, Number(args.count) || 1));
  const shots: ShotEstimate[] = [];
  for (const id of ids) {
    const shot = p.shots.find((s) => s.id === id);
    if (!shot) throw new Error(`Shot "${id}" not found.`);
    const model = shotModel(p, shot, args.modelId);
    const problems: string[] = [];
    try {
      const input = await resolveShotInput(workspacePath, p, shot, model);
      // A line is auto-voiced (TTS) at generate time for audio-driven models.
      const missing = missingRequiredFields(model, input).filter((f) => !(f === 'audio' && shot.line?.trim()) && !(f === 'sourceVideo' && args.sourceFromSelectedTake && selectedTake(shot)?.kind === 'video'));
      if (missing.length) problems.push(missingFieldsMessage(model, missing));
    } catch (e: any) { problems.push(String(e?.message || e)); }
    if (priceForModel(model, { durationSec: shot.durationSec, resolution: args.resolution || p.target.resolution, aspectRatio: p.target.aspect }) === undefined && !model.pricing?.perSecondUsd && !model.pricing?.perImageUsd && !model.pricing?.perRequestUsd && !model.pricing?.includedInSubscription) problems.push('model has no pricing; cost is unknown');
    if (model.source === 'fal-sync') {
      const { hydrateFalModelSchema } = await import('./fal-catalog.js');
      await hydrateFalModelSchema(model);
      if (model.unmappedRequired?.length) problems.push(`${model.id} requires ${model.unmappedRequired.join(', ')} which Prometheus cannot fill; add a curated manifest (add_model with defaults) first`);
      else problems.push('unverified synced model: inputs were guessed from the fal catalog; check models -> needs before approving a paid run');
    }
    shots.push({ shotId: id, title: shot.title, modelId: model.id, count, usd: estimateCostUsd(model, { durationSec: shot.durationSec, count, resolution: args.resolution || p.target.resolution, aspectRatio: p.target.aspect }), problems });
  }
  const total = Math.round(shots.reduce((s, x) => s + x.usd, 0) * 1000) / 1000;
  return { total, shots, budget: p.budget };
}

// ── job runner ──────────────────────────────────────────────────────────

const running = new Set<string>();
const POLL_MS = 5000;
const MAX_JOB_MS = 30 * 60_000;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function patchJob(workspacePath: string, projectId: string, jobId: string, patch: Partial<Job>, extra?: (p: VideoProject, job: Job) => void) {
  return mutateProject(workspacePath, projectId, 'job', (p) => {
    const job = p.jobs.find((j) => j.id === jobId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: Date.now() });
    extra?.(p, job);
  });
}

async function finishJob(workspacePath: string, projectId: string, job: Job, model: MediaModelManifest, outputs: Array<{ url?: string; localPath?: string; mimeType?: string }>, raw?: unknown) {
  const dir = mediaDir(workspacePath, projectId);
  const saved: Array<{ rel: string; durationSec?: number; poster?: string }> = [];
  for (let i = 0; i < outputs.length; i++) {
    const t = job.target as any;
    const base = `${t.shotId || t.characterId || (t.storyboardShotId ? `sb_${t.storyboardShotId}` : 'asset')}_${job.id}_${i}`;
    const abs = await downloadOutput(outputs[i], dir, base, model.kind);
    let poster: string | undefined;
    if (model.kind === 'video') {
      // Upscaled/lip-synced takes keep the clip; poster is best-effort.
      try { poster = toWorkspaceRel(workspacePath, await extractFrameAt(abs, 0.1, path.join(dir, 'posters', `${base}.jpg`), 640)); } catch { /* thumbnail is best-effort */ }
    }
    saved.push({ rel: toWorkspaceRel(workspacePath, abs), durationSec: model.kind !== 'image' ? await mediaDurationSec(abs) : undefined, poster });
  }
  // Only successfully delivered outputs accrue spend; quote may predate a live price refresh.
  const billedUsd = saved.length && model.provider === 'fal' ? falBilledUsd(raw) : undefined;
  const actualUsd = billedUsd ?? (saved.length ? estimateCostUsd(model, { durationSec: Number(job.input.durationSec) || undefined,
    resolution: String(job.input.resolution || ''), aspectRatio: String(job.input.aspectRatio || ''), count: saved.length }) : 0);
  const perOutputUsd = saved.length ? actualUsd / saved.length : 0;
  await patchJob(workspacePath, projectId, job.id, { state: 'done', actualUsd, ...(billedUsd === undefined ? {} : { billedUsd }) }, (p, j) => {
    p.budget.spentUsd = Math.round((p.budget.spentUsd + actualUsd) * 1000) / 1000;
    const prompt = String(j.input.prompt || '');
    if (model.kind === 'audio') {
      // Generated audio (music / SFX) lands as project assets only.
    } else if ('shotId' in j.target) {
      const shot = p.shots.find((s) => s.id === (j.target as any).shotId);
      if (!shot) return;
      for (const s of saved) {
        const take: Take = {
          id: newId('take'), jobId: j.id, modelId: model.id, kind: model.kind as 'video' | 'image', path: s.rel, prompt,
          costUsd: perOutputUsd, createdAt: Date.now(), durationSec: s.durationSec, poster: s.poster,
        };
        shot.takes.push(take);
        j.takeIds.push(take.id);
        if (!shot.selectedTakeId || (j.input as any).selectNew) shot.selectedTakeId = take.id;
      }
      shot.status = 'ready';
    } else if ('characterId' in j.target) {
      // Anchors land as candidates; the user approves one (chat card / Studio)
      // with character.approveAnchor before it drives identity.
      const c = p.characters.find((x) => x.id === (j.target as any).characterId);
      if (c) c.candidates = [...(c.candidates || []), ...saved.map((s) => s.rel)].slice(-12);
    } else if ('storyboardShotId' in j.target) {
      const shot = p.shots.find((s) => s.id === (j.target as any).storyboardShotId);
      if (shot) shot.storyboardCandidates = [...(shot.storyboardCandidates || []), ...saved.map((s) => s.rel)].slice(-8);
    }
    for (const s of saved) {
      p.assets.push({ id: newId('asset'), kind: model.kind, path: s.rel, origin: 'generated', modelId: model.id, prompt, createdAt: Date.now() });
    }
  });
}

async function failJob(workspacePath: string, projectId: string, jobId: string, error: string, errorType: string) {
  await patchJob(workspacePath, projectId, jobId, { state: 'failed', error: error.slice(0, 600), errorType }, (p, j) => {
    if ('shotId' in j.target) {
      const shot = p.shots.find((s) => s.id === (j.target as any).shotId);
      const stillRunning = p.jobs.some((x) => x.id !== j.id && 'shotId' in x.target && (x.target as any).shotId === shot?.id && (x.state === 'running' || x.state === 'queued'));
      if (shot && !stillRunning) shot.status = shot.takes.length ? 'ready' : 'failed';
    }
  });
}

/** Rate-limit (429 / resource-exhausted / "too many requests") errors are transient. */
export function isRateLimitError(e: unknown): boolean {
  const s = String((e as any)?.message || e || '');
  return /resource-exhausted|too many requests|rate.?limit|\b429\b/i.test(s);
}

/** Out-of-credits / billing errors: permanent for this provider, but another provider may work. */
export function isCreditError(e: unknown): boolean {
  const s = String((e as any)?.message || e || '');
  return /spending-limit|run out of credits|out of credits|insufficient[_ ]?(credits|quota|balance|funds)|billing[_ ]?(hard[_ ]?limit|not active)|payment required|\b402\b/i.test(s);
}

/** Image models to try when the chosen provider is out of credits (in order). */
export const IMAGE_CREDIT_FALLBACKS = ['openai/gpt-image', 'xai/grok-imagine-image-2.0'];

/**
 * Submit with rate-limit retry; image jobs whose provider is out of credits
 * fall back to the next configured image provider. Returns the model used.
 */
export async function submitWithFallback(model: MediaModelManifest, input: ShotInput & { count?: number }, opts: { outputDir: string }): Promise<{ model: MediaModelManifest; result: Awaited<ReturnType<typeof submit>>; fallbackFrom?: string; firstError?: string }> {
  try {
    return { model, result: await withRateLimitRetry(() => submit(model, input, opts)) };
  } catch (e) {
    if (model.kind !== 'image' || !isCreditError(e)) throw e;
    const firstError = String((e as any)?.message || e).slice(0, 240);
    for (const id of IMAGE_CREDIT_FALLBACKS) {
      const fb = getModel(id);
      if (!fb || fb.id === model.id || fb.provider === model.provider) continue;
      try {
        return { model: fb, result: await withRateLimitRetry(() => submit(fb, input, opts)), fallbackFrom: model.id, firstError };
      } catch (e2) { if (!isCreditError(e2)) throw e2; }
    }
    throw e;
  }
}

/** Retry fn on provider rate limits with jittered exponential backoff (xAI teams cap at 2 req/s). */
export async function withRateLimitRetry<T>(fn: () => Promise<T>, tries = 5, baseMs = 1500): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!isRateLimitError(e) || i === tries - 1) throw e;
      await sleep(baseMs * 2 ** i + Math.floor(Math.random() * 700));
    }
  }
  throw last;
}

async function runJob(workspacePath: string, projectId: string, jobId: string, resume = false): Promise<void> {
  const key = `${projectId}:${jobId}`;
  if (running.has(key)) return;
  running.add(key);
  try {
    let p = loadProject(workspacePath, projectId);
    let job = p.jobs.find((j) => j.id === jobId);
    if (!job || job.state === 'done' || job.state === 'failed' || job.state === 'canceled') return;
    let model = getModel(job.modelId);
    if (!model) { await failJob(workspacePath, projectId, jobId, `Model ${job.modelId} is no longer in the catalog.`, 'invalid_model'); return; }

    if (!resume || !job.requestId) {
      await patchJob(workspacePath, projectId, jobId, { state: 'running' });
      const input = job.input as unknown as ShotInput;
      const sub = await submitWithFallback(model, { ...input, count: job!.count }, { outputDir: toWorkspaceRel(workspacePath, mediaDir(workspacePath, projectId)) });
      const result = sub.result;
      if (sub.fallbackFrom) {
        model = sub.model;
        // Bill at the fallback model's price, not the original model's estimate.
        const estimateUsd = estimateCostUsd(model, { durationSec: Number(job.input.durationSec) || undefined,
          resolution: String(job.input.resolution || ''), aspectRatio: String(job.input.aspectRatio || ''), count: job.count });
        job = { ...job, modelId: model.id, estimateUsd };
        await patchJob(workspacePath, projectId, jobId, { modelId: model.id, estimateUsd, fallbackFrom: sub.fallbackFrom } as any);
      }
      if (result.state === 'done') {
        await finishJob(workspacePath, projectId, { ...job, requestId: result.requestId }, model, result.outputs || [], result.raw);
        return;
      }
      await patchJob(workspacePath, projectId, jobId, { requestId: result.requestId, statusUrl: result.statusUrl, responseUrl: result.responseUrl });
    }

    const started = Date.now();
    while (Date.now() - started < MAX_JOB_MS) {
      await sleep(POLL_MS);
      p = loadProject(workspacePath, projectId);
      job = p.jobs.find((j) => j.id === jobId);
      if (!job || job.state === 'canceled') return;
      const state = await poll(model, { requestId: job.requestId!, statusUrl: job.statusUrl, responseUrl: job.responseUrl });
      if (state.state === 'pending') continue;
      if (state.state === 'failed') { await failJob(workspacePath, projectId, jobId, state.error, state.errorType); return; }
      await finishJob(workspacePath, projectId, job, model, state.outputs, state.raw);
      return;
    }
    await failJob(workspacePath, projectId, jobId, 'Generation timed out after 30 minutes.', 'timeout');
  } catch (e: any) {
    await failJob(workspacePath, projectId, jobId, String(e?.message || e), String(e?.errorType || 'api_error')).catch(() => undefined);
  } finally {
    running.delete(key);
  }
}

/** Resume in-flight queue jobs after a restart. Safe to call repeatedly. */
export function resumeJobs(workspacePath: string): number {
  const root = path.join(workspacePath, 'video-projects');
  if (!fs.existsSync(root)) return 0;
  let resumed = 0;
  for (const id of fs.readdirSync(root)) {
    let p: VideoProject;
    try { p = loadProject(workspacePath, id); } catch { continue; }
    for (const job of p.jobs) {
      if (job.state !== 'running' && job.state !== 'queued') continue;
      if (running.has(`${p.id}:${job.id}`)) continue;
      const model = getModel(job.modelId);
      if (job.requestId && model && (model.provider === 'fal' || model.provider === 'higgsfield')) {
        void runJob(workspacePath, p.id, job.id, true);
        resumed += 1;
      } else {
        void failJob(workspacePath, p.id, job.id, 'Interrupted by a gateway restart before the provider accepted it. Re-run generate.', 'interrupted');
      }
    }
  }
  return resumed;
}

// ── generate ────────────────────────────────────────────────────────────

export interface GenerateResult {
  needsApproval?: boolean;
  reason?: string;
  estimate: { total: number; shots: ShotEstimate[] };
  jobs: Array<{ id: string; target: Job['target']; modelId: string; estimateUsd: number }>;
}

export async function generateShots(workspacePath: string, projectId: string, args: {
  shotIds?: string[]; count?: number; modelId?: string; approved?: boolean;
  /** Hook A/B: generate this shot with an alternative prompt. */
  promptOverride?: string;
  /** Draft -> final: re-generate at a higher resolution than the project target. */
  resolution?: string;
  /** Make the new take the selected one (upscale / foley / lipsync passes). */
  selectNew?: boolean;
  /** Extra provider params merged into the request body. */
  extra?: Record<string, unknown>;
  /** Post passes (upscale / foley / lipsync): feed each shot's own selected take as sourceVideo. */
  sourceFromSelectedTake?: boolean;
  /** Send this prompt verbatim ("{shot}" = the shot prompt) instead of the composed shot prompt. */
  rawPrompt?: string;
}): Promise<GenerateResult> {
  const est = await estimate(workspacePath, projectId, args);
  const blocking = est.shots.filter((s) => s.problems.some((x) => !x.startsWith('model has no pricing') && !x.startsWith('unverified synced model')));
  if (blocking.length) {
    throw new Error(`Cannot generate: ${blocking.map((s) => `${s.title}: ${s.problems.join('; ')}`).join(' | ')}`);
  }
  const p0 = loadProject(workspacePath, projectId);
  const cap = p0.budget.capUsd;
  if (cap != null && p0.budget.spentUsd + est.total > cap + 1e-9) {
    return { needsApproval: true, reason: `Budget cap $${cap.toFixed(2)} would be exceeded (spent $${p0.budget.spentUsd.toFixed(2)} + $${est.total.toFixed(2)}). Raise budget.capUsd via project.update first.`, estimate: est, jobs: [] };
  }
  if (!args.approved && est.shots.some((s) => s.problems.some((problem) => problem.startsWith('model has no pricing')))) {
    return { needsApproval: true, reason: 'At least one model has unknown pricing. Confirm with the user before generating; a $0 estimate is not a free job.', estimate: est, jobs: [] };
  }
  if (!args.approved && est.shots.some((s) => s.problems.some((x) => x.startsWith('unverified synced model')))) {
    return { needsApproval: true, reason: 'A synced fal model is unverified (inputs guessed). Check its inputs and confirm with the user, then call again with approved:true.', estimate: est, jobs: [] };
  }
  if (!args.approved && est.total > p0.budget.autoApproveUsd + 1e-9) {
    return { needsApproval: true, reason: `Estimated $${est.total.toFixed(2)} is above the auto-approve limit ($${p0.budget.autoApproveUsd.toFixed(2)}). Confirm with the user, then call again with approved:true.`, estimate: est, jobs: [] };
  }

  // Audio-driven shots (lipsync / talking photo) with a line but no audio: voice the line first.
  {
    const pa = loadProject(workspacePath, projectId);
    for (const s of est.shots) {
      const shot = pa.shots.find((x) => x.id === s.shotId)!;
      const model = shotModel(pa, shot, args.modelId);
      if (model.map.audio && !shot.audio && shot.line?.trim()) {
        const { ttsLineToFile } = await import('./studio.js');
        const rel = await ttsLineToFile(workspacePath, projectId, shot.line.trim(), `${shot.id}_line`);
        await mutateProject(workspacePath, projectId, 'tts', (proj) => { const t = proj.shots.find((x) => x.id === shot.id); if (t) t.audio = rel; });
      }
    }
  }
  const created: GenerateResult['jobs'] = [];
  const p = loadProject(workspacePath, projectId);
  const pending: Job[] = [];
  for (const s of est.shots) {
    const shot = p.shots.find((x) => x.id === s.shotId)!;
    const model = shotModel(p, shot, args.modelId);
    const input = await resolveShotInput(workspacePath, p, shot, model);
    if (args.promptOverride) input.prompt = composePrompt(p, { ...shot, prompt: String(args.promptOverride) });
    if (args.resolution) input.resolution = String(args.resolution);
    if (args.sourceFromSelectedTake && model.map.sourceVideo) {
      const t = selectedTake(shot);
      if (t?.kind === 'video') input.sourceVideo = fromWorkspaceRel(workspacePath, t.path);
    }
    if (args.rawPrompt !== undefined) input.prompt = String(args.rawPrompt).replace(/\{shot\}/g, shot.prompt.trim());
    if (args.extra) input.extra = { ...(input.extra || {}), ...args.extra };
    if (args.selectNew) (input as any).selectNew = true;
    const job: Job = {
      id: newId('job'), target: { shotId: shot.id }, modelId: model.id, input: input as any,
      count: s.count, state: 'queued', estimateUsd: s.usd, takeIds: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    pending.push(job);
    created.push({ id: job.id, target: job.target, modelId: job.modelId, estimateUsd: job.estimateUsd });
  }
  await mutateProject(workspacePath, projectId, 'generate', (proj) => {
    for (const job of pending) {
      proj.jobs.push(job);
      const shot = proj.shots.find((x) => x.id === (job.target as any).shotId);
      if (shot) shot.status = 'generating';
    }
    proj.jobs = proj.jobs.slice(-300);
  });
  for (const job of pending) void runJob(workspacePath, projectId, job.id);
  return { estimate: est, jobs: created };
}

/** Generate an anchor still for a character (Higgsfield-style identity frame). */
export async function generateCharacterAnchor(workspacePath: string, projectId: string, args: {
  characterId: string; prompt?: string; modelId?: string; count?: number; approved?: boolean; referenceImages?: string[];
}): Promise<GenerateResult> {
  const p = loadProject(workspacePath, projectId);
  const c = p.characters.find((x) => x.id === args.characterId);
  if (!c) throw new Error(`Character "${args.characterId}" not found.`);
  // Reroll reuses the last prompt/model when none is given.
  const anchorPrompt = String(args.prompt || c.anchorPrompt || '').trim();
  if (!anchorPrompt) throw new Error('prompt is required for the first anchor of a character.');
  const modelId = args.modelId || c.anchorModel || p.defaults.imageModel;
  const model = getModel(modelId);
  if (!model || model.kind !== 'image') throw new Error(`"${modelId}" is not an image model.`);
  const count = Math.max(1, Math.min(4, Number(args.count) || 1));
  const usd = estimateCostUsd(model, { count });
  const est = { total: usd, shots: [{ shotId: '', title: `${c.name} anchor`, modelId: model.id, count, usd, problems: [] }] };
  if (!args.approved && usd > p.budget.autoApproveUsd + 1e-9) {
    return { needsApproval: true, reason: `Anchor costs ~$${usd.toFixed(2)}, above auto-approve. Call again with approved:true after the user confirms.`, estimate: est, jobs: [] };
  }
  const refs = [...(args.referenceImages || []), ...characterRefs(workspacePath, c).filter((r) => !c.anchors.includes(r))]
    .map((r) => (/^(https?:|data:)/i.test(r) ? r : fromWorkspaceRel(workspacePath, r)));
  const input: ShotInput = {
    prompt: [anchorPrompt, c.notes].filter(Boolean).join(' '),
    startImage: model.map.startImage ? refs[0] : undefined,
    referenceImages: model.map.referenceImages ? refs.slice(0, refLimitFor(model)) : undefined,
    aspectRatio: p.target.aspect,
  };
  const missing = missingRequiredFields(model, input);
  if (missing.length) throw new Error(`${missingFieldsMessage(model, missing)}.`);
  const job: Job = {
    id: newId('job'), target: { characterId: c.id }, modelId: model.id, input: input as any, count,
    state: 'queued', estimateUsd: usd, takeIds: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
  await mutateProject(workspacePath, projectId, 'generate', (proj) => {
    proj.jobs.push(job);
    const ch = proj.characters.find((x) => x.id === c.id);
    if (ch) { ch.anchorPrompt = anchorPrompt; ch.anchorModel = model.id; }
  });
  void runJob(workspacePath, projectId, job.id);
  return { estimate: est, jobs: [{ id: job.id, target: job.target, modelId: model.id, estimateUsd: usd }] };
}

/**
 * Storyboard stills (our "Popcorn"): one cheap image per shot, generated from
 * the shot prompt with every character/product anchor as a reference, so the
 * user approves framing + identity at ~4-7c a shot before paying for video.
 * Approved stills become the shot's first frame.
 */
export async function generateStoryboards(workspacePath: string, projectId: string, args: {
  shotIds?: string[]; modelId?: string; approved?: boolean; count?: number;
}): Promise<GenerateResult> {
  const p = loadProject(workspacePath, projectId);
  const model = getModel(args.modelId || p.defaults.imageModel);
  if (!model || model.kind !== 'image') throw new Error(`"${args.modelId || p.defaults.imageModel}" is not an image model.`);
  const shots = args.shotIds?.length ? p.shots.filter((s) => args.shotIds!.includes(s.id)) : p.shots.filter((s) => !s.storyboard && !s.takes.length);
  const count = Math.max(1, Math.min(3, Number(args.count) || 1));
  const per = estimateCostUsd(model, { count });
  const est = {
    total: Math.round(per * shots.length * 1000) / 1000,
    shots: shots.map((s) => ({ shotId: s.id, title: `${s.title} storyboard`, modelId: model.id, count, usd: per, problems: [] as string[] })),
    budget: p.budget,
  };
  if (!shots.length) return { estimate: est, jobs: [] };
  const cap = p.budget.capUsd;
  if (cap != null && p.budget.spentUsd + est.total > cap + 1e-9) {
    return { needsApproval: true, reason: `Budget cap $${cap.toFixed(2)} would be exceeded by storyboards ($${est.total.toFixed(2)}).`, estimate: est, jobs: [] };
  }
  if (!args.approved && est.total > p.budget.autoApproveUsd + 1e-9) {
    return { needsApproval: true, reason: `Storyboards cost ~$${est.total.toFixed(2)}, above auto-approve. Call again with approved:true after the user confirms.`, estimate: est, jobs: [] };
  }
  const aspectWords = p.target.aspect === '9:16' ? 'vertical 9:16 phone frame' : p.target.aspect === '1:1' ? 'square 1:1 frame' : `${p.target.aspect} widescreen frame`;
  const abs = (r: string) => (/^(https?:|data:)/i.test(r) ? r : fromWorkspaceRel(workspacePath, r));
  const pending: Job[] = [];
  for (const shot of shots) {
    const refs: string[] = [];
    let hasProduct = false;
    for (const cid of shot.characterIds) {
      const c = p.characters.find((x) => x.id === cid);
      if (!c) continue;
      if (c.kind === 'product') hasProduct = true;
      // Full identity pack (cast-linked characters read the live library pack).
      refs.push(...characterRefs(workspacePath, c));
    }
    const style = shot.styleId ? p.styles.find((s) => s.id === shot.styleId) : undefined;
    if (style) refs.push(...style.refs.slice(0, 1));
    // Draw-to-video: the sketch leads, composition must be kept.
    if (shot.sketch) refs.unshift(shot.sketch);
    const look = getPreset(shot.presetId)?.group === 'look' ? getPreset(shot.presetId)!.label : (style?.name || 'photorealistic');
    const prompt = [
      shot.sketch ? `Turn this sketch into a finished ${look} frame, keep composition.` : '',
      `Storyboard frame: the exact opening frame of a video shot, ${aspectWords}.`,
      composePrompt(p, { ...shot, line: undefined }),
      hasProduct ? 'The product must match the reference photo exactly: same shape, label, logo and colors.' : '',
      refs.length ? 'Keep every person identical to the reference images.' : '',
      'Photorealistic, natural light, no on-screen text, no captions, no watermark.',
    ].filter(Boolean).join(' ');
    // Sketch + product refs first, then the identity pack; the provider cap trims from the end.
    const uniq = Array.from(new Set(refs)).slice(0, refLimitFor(model)).map(abs);
    const input: ShotInput = {
      prompt,
      referenceImages: model.map.referenceImages && uniq.length ? uniq : undefined,
      startImage: !model.map.referenceImages && model.map.startImage ? uniq[0] : undefined,
      aspectRatio: p.target.aspect,
    };
    pending.push({
      id: newId('job'), target: { storyboardShotId: shot.id }, modelId: model.id, input: input as any, count,
      state: 'queued', estimateUsd: per, takeIds: [], createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
  await mutateProject(workspacePath, projectId, 'generate', (proj) => { proj.jobs.push(...pending); proj.jobs = proj.jobs.slice(-300); });
  for (const job of pending) void runJob(workspacePath, projectId, job.id);
  return { estimate: est, jobs: pending.map((j) => ({ id: j.id, target: j.target, modelId: j.modelId, estimateUsd: j.estimateUsd })) };
}

export async function cancelJob(workspacePath: string, projectId: string, jobId: string): Promise<boolean> {
  const p = loadProject(workspacePath, projectId);
  const job = p.jobs.find((j) => j.id === jobId);
  if (!job || (job.state !== 'queued' && job.state !== 'running')) return false;
  const model = getModel(job.modelId);
  if (model && job.requestId) await cancel(model, { requestId: job.requestId });
  await patchJob(workspacePath, projectId, jobId, { state: 'canceled' }, (proj, j) => {
    if ('shotId' in j.target) {
      const shot = proj.shots.find((s) => s.id === (j.target as any).shotId);
      if (shot && shot.status === 'generating') shot.status = shot.takes.length ? 'ready' : 'draft';
    }
  });
  return true;
}

/** Wait (bounded) for jobs to settle — lets the agent block briefly in one call. */
export async function waitForJobs(workspacePath: string, projectId: string, jobIds: string[] | undefined, timeoutMs: number): Promise<Job[]> {
  const deadline = Date.now() + Math.max(0, Math.min(timeoutMs, 10 * 60_000));
  for (;;) {
    const p = loadProject(workspacePath, projectId);
    const jobs = jobIds?.length ? p.jobs.filter((j) => jobIds.includes(j.id)) : p.jobs.filter((j) => j.state === 'running' || j.state === 'queued');
    const active = jobs.filter((j) => j.state === 'running' || j.state === 'queued');
    if (!active.length || Date.now() >= deadline) return jobs;
    await sleep(3000);
  }
}

// ── render ──────────────────────────────────────────────────────────────

const RES_HEIGHT: Record<string, number> = { '480p': 480, '720p': 720, '1080p': 1080 };

export function canvasSize(target: VideoProject['target']): { width: number; height: number } {
  const short = RES_HEIGHT[target.resolution] || 720;
  const [a, b] = String(target.aspect || '16:9').split(':').map(Number);
  const rw = a > 0 ? a : 16;
  const rh = b > 0 ? b : 9;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return rw >= rh
    ? { width: even((short * rw) / rh), height: even(short) }
    : { width: even(short), height: even((short * rh) / rw) };
}

interface RenderLayer { abs: string; startSec: number; inSec: number; durSec: number; kind: 'video' | 'image' | 'audio'; trackIndex: number; volume: number; overlay: boolean; kenBurns?: boolean }

export function buildRenderPlan(workspacePath: string, p: VideoProject): { layers: RenderLayer[]; durationSec: number; missing: string[] } {
  const layers: RenderLayer[] = [];
  const missing: string[] = [];
  p.tracks.forEach((track, trackIndex) => {
    if (track.muted && track.kind === 'audio') return;
    for (const clip of p.clips.filter((c) => c.trackId === track.id)) {
      let rel: string | undefined;
      let kind: RenderLayer['kind'] = track.kind === 'audio' ? 'audio' : 'video';
      let kenBurns = false;
      if ('shotId' in clip.source) {
        const shot = p.shots.find((s) => s.id === (clip.source as any).shotId);
        const take = shot && selectedTake(shot);
        if (!take) { missing.push(`${shot?.title || clip.source.shotId} has no take`); continue; }
        rel = take.path;
        // Shot stills are first-class clips: slow Ken Burns push-in (opt out with kenBurns:false).
        if (take.kind === 'image') { kind = 'image'; kenBurns = shot!.kenBurns !== false; }
      } else {
        rel = clip.source.assetPath;
        if (/\.(png|jpe?g|webp)$/i.test(rel)) kind = 'image';
        if (/\.(mp3|wav|m4a|aac|ogg)$/i.test(rel)) kind = 'audio';
      }
      let abs: string;
      try { abs = fromWorkspaceRel(workspacePath, rel!); } catch { missing.push(`${rel} is outside the workspace`); continue; }
      if (!fs.existsSync(abs)) { missing.push(`${rel} is missing on disk`); continue; }
      layers.push({
        abs, kind, trackIndex,
        startSec: clip.startMs / 1000, inSec: clip.inMs / 1000, durSec: Math.max(0.05, (clip.outMs - clip.inMs) / 1000),
        volume: track.muted ? 0 : clip.volume ?? 1,
        overlay: track.kind === 'overlay',
        kenBurns: kenBurns && track.kind !== 'overlay',
      });
    }
  });
  return { layers, durationSec: timelineDurationMs(p) / 1000, missing };
}

/**
 * Layered export. Track order = stacking order (first video track at the
 * bottom). Main video tracks are scaled to cover the canvas; overlay tracks
 * are fit inside it (picture-in-picture/logos use them). Audio from video
 * clips and audio tracks is delayed to its timeline position and mixed.
 */
export interface RenderArgs {
  output?: string;
  includeClipAudio?: boolean;
  /** Reframe to another aspect (blur-fill instead of hard crop). */
  aspect?: string;
  /** Label stored on the export (hook A/B). */
  variant?: string;
  /** Render with a different take for one shot (hook variants) without touching the project. */
  takeOverride?: { shotId: string; takeId: string };
  captions?: boolean;
  music?: boolean;
  watermark?: boolean;
}

export async function renderProject(workspacePath: string, projectId: string, args: RenderArgs = {}): Promise<{ path: string; durationSec: number; width: number; height: number; layers: number; aspect: string; variant?: string; captions: number; music: boolean; watermark: boolean }> {
  const p = loadProject(workspacePath, projectId);
  if (args.takeOverride) {
    const shot = p.shots.find((s) => s.id === args.takeOverride!.shotId);
    if (!shot || !shot.takes.some((t) => t.id === args.takeOverride!.takeId)) throw new Error('takeOverride does not match a take of that shot.');
    shot.selectedTakeId = args.takeOverride.takeId;
  }
  // Native dialogue captions follow the actual clips: recompute against this
  // exact timeline (trims, moves, hook-variant takes) instead of stale cues.
  if (p.audioMode === 'native' && p.captions?.enabled) p.captions = { ...p.captions, cues: buildCaptionCues(p) };
  const plan = buildRenderPlan(workspacePath, p);
  if (plan.missing.length) throw new Error(`Cannot render: ${plan.missing.join('; ')}`);
  if (!plan.layers.some((l) => l.kind !== 'audio')) throw new Error('Nothing to render: timeline has no video/image clips. Use timeline.assemble after generating takes.');
  const aspect = args.aspect || p.target.aspect;
  const reframe = aspect !== p.target.aspect;
  const { width, height } = canvasSize({ ...p.target, aspect });
  const fps = p.target.fps || 30;
  const total = Math.max(0.5, plan.durationSec);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = `${aspect.replace(':', 'x')}${args.variant ? `_${args.variant.replace(/[^a-z0-9]+/gi, '-')}` : ''}`;
  const outAbs = args.output
    ? fromWorkspaceRel(workspacePath, args.output)
    : path.join(projectDir(workspacePath, p.id), 'exports', `${p.id}_${tag}_${stamp}.mp4`);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const voTrack = p.tracks.find((t) => t.kind === 'audio' && t.label === VO_TRACK_LABEL);
  const voClips = voTrack ? p.clips.filter((c) => c.trackId === voTrack.id) : [];
  // Voiceover mode: clips only carry ambience, so sit it under the narrator.
  // Native mode: the clip audio IS the dialogue and plays at full level.
  const clipAudioGain = voClips.length && p.audioMode !== 'native' ? 0.22 : 1;
  // Music ducks under whoever is talking: VO clips, or spoken caption spans in native mode.
  const speechSpans: Array<[number, number]> = voClips.length
    ? voClips.map((c) => [(c.startMs - 250) / 1000, (c.startMs + c.outMs - c.inMs + 250) / 1000])
    : (p.audioMode === 'native' ? (p.captions?.cues || []).map((c) => [(c.startMs - 250) / 1000, (c.endMs + 250) / 1000] as [number, number]) : []);

  const inputs: string[] = ['-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${total.toFixed(3)}`];
  const filters: string[] = [];
  const audioLabels: string[] = [];
  let base = '[0:v]';
  let n = 1;
  const visual = plan.layers.filter((l) => l.kind !== 'audio').sort((a, b) => a.trackIndex - b.trackIndex || a.startSec - b.startSec);
  const audioOk = new Map<string, boolean>();
  for (const l of plan.layers) {
    if (l.kind !== 'image' && !audioOk.has(l.abs)) audioOk.set(l.abs, await hasAudioStream(l.abs));
  }
  visual.forEach((l, i) => {
    if (l.kenBurns) inputs.push('-i', l.abs);
    else if (l.kind === 'image') inputs.push('-loop', '1', '-t', l.durSec.toFixed(3), '-i', l.abs);
    else inputs.push('-ss', l.inSec.toFixed(3), '-t', l.durSec.toFixed(3), '-i', l.abs);
    const idx = n++;
    const tail = `fps=${fps},format=yuva420p,setpts=PTS-STARTPTS+${l.startSec.toFixed(3)}/TB[v${i}]`;
    if (l.kenBurns) {
      // Ken Burns: one still -> N frames of a slow centered push-in (1.0 -> 1.12).
      const frames = Math.max(2, Math.round(l.durSec * fps));
      const W2 = width * 2; const H2 = height * 2;
      filters.push(`[${idx}:v]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},trim=duration=${l.durSec.toFixed(3)},${tail}`);
    } else if (reframe && !l.overlay) {
      // Reframe: sharp fit-inside over a blurred cover copy (no hard crop of the subject).
      filters.push(`[${idx}:v]split=2[fg${i}][bs${i}]`);
      filters.push(`[bs${i}]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:2[bg${i}]`);
      filters.push(`[fg${i}]scale=${width}:${height}:force_original_aspect_ratio=decrease[fs${i}]`);
      filters.push(`[bg${i}][fs${i}]overlay=x=(W-w)/2:y=(H-h)/2,${tail}`);
    } else {
      const fit = l.overlay
        ? `scale=${width}:${height}:force_original_aspect_ratio=decrease`
        : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
      filters.push(`[${idx}:v]${fit},${tail}`);
    }
    const out = `[b${i}]`;
    filters.push(`${base}[v${i}]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='between(t,${l.startSec.toFixed(3)},${(l.startSec + l.durSec).toFixed(3)})'${out}`);
    base = out;
    if (l.kind === 'video' && args.includeClipAudio !== false && l.volume > 0 && audioOk.get(l.abs)) {
      audioLabels.push(`__v:${idx}:${l.startSec}:${l.volume * clipAudioGain}`);
    }
  });
  for (const l of plan.layers.filter((x) => x.kind === 'audio')) {
    inputs.push('-ss', l.inSec.toFixed(3), '-t', l.durSec.toFixed(3), '-i', l.abs);
    const idx = n++;
    if (l.volume > 0 && audioOk.get(l.abs)) audioLabels.push(`__a:${idx}:${l.startSec}:${l.volume}`);
  }
  const mixed: string[] = [];
  audioLabels.forEach((spec, i) => {
    const [, idx, start, vol] = spec.split(':');
    const ms = Math.round(Number(start) * 1000);
    filters.push(`[${idx}:a]aresample=48000,volume=${Number(vol).toFixed(3)},adelay=${ms}|${ms}[a${i}]`);
    mixed.push(`[a${i}]`);
  });

  // Music bed: looped to length, ducked under every voiceover line.
  let musicOn = false;
  if (args.music !== false && p.music?.path) {
    let musicAbs = '';
    try { musicAbs = fromWorkspaceRel(workspacePath, p.music.path); } catch { /* ignore */ }
    if (musicAbs && fs.existsSync(musicAbs)) {
      inputs.push('-stream_loop', '-1', '-t', total.toFixed(3), '-i', musicAbs);
      const idx = n++;
      const duck = p.music.duck && speechSpans.length
        ? `,volume='if(${speechSpans.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+')},0.3,1)':eval=frame`
        : '';
      filters.push(`[${idx}:a]aresample=48000,volume=${p.music.volume.toFixed(3)}${duck},afade=t=out:st=${Math.max(0, total - 1).toFixed(2)}:d=1[am]`);
      mixed.push('[am]');
      musicOn = true;
    }
  }

  // Brand watermark (logo, top-right).
  let wmOn = false;
  if (args.watermark !== false && p.brand?.watermark && p.brand.logo) {
    let logoAbs = '';
    try { logoAbs = fromWorkspaceRel(workspacePath, p.brand.logo); } catch { /* ignore */ }
    if (logoAbs && fs.existsSync(logoAbs)) {
      inputs.push('-loop', '1', '-t', total.toFixed(3), '-i', logoAbs);
      const idx = n++;
      const m = Math.round(Math.min(width, height) * 0.04);
      filters.push(`[${idx}:v]scale=${Math.round(width * 0.2)}:-1,format=rgba,colorchannelmixer=aa=0.85[wm]`);
      filters.push(`${base}[wm]overlay=x=W-w-${m}:y=${m}:shortest=0[bwm]`);
      base = '[bwm]';
      wmOn = true;
    }
  }

  // Burned-in captions (libass).
  let cwd: string | undefined;
  const cueCount = args.captions !== false && p.captions?.enabled ? p.captions.cues.length : 0;
  if (cueCount) {
    const assName = `captions_${stamp}.ass`;
    cwd = path.dirname(outAbs);
    fs.writeFileSync(path.join(cwd, assName), buildAss(p.captions!.cues, p.captions!.style, width, height), 'utf-8');
    const fontsdir = process.platform === 'win32' ? `:fontsdir=${(process.env.WINDIR || 'C:/Windows').replace(/\\/g, '/').replace(':', '\\\\:')}/Fonts` : '';
    filters.push(`${base}subtitles=${assName}${fontsdir}[bcap]`);
    base = '[bcap]';
  }
  filters.push(`${base}format=yuv420p[vout]`);

  const f = [...filters];
  const a = [...inputs, '-filter_complex', '', '-map', '[vout]'];
  if (mixed.length) {
    // amix divides by input count; scale back up (the bundled ffmpeg predates amix normalize=0).
    const mix = mixed.length === 1
      ? `${mixed[0]}anull`
      : `${mixed.join('')}amix=inputs=${mixed.length}:duration=longest:dropout_transition=0,volume=${mixed.length}`;
    // No apad: the bundled ffmpeg (4.1) never ends an infinite apad stream behind
    // amix, so multi-clip exports hung until the timeout. A short audio track is
    // fine in MP4; -t below still caps the output length.
    f.push(`${mix},atrim=0:${total.toFixed(3)}[aout]`);
    a.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  }
  a[a.indexOf('-filter_complex') + 1] = f.join(';');
  const res = await ffmpeg(['-y', '-hide_banner', ...a, '-t', total.toFixed(3), '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outAbs], Math.max(120_000, Math.round(total * 30_000)), cwd);
  if (cwd) { try { for (const f of fs.readdirSync(cwd)) if (f === `captions_${stamp}.ass`) fs.unlinkSync(path.join(cwd, f)); } catch { /* ignore */ } }
  if (res.code !== 0) throw new Error(`Export failed: ${res.stderr.slice(-900)}`);
  const rel = toWorkspaceRel(workspacePath, outAbs);
  await mutateProject(workspacePath, projectId, 'export', (proj) => {
    proj.exports = [...(proj.exports || []), { path: rel, createdAt: Date.now(), durationSec: +total.toFixed(2), aspect, variant: args.variant }].slice(-30);
  });
  return { path: rel, durationSec: +total.toFixed(2), width, height, layers: plan.layers.length, aspect, variant: args.variant, captions: cueCount, music: musicOn, watermark: wmOn };
}

/** Grab a still of the timeline at a given time (cheap preview for the agent/UI). */
export async function renderFrame(workspacePath: string, projectId: string, atSec: number): Promise<string> {
  const p = loadProject(workspacePath, projectId);
  const plan = buildRenderPlan(workspacePath, p);
  const hits = plan.layers.filter((l) => l.kind !== 'audio' && atSec >= l.startSec && atSec < l.startSec + l.durSec)
    .sort((a, b) => a.trackIndex - b.trackIndex);
  const top = hits.filter((h) => !h.overlay).pop() || hits[hits.length - 1];
  if (!top) throw new Error(`Nothing on the timeline at ${atSec}s.`);
  const out = path.join(projectDir(workspacePath, p.id), 'previews', `frame_${Math.round(atSec * 1000)}.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const seek = top.kind === 'image' ? 0 : top.inSec + (atSec - top.startSec);
  const { code, stderr } = await ffmpeg(['-y', '-ss', seek.toFixed(3), '-i', top.abs, '-frames:v', '1', '-q:v', '3', out], 60_000);
  if (code !== 0) throw new Error(`Frame grab failed: ${stderr.slice(-300)}`);
  return toWorkspaceRel(workspacePath, out);
}
