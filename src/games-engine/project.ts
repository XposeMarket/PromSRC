/**
 * Game projects ("Games mode"): server-owned documents at
 *   <workspace>/game-projects/<gp_id>/game.json
 * with assets/ (generated images), audio/ (procedural sfx + music beds) and
 * build/ (the playable browser game the chat agent writes).
 * Writes are serialized per project.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const GAME_GENRES = ['shooter', 'platformer', 'novella', 'hypercasual', 'racing', 'horror', 'puzzle', 'other'] as const;
export const GAME_STYLES = ['pixel', 'minimal', 'ascii', 'voxel', 'anime', '3d', 'cartoon'] as const;
export const GAME_STAGES = ['design', 'art', 'audio', 'code', 'playable', 'published'] as const;
export type GameGenre = typeof GAME_GENRES[number];
export type GameStyle = typeof GAME_STYLES[number];
export type GameStage = typeof GAME_STAGES[number];
export type GameEngine = 'canvas2d' | 'three';
export type AssetKind = 'sprite' | 'texture' | 'background' | 'ui' | 'portrait' | 'sfx' | 'music';
export type AssetStatus = 'planned' | 'generating' | 'candidate' | 'approved' | 'rejected' | 'failed';

export interface GameDesign {
  genre: GameGenre;
  style: GameStyle;
  setting: string;
  multiplayer: boolean;
  engine: GameEngine;
  controls?: string;
  coreLoop?: string;
  winLose?: string;
  notes?: string;
}

export interface GameQuestion { id: string; q: string; options: string[]; answer?: string }

export interface GameAsset {
  id: string;
  kind: AssetKind;
  name: string;
  prompt: string;
  /** Workspace-relative path of the approved/current file. */
  path?: string;
  /** Workspace-relative candidate files (newest last). */
  candidates?: string[];
  status: AssetStatus;
  transparent?: boolean;
  size?: { w: number; h: number };
  modelId?: string;
  error?: string;
  durationSec?: number;
}

export interface GameProject {
  id: string;
  title: string;
  pitch: string;
  design: GameDesign;
  questions: GameQuestion[];
  assets: GameAsset[];
  stage: GameStage;
  budget: { capUsd?: number; autoApproveUsd: number; spentUsd: number };
  publish: { localUrl?: string; url?: string; room?: string; note?: string; at?: number };
  imageModel?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export function gamesRoot(ws: string): string { return path.join(ws, 'game-projects'); }

export function gameDir(ws: string, id: string): string {
  if (!/^gp_[A-Za-z0-9_-]{3,64}$/.test(String(id || ''))) throw new Error(`Invalid game project id "${id}".`);
  return path.join(gamesRoot(ws), id);
}

export function toRel(ws: string, abs: string): string { return path.relative(ws, abs).split(path.sep).join('/'); }
export function fromRel(ws: string, rel: string): string {
  const abs = path.resolve(ws, rel);
  const root = path.resolve(ws);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Path escapes the workspace.');
  return abs;
}

export function defaultEngine(style: string): GameEngine {
  return style === '3d' || style === 'voxel' ? 'three' : 'canvas2d';
}

function pick<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  const s = String(v ?? '').trim().toLowerCase() as T;
  return list.includes(s) ? s : fallback;
}

export function normalizeDesign(input: any, base?: GameDesign): GameDesign {
  const b: GameDesign = base || { genre: 'other', style: 'pixel', setting: '', multiplayer: false, engine: 'canvas2d' };
  const style = input?.style !== undefined ? pick(input.style, GAME_STYLES, b.style) : b.style;
  const d: GameDesign = {
    genre: input?.genre !== undefined ? pick(input.genre, GAME_GENRES, b.genre) : b.genre,
    style,
    setting: input?.setting !== undefined ? String(input.setting).slice(0, 400) : b.setting,
    multiplayer: input?.multiplayer !== undefined ? input.multiplayer === true || input.multiplayer === 'true' : b.multiplayer,
    engine: input?.engine === 'three' || input?.engine === 'canvas2d' ? input.engine
      : (input?.style !== undefined && !base ? defaultEngine(style) : (base ? b.engine : defaultEngine(style))),
  };
  for (const k of ['controls', 'coreLoop', 'winLose', 'notes'] as const) {
    const v = input?.[k] !== undefined ? String(input[k]).slice(0, 2000) : b[k];
    if (v) d[k] = v;
  }
  return d;
}

function file(ws: string, id: string): string { return path.join(gameDir(ws, id), 'game.json'); }

export function loadGame(ws: string, id: string): GameProject {
  const f = file(ws, id);
  if (!fs.existsSync(f)) throw new Error(`Game project "${id}" not found.`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function saveGame(ws: string, p: GameProject): void {
  const f = file(ws, p.id);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 1));
  fs.renameSync(tmp, f);
}

const locks = new Map<string, Promise<unknown>>();
const listeners = new Set<(ev: { workspacePath: string; projectId: string; version: number }) => void>();
export function onGameChange(fn: (ev: { workspacePath: string; projectId: string; version: number }) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Serialized read-modify-write of one project. */
export function mutateGame<T = void>(ws: string, id: string, fn: (p: GameProject) => T | Promise<T>): Promise<{ project: GameProject; result: T }> {
  const key = `${path.resolve(ws)}|${id}`;
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const p = loadGame(ws, id);
    const result = await fn(p);
    p.updatedAt = Date.now();
    p.version = (p.version || 0) + 1;
    saveGame(ws, p);
    for (const l of listeners) { try { l({ workspacePath: ws, projectId: id, version: p.version }); } catch { /* ignore */ } }
    return { project: p, result };
  });
  locks.set(key, run.catch(() => undefined));
  return run;
}

export function createGame(ws: string, args: { title?: string; pitch?: string; genre?: string; style?: string; setting?: string; multiplayer?: boolean; engine?: string; autoApproveUsd?: number; capUsd?: number; imageModel?: string }): GameProject {
  const id = newId('gp');
  const dir = gameDir(ws, id);
  for (const sub of ['assets', 'audio', 'build']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const now = Date.now();
  const p: GameProject = {
    id,
    title: String(args.title || 'Untitled game').slice(0, 120),
    pitch: String(args.pitch || '').slice(0, 2000),
    design: normalizeDesign(args),
    questions: [],
    assets: [],
    stage: 'design',
    budget: {
      autoApproveUsd: Number.isFinite(Number(args.autoApproveUsd)) && args.autoApproveUsd !== undefined ? Number(args.autoApproveUsd) : 1,
      spentUsd: 0,
      ...(Number(args.capUsd) > 0 ? { capUsd: Number(args.capUsd) } : {}),
    },
    publish: {},
    ...(args.imageModel ? { imageModel: String(args.imageModel) } : {}),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  saveGame(ws, p);
  return p;
}

export function listGames(ws: string): Array<{ id: string; title: string; genre: string; style: string; stage: GameStage; updatedAt: number }> {
  const root = gamesRoot(ws);
  if (!fs.existsSync(root)) return [];
  const out: Array<{ id: string; title: string; genre: string; style: string; stage: GameStage; updatedAt: number }> = [];
  for (const d of fs.readdirSync(root)) {
    if (!d.startsWith('gp_')) continue;
    try { const p = loadGame(ws, d); out.push({ id: p.id, title: p.title, genre: p.design.genre, style: p.design.style, stage: p.stage, updatedAt: p.updatedAt }); }
    catch { /* skip */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteGame(ws: string, id: string): void {
  const dir = gameDir(ws, id);
  if (!fs.existsSync(path.join(dir, 'game.json'))) throw new Error(`Game project "${id}" not found.`);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function stageIndex(s: GameStage): number { return GAME_STAGES.indexOf(s); }

/** Move forward only (never regress the stage). */
export function advanceStage(p: GameProject, to: GameStage): void {
  if (stageIndex(to) > stageIndex(p.stage)) p.stage = to;
}

export function summarizeGame(p: GameProject) {
  const count = (s: AssetStatus) => p.assets.filter((a) => a.status === s).length;
  return {
    id: p.id,
    title: p.title,
    pitch: p.pitch,
    stage: p.stage,
    design: p.design,
    questions: p.questions.map((q) => ({ id: q.id, q: q.q, answer: q.answer })),
    assets: p.assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, status: a.status, path: a.path, candidates: a.candidates?.length || 0, ...(a.error ? { error: a.error } : {}) })),
    counts: { planned: count('planned'), generating: count('generating'), candidate: count('candidate'), approved: count('approved'), rejected: count('rejected'), failed: count('failed') },
    budget: p.budget,
    publish: p.publish,
    chatCard: '```game-project\n' + JSON.stringify({ projectId: p.id }) + '\n```',
  };
}
