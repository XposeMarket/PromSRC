/**
 * Game asset pipeline: per-genre asset plans, cost-gated image generation
 * (same semantics as video projects: > autoApproveUsd needs approved:true,
 * capUsd is a hard stop), magenta chroma-key for transparent sprites, and
 * free procedural SFX / music beds via the bundled ffmpeg.
 */
import fs from 'fs';
import path from 'path';
import { estimateCostUsd, getModel, type MediaModelManifest } from '../media-engine/catalog.js';
import { downloadOutput, submit, type MediaOutput } from '../media-engine/providers.js';
import { mediaDurationSec, runFfmpeg, withRateLimitRetry } from '../media-engine/engine.js';
import {
  advanceStage, fromRel, gameDir, loadGame, mutateGame, newId, toRel,
  type AssetKind, type GameAsset, type GameDesign, type GameProject, type GameQuestion,
} from './project.js';

// ── style + plans ───────────────────────────────────────────────────────

export const STYLE_WORDS: Record<string, string> = {
  pixel: '16-bit pixel art, crisp pixels, limited palette, retro SNES look',
  minimal: 'clean minimal flat vector art, simple geometric shapes, flat colors',
  ascii: 'monochrome terminal ASCII-inspired look, green phosphor on black, blocky glyph shapes',
  voxel: 'voxel art, chunky cubes, isometric, soft ambient occlusion',
  anime: 'anime cel-shaded illustration, bold lineart, vibrant colors',
  '3d': 'stylized 3D render, soft lighting, game-ready look',
  cartoon: 'bright cartoon style, thick outlines, playful proportions',
};

type PlanItem = { kind: AssetKind; name: string; subject: string; transparent?: boolean; size: { w: number; h: number } };
const S = (name: string, subject: string, w = 128, h = 128): PlanItem => ({ kind: 'sprite', name, subject, transparent: true, size: { w, h } });
const BG = (name: string, subject: string): PlanItem => ({ kind: 'background', name, subject, size: { w: 1280, h: 720 } });
const TX = (name: string, subject: string): PlanItem => ({ kind: 'texture', name, subject, size: { w: 512, h: 512 } });
const UI = (name: string, subject: string): PlanItem => ({ kind: 'ui', name, subject, transparent: true, size: { w: 64, h: 64 } });
const PT = (name: string, subject: string): PlanItem => ({ kind: 'portrait', name, subject, transparent: true, size: { w: 512, h: 768 } });

const GENRE_PLANS: Record<string, PlanItem[]> = {
  platformer: [S('player', 'the hero character, side view, idle pose'), S('enemy', 'a small enemy creature, side view'), TX('tileset', 'seamless ground/platform tile texture'), BG('background', 'parallax level background scenery'), S('coin', 'a collectible coin pickup', 64, 64), UI('heart', 'a heart life icon')],
  shooter: [S('player', 'the player spaceship, top-down view, facing up'), S('enemy1', 'an enemy fighter ship, top-down view, facing down'), S('enemy2', 'a large enemy gunship, top-down view, facing down', 160, 160), S('bullet', 'a glowing energy bullet', 32, 32), S('explosion', 'a single explosion burst'), BG('background', 'scrolling space backdrop, top-down')],
  racing: [S('car', 'the player race car, top-down view, facing up', 96, 160), TX('track', 'seamless asphalt race track texture with lane markings'), BG('background', 'racing environment horizon scenery')],
  novella: [PT('portrait_hero', 'the protagonist, waist-up portrait, neutral expression'), PT('portrait_ally', 'a friendly companion character, waist-up portrait'), PT('portrait_rival', 'a rival/antagonist character, waist-up portrait'), BG('bg_home', 'an interior location scene'), BG('bg_street', 'an outdoor street location scene'), BG('bg_climax', 'a dramatic climax location scene')],
  horror: [S('player', 'the survivor character, top-down view'), S('monster', 'a terrifying monster, top-down view', 160, 160), TX('tileset', 'dark seamless floor tile texture, grime and blood stains'), BG('background', 'dark eerie environment, fog, low light')],
  hypercasual: [S('player', 'the main character or object the player controls'), S('obstacle', 'an obstacle to avoid'), BG('background', 'simple colorful background')],
  puzzle: [S('piece_a', 'a puzzle piece/tile type A', 96, 96), S('piece_b', 'a puzzle piece/tile type B', 96, 96), S('piece_c', 'a puzzle piece/tile type C', 96, 96), BG('background', 'calm puzzle board background'), UI('star', 'a star rating icon')],
  other: [S('player', 'the player character'), S('enemy', 'an opponent or hazard'), BG('background', 'game background scenery'), UI('icon', 'a collectible icon')],
};

export function buildPrompt(design: GameDesign, item: { subject: string; kind: AssetKind; transparent?: boolean }): string {
  const style = STYLE_WORDS[design.style] || design.style;
  const parts = [
    `${item.subject} for a ${design.genre} video game`,
    design.setting ? `setting: ${design.setting}` : '',
    `art style: ${style}`,
    item.transparent
      ? 'single isolated game asset, centered, full subject visible, on a perfectly flat solid pure magenta #FF00FF background, no shadow on the background, no magenta on the subject, no text'
      : item.kind === 'texture' ? 'seamless tileable texture, fills the whole frame, no text, no border' : 'full-bleed game background, no characters, no text, no UI',
  ];
  return parts.filter(Boolean).join('. ');
}

export function planAssets(design: GameDesign): GameAsset[] {
  const plan = GENRE_PLANS[design.genre] || GENRE_PLANS.other;
  return plan.map((it) => ({
    id: newId('ga'), kind: it.kind, name: it.name, prompt: buildPrompt(design, it),
    status: 'planned', ...(it.transparent ? { transparent: true } : {}), size: it.size,
  }));
}

// ── design questions ────────────────────────────────────────────────────

const COMMON_Q: GameQuestion[] = [
  { id: 'session', q: 'How long should one play session be?', options: ['Under 1 minute', '2-5 minutes', '10+ minutes', 'Endless / high score'] },
  { id: 'platform', q: 'Main device?', options: ['Phone (portrait, touch)', 'Desktop (keyboard)', 'Both'] },
  { id: 'difficulty', q: 'Difficulty curve?', options: ['Chill', 'Gradually harder', 'Brutal from the start'] },
];
const GENRE_Q: Record<string, GameQuestion[]> = {
  platformer: [{ id: 'movement', q: 'Movement feel?', options: ['Floaty jumps', 'Tight precise jumps', 'Double jump + dash'] }, { id: 'goal', q: 'Level goal?', options: ['Reach the flag', 'Collect all coins', 'Beat the boss'] }],
  shooter: [{ id: 'view', q: 'Shooter view?', options: ['Vertical scroller', 'Horizontal scroller', 'Twin-stick arena'] }, { id: 'weapons', q: 'Weapons?', options: ['Single blaster', 'Power-up upgrades', 'Bombs + shields'] }],
  racing: [{ id: 'view', q: 'Camera?', options: ['Top-down', 'Behind the car (3D)', 'Side-scrolling'] }, { id: 'mode', q: 'Race mode?', options: ['Time trial', 'Vs AI racers', 'Endless dodge'] }],
  novella: [{ id: 'tone', q: 'Tone?', options: ['Romance', 'Mystery', 'Comedy', 'Drama'] }, { id: 'branches', q: 'Branching?', options: ['Linear', '2-3 endings', 'Many choices matter'] }],
  horror: [{ id: 'threat', q: 'Main threat?', options: ['One stalking monster', 'Hordes', 'Unseen presence'] }, { id: 'mechanic', q: 'Core mechanic?', options: ['Hide and sneak', 'Flashlight battery', 'Escape the maze'] }],
  hypercasual: [{ id: 'input', q: 'Input?', options: ['One tap', 'Swipe', 'Hold and release'] }, { id: 'loop', q: 'Core loop?', options: ['Dodge obstacles', 'Stack / time it', 'Merge things'] }],
  puzzle: [{ id: 'type', q: 'Puzzle type?', options: ['Match-3', 'Sliding tiles', 'Physics', 'Logic grid'] }, { id: 'pressure', q: 'Pressure?', options: ['Move limit', 'Timer', 'None'] }],
};

export function designQuestions(design: GameDesign): GameQuestion[] {
  const qs = [...(GENRE_Q[design.genre] || []), ...COMMON_Q];
  if (design.multiplayer) qs.push({ id: 'mp_mode', q: 'Multiplayer mode?', options: ['Co-op', 'Versus', 'Race / ghost players'] });
  return qs.map((q) => ({ ...q, options: [...q.options] }));
}

// ── image generation ────────────────────────────────────────────────────

export type GameImageGenerator = (args: { prompt: string; outDir: string; baseName: string; model: MediaModelManifest; size?: { w: number; h: number } }) => Promise<string>;
let imageGeneratorOverride: GameImageGenerator | null = null;
/** Test seam: replace the provider call (no money spent). Pass null to restore. */
export function setGameImageGenerator(fn: GameImageGenerator | null): void { imageGeneratorOverride = fn; }

const DEFAULT_IMAGE_MODELS = ['xai/grok-imagine-image-2.0', 'openai/gpt-image'];
export function gameImageModel(p: GameProject, override?: string): MediaModelManifest {
  const ids = [override, p.imageModel, ...DEFAULT_IMAGE_MODELS].filter(Boolean) as string[];
  for (const id of ids) {
    const m = getModel(id);
    if (m && m.kind === 'image') return m;
  }
  throw new Error('No image model available in the media catalog.');
}

async function providerGenerate(args: { prompt: string; outDir: string; baseName: string; model: MediaModelManifest; size?: { w: number; h: number } }): Promise<string> {
  if (imageGeneratorOverride) return imageGeneratorOverride(args);
  const aspect = args.size && args.size.w > args.size.h * 1.3 ? '16:9' : args.size && args.size.h > args.size.w * 1.3 ? '9:16' : '1:1';
  const r = await withRateLimitRetry(() => submit(args.model, { prompt: args.prompt, aspectRatio: aspect, count: 1 }, { outputDir: args.outDir }));
  let outputs: MediaOutput[] | undefined = r.outputs;
  if (r.state !== 'done' || !outputs?.length) {
    const { poll } = await import('../media-engine/providers.js');
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 2500));
      const st = await poll(args.model, { requestId: String(r.requestId || ''), statusUrl: r.statusUrl, responseUrl: r.responseUrl });
      if (st.state === 'done') { outputs = st.outputs; break; }
      if (st.state === 'failed') throw new Error(st.error);
    }
  }
  if (!outputs?.length) throw new Error('Provider returned no image.');
  return downloadOutput(outputs[0], args.outDir, args.baseName, 'image');
}

/** Chroma-key a flat #FF00FF background to alpha and fit into size (PNG rgba). */
export async function chromaKeyToPng(srcAbs: string, outAbs: string, size?: { w: number; h: number }): Promise<string> {
  const w = size?.w || 256;
  const h = size?.h || 256;
  const vf = `colorkey=0xFF00FF:0.3:0.1,format=rgba,scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=neighbor,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
  const { code, stderr } = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', srcAbs, '-vf', vf, '-frames:v', '1', '-pix_fmt', 'rgba', outAbs], 60_000);
  if (code !== 0) throw new Error(`chroma key failed: ${stderr.slice(-300)}`);
  return outAbs;
}

export async function fitImage(srcAbs: string, outAbs: string, size?: { w: number; h: number }): Promise<string> {
  const w = size?.w || 1280;
  const h = size?.h || 720;
  const { code, stderr } = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', srcAbs, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`, '-frames:v', '1', outAbs], 60_000);
  if (code !== 0) throw new Error(`image fit failed: ${stderr.slice(-300)}`);
  return outAbs;
}

/** pix_fmt of an image as reported by ffmpeg (e.g. "rgba"). */
export async function imagePixFmt(abs: string): Promise<string> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', abs], 30_000).catch(() => ({ code: 1, stderr: '' }));
  const m = stderr.match(/Video:\s*\w+[^,]*,\s*([a-z0-9]+)/i);
  return m ? m[1] : '';
}

export interface AssetEstimate { total: number; perImage: number; modelId: string; breakdown: Array<{ id: string; name: string; usd: number }>; budget: GameProject['budget'] }

function targetsFor(p: GameProject, ids?: string[]): GameAsset[] {
  const visual = p.assets.filter((a) => a.kind !== 'sfx' && a.kind !== 'music');
  if (ids?.length) {
    const found = visual.filter((a) => ids.includes(a.id) || ids.includes(a.name));
    if (!found.length) throw new Error(`No matching visual assets for ${ids.join(', ')}.`);
    return found;
  }
  return visual.filter((a) => a.status === 'planned' || a.status === 'rejected' || a.status === 'failed');
}

export function estimateAssets(ws: string, projectId: string, args: { ids?: string[]; modelId?: string } = {}): AssetEstimate {
  const p = loadGame(ws, projectId);
  const model = gameImageModel(p, args.modelId);
  const per = estimateCostUsd(model, { count: 1 });
  const list = targetsFor(p, args.ids);
  return {
    total: Math.round(per * list.length * 1000) / 1000,
    perImage: per,
    modelId: model.id,
    breakdown: list.map((a) => ({ id: a.id, name: a.name, usd: per })),
    budget: p.budget,
  };
}

export interface GenerateAssetsResult {
  needsApproval?: boolean;
  blocked?: boolean;
  reason?: string;
  usd: number;
  estimate: AssetEstimate;
  started: string[];
}

async function generateOne(ws: string, projectId: string, assetId: string, model: MediaModelManifest, usd: number): Promise<void> {
  const p = loadGame(ws, projectId);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a) return;
  const dir = path.join(gameDir(ws, projectId), 'assets');
  const rawDir = path.join(dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const n = (a.candidates?.length || 0) + 1;
  const base = `${a.name}_${n}`;
  try {
    const raw = await providerGenerate({ prompt: a.prompt, outDir: rawDir, baseName: `${base}_raw`, model, size: a.size });
    const out = path.join(dir, `${base}.png`);
    if (a.transparent) await chromaKeyToPng(raw, out, a.size);
    else await fitImage(raw, out, a.size);
    await mutateGame(ws, projectId, (proj) => {
      const x = proj.assets.find((y) => y.id === assetId);
      proj.budget.spentUsd = Math.round((proj.budget.spentUsd + usd) * 1000) / 1000;
      if (!x) return;
      x.candidates = [...(x.candidates || []), toRel(ws, out)];
      x.path = toRel(ws, out);
      x.status = 'candidate';
      x.modelId = model.id;
      delete x.error;
    });
  } catch (e: any) {
    await mutateGame(ws, projectId, (proj) => {
      const x = proj.assets.find((y) => y.id === assetId);
      if (x) { x.status = 'failed'; x.error = String(e?.message || e).slice(0, 300); }
    });
  }
}

/**
 * Cost-gated generation. Above autoApproveUsd without approved:true returns
 * needsApproval; exceeding capUsd is a hard stop. Runs in the background
 * unless wait:true.
 */
export async function generateAssets(ws: string, projectId: string, args: { ids?: string[]; approved?: boolean; modelId?: string; wait?: boolean; reroll?: boolean } = {}): Promise<GenerateAssetsResult> {
  const est = estimateAssets(ws, projectId, args);
  const p = loadGame(ws, projectId);
  if (!est.breakdown.length) return { usd: 0, estimate: est, started: [], reason: 'Nothing to generate (all visual assets already have candidates). Pass ids to reroll specific ones.' };
  if (p.budget.capUsd !== undefined && p.budget.spentUsd + est.total > p.budget.capUsd + 1e-9) {
    return { blocked: true, usd: est.total, estimate: est, started: [], reason: `Budget cap $${p.budget.capUsd.toFixed(2)} would be exceeded (spent $${p.budget.spentUsd.toFixed(2)} + $${est.total.toFixed(2)}). Raise capUsd first.` };
  }
  if (!args.approved && est.total > p.budget.autoApproveUsd + 1e-9) {
    return { needsApproval: true, usd: est.total, estimate: est, started: [], reason: `Generating ${est.breakdown.length} image(s) costs ~$${est.total.toFixed(2)}, above auto-approve $${p.budget.autoApproveUsd.toFixed(2)}. Confirm with the user, then call again with approved:true.` };
  }
  const model = getModel(est.modelId)!;
  const ids = est.breakdown.map((b) => b.id);
  await mutateGame(ws, projectId, (proj) => {
    for (const a of proj.assets) if (ids.includes(a.id)) { a.status = 'generating'; delete a.error; }
    advanceStage(proj, 'art');
  });
  const work = (async () => {
    // Small concurrency to stay under provider rate limits.
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) { const id = queue.shift()!; await generateOne(ws, projectId, id, model, est.perImage); }
    });
    await Promise.all(workers);
  })();
  if (args.wait) await work; else work.catch(() => undefined);
  return { usd: est.total, estimate: est, started: ids };
}

export async function setAssetStatus(ws: string, projectId: string, assetId: string, status: 'approved' | 'rejected', candidate?: string | number): Promise<GameAsset> {
  const { result } = await mutateGame(ws, projectId, (p) => {
    const a = p.assets.find((x) => x.id === assetId || x.name === assetId);
    if (!a) throw new Error(`Asset "${assetId}" not found.`);
    if (status === 'approved') {
      if (candidate !== undefined && a.candidates?.length) {
        const c = typeof candidate === 'number' || /^\d+$/.test(String(candidate)) ? a.candidates[Number(candidate)] : a.candidates.find((x) => x === candidate || x.endsWith(`/${candidate}`));
        if (!c) throw new Error(`Candidate "${candidate}" not found.`);
        a.path = c;
      }
      if (!a.path) throw new Error(`Asset "${a.name}" has no generated file yet.`);
    }
    a.status = status;
    return { ...a };
  });
  return result;
}

export function artApproved(p: GameProject): boolean {
  const visual = p.assets.filter((a) => a.kind !== 'sfx' && a.kind !== 'music');
  return visual.length > 0 && visual.every((a) => a.status === 'approved' || a.status === 'rejected') && visual.some((a) => a.status === 'approved');
}

// ── procedural audio (free) ─────────────────────────────────────────────

export const SFX_RECIPES: Record<string, { expr: string; dur: number } | { noise: true; dur: number; af: string }> = {
  jump: { expr: '0.6*sin(2*PI*(220+900*t)*t)*exp(-6*t)', dur: 0.3 },
  coin: { expr: '0.5*sin(2*PI*(988+gt(t,0.07)*330)*t)*exp(-9*t)', dur: 0.35 },
  shoot: { expr: '0.5*sin(2*PI*(1400-2600*t)*t)*exp(-14*t)', dur: 0.22 },
  hit: { expr: '0.7*sin(2*PI*(160-200*t)*t)*exp(-12*t)+0.2*(random(0)*2-1)*exp(-30*t)', dur: 0.25 },
  powerup: { expr: '0.45*sin(2*PI*(300+1200*t)*t*(1+0.1*sin(2*PI*30*t)))*min(1,4*t)*exp(-2*t)', dur: 0.7 },
  click: { expr: '0.6*sin(2*PI*1800*t)*exp(-80*t)', dur: 0.08 },
  explosion: { noise: true, dur: 0.9, af: 'lowpass=f=900,afade=t=out:st=0.05:d=0.85,volume=1.6' },
};

export async function makeSfx(ws: string, projectId: string, args: { names?: string[]; force?: boolean } = {}): Promise<Array<{ name: string; path: string; durationSec: number }>> {
  const p = loadGame(ws, projectId);
  if (!args.force && !artApproved(p) && p.assets.some((a) => a.kind !== 'sfx' && a.kind !== 'music')) {
    throw new Error('Audio stage requires the art stage approved first (approve or reject every visual asset). Pass force:true to override.');
  }
  const names = (args.names?.length ? args.names : Object.keys(SFX_RECIPES)).map((n) => String(n).toLowerCase());
  const bad = names.filter((n) => !SFX_RECIPES[n]);
  if (bad.length) throw new Error(`Unknown sfx: ${bad.join(', ')}. Available: ${Object.keys(SFX_RECIPES).join(', ')}.`);
  const dir = path.join(gameDir(ws, projectId), 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const out: Array<{ name: string; path: string; durationSec: number }> = [];
  for (const name of names) {
    const r = SFX_RECIPES[name];
    const abs = path.join(dir, `${name}.wav`);
    const src = 'noise' in r
      ? ['-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.9:d=${r.dur}:r=44100`, '-af', r.af]
      : ['-f', 'lavfi', '-i', `aevalsrc='${r.expr}':s=44100:d=${r.dur}`, '-af', `afade=t=out:st=${Math.max(0, r.dur - 0.05)}:d=0.05`];
    const { code, stderr } = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...src, '-ac', '1', '-c:a', 'pcm_s16le', abs], 60_000);
    if (code !== 0) throw new Error(`sfx ${name} failed: ${stderr.slice(-300)}`);
    out.push({ name, path: toRel(ws, abs), durationSec: (await mediaDurationSec(abs)) || r.dur });
  }
  await mutateGame(ws, projectId, (proj) => {
    for (const s of out) {
      const existing = proj.assets.find((a) => a.kind === 'sfx' && a.name === s.name);
      if (existing) Object.assign(existing, { path: s.path, status: 'approved', durationSec: s.durationSec });
      else proj.assets.push({ id: newId('ga'), kind: 'sfx', name: s.name, prompt: `procedural ${s.name}`, path: s.path, status: 'approved', durationSec: s.durationSec });
    }
    advanceStage(proj, 'audio');
  });
  return out;
}

export async function makeMusic(ws: string, projectId: string, args: { bed?: string; seconds?: number; force?: boolean } = {}): Promise<{ name: string; path: string; label: string; durationSec: number }> {
  const p = loadGame(ws, projectId);
  if (!args.force && !artApproved(p) && p.assets.some((a) => a.kind !== 'sfx' && a.kind !== 'music')) {
    throw new Error('Audio stage requires the art stage approved first. Pass force:true to override.');
  }
  const { synthMusicBed } = await import('../media-engine/studio.js');
  const bed = String(args.bed || (p.design.genre === 'horror' ? 'ambient' : 'pulse')).toLowerCase();
  const seconds = Math.max(8, Math.min(180, Number(args.seconds) || 48));
  const abs = path.join(gameDir(ws, projectId), 'audio', `music_${bed}.mp3`);
  let label: string;
  try { label = (await synthMusicBed(bed, seconds, abs)).label; }
  catch (e: any) {
    if (!/unknown bed/i.test(String(e?.message))) throw e;
    label = (await synthMusicBed('pulse', seconds, abs)).label;
  }
  const durationSec = (await mediaDurationSec(abs)) || seconds;
  const rel = toRel(ws, abs);
  await mutateGame(ws, projectId, (proj) => {
    const existing = proj.assets.find((a) => a.kind === 'music');
    if (existing) Object.assign(existing, { path: rel, status: 'approved', durationSec, prompt: `music bed ${bed}` });
    else proj.assets.push({ id: newId('ga'), kind: 'music', name: 'music', prompt: `music bed ${bed}`, path: rel, status: 'approved', durationSec });
    advanceStage(proj, 'audio');
  });
  return { name: 'music', path: rel, label, durationSec };
}

export { fromRel };
