/**
 * Trend transfer + phone-look finishing.
 *
 * trendTransfer: a trending clip + a character -> cut at outfit/scene changes,
 * one GPT-Image start frame per part matched to that part's first frame
 * (subscription, $0), Kling motion control per part (quoted, approval-gated).
 * trendAssemble: join the parts' selected takes over the ORIGINAL clip audio.
 * phoneFinish: ffmpeg pass that knocks the "AI sheen" off (grain, softer grade,
 * slight handheld drift, 30fps, metadata stripped). Local and free.
 */
import fs from 'fs';
import path from 'path';
import { getModel } from './catalog.js';
import { generateShots, mediaDurationSec, runFfmpeg, type GenerateResult } from './engine.js';
import { applyOps, fromWorkspaceRel, loadProject, mediaDir, mutateProject, newId, selectedTake, toWorkspaceRel } from './project.js';
import { generateImage } from '../image-generation/registry.js';
import { breakdownReel, trendWindow, type ReelBreakdown } from './inspect.js';

export const TREND_DEFAULT_MODEL = 'fal/kling-v3-pro-motion-control';

export interface TrendPart { startSec: number; endSec: number; look?: string; startImage?: string }
export type { ReelBreakdown };

function abs(ws: string, ref: string): string { return path.isAbsolute(ref) ? ref : fromWorkspaceRel(ws, ref); }

export async function trendTransfer(ws: string, projectId: string, args: {
  sourcePath: string; characterId: string; cuts?: number[]; maxParts?: number; looks?: string[];
  startImages?: string[]; prompt?: string; modelId?: string; approved?: boolean; shotIds?: string[];
}): Promise<GenerateResult & { shotIds: string[]; parts: Array<TrendPart & { shotId: string; segment: string; frame: string }>; modelId: string; breakdown?: ReelBreakdown }> {
  const modelId = args.modelId || TREND_DEFAULT_MODEL;
  if (!getModel(modelId)) throw new Error(`Unknown model "${modelId}".`);
  const p = loadProject(ws, projectId);
  const character = p.characters.find((c) => c.id === args.characterId);
  if (!character) throw new Error(`Character "${args.characterId}" not found.`);
  const face = character.anchors[0];
  if (!face) throw new Error(`${character.name} has no approved anchor (face) yet.`);

  // Re-call with shotIds from the quote: reuse the prepared parts, never duplicate.
  if (args.shotIds?.length) {
    const shots = args.shotIds.map((id) => p.shots.find((s) => s.id === id));
    if (shots.some((s) => !s)) throw new Error('Some trend shotIds no longer exist; call trend_transfer without shotIds.');
    const r = await generateShots(ws, projectId, { shotIds: args.shotIds, approved: args.approved === true });
    return { ...r, shotIds: args.shotIds, parts: shots.map((s) => ({ startSec: 0, endSec: s!.durationSec, shotId: s!.id, segment: s!.sourceVideo || '', frame: s!.startImage || '' })), modelId };
  }

  const srcAbs = abs(ws, args.sourcePath);
  if (!fs.existsSync(srcAbs)) throw new Error(`Clip not found: ${args.sourcePath}`);
  const model = getModel(modelId)!;
  const dir = path.join(mediaDir(ws, projectId), 'trend', newId('tr'));
  fs.mkdirSync(dir, { recursive: true });
  // Understand the reel first ($0): model-minimum-safe parts + what happens inside each part.
  const breakdown = await breakdownReel(srcAbs, { workDir: path.join(dir, 'bd'), cuts: args.cuts, maxParts: args.maxParts, minPartSec: model.limits?.minDurationSec ?? 0 });
  const img = getModel(p.defaults.imageModel?.startsWith('openai/') ? p.defaults.imageModel : 'openai/gpt-image');

  const parts: Array<TrendPart & { shotId: string; segment: string; frame: string; speed: number }> = [];
  for (const [i, bp] of breakdown.parts.entries()) {
    const { startSec, endSec, speed } = bp;
    const len = +(endSec - startSec).toFixed(2);
    const segAbs = path.join(dir, `part${i + 1}.mp4`); const firstAbs = path.join(dir, `part${i + 1}_first.jpg`);
    // Parts under the model minimum are uploaded slowed (speed < 1); trendAssemble speeds them back up.
    const slow = speed < 1 ? ['-vf', `setpts=PTS/${speed}`, '-an'] : ['-c:a', 'aac'];
    await runFfmpeg(['-y', '-loglevel', 'error', '-ss', String(startSec), '-i', srcAbs, '-t', String(len), ...slow, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', segAbs], 180_000);
    await runFfmpeg(['-y', '-loglevel', 'error', '-ss', String(startSec + 0.05), '-i', srcAbs, '-frames:v', '1', firstAbs], 60_000);
    if (!fs.existsSync(segAbs)) throw new Error(`ffmpeg could not cut part ${i + 1}.`);
    let frame = args.startImages?.[i];
    // A garment that changes mid-part must already exist in the start frame, or the model tears the outfit to fake it.
    const look = args.looks?.[i] || (bp.garmentChange ? bp.look : undefined);
    if (!frame) {
      if (!img) throw new Error('No OpenAI image model in the catalog for matched start frames.');
      const r: any = await generateImage({
        prompt: `Replace the person in the second reference image with the exact person from the first reference image (identical face, hair, glasses, body proportions and age${character.notes ? `; ${character.notes}` : ''}). Keep the second image's exact framing, camera angle, room, lighting and pose.${look ? ` Outfit: ${look}.` : ''} Photorealistic phone photo, natural skin texture.`,
        reference_images: [abs(ws, face), firstAbs], aspect_ratio: p.target.aspect === '16:9' ? 'landscape' : 'portrait',
        size: p.target.aspect === '16:9' ? '1536x1024' : '1024x1536', provider: 'openai_codex', model: img.endpoint, output_dir: dir,
      } as any);
      const out = r?.images?.[0]?.path || r?.image?.path;
      if (!r?.success || !out) throw new Error(`Start frame ${i + 1} failed: ${r?.error || 'no image'}`);
      // Generated names embed the prompt and blow past Windows MAX_PATH; keep a short stable name.
      const outAbs = abs(ws, out);
      const shortAbs = path.join(dir, `part${i + 1}_frame${path.extname(outAbs) || '.png'}`);
      try { fs.renameSync(outAbs, shortAbs); frame = shortAbs; } catch { frame = out; }
    }
    parts.push({ startSec, endSec, speed, look, startImage: frame, shotId: '', segment: toWorkspaceRel(ws, segAbs), frame: toWorkspaceRel(ws, abs(ws, frame!)) });
  }

  const before = new Set(p.shots.map((s) => s.id));
  await applyOps(ws, projectId, parts.map((pt, i) => ({
    op: 'shot.add', title: `Trend part ${i + 1}${pt.look ? `: ${pt.look.slice(0, 40)}` : ''}`, prompt: args.prompt || `${character.name} performs the reference motion naturally.`,
    sourceVideo: pt.segment, startImage: pt.frame, modelId, durationSec: Math.max(1, Math.ceil((pt.endSec - pt.startSec) / pt.speed)),
    characterIds: [character.id], anchorMode: 'start',
    notes: `trend ${path.basename(dir)} ${pt.startSec}-${pt.endSec}s speed=${pt.speed} of ${args.sourcePath}${breakdown.parts[i]?.action ? ` | ${breakdown.parts[i].action}` : ''}`,
  })) as any, 'agent');
  const added = loadProject(ws, projectId).shots.filter((s) => !before.has(s.id));
  added.forEach((s, i) => { parts[i].shotId = s.id; });
  const shotIds = added.map((s) => s.id);
  const r = await generateShots(ws, projectId, { shotIds, approved: args.approved === true });
  return { ...r, shotIds, parts, modelId, breakdown };
}

/** Playback factor a trend shot was generated at (notes "speed=0.49"); 1 when absent. */
export function trendSpeed(notes?: string): number {
  const v = Number((String(notes || '').match(/speed=([\d.]+)/) || [])[1]);
  return v > 0 && v <= 1 ? v : 1;
}

/** Join the trend parts' selected takes in order over the source clip's original audio. */
export async function trendAssemble(ws: string, projectId: string, args: { shotIds: string[]; audioPath?: string; audioStartSec?: number; phoneLook?: boolean }): Promise<{ path: string; durationSec: number; phoneLook?: string }> {
  const p = loadProject(ws, projectId);
  const items = args.shotIds.map((id) => {
    const s = p.shots.find((x) => x.id === id); const t = s && selectedTake(s);
    if (!t || t.kind !== 'video') throw new Error(`${s?.title || id} has no video take yet.`);
    const win = trendWindow(s!);
    return { path: abs(ws, t.path), speed: trendSpeed(s!.notes), len: win ? +(win.endSec - win.startSec).toFixed(3) : undefined };
  });
  const takes = items.map((x) => x.path);
  const outDir = path.join(path.dirname(mediaDir(ws, projectId)), 'exports'); fs.mkdirSync(outDir, { recursive: true });
  const outAbs = path.join(outDir, `${projectId}_trend_${Date.now()}.mp4`);
  // Full-res single encode: Kling delivers ~1080p, downscaling before grain/grade made exports look noisy.
  const [w, h] = p.target.aspect === '16:9' ? [1920, 1080] : [1080, 1920];
  const a: string[] = ['-y', '-hide_banner'];
  for (const t of takes) a.push('-i', t);
  const audio = args.audioPath ? abs(ws, args.audioPath) : undefined;
  if (audio) a.push('-ss', String(args.audioStartSec || 0), '-i', audio);
  // Slowed parts play back at the original beat, then trim to the source window length.
  const f = items.map((it, i) => `[${i}:v]${it.speed < 1 ? `setpts=PTS*${it.speed},` : ''}${it.len ? `trim=duration=${it.len},setpts=PTS-STARTPTS,` : ''}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,setsar=1[v${i}]`);
  f.push(`${takes.map((_, i) => `[v${i}]`).join('')}concat=n=${takes.length}:v=1:a=0[vout]`);
  a.push('-filter_complex', f.join(';'), '-map', '[vout]');
  if (audio) a.push('-map', `${takes.length}:a?`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outAbs);
  const res = await runFfmpeg(a, 600_000);
  if (res.code !== 0 || !fs.existsSync(outAbs)) throw new Error(`Trend assemble failed: ${res.stderr.slice(-600)}`);
  const dur = (await mediaDurationSec(outAbs)) || 0;
  const rel = toWorkspaceRel(ws, outAbs);
  await mutateProject(ws, projectId, 'export', (proj) => { proj.exports = [...(proj.exports || []), { path: rel, createdAt: Date.now(), durationSec: +dur.toFixed(2), aspect: p.target.aspect, variant: 'trend' }].slice(-30); });
  if (args.phoneLook === false) return { path: rel, durationSec: +dur.toFixed(2) };
  const finished = await phoneFinish(ws, { path: rel, projectId });
  return { path: rel, durationSec: +dur.toFixed(2), phoneLook: finished.path };
}

export const PHONE_LOOK_STRENGTHS = { light: { grain: 4, sat: 0.94, drift: 0.003 }, medium: { grain: 7, sat: 0.9, drift: 0.005 }, strong: { grain: 11, sat: 0.86, drift: 0.008 } } as const;

/** Free local pass: phone-camera grade, grain, slight handheld drift, 30fps, metadata stripped. */
export async function phoneFinish(ws: string, args: { path: string; projectId?: string; strength?: keyof typeof PHONE_LOOK_STRENGTHS }): Promise<{ path: string; strength: string }> {
  const inAbs = abs(ws, args.path);
  if (!fs.existsSync(inAbs)) throw new Error(`Video not found: ${args.path}`);
  const strength = args.strength && PHONE_LOOK_STRENGTHS[args.strength] ? args.strength : 'light';
  const s = PHONE_LOOK_STRENGTHS[strength];
  const z = 0.97; const d = s.drift;
  const vf = [
    `crop=iw*${z}:ih*${z}:(iw-iw*${z})/2+sin(t*1.3)*iw*${d}:(ih-ih*${z})/2+cos(t*1.7)*ih*${d}`,
    `scale=trunc(iw/${z}/2)*2:trunc(ih/${z}/2)*2`,
    `eq=contrast=0.96:saturation=${s.sat}:gamma=1.02`,
    'unsharp=5:5:0.35:5:5:0',
    `noise=alls=${s.grain}:allf=t`,
    'vignette=PI/7',
    'fps=30', 'format=yuv420p',
  ].join(',');
  const outAbs = inAbs.replace(/\.mp4$/i, '') + `_phone.mp4`;
  const res = await runFfmpeg(['-y', '-hide_banner', '-i', inAbs, '-vf', vf, '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outAbs], 600_000);
  if (res.code !== 0 || !fs.existsSync(outAbs)) throw new Error(`phone finish failed: ${res.stderr.slice(-600)}`);
  const rel = toWorkspaceRel(ws, outAbs);
  if (args.projectId) {
    const dur = (await mediaDurationSec(outAbs)) || 0;
    const p = loadProject(ws, args.projectId);
    await mutateProject(ws, args.projectId, 'export', (proj) => { proj.exports = [...(proj.exports || []), { path: rel, createdAt: Date.now(), durationSec: +dur.toFixed(2), aspect: p.target.aspect, variant: `phone-${strength}` }].slice(-30); });
  }
  return { path: rel, strength };
}
