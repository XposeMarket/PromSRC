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
import { cancel, downloadOutput, missingRequiredFields, poll, submit, type ShotInput } from './providers.js';
import {
  fromWorkspaceRel, loadProject, mediaDir, mutateProject, newId, projectDir, selectedTake,
  timelineDurationMs, toWorkspaceRel, type Job, type Shot, type Take, type VideoProject,
} from './project.js';

// ── ffmpeg helpers ──────────────────────────────────────────────────────

function ffmpeg(args: string[], timeoutMs = 15 * 60_000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveRuntimeBinary('ffmpeg', { allowPathFallback: true }), args, { windowsHide: true });
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

function composePrompt(p: VideoProject, shot: Shot): string {
  const parts = [shot.prompt.trim()];
  if (shot.camera) parts.push(`Camera: ${shot.camera}.`);
  for (const cid of shot.characterIds) {
    const c = p.characters.find((x) => x.id === cid);
    if (c?.notes) parts.push(`${c.name}: ${c.notes}.`);
  }
  const style = shot.styleId ? p.styles.find((s) => s.id === shot.styleId) : undefined;
  if (style?.promptSuffix) parts.push(style.promptSuffix);
  return parts.filter(Boolean).join(' ');
}

async function resolveShotInput(workspacePath: string, p: VideoProject, shot: Shot, model: MediaModelManifest): Promise<ShotInput> {
  const refs: string[] = [];
  for (const cid of shot.characterIds) {
    const c = p.characters.find((x) => x.id === cid);
    if (c) refs.push(...c.anchors, ...c.refs);
  }
  const style = shot.styleId ? p.styles.find((s) => s.id === shot.styleId) : undefined;
  if (style) refs.push(...style.refs);

  let startImage = shot.startImage;
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
  return {
    prompt: composePrompt(p, shot),
    startImage: abs(startImage),
    endImage: abs(shot.endImage),
    referenceImages: model.map.referenceImages && !startImage ? Array.from(new Set(refs)).slice(0, 5).map((r) => abs(r)!) : undefined,
    durationSec: shot.durationSec,
    aspectRatio: p.target.aspect,
    resolution: p.target.resolution,
    extra: shot.params,
  };
}

// ── estimate ────────────────────────────────────────────────────────────

export interface ShotEstimate { shotId: string; title: string; modelId: string; count: number; usd: number; problems: string[] }

export async function estimate(workspacePath: string, projectId: string, args: { shotIds?: string[]; count?: number; modelId?: string }): Promise<{ total: number; shots: ShotEstimate[]; budget: VideoProject['budget'] }> {
  const p = loadProject(workspacePath, projectId);
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
      const missing = missingRequiredFields(model, input);
      if (missing.length) problems.push(`${model.id} needs ${missing.join(', ')} (add a character anchor, startImage, or chainFromPrevious)`);
    } catch (e: any) { problems.push(String(e?.message || e)); }
    if (!model.pricing?.perSecondUsd && !model.pricing?.perImageUsd && !model.pricing?.perRequestUsd) problems.push('model has no pricing; cost is unknown');
    shots.push({ shotId: id, title: shot.title, modelId: model.id, count, usd: estimateCostUsd(model, { durationSec: shot.durationSec, count }), problems });
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

async function finishJob(workspacePath: string, projectId: string, job: Job, model: MediaModelManifest, outputs: Array<{ url?: string; localPath?: string; mimeType?: string }>) {
  const dir = mediaDir(workspacePath, projectId);
  const saved: Array<{ rel: string; durationSec?: number }> = [];
  for (let i = 0; i < outputs.length; i++) {
    const base = `${'shotId' in job.target ? job.target.shotId : 'characterId' in job.target ? job.target.characterId : 'asset'}_${job.id}_${i}`;
    const abs = await downloadOutput(outputs[i], dir, base, model.kind);
    saved.push({ rel: toWorkspaceRel(workspacePath, abs), durationSec: model.kind === 'video' ? await mediaDurationSec(abs) : undefined });
  }
  const perOutputUsd = saved.length ? job.estimateUsd / saved.length : 0;
  await patchJob(workspacePath, projectId, job.id, { state: 'done' }, (p, j) => {
    p.budget.spentUsd = Math.round((p.budget.spentUsd + j.estimateUsd) * 1000) / 1000;
    const prompt = String(j.input.prompt || '');
    if ('shotId' in j.target) {
      const shot = p.shots.find((s) => s.id === (j.target as any).shotId);
      if (!shot) return;
      for (const s of saved) {
        const take: Take = {
          id: newId('take'), jobId: j.id, modelId: model.id, kind: model.kind, path: s.rel, prompt,
          costUsd: perOutputUsd, createdAt: Date.now(), durationSec: s.durationSec,
        };
        shot.takes.push(take);
        j.takeIds.push(take.id);
        if (!shot.selectedTakeId) shot.selectedTakeId = take.id;
      }
      shot.status = 'ready';
    } else if ('characterId' in j.target) {
      // Anchors land as candidates; the user approves one (chat card / Studio)
      // with character.approveAnchor before it drives identity.
      const c = p.characters.find((x) => x.id === (j.target as any).characterId);
      if (c) c.candidates = [...(c.candidates || []), ...saved.map((s) => s.rel)].slice(-12);
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

async function runJob(workspacePath: string, projectId: string, jobId: string, resume = false): Promise<void> {
  const key = `${projectId}:${jobId}`;
  if (running.has(key)) return;
  running.add(key);
  try {
    let p = loadProject(workspacePath, projectId);
    let job = p.jobs.find((j) => j.id === jobId);
    if (!job || job.state === 'done' || job.state === 'failed' || job.state === 'canceled') return;
    const model = getModel(job.modelId);
    if (!model) { await failJob(workspacePath, projectId, jobId, `Model ${job.modelId} is no longer in the catalog.`, 'invalid_model'); return; }

    if (!resume || !job.requestId) {
      await patchJob(workspacePath, projectId, jobId, { state: 'running' });
      const input = job.input as unknown as ShotInput;
      const result = await submit(model, { ...input, count: job.count }, { outputDir: toWorkspaceRel(workspacePath, mediaDir(workspacePath, projectId)) });
      if (result.state === 'done') {
        await finishJob(workspacePath, projectId, { ...job, requestId: result.requestId }, model, result.outputs || []);
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
      await finishJob(workspacePath, projectId, job, model, state.outputs);
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
}): Promise<GenerateResult> {
  const est = await estimate(workspacePath, projectId, args);
  const blocking = est.shots.filter((s) => s.problems.some((x) => !x.startsWith('model has no pricing')));
  if (blocking.length) {
    throw new Error(`Cannot generate: ${blocking.map((s) => `${s.title}: ${s.problems.join('; ')}`).join(' | ')}`);
  }
  const p0 = loadProject(workspacePath, projectId);
  const cap = p0.budget.capUsd;
  if (cap != null && p0.budget.spentUsd + est.total > cap + 1e-9) {
    return { needsApproval: true, reason: `Budget cap $${cap.toFixed(2)} would be exceeded (spent $${p0.budget.spentUsd.toFixed(2)} + $${est.total.toFixed(2)}). Raise budget.capUsd via project.update first.`, estimate: est, jobs: [] };
  }
  if (!args.approved && est.total > p0.budget.autoApproveUsd + 1e-9) {
    return { needsApproval: true, reason: `Estimated $${est.total.toFixed(2)} is above the auto-approve limit ($${p0.budget.autoApproveUsd.toFixed(2)}). Confirm with the user, then call again with approved:true.`, estimate: est, jobs: [] };
  }

  const created: GenerateResult['jobs'] = [];
  const p = loadProject(workspacePath, projectId);
  const pending: Job[] = [];
  for (const s of est.shots) {
    const shot = p.shots.find((x) => x.id === s.shotId)!;
    const model = shotModel(p, shot, args.modelId);
    const input = await resolveShotInput(workspacePath, p, shot, model);
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
  const refs = [...(args.referenceImages || []), ...c.refs]
    .map((r) => (/^(https?:|data:)/i.test(r) ? r : fromWorkspaceRel(workspacePath, r)));
  const input: ShotInput = {
    prompt: [anchorPrompt, c.notes].filter(Boolean).join(' '),
    startImage: model.map.startImage ? refs[0] : undefined,
    referenceImages: model.map.referenceImages ? refs.slice(0, 5) : undefined,
    aspectRatio: p.target.aspect,
  };
  const missing = missingRequiredFields(model, input);
  if (missing.length) throw new Error(`${model.id} needs ${missing.join(', ')}.`);
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

interface RenderLayer { abs: string; startSec: number; inSec: number; durSec: number; kind: 'video' | 'image' | 'audio'; trackIndex: number; volume: number; overlay: boolean }

export function buildRenderPlan(workspacePath: string, p: VideoProject): { layers: RenderLayer[]; durationSec: number; missing: string[] } {
  const layers: RenderLayer[] = [];
  const missing: string[] = [];
  p.tracks.forEach((track, trackIndex) => {
    if (track.muted && track.kind === 'audio') return;
    for (const clip of p.clips.filter((c) => c.trackId === track.id)) {
      let rel: string | undefined;
      let kind: RenderLayer['kind'] = track.kind === 'audio' ? 'audio' : 'video';
      if ('shotId' in clip.source) {
        const shot = p.shots.find((s) => s.id === (clip.source as any).shotId);
        const take = shot && selectedTake(shot);
        if (!take) { missing.push(`${shot?.title || clip.source.shotId} has no take`); continue; }
        rel = take.path;
        if (take.kind === 'image') kind = 'image';
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
export async function renderProject(workspacePath: string, projectId: string, args: { output?: string; includeClipAudio?: boolean } = {}): Promise<{ path: string; durationSec: number; width: number; height: number; layers: number }> {
  const p = loadProject(workspacePath, projectId);
  const plan = buildRenderPlan(workspacePath, p);
  if (plan.missing.length) throw new Error(`Cannot render: ${plan.missing.join('; ')}`);
  if (!plan.layers.some((l) => l.kind !== 'audio')) throw new Error('Nothing to render: timeline has no video/image clips. Use timeline.assemble after generating takes.');
  const { width, height } = canvasSize(p.target);
  const fps = p.target.fps || 30;
  const total = Math.max(0.5, plan.durationSec);
  const outAbs = args.output
    ? fromWorkspaceRel(workspacePath, args.output)
    : path.join(projectDir(workspacePath, p.id), 'exports', `${p.id}_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

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
    if (l.kind === 'image') inputs.push('-loop', '1', '-t', l.durSec.toFixed(3), '-i', l.abs);
    else inputs.push('-ss', l.inSec.toFixed(3), '-t', l.durSec.toFixed(3), '-i', l.abs);
    const idx = n++;
    const fit = l.overlay
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    filters.push(`[${idx}:v]${fit},fps=${fps},format=yuva420p,setpts=PTS-STARTPTS+${l.startSec.toFixed(3)}/TB[v${i}]`);
    const out = `[b${i}]`;
    filters.push(`${base}[v${i}]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='between(t,${l.startSec.toFixed(3)},${(l.startSec + l.durSec).toFixed(3)})'${out}`);
    base = out;
    if (l.kind === 'video' && args.includeClipAudio !== false && l.volume > 0 && audioOk.get(l.abs)) {
      audioLabels.push(`__v:${idx}:${l.startSec}:${l.volume}`);
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
  filters.push(`${base}format=yuv420p[vout]`);

  const f = [...filters];
  const a = [...inputs, '-filter_complex', '', '-map', '[vout]'];
  if (mixed.length) {
    // amix divides by input count; scale back up (the bundled ffmpeg predates amix normalize=0).
    const mix = mixed.length === 1
      ? `${mixed[0]}anull`
      : `${mixed.join('')}amix=inputs=${mixed.length}:duration=longest:dropout_transition=0,volume=${mixed.length}`;
    f.push(`${mix},apad,atrim=0:${total.toFixed(3)}[aout]`);
    a.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  }
  a[a.indexOf('-filter_complex') + 1] = f.join(';');
  const res = await ffmpeg(['-y', '-hide_banner', ...a, '-t', total.toFixed(3), '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outAbs]);
  if (res.code !== 0) throw new Error(`Export failed: ${res.stderr.slice(-900)}`);
  const rel = toWorkspaceRel(workspacePath, outAbs);
  await mutateProject(workspacePath, projectId, 'export', (proj) => {
    proj.exports = [...(proj.exports || []), { path: rel, createdAt: Date.now(), durationSec: +total.toFixed(2) }].slice(-20);
  });
  return { path: rel, durationSec: +total.toFixed(2), width, height, layers: plan.layers.length };
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
