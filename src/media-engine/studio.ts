/**
 * Studio layer on top of the video project engine: everything that turns a
 * set of generated clips into a finished, postable ad.
 *
 *  - importAsset: product/character photos (chat attachments, uploads)
 *  - voiceover:   script lines -> TTS (OpenAI / xAI) -> VO track timed per shot
 *  - captions:    word-timed cues from the VO, burned in at render (captions.ts)
 *  - music:       generated royalty-free beds (ffmpeg synth), ducked under VO
 *  - qa:          vision review of every selected take (xAI -> Codex -> OpenAI)
 *  - hooks:       A/B hook takes + one export per variant
 *  - renderAll:   multi-aspect exports (9:16 / 1:1 / 16:9, blur-fill reframe)
 *  - templates / cast / brand kits wired into projects
 *  - runAutopilot: brief -> finished render with ONE approval (Supercomputer mode)
 */
import fs from 'fs';
import path from 'path';
import { estimateCostUsd, getModel } from './catalog.js';
import { buildCaptionCues } from './captions.js';
import { denseTakeCheck, type TakeDefect } from './inspect.js';
import {
  estimate, extractFrameAt, generateCharacterAnchor, generateShots, generateStoryboards, mediaDurationSec,
  renderProject, runFfmpeg, waitForJobs,
} from './engine.js';
import {
  applyOps, createProject, fromWorkspaceRel, layoutVoiceover, loadProject, mediaDir, mutateProject, newId,
  selectedTake, toWorkspaceRel, type RunState, type RunStep, type Shot, type Take, type VideoProject,
} from './project.js';
import { brandToProjectOps, castFromCharacter, castToCharacterOp, getBrand, getCast, listBrands, listCast, saveBrand } from './library.js';
import { getTemplate, listTemplates, planFromTemplate } from './templates.js';
import { transcribeTakes } from './transcribe.js';

// ── import ──────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Bring a photo into the project. role=product|character creates an
 * auto-approved identity (the user supplied it, so no candidate step).
 * Accepts a workspace path (chat uploads land in uploads/) or base64 data.
 */
export async function importAsset(ws: string, projectId: string, args: {
  path?: string; dataBase64?: string; filename?: string; role?: 'product' | 'character' | 'asset' | 'footage' | 'sketch'; name?: string; notes?: string;
}): Promise<{ assetPath: string; characterId?: string; role: string; kind?: string }> {
  const dir = path.join(mediaDir(ws, projectId), 'imports');
  fs.mkdirSync(dir, { recursive: true });
  let dest: string;
  if (args.dataBase64) {
    const raw = String(args.dataBase64).replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) throw new Error('import_asset: empty file data.');
    if (buf.length > 25 * 1024 * 1024) throw new Error('import_asset: file is larger than 25 MB.');
    const safe = String(args.filename || 'upload.png').replace(/[^a-z0-9._-]+/gi, '_').slice(-80);
    dest = path.join(dir, `${Date.now().toString(36)}_${IMAGE_EXT.test(safe) || /\.(mp4|webm|mov|mp3|wav|m4a)$/i.test(safe) ? safe : `${safe}.png`}`);
    fs.writeFileSync(dest, buf);
  } else if (args.path) {
    const src = fromWorkspaceRel(ws, String(args.path));
    if (!fs.existsSync(src)) throw new Error(`import_asset: ${args.path} not found.`);
    dest = path.join(dir, `${Date.now().toString(36)}_${path.basename(src).replace(/[^a-z0-9._-]+/gi, '_')}`);
    fs.copyFileSync(src, dest);
  } else throw new Error('import_asset needs path (workspace file) or dataBase64.');
  const rel = toWorkspaceRel(ws, dest);
  const role = args.role || 'asset';
  if (role === 'asset' || role === 'footage' || role === 'sketch' || !IMAGE_EXT.test(dest)) {
    const kind = /\.(mp4|webm|mov)$/i.test(dest) ? 'video' : /\.(mp3|wav|m4a|aac|ogg)$/i.test(dest) ? 'audio' : 'image';
    if (role === 'footage' && kind !== 'video') throw new Error('import_asset role footage needs a video file (.mp4/.webm/.mov).');
    await applyOps(ws, projectId, [{ op: 'asset.add', path: rel, kind, label: args.name || (role === 'footage' ? 'Footage' : role === 'sketch' ? 'Sketch' : undefined) }], 'user');
    return { assetPath: rel, role: role === 'footage' || role === 'sketch' ? role : 'asset', kind };
  }
  const name = String(args.name || (role === 'product' ? 'Product' : 'Creator')).trim();
  const existing = loadProject(ws, projectId).characters.find((c) => c.name.toLowerCase() === name.toLowerCase() && (c.kind || 'person') === (role === 'product' ? 'product' : 'person'));
  const id = existing?.id || newId('char');
  await applyOps(ws, projectId, [{
    op: 'character.upsert', id, name, kind: role === 'product' ? 'product' : 'person',
    anchors: [rel, ...(existing?.anchors || [])].slice(0, 4), refs: existing?.refs || [],
    notes: args.notes ?? existing?.notes ?? (role === 'product' ? 'Exact product from the reference photo: same shape, label, logo and colors.' : undefined),
  }], 'user');
  return { assetPath: rel, characterId: id, role };
}

// ── voiceover ───────────────────────────────────────────────────────────

async function tts(text: string, voice: { provider: 'openai' | 'xai'; voice: string; speed?: number }): Promise<{ buffer: Buffer; ext: string; provider: string; voice: string }> {
  const gp = await import('../gateway/creative/generative-pipeline.js');
  const tryOpenAi = async () => {
    const v = gp.normalizeOpenAiTtsVoice(voice.provider === 'openai' ? voice.voice : undefined);
    const errs: string[] = [];
    // An explicit key is tried first; OAuth bridges (which may refresh tokens) only when it is missing or fails.
    const envKey = String(process.env.OPENAI_API_KEY || '').trim();
    const first = envKey ? [{ token: envKey, auth: 'api_key' as const }] : [];
    const cands = [...first];
    let loadedRest = false;
    for (let i = 0; i < cands.length || !loadedRest; i++) {
      if (i >= cands.length) {
        loadedRest = true;
        for (const c of await gp.openAiVoiceAuthCandidates()) if (!cands.some((x) => x.token === c.token)) cands.push(c as any);
        if (i >= cands.length) break;
      }
      const c = cands[i];
      try {
        const r = await gp.fetchBinaryOrThrow('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: v, input: text, response_format: 'mp3',
            instructions: 'Casual, genuine, upbeat social-media creator talking straight to camera. Natural pace, not salesy.',
            ...(voice.speed ? { speed: Math.max(0.5, Math.min(2, voice.speed)) } : {}),
          }),
        });
        if (r.buffer.length) return { buffer: r.buffer, ext: '.mp3', provider: 'openai', voice: v };
      } catch (e: any) { errs.push(`${c.auth}: ${String(e?.message || e).slice(0, 200)}`); }
    }
    if (!cands.length) throw new Error('OpenAI voice is not connected.');
    throw new Error(`OpenAI TTS failed: ${errs.join(' | ')}`);
  };
  const tryXai = async () => {
    const key = await gp.xaiVoiceAuthToken();
    if (!key) throw new Error('xAI voice is not connected.');
    const resolved = await gp.resolveXaiVoiceId(key, voice.provider === 'xai' ? voice.voice : undefined);
    const r = await gp.fetchBinaryOrThrow(`${gp.xaiVoiceBaseUrl()}/tts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0' },
      body: JSON.stringify({ text, voice_id: resolved.voice, language: 'en', ...(voice.speed ? { speed: voice.speed } : {}) }),
    });
    return { buffer: r.buffer, ext: r.mimeType.includes('wav') ? '.wav' : '.mp3', provider: 'xai', voice: resolved.voice };
  };
  const order = voice.provider === 'xai' ? [tryXai, tryOpenAi] : [tryOpenAi, tryXai];
  const errs: string[] = [];
  for (const fn of order) { try { return await fn(); } catch (e: any) { errs.push(String(e?.message || e).slice(0, 300)); } }
  // Report every provider's failure: the last one alone hid the real cause (e.g. OpenAI 401 behind "xAI not connected").
  throw new Error(`Voiceover failed on every TTS provider: ${errs.join(' || ') || 'none available'}`);
}

/** TTS one line with the project voice into media/vo; returns the workspace path (lipsync / talking photo). */
export async function ttsLineToFile(ws: string, projectId: string, text: string, baseName = 'line'): Promise<string> {
  const p = loadProject(ws, projectId);
  const voice = p.voice || { provider: 'openai' as const, voice: 'nova' };
  const out = await tts(text, voice);
  const dir = path.join(mediaDir(ws, projectId), 'vo');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${baseName.replace(/[^a-z0-9_-]+/gi, '_')}_${Date.now().toString(36)}${out.ext}`);
  fs.writeFileSync(abs, out.buffer);
  return toWorkspaceRel(ws, abs);
}

/** Voice every shot that has a line; place clips on the VO track aligned to the edit. */
export async function voiceover(ws: string, projectId: string, args: { shotIds?: string[]; force?: boolean } = {}): Promise<{ voiced: Array<{ shotId: string; durationSec: number; path: string }>; skipped: string[]; voice: string }> {
  const p = loadProject(ws, projectId);
  const voice = p.voice || { provider: 'openai' as const, voice: 'nova' };
  const targets = p.shots.filter((s) => s.line?.trim() && (!args.shotIds?.length || args.shotIds.includes(s.id)));
  if (!targets.length) throw new Error('No shot has a voiceover line. Set shot.line first (shot.update or a template).');
  const dir = path.join(mediaDir(ws, projectId), 'vo');
  fs.mkdirSync(dir, { recursive: true });
  const voiced: Array<{ shotId: string; durationSec: number; path: string; text: string; voice: string }> = [];
  const skipped: string[] = [];
  let usedVoice = voice.voice;
  for (const shot of targets) {
    const text = shot.line!.trim();
    if (!args.force && shot.voiceover?.text === text && shot.voiceover.voice === voice.voice && fs.existsSync(fromWorkspaceRel(ws, shot.voiceover.path))) { skipped.push(shot.id); continue; }
    const out = await tts(text, voice);
    usedVoice = out.voice;
    const abs = path.join(dir, `${shot.id}_${Date.now().toString(36)}${out.ext}`);
    fs.writeFileSync(abs, out.buffer);
    const dur = (await mediaDurationSec(abs)) || Math.max(1, text.split(/\s+/).length / 2.6);
    voiced.push({ shotId: shot.id, durationSec: +dur.toFixed(2), path: toWorkspaceRel(ws, abs), text, voice: out.voice });
  }
  await mutateProject(ws, projectId, 'voiceover', (proj) => {
    for (const v of voiced) {
      const s = proj.shots.find((x) => x.id === v.shotId);
      if (!s) continue;
      s.voiceover = { path: v.path, durationSec: v.durationSec, text: v.text, voice: v.voice };
      // A line longer than the shot would get cut: stretch the shot to fit.
      if (v.durationSec + 0.4 > s.durationSec && !s.takes.length) s.durationSec = Math.min(15, Math.ceil(v.durationSec + 0.5));
    }
    // Asking for a narrator means the narrator carries the words (clips go under it).
    if (voiced.length) proj.audioMode = 'voiceover';
    layoutVoiceover(proj);
    if (proj.captions?.enabled) proj.captions.cues = buildCaptionCues(proj);
  });
  return { voiced: voiced.map(({ shotId, durationSec, path: pth }) => ({ shotId, durationSec, path: pth })), skipped, voice: usedVoice };
}

// ── captions ────────────────────────────────────────────────────────────

export async function captions(ws: string, projectId: string, args: { style?: string; enabled?: boolean } = {}): Promise<{ cues: number; style: string; sample: string[] }> {
  const p = await mutateProject(ws, projectId, 'captions', (proj) => {
    layoutVoiceover(proj);
    const style = (['bold', 'pop', 'minimal', 'karaoke'].includes(String(args.style)) ? args.style : proj.captions?.style || 'pop') as any;
    proj.captions = { enabled: args.enabled !== false, style, cues: buildCaptionCues(proj) };
  });
  if (!p.captions!.cues.length) {
    throw new Error(p.audioMode === 'native'
      ? 'No speech found in the clips to caption. Run transcribe after the takes land (and timeline.assemble), or switch audioMode to voiceover.'
      : 'No voiceover on the timeline to caption. Run voiceover (and timeline.assemble) first.');
  }
  return { cues: p.captions!.cues.length, style: p.captions!.style, sample: p.captions!.cues.slice(0, 4).map((c) => c.text) };
}

// ── music ───────────────────────────────────────────────────────────────

/** Royalty-free generated beds (pure synthesis, no samples). */
const BEDS: Record<string, { label: string; bpm: number; expr: (bpm: number) => string }> = {
  pulse: {
    label: 'Pulse (upbeat)', bpm: 120,
    expr: (bpm) => {
      const b = (60 / bpm).toFixed(4);
      const h = (30 / bpm).toFixed(4);
      return [
        `0.55*sin(2*PI*52*t*(1+0.6*exp(-30*mod(t,${b}))))*exp(-9*mod(t,${b}))`,
        `0.10*(random(0)*2-1)*exp(-55*mod(t+${h},${b}))`,
        `0.09*sin(2*PI*(110+55*(mod(floor(t/(4*${b})),2)))*t)*(0.55+0.45*sin(2*PI*t/(${b}*8)))`,
        `0.05*sin(2*PI*330*t)*exp(-6*mod(t,${h}))`,
      ].join('+');
    },
  },
  chill: {
    label: 'Chill (lo-fi)', bpm: 84,
    expr: (bpm) => {
      const b = (60 / bpm).toFixed(4);
      return [
        `0.35*sin(2*PI*48*t)*exp(-7*mod(t,2*${b}))`,
        `0.07*(random(0)*2-1)*exp(-35*mod(t+${b},2*${b}))`,
        `0.08*(sin(2*PI*220*t)+sin(2*PI*277.2*t)+sin(2*PI*329.6*t))*(0.6+0.4*sin(2*PI*t/(${b}*16)))`,
        `0.03*(random(0)*2-1)`,
      ].join('+');
    },
  },
  hype: {
    label: 'Hype (trap)', bpm: 140,
    expr: (bpm) => {
      const b = (60 / bpm).toFixed(4);
      const q = (15 / bpm).toFixed(4);
      return [
        `0.6*sin(2*PI*44*t*(1+1.2*exp(-18*mod(t,2*${b}))))*exp(-3.5*mod(t,2*${b}))`,
        `0.08*(random(0)*2-1)*exp(-120*mod(t,${q}))`,
        `0.12*(random(0)*2-1)*exp(-30*mod(t+${b},2*${b}))`,
        `0.06*sin(2*PI*392*t)*(0.5+0.5*sin(2*PI*t/(${b}*4)))`,
      ].join('+');
    },
  },
};

export function listMusicBeds() {
  return Object.entries(BEDS).map(([id, b]) => ({ id, label: b.label, bpm: b.bpm }));
}

/** Render a builtin music bed to an mp3 (used by game projects). Free, local ffmpeg. */
export async function synthMusicBed(bedId: string, seconds: number, outAbs: string): Promise<{ path: string; label: string }> {
  const id = String(bedId || 'pulse').toLowerCase();
  const bed = BEDS[id];
  if (!bed) throw new Error(`music: unknown bed "${id}". Use one of ${Object.keys(BEDS).join(', ')}.`);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const { code, stderr } = await runFfmpeg(['-y', '-hide_banner', '-f', 'lavfi', '-i', `aevalsrc='${bed.expr(bed.bpm)}':s=44100:d=${Math.max(4, seconds)}`,
    '-af', 'highpass=f=30,lowpass=f=9000,acompressor=threshold=0.25:ratio=3,afade=t=in:d=0.4,volume=0.9', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', outAbs], 120_000);
  if (code !== 0) throw new Error(`music synth failed: ${stderr.slice(-300)}`);
  return { path: outAbs, label: bed.label };
}

export async function music(ws: string, projectId: string, args: { builtin?: string; path?: string; volume?: number; duck?: boolean } = {}): Promise<{ path: string; label: string; volume: number; durationSec: number }> {
  let rel: string;
  let label: string;
  const p0 = loadProject(ws, projectId);
  const total = Math.max(6, Math.ceil(p0.clips.reduce((m, c) => Math.max(m, c.startMs + c.outMs - c.inMs), 0) / 1000) || p0.shots.reduce((s, x) => s + x.durationSec, 0) || 15);
  if (args.path) {
    const abs = fromWorkspaceRel(ws, args.path);
    if (!fs.existsSync(abs)) throw new Error(`music: ${args.path} not found.`);
    rel = toWorkspaceRel(ws, abs);
    label = path.basename(abs);
  } else {
    const id = String(args.builtin || 'pulse').toLowerCase();
    const bed = BEDS[id];
    if (!bed) throw new Error(`music: unknown builtin "${id}". Use one of ${Object.keys(BEDS).join(', ')}.`);
    const abs = path.join(mediaDir(ws, projectId), 'music', `${id}_${total}s.mp3`);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const { code, stderr } = await runFfmpeg(['-y', '-hide_banner', '-f', 'lavfi', '-i', `aevalsrc='${bed.expr(bed.bpm)}':s=44100:d=${total + 1}`,
        '-af', 'highpass=f=30,lowpass=f=9000,acompressor=threshold=0.25:ratio=3,afade=t=in:d=0.4,volume=0.9', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', abs], 120_000);
      if (code !== 0) throw new Error(`music synth failed: ${stderr.slice(-300)}`);
    }
    rel = toWorkspaceRel(ws, abs);
    label = bed.label;
  }
  const volume = Math.max(0, Math.min(1, args.volume ?? (p0.shots.some((s) => s.line) ? 0.22 : 0.45)));
  await applyOps(ws, projectId, [{ op: 'music.set', path: rel, volume, duck: args.duck !== false, label }], 'agent');
  return { path: rel, label, volume, durationSec: total };
}

// ── QA ──────────────────────────────────────────────────────────────────

const QA_PROMPT = (shot: Shot, p: VideoProject) => {
  const chars = shot.characterIds.map((id) => p.characters.find((c) => c.id === id)).filter(Boolean)
    .map((c) => `${c!.kind === 'product' ? 'PRODUCT' : 'PERSON'} "${c!.name}"`).join(', ');
  return [
    `You are reviewing frames from one AI-generated video shot for a paid ad. The shot was meant to show: "${shot.prompt.slice(0, 400)}".`,
    chars ? `The FIRST image(s) are the reference anchors for ${chars}; the remaining images are frames from the start, middle and end of the generated clip.` : 'The images are frames from the start, middle and end of the generated clip.',
    'Score 1-10 for ad-readiness. Deduct hard for: deformed hands/fingers, melting or morphing faces, identity drift from the reference person, product that does not match the reference (wrong shape/label/logo/colors), garbled text or logos, objects popping in/out, severe artifacts, or not matching the intended action.',
    'Answer ONLY JSON: {"score": <1-10>, "issues": ["short issue", ...], "verdict": "pass" | "reroll"}. verdict is "reroll" when score < 6.',
  ].join(' ');
};

function toDataUrl(abs: string): string {
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function parseQa(text: string): { score: number; issues: string[]; verdict: 'pass' | 'reroll' } {
  const m = text.match(/\{[\s\S]*\}/);
  let j: any = {};
  try { j = JSON.parse(m ? m[0] : text); } catch { /* fall through */ }
  const score = Math.max(1, Math.min(10, Math.round(Number(j.score) || Number((text.match(/score\D{0,6}(\d+)/i) || [])[1]) || 5)));
  const issues = Array.isArray(j.issues) ? j.issues.map((x: any) => String(x).slice(0, 120)).slice(0, 6) : [];
  return { score, issues, verdict: j.verdict === 'reroll' || score < 6 ? 'reroll' : 'pass' };
}

export async function qaTake(ws: string, p: VideoProject, shot: Shot, take: Take): Promise<{ score: number; issues: string[]; verdict: 'pass' | 'reroll'; model: string; defects?: TakeDefect[]; framesChecked?: number }> {
  // Video takes: dense check (a frame every ~0.25s + identity anchor + start frame). A 3-frame
  // start/middle/end sample missed a half-second shirt split on 2026-10-07.
  if (take.kind === 'video') {
    try {
      const d = await denseTakeCheck(ws, p, shot, take, { workDir: path.join(mediaDir(ws, p.id), 'qa', 'dense') });
      return { score: d.score, issues: d.issues, verdict: d.verdict, model: d.model, defects: d.defects, framesChecked: d.framesChecked };
    } catch (e: any) {
      if (/vision failed/i.test(String(e?.message))) throw e;
      /* grid extraction failed: fall back to the 3-frame sample below */
    }
  }
  const abs = fromWorkspaceRel(ws, take.path);
  const frames: string[] = [];
  for (const cid of shot.characterIds) {
    const c = p.characters.find((x) => x.id === cid);
    const a = c?.anchors[0];
    if (a) { try { const aa = fromWorkspaceRel(ws, a); if (fs.existsSync(aa)) frames.push(toDataUrl(aa)); } catch { /* ignore */ } }
  }
  if (take.kind === 'video') {
    const dur = take.durationSec || (await mediaDurationSec(abs)) || shot.durationSec;
    const dir = path.join(mediaDir(ws, p.id), 'qa');
    for (const [i, t] of [0.15, dur * 0.5, Math.max(0.2, dur - 0.25)].entries()) {
      const out = await extractFrameAt(abs, t, path.join(dir, `${take.id}_${i}.jpg`), 640);
      frames.push(toDataUrl(out));
    }
  } else frames.push(toDataUrl(abs));
  const { executeVisionJudge } = await import('../gateway/tools/handlers/xai-handlers.js');
  const { withRateLimitRetry } = await import('./engine.js');
  const res = await withRateLimitRetry(async () => {
    const r = await executeVisionJudge(QA_PROMPT(shot, p), frames, { maxTokens: 300 });
    if (!r.success || !r.text) throw new Error(`QA vision failed: ${r.error || 'no response'}`);
    return r;
  });
  return { ...parseQa(res.text || ''), model: res.model || 'vision' };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

/** Word-overlap similarity (0..1) between what the clip said and the scripted line. */
export function lineSimilarity(said: string, line: string): number {
  const a = norm(said); const b = norm(line);
  if (!a.length || !b.length) return 0;
  const pool = new Map<string, number>();
  for (const w of a) pool.set(w, (pool.get(w) || 0) + 1);
  let hit = 0;
  for (const w of b) { const n = pool.get(w) || 0; if (n) { hit += 1; pool.set(w, n - 1); } }
  return (2 * hit) / (a.length + b.length);
}

/** Native dialogue: flag clips that went off-script (or silent) as rerolls. */
export function onScriptIssue(p: VideoProject, shot: Shot, take: Take): string | null {
  if (p.audioMode !== 'native' || take.kind !== 'video' || !shot.line?.trim() || !take.transcript) return null;
  const said = String(take.transcript.text || '').trim();
  if (!said) return 'off-script: no speech (the line was not said)';
  if (lineSimilarity(said, shot.line) < 0.5) return `off-script: said '${said.slice(0, 120)}'`;
  return null;
}

export async function qa(ws: string, projectId: string, args: { shotIds?: string[] } = {}): Promise<{ results: Array<{ shotId: string; title: string; takeId: string; score: number; verdict: string; issues: string[] }>; failed: string[] }> {
  // Native dialogue: transcribe first so the on-script check has words to compare (free, local).
  if (loadProject(ws, projectId).audioMode === 'native') {
    try { await transcribeTakes(ws, projectId, { shotIds: args.shotIds }); } catch { /* on-script check is best-effort */ }
  }
  const p = loadProject(ws, projectId);
  const results: Array<{ shotId: string; title: string; takeId: string; score: number; verdict: string; issues: string[]; model: string; framesChecked?: number }> = [];
  const failed: string[] = [];
  const shots = p.shots.filter((s) => (!args.shotIds?.length || args.shotIds.includes(s.id)) && selectedTake(s));
  // Two at a time: vision providers rate-limit per team (xAI: 2 req/s).
  const queue = [...shots];
  const worker = async () => {
    for (let shot = queue.shift(); shot; shot = queue.shift()) {
      const take = selectedTake(shot)!;
      try {
        const v = await qaTake(ws, p, shot, take);
        const off = onScriptIssue(p, shot, take);
        if (off) { v.verdict = 'reroll'; v.issues = [off, ...v.issues]; v.score = Math.min(v.score, 4); }
        results.push({ shotId: shot.id, title: shot.title, takeId: take.id, ...v });
      }
      catch (e: any) { failed.push(`${shot.title}: ${String(e?.message || e).slice(0, 200)}`); }
    }
  };
  await Promise.all([worker(), worker()]);
  await mutateProject(ws, projectId, 'qa', (proj) => {
    for (const r of results) {
      const t = proj.shots.find((s) => s.id === r.shotId)?.takes.find((x) => x.id === r.takeId);
      if (t) t.qa = { score: r.score, issues: r.issues, verdict: r.verdict as any, model: r.model, at: Date.now(), ...(r.framesChecked ? { framesChecked: r.framesChecked } : {}) };
    }
  });
  return { results: results.map(({ model: _m, ...r }) => r), failed };
}

// ── hooks + multi-aspect ────────────────────────────────────────────────

/** One export per take of a shot (hook A/B). */
export async function renderVariants(ws: string, projectId: string, args: { shotId: string; aspect?: string }): Promise<{ exports: Array<{ path: string; takeId: string; variant: string }> }> {
  const p = loadProject(ws, projectId);
  const shot = p.shots.find((s) => s.id === args.shotId);
  if (!shot) throw new Error(`Shot "${args.shotId}" not found.`);
  const takes = shot.takes.filter((t) => t.kind === 'video');
  if (takes.length < 2) throw new Error('render_variants needs at least 2 video takes of that shot (generate with count:2+ or hookVariants).');
  const out: Array<{ path: string; takeId: string; variant: string }> = [];
  for (const [i, t] of takes.slice(0, 4).entries()) {
    const variant = `hook-${String.fromCharCode(65 + i)}`;
    const r = await renderProject(ws, projectId, { takeOverride: { shotId: shot.id, takeId: t.id }, variant, aspect: args.aspect });
    out.push({ path: r.path, takeId: t.id, variant });
  }
  return { exports: out };
}

/** Generate alternative hook takes for the first shot from template/prompt variants. */
export async function generateHookVariants(ws: string, projectId: string, args: { prompts?: string[]; shotId?: string; approved?: boolean }): Promise<any> {
  const p = loadProject(ws, projectId);
  const shot = p.shots.find((s) => s.id === args.shotId) || p.shots[0];
  if (!shot) throw new Error('No shots.');
  const prompts = (args.prompts?.length ? args.prompts : p.hookVariants || []).slice(0, 3);
  if (!prompts.length) throw new Error('No hook variants: pass prompts or use a template that has hookVariants.');
  const jobs: any[] = [];
  let needs: any = null;
  const est = await estimate(ws, projectId, { shotIds: [shot.id] });
  const totalUsd = est.total * prompts.length;
  if (!args.approved && totalUsd > p.budget.autoApproveUsd + 1e-9) {
    return { needsApproval: true, usd: +totalUsd.toFixed(3), reason: `${prompts.length} hook variants ~$${totalUsd.toFixed(2)}`, breakdown: prompts.map((pr) => ({ item: `Hook: ${pr.slice(0, 50)}`, usd: est.total })) };
  }
  for (const pr of prompts) {
    const r = await generateShots(ws, projectId, { shotIds: [shot.id], promptOverride: pr, approved: true });
    if (r.needsApproval) { needs = r; break; }
    jobs.push(...r.jobs);
  }
  return needs || { shotId: shot.id, jobs };
}

export async function renderAll(ws: string, projectId: string, args: { aspects?: string[] } = {}): Promise<{ exports: Array<{ path: string; aspect: string; durationSec: number }> }> {
  const p = loadProject(ws, projectId);
  const aspects = Array.from(new Set((args.aspects?.length ? args.aspects : [p.target.aspect]).filter((a) => /^\d+:\d+$/.test(a))));
  const out: Array<{ path: string; aspect: string; durationSec: number }> = [];
  for (const aspect of aspects) {
    const r = await renderProject(ws, projectId, { aspect });
    out.push({ path: r.path, aspect, durationSec: r.durationSec });
  }
  return { exports: out };
}

// ── draft -> final ──────────────────────────────────────────────────────

/** Re-generate the selected shots at a higher resolution (same prompt/anchor). */
export async function upgradeFinal(ws: string, projectId: string, args: { shotIds?: string[]; resolution?: string; approved?: boolean }): Promise<any> {
  const resolution = args.resolution || '720p';
  const p = loadProject(ws, projectId);
  const ids = args.shotIds?.length ? args.shotIds : p.shots.filter((s) => selectedTake(s)).map((s) => s.id);
  return generateShots(ws, projectId, { shotIds: ids, resolution, approved: args.approved });
}

// ── smart router ────────────────────────────────────────────────────────

/**
 * Pick a model per shot from what is configured + what the shot needs:
 *  - talking head with lip-synced line -> Veo 3 (native audio) when fal is set up
 *  - start + end frame -> Seedance / Kling (fal)
 *  - otherwise the project default (Grok 1.5 draft).
 */
export async function routeModels(ws: string, projectId: string, args: { quality?: 'draft' | 'premium'; apply?: boolean } = {}): Promise<{ picks: Array<{ shotId: string; title: string; modelId: string; why: string }> }> {
  const { providerStatus } = await import('./providers.js');
  const status = await providerStatus();
  const has = (prov: string) => !!(status as any)[prov]?.configured;
  const p = loadProject(ws, projectId);
  const picks: Array<{ shotId: string; title: string; modelId: string; why: string }> = [];
  for (const s of p.shots) {
    let modelId = p.defaults.videoModel;
    let why = 'project default';
    if (s.endImage && has('fal')) { modelId = 'fal/seedance-v1-pro-i2v'; why = 'start+end frame'; }
    else if (args.quality === 'premium' && has('higgsfield')) { modelId = 'higgsfield/kling-v2.5-turbo-pro-i2v'; why = 'premium motion'; }
    else if (args.quality === 'premium' && has('fal')) { modelId = 'fal/kling-v2.1-master-i2v'; why = 'premium motion'; }
    else if (has('xai')) { modelId = 'xai/grok-imagine-video-1.5'; why = 'cheap draft (Grok 1.5)'; }
    if (!getModel(modelId)) { modelId = p.defaults.videoModel; why = 'fallback to default'; }
    picks.push({ shotId: s.id, title: s.title, modelId, why });
  }
  if (args.apply !== false) {
    await applyOps(ws, projectId, picks.map((x) => ({ op: 'shot.update', id: x.shotId, modelId: x.modelId })), 'agent');
  }
  return { picks };
}

// ── templates / library glue ────────────────────────────────────────────

export async function applyTemplate(ws: string, projectId: string, args: {
  templateId: string; product?: string; character?: string; brief?: string; brand?: string; productCharId?: string; personCharId?: string; music?: boolean;
}): Promise<{ shots: number; templateId: string; hookVariants: number; applied: string[] }> {
  const t = getTemplate(args.templateId);
  if (!t) throw new Error(`Unknown template "${args.templateId}". Use templates to list.`);
  const p = loadProject(ws, projectId);
  const productCharId = args.productCharId || p.characters.find((c) => c.kind === 'product')?.id;
  const personCharId = args.personCharId || p.characters.find((c) => (c.kind || 'person') === 'person')?.id;
  const plan = planFromTemplate(t, { brief: args.brief || p.brief, product: args.product, character: args.character, brand: args.brand || p.brand?.name }, { productCharId, personCharId });
  const ops = [...plan.ops, { op: 'project.update', templateId: t.id, hookVariants: plan.hookVariants || [], audioMode: t.audioMode || 'native' }];
  const { summaries } = await applyOps(ws, projectId, ops as any, 'agent');
  if (args.music !== false && plan.music?.builtin && plan.music.builtin !== 'none') {
    try { await music(ws, projectId, { builtin: plan.music.builtin, volume: plan.music.volume }); } catch { /* music is optional */ }
  }
  return { shots: loadProject(ws, projectId).shots.length, templateId: t.id, hookVariants: plan.hookVariants?.length || 0, applied: summaries };
}

export async function castAdd(ws: string, projectId: string, castId: string): Promise<{ characterId: string }> {
  const m = getCast(ws, castId);
  if (!m) throw new Error(`Cast member "${castId}" not found.`);
  const before = new Set(loadProject(ws, projectId).characters.map((c) => c.id));
  await applyOps(ws, projectId, [castToCharacterOp(m) as any], 'agent');
  const c = loadProject(ws, projectId).characters.find((x) => !before.has(x.id)) || loadProject(ws, projectId).characters.find((x) => x.castId === castId);
  return { characterId: c!.id };
}

export function castSave(ws: string, projectId: string, characterId: string, extra?: { tags?: string[] }) {
  const p = loadProject(ws, projectId);
  const c = p.characters.find((x) => x.id === characterId);
  if (!c) throw new Error(`Character "${characterId}" not found.`);
  if (!c.anchors.length) throw new Error(`${c.name} has no approved anchor yet.`);
  return castFromCharacter(ws, { name: c.name, anchors: c.anchors, refs: c.refs, notes: c.notes, identity: c.identity }, { kind: c.kind || 'person', voice: p.voice, tags: extra?.tags });
}

export async function brandApply(ws: string, projectId: string, brandId: string) {
  const b = getBrand(ws, brandId);
  if (!b) throw new Error(`Brand "${brandId}" not found.`);
  const ops = brandToProjectOps(ws, b) as any[];
  if (b.voice) ops.push({ op: 'voice.set', provider: b.voice.provider, voice: b.voice.voice });
  const { summaries } = await applyOps(ws, projectId, ops, 'agent');
  const p = loadProject(ws, projectId);
  const style = p.styles.find((s) => s.name === `${b.name} brand`);
  if (style) await applyOps(ws, projectId, p.shots.filter((s) => !s.styleId).map((s) => ({ op: 'shot.update', id: s.id, styleId: style.id })).concat() as any[], 'agent').catch(() => undefined);
  return { applied: summaries };
}

export { listTemplates, listCast, listBrands, saveBrand, getCast, getBrand };

// ── autopilot ───────────────────────────────────────────────────────────

const RUN_STEPS = ['plan', 'anchors', 'storyboard', 'voiceover', 'generate', 'qa', 'assemble', 'transcribe', 'captions', 'music', 'render'] as const;
type RunStepName = typeof RUN_STEPS[number];

async function setRun(ws: string, projectId: string, fn: (r: RunState) => void): Promise<RunState> {
  let out!: RunState;
  await mutateProject(ws, projectId, 'run', (p) => {
    const r: RunState = p.lastRun || { id: newId('run'), state: 'running', steps: RUN_STEPS.map((step) => ({ step, state: 'pending' })), startedAt: Date.now() };
    fn(r);
    p.lastRun = r;
    out = JSON.parse(JSON.stringify(r));
  });
  return out;
}

function step(r: RunState, name: string, state: RunStep['state'], note?: string) {
  const s = r.steps.find((x) => x.step === name);
  if (s) { s.state = state; if (note !== undefined) s.note = note; }
}

/** Everything the run will spend from here, so the user approves once. */
export async function planRunCost(ws: string, projectId: string, opts: { storyboard: boolean; qaRerolls: number }): Promise<{ usd: number; breakdown: Array<{ item: string; usd: number }> }> {
  const p = loadProject(ws, projectId);
  const breakdown: Array<{ item: string; usd: number }> = [];
  const img = getModel(p.defaults.imageModel);
  for (const c of p.characters) {
    if (!c.anchors.length && img) breakdown.push({ item: `${c.name} anchor`, usd: estimateCostUsd(img, { count: 1 }) });
  }
  const needBoards = opts.storyboard ? p.shots.filter((s) => !s.storyboard && !s.takes.length && getModel(s.modelId || p.defaults.videoModel)?.kind !== 'image') : [];
  if (needBoards.length && img) breakdown.push({ item: `${needBoards.length} storyboard stills`, usd: +(estimateCostUsd(img, { count: 1 }) * needBoards.length).toFixed(3) });
  const todo = p.shots.filter((s) => !s.takes.length);
  if (todo.length) {
    const est = await estimate(ws, projectId, { shotIds: todo.map((s) => s.id) }).catch(() => null);
    if (est) {
      const stills = est.shots.filter((s) => getModel(s.modelId)?.kind === 'image');
      const vids = est.shots.filter((s) => getModel(s.modelId)?.kind !== 'image');
      if (stills.length) breakdown.push({ item: `${stills.length} still shots (Ken Burns)`, usd: +stills.reduce((a, s) => a + s.usd, 0).toFixed(3) });
      if (vids.length) breakdown.push({ item: `${vids.length} video shots`, usd: +vids.reduce((a, s) => a + s.usd, 0).toFixed(3) });
      if (opts.qaRerolls) breakdown.push({ item: `QA reroll reserve (≤${opts.qaRerolls})`, usd: +(est.total / Math.max(1, todo.length) * opts.qaRerolls).toFixed(3) });
    }
  }
  if (p.audioMode === 'voiceover' && p.shots.some((s) => s.line && !s.voiceover)) breakdown.push({ item: 'Voiceover (TTS)', usd: 0.01 });
  const usd = +breakdown.reduce((a, b) => a + b.usd, 0).toFixed(3);
  return { usd, breakdown };
}

/**
 * Supercomputer mode. Resumable: every step checks the project state and
 * skips what is already done, so the user can approve / pause / edit and
 * call run again. Spends only after ONE approval of the whole-run estimate
 * (unless it fits under auto-approve).
 */
export async function runAutopilot(ws: string, projectId: string, args: {
  approved?: boolean; storyboard?: boolean; autoApproveStoryboard?: boolean; qa?: boolean; maxRerolls?: number; aspects?: string[]; steps?: string[];
  onProgress?: (r: RunState) => void;
} = {}): Promise<{ lastRun: RunState; needsApproval?: { usd: number; breakdown: Array<{ item: string; usd: number }> }; render?: any }> {
  const storyboard = args.storyboard !== false;
  const maxRerolls = Math.max(0, Math.min(3, args.maxRerolls ?? 1));
  const only = args.steps?.length ? new Set(args.steps) : null;
  const want = (s: RunStepName) => !only || only.has(s);
  const p0 = loadProject(ws, projectId);
  if (!p0.shots.length) throw new Error('Nothing to run: plan shots first (apply_template or plan.setShots).');

  const cost = await planRunCost(ws, projectId, { storyboard, qaRerolls: args.qa === false ? 0 : maxRerolls });
  const cap = p0.budget.capUsd;
  if (cap != null && p0.budget.spentUsd + cost.usd > cap + 1e-9) {
    const r = await setRun(ws, projectId, (run) => { run.state = 'needs_approval'; run.needsApproval = cost; run.error = `Budget cap $${cap.toFixed(2)} would be exceeded (spent $${p0.budget.spentUsd.toFixed(2)} + ~$${cost.usd.toFixed(2)}). Raise the cap first.`; });
    return { lastRun: r, needsApproval: cost };
  }
  if (!args.approved && cost.usd > p0.budget.autoApproveUsd + 1e-9) {
    const r = await setRun(ws, projectId, (run) => { run.state = 'needs_approval'; run.needsApproval = cost; step(run, 'plan', 'done'); });
    return { lastRun: r, needsApproval: cost };
  }
  // Fresh run record.
  await mutateProject(ws, projectId, 'run', (p) => {
    p.lastRun = { id: newId('run'), state: 'running', steps: RUN_STEPS.map((s) => ({ step: s, state: 'pending' })), startedAt: Date.now() };
  });
  const progress = async (name: RunStepName, state: RunStep['state'], note?: string) => {
    const r = await setRun(ws, projectId, (run) => step(run, name, state, note));
    args.onProgress?.(r);
  };
  try {
    await progress('plan', 'done', `${p0.shots.length} shots`);

    // Anchors: generate missing identity stills and auto-approve the first (the whole run was approved).
    if (want('anchors')) {
      const missing = loadProject(ws, projectId).characters.filter((c) => !c.anchors.length);
      if (!missing.length) await progress('anchors', 'skipped', 'all characters have anchors');
      else {
        await progress('anchors', 'running');
        for (const c of missing) {
          if (!c.candidates?.length) {
            const prompt = c.anchorPrompt || `${c.kind === 'product' ? 'Studio product photo of' : 'Candid, photorealistic portrait of'} ${c.name}. ${c.notes || ''}`.trim();
            const g = await generateCharacterAnchor(ws, projectId, { characterId: c.id, prompt, approved: true });
            await waitForJobs(ws, projectId, g.jobs.map((j) => j.id), 180_000);
          }
          const cur = loadProject(ws, projectId).characters.find((x) => x.id === c.id);
          if (cur?.candidates?.length) await applyOps(ws, projectId, [{ op: 'character.approveAnchor', id: c.id }], 'agent');
        }
        await progress('anchors', 'done', `${missing.length} anchor(s)`);
      }
    } else await progress('anchors', 'skipped');

    // Storyboard stills -> auto-approve first candidate per shot.
    if (want('storyboard') && storyboard) {
      const pb = loadProject(ws, projectId);
      // Still shots are their own image: no storyboard pass needed.
      const need = pb.shots.filter((s) => !s.storyboard && !s.takes.length && getModel(s.modelId || pb.defaults.videoModel)?.kind !== 'image');
      if (!need.length) await progress('storyboard', 'skipped', 'already boarded');
      else {
        await progress('storyboard', 'running');
        const g = await generateStoryboards(ws, projectId, { shotIds: need.map((s) => s.id), approved: true });
        if (g.jobs.length) await waitForJobs(ws, projectId, g.jobs.map((j) => j.id), 240_000);
        const after = loadProject(ws, projectId);
        const ops = need.map((s) => after.shots.find((x) => x.id === s.id)).filter((s) => s?.storyboardCandidates?.length)
          .map((s) => ({ op: 'shot.approveStoryboard', id: s!.id }));
        if (ops.length && args.autoApproveStoryboard !== false) await applyOps(ws, projectId, ops, 'agent');
        await progress('storyboard', 'done', `${ops.length}/${need.length} stills`);
      }
    } else await progress('storyboard', 'skipped');

    // Voiceover before video so shot lengths fit the lines. Native dialogue
    // skips it: the video model speaks the lines on camera.
    if (loadProject(ws, projectId).audioMode === 'native') await progress('voiceover', 'skipped', 'native dialogue: lines are spoken on camera');
    else if (want('voiceover') && loadProject(ws, projectId).shots.some((s) => s.line?.trim())) {
      await progress('voiceover', 'running');
      // A dead TTS login must not throw away the paid anchors/storyboards: keep going
      // without VO (captions then skip) and say why on the card.
      let v: Awaited<ReturnType<typeof voiceover>> | null = null;
      try { v = await voiceover(ws, projectId, {}); }
      catch (e: any) { await progress('voiceover', 'skipped', `TTS unavailable: ${String(e?.message || e).slice(0, 160)}`); }
      if (v) await progress('voiceover', 'done', `${v.voiced.length} line(s) · ${v.voice}`);
    } else await progress('voiceover', 'skipped', 'no lines');

    // Video.
    if (want('generate')) {
      const todo = loadProject(ws, projectId).shots.filter((s) => !s.takes.length);
      if (!todo.length) await progress('generate', 'skipped', 'every shot has a take');
      else {
        await progress('generate', 'running', `${todo.length} shot(s)`);
        const g = await generateShots(ws, projectId, { shotIds: todo.map((s) => s.id), approved: true });
        if (g.needsApproval) throw new Error(g.reason || 'Generation blocked by the budget cap.');
        const done = await waitForJobs(ws, projectId, g.jobs.map((j) => j.id), 10 * 60_000);
        const failed = done.filter((j) => j.state === 'failed');
        await progress('generate', failed.length === done.length ? 'failed' : 'done', `${done.length - failed.length}/${done.length} ok${failed.length ? ` · ${failed[0].error?.slice(0, 80)}` : ''}`);
        if (failed.length === done.length) throw new Error(`All generations failed: ${failed[0]?.error || 'unknown'}`);
      }
    } else await progress('generate', 'skipped');

    // Vision QA + bounded rerolls.
    if (want('qa') && args.qa !== false) {
      await progress('qa', 'running');
      let rerolls = 0;
      let res = await qa(ws, projectId, {});
      const bad = () => res.results.filter((r) => r.verdict === 'reroll');
      while (bad().length && rerolls < maxRerolls) {
        const target = bad().sort((a, b) => a.score - b.score)[0];
        rerolls += 1;
        const g = await generateShots(ws, projectId, { shotIds: [target.shotId], approved: true });
        if (g.needsApproval) break;
        const jobs = await waitForJobs(ws, projectId, g.jobs.map((j) => j.id), 6 * 60_000);
        const newTakeIds = jobs.flatMap((j) => j.takeIds);
        if (!newTakeIds.length) continue;
        const p = loadProject(ws, projectId);
        const shot = p.shots.find((s) => s.id === target.shotId)!;
        const take = shot.takes.find((t) => t.id === newTakeIds[0])!;
        const verdict = await qaTake(ws, p, shot, take).catch(() => null);
        await mutateProject(ws, projectId, 'qa', (proj) => {
          const t = proj.shots.find((s) => s.id === shot.id)?.takes.find((x) => x.id === take.id);
          if (t && verdict) t.qa = { ...verdict, at: Date.now() };
        });
        if (verdict && verdict.score > target.score) await applyOps(ws, projectId, [{ op: 'take.select', shotId: shot.id, takeId: take.id }], 'agent');
        res = await qa(ws, projectId, {});
      }
      const scores = res.results.map((r) => `${r.title} ${r.score}`).join(', ');
      await progress('qa', res.failed.length && !res.results.length ? 'failed' : 'done', `${scores}${rerolls ? ` · ${rerolls} reroll(s)` : ''}${res.failed.length ? ` · ${res.failed[0]}` : ''}`);
    } else await progress('qa', 'skipped');

    if (want('assemble')) {
      await applyOps(ws, projectId, [{ op: 'timeline.assemble' }], 'agent');
      await progress('assemble', 'done');
    } else await progress('assemble', 'skipped');

    // Native dialogue: hear what the clips actually say (free, local Whisper).
    if (want('transcribe') && loadProject(ws, projectId).audioMode === 'native') {
      await progress('transcribe', 'running');
      try {
        const t = await transcribeTakes(ws, projectId, {});
        const spoken = loadProject(ws, projectId).shots.filter((s) => selectedTake(s)?.transcript?.words.length).length;
        await progress('transcribe', 'done', `${spoken} shot(s) with speech${t.failed.length ? ` · ${t.failed.length} failed` : ''}`);
      } catch (e: any) {
        await progress('transcribe', 'failed', String(e?.message || e).slice(0, 160));
      }
    } else await progress('transcribe', 'skipped');

    const pc = loadProject(ws, projectId);
    const hasSpeech = pc.audioMode === 'native'
      ? pc.shots.some((s) => selectedTake(s)?.transcript?.words.length)
      : pc.shots.some((s) => s.voiceover);
    if (want('captions') && hasSpeech && pc.captions?.enabled !== false) {
      const c = await captions(ws, projectId, { style: pc.captions?.style || 'pop' });
      await progress('captions', 'done', `${c.cues} cues · ${c.style} · from ${pc.audioMode === 'native' ? 'clip audio' : 'voiceover'}`);
    } else await progress('captions', 'skipped', hasSpeech ? undefined : 'no speech to caption');

    if (want('music') && !loadProject(ws, projectId).music) {
      const m = await music(ws, projectId, { builtin: 'pulse' });
      await progress('music', 'done', m.label);
    } else await progress('music', loadProject(ws, projectId).music ? 'done' : 'skipped', loadProject(ws, projectId).music?.label);

    let render: any;
    if (want('render')) {
      await progress('render', 'running');
      render = await renderAll(ws, projectId, { aspects: args.aspects });
      await progress('render', 'done', render.exports.map((e: any) => `${e.aspect} ${e.durationSec}s`).join(', '));
    }
    const r = await setRun(ws, projectId, (run) => { run.state = 'done'; run.finishedAt = Date.now(); run.needsApproval = undefined; });
    return { lastRun: r, render };
  } catch (e: any) {
    const r = await setRun(ws, projectId, (run) => {
      run.state = 'failed'; run.error = String(e?.message || e).slice(0, 500); run.finishedAt = Date.now();
      const cur = run.steps.find((s) => s.state === 'running');
      if (cur) cur.state = 'failed';
    });
    return { lastRun: r };
  }
}

/** One call from a brief: create (or reuse) a project, apply a template, attach product/creator, then run. */
export async function quickstart(ws: string, args: {
  brief: string; templateId?: string; title?: string; productPath?: string; productName?: string; creator?: string; brandId?: string;
  castIds?: string[]; capUsd?: number; aspect?: string; resolution?: string; approved?: boolean; run?: boolean;
}): Promise<any> {
  const templateId = args.templateId || 'ugc-testimonial';
  const t = getTemplate(templateId);
  if (!t) throw new Error(`Unknown template "${templateId}".`);
  const p = await createProject(ws, {
    title: args.title || `${t.name}: ${args.productName || args.brief.slice(0, 40)}`,
    brief: args.brief,
    target: { aspect: args.aspect || t.aspect, resolution: args.resolution || '480p', fps: 30, durationSec: t.durationSec } as any,
    budget: { capUsd: args.capUsd ?? 5, autoApproveUsd: 0 } as any,
  } as any);
  const id = p.id;
  if (args.brandId) await brandApply(ws, id, args.brandId);
  for (const cid of args.castIds || []) await castAdd(ws, id, cid);
  let productCharId: string | undefined;
  if (args.productPath) productCharId = (await importAsset(ws, id, { path: args.productPath, role: 'product', name: args.productName || 'Product' })).characterId;
  let personCharId = loadProject(ws, id).characters.find((c) => (c.kind || 'person') === 'person')?.id;
  if (!personCharId && t.needs.character) {
    const creator = args.creator || 'a relatable 20-something social media creator, natural makeup, casual hoodie, warm friendly face';
    const { project } = await applyOps(ws, id, [{ op: 'character.upsert', name: 'Creator', kind: 'person', notes: creator, anchorPrompt: `Candid smartphone selfie-style photo of ${creator}, natural light, photorealistic, looking at camera` }], 'agent');
    personCharId = project.characters.find((c) => c.name === 'Creator')?.id;
  }
  await applyTemplate(ws, id, { templateId, product: args.productName, character: undefined, brief: args.brief, productCharId, personCharId });
  const summary = loadProject(ws, id);
  if (args.run === false) return { projectId: id, shots: summary.shots.length, chatCard: `\`\`\`video-project\n{"projectId":"${id}"}\n\`\`\`` };
  const run = await runAutopilot(ws, id, { approved: args.approved });
  return { projectId: id, ...run, chatCard: `\`\`\`video-project\n{"projectId":"${id}"}\n\`\`\`` };
}
