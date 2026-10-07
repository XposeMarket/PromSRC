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

export const TREND_DEFAULT_MODEL = 'fal/kling-v3-pro-motion-control';

export interface TrendPart { startSec: number; endSec: number; look?: string; startImage?: string }

async function detectCuts(abs: string, threshold = 0.08, minGapSec = 1.5): Promise<number[]> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', abs, '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'], 120_000).catch(() => ({ code: 1, stderr: '' }));
  const cuts: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const t = Number(m[1]);
    if (t > minGapSec && (!cuts.length || t - cuts[cuts.length - 1] >= minGapSec)) cuts.push(+t.toFixed(2));
  }
  return cuts;
}

function abs(ws: string, ref: string): string { return path.isAbsolute(ref) ? ref : fromWorkspaceRel(ws, ref); }

export async function trendTransfer(ws: string, projectId: string, args: {
  sourcePath: string; characterId: string; cuts?: number[]; maxParts?: number; looks?: string[];
  startImages?: string[]; prompt?: string; modelId?: string; approved?: boolean; shotIds?: string[];
}): Promise<GenerateResult & { shotIds: string[]; parts: Array<TrendPart & { shotId: string; segment: string; frame: string }>; modelId: string }> {
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
  const total = (await mediaDurationSec(srcAbs)) || 5;
  let cuts = (args.cuts?.length ? args.cuts : await detectCuts(srcAbs)).filter((c) => c > 0.5 && c < total - 0.5).sort((a, b) => a - b);
  const maxParts = Math.max(1, Math.min(6, Number(args.maxParts) || 3));
  if (cuts.length > maxParts - 1) cuts = cuts.slice(0, maxParts - 1);
  const bounds = [0, ...cuts, total];
  const dir = path.join(mediaDir(ws, projectId), 'trend', newId('tr'));
  fs.mkdirSync(dir, { recursive: true });
  const img = getModel(p.defaults.imageModel?.startsWith('openai/') ? p.defaults.imageModel : 'openai/gpt-image');

  const parts: Array<TrendPart & { shotId: string; segment: string; frame: string }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const startSec = +bounds[i].toFixed(2); const endSec = +bounds[i + 1].toFixed(2);
    const segAbs = path.join(dir, `part${i + 1}.mp4`); const firstAbs = path.join(dir, `part${i + 1}_first.jpg`);
    await runFfmpeg(['-y', '-loglevel', 'error', '-ss', String(startSec), '-i', srcAbs, '-t', String(+(endSec - startSec).toFixed(2)), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', segAbs], 180_000);
    await runFfmpeg(['-y', '-loglevel', 'error', '-ss', String(startSec + 0.05), '-i', srcAbs, '-frames:v', '1', firstAbs], 60_000);
    if (!fs.existsSync(segAbs)) throw new Error(`ffmpeg could not cut part ${i + 1}.`);
    let frame = args.startImages?.[i];
    const look = args.looks?.[i];
    if (!frame) {
      if (!img) throw new Error('No OpenAI image model in the catalog for matched start frames.');
      const r: any = await generateImage({
        prompt: `Replace the person in the second reference image with the exact person from the first reference image (identical face, hair, glasses, body proportions and age${character.notes ? `; ${character.notes}` : ''}). Keep the second image's exact framing, camera angle, room, lighting and pose.${look ? ` Outfit: ${look}.` : ''} Photorealistic phone photo, natural skin texture.`,
        reference_images: [abs(ws, face), firstAbs], aspect_ratio: p.target.aspect === '16:9' ? 'landscape' : 'portrait',
        size: p.target.aspect === '16:9' ? '1536x1024' : '1024x1536', provider: 'openai_codex', model: img.endpoint, output_dir: dir,
      } as any);
      const out = r?.images?.[0]?.path || r?.image?.path;
      if (!r?.success || !out) throw new Error(`Start frame ${i + 1} failed: ${r?.error || 'no image'}`);
      frame = out;
    }
    parts.push({ startSec, endSec, look, startImage: frame, shotId: '', segment: toWorkspaceRel(ws, segAbs), frame: toWorkspaceRel(ws, abs(ws, frame!)) });
  }

  const before = new Set(p.shots.map((s) => s.id));
  await applyOps(ws, projectId, parts.map((pt, i) => ({
    op: 'shot.add', title: `Trend part ${i + 1}${pt.look ? `: ${pt.look.slice(0, 40)}` : ''}`, prompt: args.prompt || `${character.name} performs the reference motion naturally.`,
    sourceVideo: pt.segment, startImage: pt.frame, modelId, durationSec: Math.max(1, Math.round(pt.endSec - pt.startSec)),
    characterIds: [character.id], anchorMode: 'start', notes: `trend ${path.basename(dir)} ${pt.startSec}-${pt.endSec}s of ${args.sourcePath}`,
  })) as any, 'agent');
  const added = loadProject(ws, projectId).shots.filter((s) => !before.has(s.id));
  added.forEach((s, i) => { parts[i].shotId = s.id; });
  const shotIds = added.map((s) => s.id);
  const r = await generateShots(ws, projectId, { shotIds, approved: args.approved === true });
  return { ...r, shotIds, parts, modelId };
}

/** Join the trend parts' selected takes in order over the source clip's original audio. */
export async function trendAssemble(ws: string, projectId: string, args: { shotIds: string[]; audioPath?: string; audioStartSec?: number; phoneLook?: boolean }): Promise<{ path: string; durationSec: number; phoneLook?: string }> {
  const p = loadProject(ws, projectId);
  const takes = args.shotIds.map((id) => {
    const s = p.shots.find((x) => x.id === id); const t = s && selectedTake(s);
    if (!t || t.kind !== 'video') throw new Error(`${s?.title || id} has no video take yet.`);
    return abs(ws, t.path);
  });
  const outDir = path.join(path.dirname(mediaDir(ws, projectId)), 'exports'); fs.mkdirSync(outDir, { recursive: true });
  const outAbs = path.join(outDir, `${projectId}_trend_${Date.now()}.mp4`);
  const [w, h] = p.target.aspect === '16:9' ? [1280, 720] : [720, 1280];
  const a: string[] = ['-y', '-hide_banner'];
  for (const t of takes) a.push('-i', t);
  const audio = args.audioPath ? abs(ws, args.audioPath) : undefined;
  if (audio) a.push('-ss', String(args.audioStartSec || 0), '-i', audio);
  const f = takes.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,setsar=1[v${i}]`);
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
  const strength = args.strength && PHONE_LOOK_STRENGTHS[args.strength] ? args.strength : 'medium';
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
