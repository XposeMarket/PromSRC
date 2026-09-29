/**
 * Higgsfield-parity actions on top of the engine: recast / motion transfer /
 * element swap, lip-sync, talking photo, draw-to-video, upscale, foley,
 * faceless long-form and batch UGC variants. Every paid path goes through
 * the normal cost gate (generateShots / planRunCost).
 */
import { estimateCostUsd, getModel } from './catalog.js';
import { estimate, generateShots, generateStoryboards, mediaDurationSec, waitForJobs, type GenerateResult } from './engine.js';
import { getPreset } from './presets.js';
import { getProviderKey, providerKeyHint } from './providers.js';
import {
  applyOps, createProject, fromWorkspaceRel, loadProject, mutateProject, newId, selectedTake, type Shot,
} from './project.js';
import { importAsset, music, planRunCost } from './studio.js';

export const DEFAULT_MODELS = {
  recastEdit: 'xai/grok-imagine-video-1.5-edit',
  recastMotion: 'fal/wan-vace-pose',
  recastSwap: 'fal/kling-o1-edit',
  lipsync: 'fal/sync-lipsync-v2',
  talkingPhoto: 'fal/omnihuman-v1.5',
  upscale: 'fal/topaz-upscale-video',
  foley: 'fal/mmaudio-v2',
};

function requireModel(id: string) {
  const m = getModel(id);
  if (!m) throw new Error(`Unknown model "${id}". Use action models to list the catalog.`);
  if ((m.provider === 'fal' || m.provider === 'higgsfield') && !getProviderKey(m.provider)) {
    throw new Error(`${m.label} needs a ${m.provider} API key. ${providerKeyHint(m.provider)}`);
  }
  return m;
}

async function addShot(ws: string, projectId: string, fields: Partial<Shot> & Record<string, unknown>): Promise<string> {
  const before = new Set(loadProject(ws, projectId).shots.map((s) => s.id));
  await applyOps(ws, projectId, [{ op: 'shot.add', ...fields } as any], 'agent');
  const s = loadProject(ws, projectId).shots.find((x) => !before.has(x.id));
  if (!s) throw new Error('Could not add the shot.');
  return s.id;
}

async function sourceDuration(ws: string, projectId: string, ref: string): Promise<number> {
  const p = loadProject(ws, projectId);
  const m = ref.match(/^(shot_[a-z0-9_-]+)(?::(take_[a-z0-9_-]+))?$/i);
  let rel = ref;
  if (m) {
    const s = p.shots.find((x) => x.id === m[1]);
    const t = s && (m[2] ? s.takes.find((x) => x.id === m[2]) : selectedTake(s));
    if (!t) throw new Error(`"${ref}" has no take yet.`);
    if (t.durationSec) return t.durationSec;
    rel = t.path;
  }
  if (/^(https?:|data:)/i.test(rel)) return 5;
  const abs = fromWorkspaceRel(ws, rel);
  return (await mediaDurationSec(abs)) || 5;
}

// ── recast ─────────────────────────────────────────────────────────────

export async function recast(ws: string, projectId: string, args: {
  sourcePath?: string; shotId?: string; takeId?: string; prompt: string; characterId?: string;
  mode?: 'edit' | 'motion' | 'swap'; modelId?: string; approved?: boolean;
}): Promise<GenerateResult & { shotId: string; modelId: string }> {
  const mode = args.mode || 'edit';
  const source = args.sourcePath || (args.shotId ? (args.takeId ? `${args.shotId}:${args.takeId}` : args.shotId) : '');
  if (!source) throw new Error('recast needs sourcePath (workspace video, e.g. from import_asset role footage) or shotId(+takeId).');
  const modelId = args.modelId || (mode === 'motion' ? DEFAULT_MODELS.recastMotion : mode === 'swap' ? DEFAULT_MODELS.recastSwap : DEFAULT_MODELS.recastEdit);
  requireModel(modelId);
  if ((mode === 'motion' || mode === 'swap') && !args.characterId) throw new Error(`recast mode ${mode} needs characterId (the new character/element; its anchor is sent as the reference image).`);
  if (args.characterId && !loadProject(ws, projectId).characters.some((c) => c.id === args.characterId)) throw new Error(`Character "${args.characterId}" not found.`);
  const dur = Math.max(1, Math.min(60, Math.round(await sourceDuration(ws, projectId, source))));
  const shotId = await addShot(ws, projectId, {
    title: `Recast (${mode})`, prompt: String(args.prompt || ''), sourceVideo: source, modelId, durationSec: dur,
    characterIds: args.characterId ? [args.characterId] : [], anchorMode: 'reference',
  });
  const r = await generateShots(ws, projectId, { shotIds: [shotId], approved: args.approved === true });
  return { ...r, shotId, modelId };
}

// ── lip-sync / talking photo ───────────────────────────────────────────

export async function lipsync(ws: string, projectId: string, args: {
  shotId?: string; sourcePath?: string; audioPath?: string; line?: string; modelId?: string; approved?: boolean;
}): Promise<GenerateResult & { shotId: string; modelId: string }> {
  const modelId = args.modelId || DEFAULT_MODELS.lipsync;
  requireModel(modelId);
  if (!args.audioPath && !args.line?.trim()) {
    const s = args.shotId ? loadProject(ws, projectId).shots.find((x) => x.id === args.shotId) : undefined;
    if (!s?.audio && !s?.line?.trim()) throw new Error('lipsync needs audioPath or line (the line is voiced with the project voice).');
  }
  if (args.shotId) {
    const p = loadProject(ws, projectId);
    const shot = p.shots.find((s) => s.id === args.shotId);
    if (!shot) throw new Error(`Shot "${args.shotId}" not found.`);
    if (selectedTake(shot)?.kind !== 'video') throw new Error(`${shot.title} has no video take to lip-sync. Generate it first or pass sourcePath.`);
    const upd: any = { op: 'shot.update', id: shot.id };
    if (args.audioPath) upd.audio = args.audioPath;
    if (args.line?.trim()) { upd.line = args.line.trim(); if (!args.audioPath) upd.audio = ''; }
    await applyOps(ws, projectId, [upd], 'agent');
    if (upd.audio === '') await mutateProject(ws, projectId, 'lipsync', (proj) => { const s = proj.shots.find((x) => x.id === shot.id); if (s) delete s.audio; });
    const r = await generateShots(ws, projectId, { shotIds: [shot.id], modelId, sourceFromSelectedTake: true, selectNew: true, approved: args.approved === true });
    return { ...r, shotId: shot.id, modelId };
  }
  if (!args.sourcePath) throw new Error('lipsync needs shotId (with a video take) or sourcePath (workspace video).');
  const dur = Math.max(1, Math.min(60, Math.round(await sourceDuration(ws, projectId, args.sourcePath))));
  const shotId = await addShot(ws, projectId, {
    title: 'Lip-sync', prompt: '', sourceVideo: args.sourcePath, audio: args.audioPath, line: args.line?.trim(), modelId, durationSec: dur,
  });
  const r = await generateShots(ws, projectId, { shotIds: [shotId], approved: args.approved === true });
  return { ...r, shotId, modelId };
}

export async function talkingPhoto(ws: string, projectId: string, args: {
  imagePath?: string; characterId?: string; line?: string; audioPath?: string; prompt?: string; modelId?: string; approved?: boolean;
}): Promise<GenerateResult & { shotId: string; modelId: string }> {
  const modelId = args.modelId || DEFAULT_MODELS.talkingPhoto;
  requireModel(modelId);
  if (!args.imagePath && !args.characterId) throw new Error('talking_photo needs imagePath (a portrait) or characterId (uses its anchor).');
  if (!args.line?.trim() && !args.audioPath) throw new Error('talking_photo needs line (auto-voiced) or audioPath.');
  const words = (args.line || '').trim().split(/\s+/).filter(Boolean).length;
  const shotId = await addShot(ws, projectId, {
    title: 'Talking photo', prompt: args.prompt || 'The person talks naturally to camera with subtle head movement and expressive face.',
    startImage: args.imagePath, characterIds: args.characterId ? [args.characterId] : [], anchorMode: 'start',
    line: args.line?.trim(), audio: args.audioPath, modelId, durationSec: Math.max(2, Math.min(30, Math.ceil(words / 2.6) || 5)),
  });
  const r = await generateShots(ws, projectId, { shotIds: [shotId], approved: args.approved === true });
  return { ...r, shotId, modelId };
}

// ── draw-to-video ──────────────────────────────────────────────────────

export async function drawToVideo(ws: string, projectId: string, args: {
  sketchPath?: string; dataBase64?: string; prompt: string; modelId?: string; approved?: boolean; durationSec?: number;
}): Promise<any> {
  if (!args.sketchPath && !args.dataBase64) throw new Error('draw_to_video needs sketchPath or dataBase64 (PNG).');
  const imp = await importAsset(ws, projectId, { path: args.sketchPath, dataBase64: args.dataBase64, filename: 'sketch.png', role: 'sketch' });
  const p = loadProject(ws, projectId);
  const shotId = await addShot(ws, projectId, {
    title: 'Sketch', prompt: String(args.prompt || 'Bring this scene to life'), sketch: imp.assetPath,
    modelId: args.modelId, durationSec: Math.max(1, Math.min(15, Number(args.durationSec) || 5)),
  });
  // Whole-flow cost gate: still + video, approved once.
  const img = getModel(p.defaults.imageModel);
  const imgUsd = img ? estimateCostUsd(img, { count: 1 }) : 0;
  const est = await estimate(ws, projectId, { shotIds: [shotId] });
  const total = +(imgUsd + est.total).toFixed(3);
  const cap = p.budget.capUsd;
  const breakdown = [{ item: 'Sketch -> clean frame', usd: imgUsd }, { item: 'Animate frame', usd: est.total }];
  if (cap != null && p.budget.spentUsd + total > cap + 1e-9) return { needsApproval: true, shotId, sketch: imp.assetPath, estimateUsd: total, breakdown, reason: `Budget cap $${cap.toFixed(2)} would be exceeded.` };
  if (!args.approved && total > p.budget.autoApproveUsd + 1e-9) return { needsApproval: true, shotId, sketch: imp.assetPath, estimateUsd: total, breakdown, next: 'Confirm the cost, then call draw_to_video again with approved:true (or generate this shot).' };
  const sb = await generateStoryboards(ws, projectId, { shotIds: [shotId], approved: true });
  if (sb.jobs.length) await waitForJobs(ws, projectId, sb.jobs.map((j) => j.id), 180_000);
  const after = loadProject(ws, projectId).shots.find((s) => s.id === shotId);
  if (!after?.storyboardCandidates?.length) throw new Error('Sketch cleanup produced no frame (check the image model / provider).');
  await applyOps(ws, projectId, [{ op: 'shot.approveStoryboard', id: shotId }], 'agent');
  const g = await generateShots(ws, projectId, { shotIds: [shotId], approved: true });
  return { ...g, shotId, sketch: imp.assetPath, storyboard: loadProject(ws, projectId).shots.find((s) => s.id === shotId)?.storyboard };
}

// ── post passes: upscale / foley ───────────────────────────────────────

function videoShots(ws: string, projectId: string, shotIds?: string[]): string[] {
  const p = loadProject(ws, projectId);
  const ids = p.shots.filter((s) => (!shotIds?.length || shotIds.includes(s.id)) && selectedTake(s)?.kind === 'video').map((s) => s.id);
  if (!ids.length) throw new Error('No selected video takes to process. Generate the shots first.');
  return ids;
}

export async function upscale(ws: string, projectId: string, args: { shotIds?: string[]; factor?: number; modelId?: string; approved?: boolean }): Promise<GenerateResult> {
  const modelId = args.modelId || DEFAULT_MODELS.upscale;
  requireModel(modelId);
  const factor = Math.max(1, Math.min(4, Number(args.factor) || 2));
  return generateShots(ws, projectId, { shotIds: videoShots(ws, projectId, args.shotIds), modelId, sourceFromSelectedTake: true, selectNew: true, extra: { upscale_factor: factor }, approved: args.approved === true });
}

export async function foley(ws: string, projectId: string, args: { shotIds?: string[]; prompt?: string; modelId?: string; approved?: boolean }): Promise<GenerateResult> {
  const modelId = args.modelId || DEFAULT_MODELS.foley;
  requireModel(modelId);
  const prompt = args.prompt?.trim() || 'Realistic foley and ambient sound effects matching the action: {shot}';
  return generateShots(ws, projectId, { shotIds: videoShots(ws, projectId, args.shotIds), modelId, sourceFromSelectedTake: true, selectNew: true, rawPrompt: prompt, approved: args.approved === true });
}

// ── faceless long-form ─────────────────────────────────────────────────

const FACELESS_STYLE: Record<string, { name: string; suffix: string; presetId?: string }> = {
  documentary: { name: 'Documentary', suffix: 'documentary photography, natural light, realistic, cinematic composition', presetId: 'film-35mm' },
  '2d-animated': { name: '2D animated', suffix: 'flat 2D animated illustration, clean shapes, bold colors', presetId: 'anime-cel' },
  'stock-cinematic': { name: 'Stock cinematic', suffix: 'premium cinematic stock footage look, shallow depth of field', presetId: 'golden-hour' },
  whiteboard: { name: 'Whiteboard', suffix: 'hand-drawn black marker whiteboard illustration on white background, simple sketch lines' },
  history: { name: 'History', suffix: 'historical painting and archival photo look, aged texture, museum lighting', presetId: 'film-35mm' },
};

const BEATS = ['Hook', 'Background', 'The key idea', 'A closer look', 'Turning point', 'Evidence', 'Consequences', 'The twist', 'What it means', 'Takeaway'];

export async function faceless(ws: string, args: {
  projectId?: string; topic: string; minutes?: number; style?: string; videoEvery?: number;
  script?: Array<{ line: string; visual?: string }>; imageModel?: string; videoModel?: string; resolution?: string; capUsd?: number;
}): Promise<{ projectId: string; shots: number; stills: number; videos: number; cost: { usd: number; breakdown: Array<{ item: string; usd: number }> }; needsApproval: boolean; chatCard: string }> {
  const topic = String(args.topic || '').trim();
  if (!topic) throw new Error('faceless needs topic.');
  const minutes = Math.max(1, Math.min(15, Number(args.minutes) || 3));
  const style = FACELESS_STYLE[args.style || 'documentary'] || FACELESS_STYLE.documentary;
  const videoEvery = Math.max(0, Math.floor(Number(args.videoEvery ?? 4)));
  let pid = args.projectId;
  if (!pid) {
    const p = await createProject(ws, {
      title: `Faceless: ${topic.slice(0, 60)}`, brief: topic,
      target: { aspect: '16:9', resolution: args.resolution || '720p', fps: 30, durationSec: minutes * 60 } as any,
      budget: { capUsd: args.capUsd ?? 10, autoApproveUsd: 1 } as any,
    });
    pid = p.id;
  }
  const p = loadProject(ws, pid);
  const imageModel = args.imageModel || p.defaults.imageModel;
  const videoModel = args.videoModel || p.defaults.videoModel;
  const script = Array.isArray(args.script) && args.script.length
    ? args.script.filter((b) => String(b?.line || '').trim()).slice(0, 40)
    : null;
  const n = script ? script.length : Math.max(8, Math.min(40, Math.round((minutes * 60) / 25)));
  const segSec = Math.max(3, Math.min(60, Math.round((minutes * 60) / n)));
  const styleId = 'style_faceless';
  const shots = Array.from({ length: n }, (_, i) => {
    const isVideo = videoEvery > 0 && i % videoEvery === videoEvery - 1;
    const beat = BEATS[i % BEATS.length];
    const line = script ? String(script[i].line).trim() : `${beat}: ${topic}.`;
    const visual = script?.[i].visual ? String(script[i].visual) : `${beat} of ${topic}, illustrative scene`;
    return {
      title: `${i + 1}. ${beat}`, prompt: visual, line, styleId,
      modelId: isVideo ? videoModel : imageModel, kenBurns: !isVideo,
      durationSec: isVideo ? Math.min(segSec, 10) : segSec,
      presetId: style.presetId,
    };
  });
  await applyOps(ws, pid, [
    { op: 'project.update', target: { aspect: '16:9', durationSec: minutes * 60 }, templateId: 'faceless-youtube', audioMode: 'voiceover' },
    { op: 'style.upsert', id: styleId, name: style.name, promptSuffix: style.suffix },
    { op: 'plan.setShots', shots },
    { op: 'captions.set', enabled: true, style: 'bold' },
    { op: 'voice.set', provider: 'openai', voice: 'onyx' },
  ] as any, 'agent');
  try { await music(ws, pid, { builtin: 'chill', volume: 0.12 }); } catch { /* optional */ }
  const cost = await planRunCost(ws, pid, { storyboard: false, qaRerolls: 0 });
  const after = loadProject(ws, pid);
  const stills = shots.filter((s) => s.kenBurns).length;
  return {
    projectId: pid, shots: n, stills, videos: n - stills, cost,
    needsApproval: cost.usd > after.budget.autoApproveUsd + 1e-9,
    chatCard: `\`\`\`video-project\n{"projectId":"${pid}"}\n\`\`\``,
  };
}

// ── batch UGC variants ─────────────────────────────────────────────────

export const VARIANT_LISTS = {
  hook: [
    'Okay, I need to talk about {product}.',
    'Stop scrolling if you have not tried {product} yet.',
    'I did not believe the hype about {product} until this.',
    'POV: you finally found {product}.',
    'Three reasons I switched to {product}.',
    'Why did nobody tell me about {product} sooner?',
    'This is your sign to try {product}.',
    'I was today years old when I found {product}.',
    'Unpopular opinion: {product} is worth it.',
    'Here is what happened after a week of {product}.',
  ],
  creator: [
    'a gym guy in his 20s, athletic tank top, energetic',
    'a college girl, casual hoodie, dorm-room vibe',
    'a busy mom in her 30s, cozy sweater, warm smile',
    'an office worker in a button-down shirt, lanyard',
    'a skater teen with a beanie and a skateboard',
    'a retired grandpa with a friendly grin, cardigan',
    'a nurse in scrubs just off shift',
    'a gamer with headphones around the neck',
    'a yoga instructor in athleisure, calm energy',
    'a construction worker in a hi-vis vest',
  ],
  setting: [
    'in a parked car', 'in a bright kitchen', 'at the gym', 'in a college dorm', 'on a city sidewalk',
    'at an office desk', 'in a cozy living room', 'at a skate park', 'on a beach boardwalk', 'in a coffee shop',
  ],
  cta: [
    'Link in bio, grab yours.', 'Try it today, you will thank me.', 'Tap the link before it sells out.',
    'Use my code for 20% off.', 'Go get it, seriously.', 'Comment "link" and I will send it.',
    'Add it to your cart right now.', 'Follow for part two.', 'Trust me, just try it.', 'Run, do not walk.',
  ],
};

export type VaryField = keyof typeof VARIANT_LISTS;

export async function batchVariants(ws: string, projectId: string, args: { count?: number; vary?: string[] }): Promise<{
  sourceId: string; projects: Array<{ projectId: string; variant: Record<string, string>; usd: number; chatCard: string }>; totalUsd: number; needsApproval: boolean;
}> {
  const src = loadProject(ws, projectId);
  if (!src.shots.length) throw new Error('batch_variants needs a planned project (shots) to clone.');
  const count = Math.max(2, Math.min(20, Math.floor(Number(args.count) || 3)));
  const vary = (args.vary?.length ? args.vary : ['hook', 'creator']).filter((v): v is VaryField => v in VARIANT_LISTS);
  if (!vary.length) throw new Error('batch_variants vary must include hook, creator, setting and/or cta.');
  const productName = src.characters.find((c) => c.kind === 'product')?.name || 'this';
  const out: Array<{ projectId: string; variant: Record<string, string>; usd: number; chatCard: string }> = [];
  for (let i = 0; i < count; i++) {
    const variant: Record<string, string> = {};
    for (const f of vary) variant[f] = VARIANT_LISTS[f][i % VARIANT_LISTS[f].length].replace(/\{product\}/g, productName);
    const np = await createProject(ws, {
      title: `${src.title} · V${i + 1}`, brief: src.brief, target: src.target, defaults: src.defaults,
      budget: { capUsd: src.budget.capUsd, autoApproveUsd: src.budget.autoApproveUsd } as any,
    });
    await mutateProject(ws, np.id, 'variant.clone', (proj) => {
      const clone = JSON.parse(JSON.stringify(src));
      proj.characters = clone.characters;
      proj.styles = clone.styles;
      proj.voice = clone.voice;
      proj.audioMode = clone.audioMode;
      proj.captions = clone.captions ? { ...clone.captions, cues: [] } : undefined;
      proj.music = clone.music;
      proj.brand = clone.brand;
      proj.templateId = clone.templateId;
      proj.hookVariants = clone.hookVariants;
      const visualChange = !!(variant.creator || variant.setting);
      proj.shots = clone.shots.map((s: Shot) => ({
        ...s, id: newId('shot'), takes: [], selectedTakeId: undefined, status: 'draft', voiceover: undefined,
        storyboard: visualChange ? undefined : s.storyboard, storyboardCandidates: [],
        prompt: variant.setting ? `${s.prompt.replace(/\s*Setting: [^.]*\.$/, '')} Setting: ${variant.setting}.` : s.prompt,
      }));
      if (variant.hook && proj.shots[0]) proj.shots[0].line = variant.hook;
      if (variant.cta && proj.shots.length > 1) proj.shots[proj.shots.length - 1].line = variant.cta;
      if (variant.creator) {
        for (const c of proj.characters) {
          if ((c.kind || 'person') !== 'person') continue;
          c.notes = variant.creator; c.anchors = []; c.candidates = []; c.castId = undefined; c.identity = undefined;
          c.anchorPrompt = `Candid smartphone selfie-style photo of ${variant.creator}, natural light, photorealistic, looking at camera`;
        }
      }
    });
    const cost = await planRunCost(ws, np.id, { storyboard: true, qaRerolls: 1 });
    out.push({ projectId: np.id, variant, usd: cost.usd, chatCard: `\`\`\`video-project\n{"projectId":"${np.id}"}\n\`\`\`` });
  }
  const totalUsd = +out.reduce((a, b) => a + b.usd, 0).toFixed(3);
  return { sourceId: projectId, projects: out, totalUsd, needsApproval: totalUsd > src.budget.autoApproveUsd + 1e-9 };
}

export { getPreset };
