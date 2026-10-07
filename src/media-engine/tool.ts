/**
 * video_project — Prom's single control surface for the generative video
 * engine. Every edit goes through project ops (undoable, shared with the UI).
 */
import {
  getModel, importModelManifests, listModels, removeUserManifest, saveUserManifest, type MediaModelManifest,
} from './catalog.js';
import { providerKeyHint, providerStatus, setProviderKey } from './providers.js';
import { liveFalPrice, syncFalModels } from './fal-catalog.js';
import {
  applyOps, createProject, deleteProject, historyDepth, listProjects, loadProject, OP_NAMES,
  summarizeProject, undoRedo,
} from './project.js';
import {
  cancelJob, estimate, generateCharacterAnchor, generateShots, generateStoryboards, renderFrame, renderProject, resumeJobs, waitForJobs,
} from './engine.js';
import * as studio from './studio.js';
import * as parity from './parity.js';
import * as trend from './trend.js';
import { listPresets } from './presets.js';
import { deleteBrand, deleteCast, saveCast } from './library.js';

export const VIDEO_PROJECT_ACTIONS = [
  'help', 'list', 'create', 'get', 'delete', 'apply_ops', 'undo', 'redo',
  'models', 'syncModels', 'import_models', 'add_model', 'remove_model', 'providers', 'set_key',
  'estimate', 'generate', 'generate_anchor', 'jobs', 'wait', 'cancel_job', 'render', 'frame',
  // studio
  'quickstart', 'templates', 'apply_template', 'import_asset', 'storyboard', 'voiceover', 'captions', 'music', 'music_beds',
  'qa', 'hooks', 'render_variants', 'upgrade', 'route', 'run', 'run_cost', 'watch', 'transcribe',
  'cast_list', 'cast_save', 'cast_add', 'cast_delete', 'brand_list', 'brand_save', 'brand_apply', 'brand_delete',
  // parity
  'presets', 'recast', 'lipsync', 'talking_photo', 'draw_to_video', 'upscale', 'foley', 'faceless', 'batch_variants',
  // trend transfer + finishing
  'trend_transfer', 'trend_assemble', 'phone_finish',
] as const;

export const VIDEO_PROJECT_READ_ACTIONS = new Set(['help', 'list', 'get', 'models', 'syncModels', 'providers', 'estimate', 'jobs', 'wait', 'frame', 'templates', 'music_beds', 'run_cost', 'cast_list', 'brand_list', 'presets']);
/** Actions that can spend money with an external provider. */
export const VIDEO_PROJECT_PAID_ACTIONS = new Set(['generate', 'generate_anchor', 'storyboard', 'voiceover', 'qa', 'hooks', 'upgrade', 'run', 'quickstart', 'recast', 'lipsync', 'talking_photo', 'draw_to_video', 'upscale', 'foley', 'faceless', 'batch_variants', 'trend_transfer']);

export function getVideoProjectToolDef(): any {
  return {
    type: 'function',
    function: {
      name: 'video_project',
      description: [
        'Generative video projects (Higgsfield/CapCut-style): brief -> characters/styles -> shot list -> generated takes -> layered timeline -> MP4.',
        'Server-owned project; works without the editor open. All edits are ops (one undo step per apply_ops call, shared with the user).',
        'Providers: xAI Grok Imagine (video 1.5, image 2.0), OpenAI images, fal (Kling/Seedance/Veo/Wan/FLUX), Higgsfield (Soul, Kling, Hailuo). Models are catalog manifests; import more with import_models.',
        'Flow: create -> apply_ops plan.setShots (+character.upsert) -> generate_anchor (optional identity still) -> estimate -> generate (needs approved:true above the auto-approve limit; confirm cost with the user first) -> wait -> apply_ops timeline.assemble / take.select / clip.trim -> render.',
        'Anchors from generate_anchor arrive as character candidates; the user approves one (character.approveAnchor) before it drives identity. Shot anchorMode "start" uses the anchor as the first frame, "reference" as reference images.',
        'CHAT CARD: put the project\'s chatCard fence (```video-project\n{"projectId":"vp_..."}\n```) in your reply once per project. It renders a live card in chat (desktop + phone) with anchor approve/reroll, shot list, cost + Approve & generate, takes, redo, and Render/final video, so the user never has to leave chat.',
        'SUPERCOMPUTER MODE: quickstart {brief, templateId?, productPath? (a chat upload like uploads/can.png), productName?, capUsd?} creates the project, imports the product photo, applies a template (ugc-testimonial, product-demo, cinematic-trailer, explainer, before-after, local-business-promo) and runs the autopilot: anchors -> storyboard stills -> voiceover -> video -> vision QA (+rerolls) -> assemble -> captions -> music -> render. It returns needsApproval with a whole-run cost breakdown first; show it, get ONE yes, then call run {projectId, approved:true}. run is resumable and skips finished steps.',
        'Studio actions: import_asset (product/character photo), apply_template, storyboard (cheap stills per shot, approve with shot.approveStoryboard), voiceover (shot.line -> TTS VO track; voice.set op picks openai/xai voice), captions {style: pop|bold|minimal|karaoke}, music {builtin: pulse|chill|hype}, qa (vision score per take), hooks (A/B hook takes) + render_variants, render {aspects:["9:16","1:1","16:9"]}, upgrade (re-generate picked shots at 720p/1080p), route (smart model per shot), cast_*/brand_* (persistent cast + brand kits across projects).',
        'ASYNC: long generations do not need you to wait. generate/storyboard/run/hooks accept notify:true (default for run): Prometheus wakes this chat with a [video_project wake] message when the jobs settle, so end your turn after kicking them off.',
        'PARITY: presets {group?} lists camera/vfx/look presets (set shot.presetId via shot.update). recast {sourcePath|shotId, prompt, mode: edit(xAI, no fal key)|motion|swap, characterId?} restyles footage (import_asset role footage first). lipsync {shotId|sourcePath, audioPath|line} and talking_photo {imagePath|characterId, line|audioPath} need fal. draw_to_video {sketchPath|dataBase64, prompt}: sketch -> clean frame -> video. upscale {shotIds?, factor?} and foley {shotIds?, prompt?} add a new selected take. faceless {topic, minutes, style, videoEvery?, script?:[{line,visual}]} plans a 16:9 narrated long-form (Ken Burns stills + video beats) then run. batch_variants {projectId, count, vary:[hook,creator,setting,cta], approved?} clones N projects; show each chatCard.',
        'Call action "help" for the op reference.',
      ].join(' '),
      parameters: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: [...VIDEO_PROJECT_ACTIONS] },
          projectId: { type: 'string', description: 'Project id (vp_...). Required for project actions.' },
          title: { type: 'string' },
          brief: { type: 'string' },
          target: { type: 'object', description: '{ aspect:"16:9"|"9:16"|"1:1", resolution:"480p"|"720p"|"1080p", fps, durationSec }' },
          defaults: { type: 'object', description: '{ videoModel, imageModel } catalog ids' },
          budget: { type: 'object', description: '{ capUsd, autoApproveUsd } (default auto-approve $0: every paid run needs approved:true after the user confirms the quote)' },
          ops: { type: 'array', items: { type: 'object' }, description: 'For apply_ops: [{op:"shot.update", id, prompt}, ...]. Applied atomically as one undo step.' },
          shotIds: { type: 'array', items: { type: 'string' }, description: 'For estimate/generate. Default: all shots.' },
          count: { type: 'integer', minimum: 1, maximum: 4, description: 'Takes (variations) per shot.' },
          modelId: { type: 'string', description: 'Override the model for this estimate/generate (catalog id, e.g. fal/kling-v2.1-master-i2v).' },
          approved: { type: 'boolean', description: 'Set only after the user approved the quoted cost.' },
          characterId: { type: 'string', description: 'For generate_anchor.' },
          prompt: { type: 'string', description: 'For generate_anchor.' },
          referenceImages: { type: 'array', items: { type: 'string' }, description: 'For generate_anchor: workspace paths/URLs.' },
          jobIds: { type: 'array', items: { type: 'string' } },
          jobId: { type: 'string' },
          timeoutMs: { type: 'integer', description: 'For wait (max 600000).' },
          pendingShotId: { type: 'string', description: 'recast/lipsync/talking_photo/draw_to_video: the shotId returned by a needsApproval response; pass it with approved:true so the approved retry reuses that shot instead of creating a duplicate.' },
          kind: { type: 'string', enum: ['video', 'image'], description: 'models filter' },
          provider: { type: 'string', enum: ['xai', 'openai', 'fal', 'higgsfield'], description: 'models filter / import_models / set_key provider' },
          endpoint: { type: 'string', description: 'import_models: fal endpoint id or Higgsfield path (omit for all Higgsfield models).' },
          manifest: { type: 'object', description: 'add_model: full model manifest.' },
          apiKey: { type: 'string', description: 'set_key: provider API key (stored in the vault). Only when the user pastes it.' },
          output: { type: 'string', description: 'render: workspace-relative output path (.mp4).' },
          atSec: { type: 'number', description: 'frame: timeline time in seconds.' },
          templateId: { type: 'string', description: 'quickstart/apply_template: template id (see templates).' },
          productPath: { type: 'string', description: 'quickstart: workspace path of the product photo (e.g. uploads/can.png).' },
          productName: { type: 'string' },
          creator: { type: 'string', description: 'quickstart: description of the on-camera creator.' },
          capUsd: { type: 'number', description: 'quickstart: project budget cap in USD (default 5).' },
          path: { type: 'string', description: 'import_asset: workspace file; music: custom audio path.' },
          dataBase64: { type: 'string', description: 'import_asset: base64 file data (UI uploads).' },
          filename: { type: 'string' },
          role: { type: 'string', enum: ['product', 'character', 'asset', 'footage', 'sketch'], description: 'import_asset role (footage = video to recast/lipsync).' },
          name: { type: 'string' },
          notes: { type: 'string' },
          style: { type: 'string', description: 'captions style pop|bold|minimal|karaoke; faceless style documentary|2d-animated|stock-cinematic|whiteboard|history.' },
          audioMode: { type: 'string', enum: ['native', 'voiceover'], description: 'quickstart/project audio: native = the on-screen creator speaks each shot.line (captions transcribed from the clip audio, no TTS); voiceover = TTS narrator track, clips prompted dialogue-free. UGC/before-after default to native.' },
          builtin: { type: 'string', enum: ['pulse', 'chill', 'hype'], description: 'music: generated bed.' },
          volume: { type: 'number' },
          aspects: { type: 'array', items: { type: 'string' }, description: 'render: one export per aspect, e.g. ["9:16","1:1","16:9"].' },
          aspect: { type: 'string' },
          shotId: { type: 'string' },
          prompts: { type: 'array', items: { type: 'string' }, description: 'hooks: alternative hook prompts.' },
          resolution: { type: 'string', enum: ['480p', '720p', '1080p'], description: 'upgrade target resolution.' },
          quality: { type: 'string', enum: ['draft', 'premium'], description: 'route.' },
          storyboard: { type: 'boolean', description: 'run: generate storyboard stills first (default true).' },
          qa: { type: 'boolean', description: 'run: vision QA + rerolls (default true).' },
          maxRerolls: { type: 'integer' },
          steps: { type: 'array', items: { type: 'string' }, description: 'run: limit to these steps.' },
          notify: { type: 'boolean', description: 'Wake this chat when the started jobs finish (default true for run/quickstart).' },
          anchors: { type: 'array', items: { type: 'string' }, description: 'cast_save (standalone): approved face/identity image paths' },
          refs: { type: 'array', items: { type: 'string' }, description: 'cast_save (standalone): asset-pack images (turnaround, expressions, outfits)' },
          voice: { type: 'object', description: 'cast_save: { provider, voice }' },
          cuts: { type: 'array', items: { type: 'number' }, description: 'trend_transfer: cut points in seconds (outfit/scene changes). Omit to auto-detect.' },
          looks: { type: 'array', items: { type: 'string' }, description: 'trend_transfer: outfit/look per part for the matched start frames' },
          startImages: { type: 'array', items: { type: 'string' }, description: 'trend_transfer: pre-made start frames per part (skips frame generation)' },
          maxParts: { type: 'number' },
          audioStartSec: { type: 'number' },
          phoneLook: { type: 'boolean', description: 'trend_assemble: also write a phone-look finished copy (default true)' },
          strength: { type: 'string', enum: ['light', 'medium', 'strong'], description: 'phone_finish strength' },
          castId: { type: 'string' },
          brandId: { type: 'string' },
          castIds: { type: 'array', items: { type: 'string' } },
          brand: { type: 'object', description: 'brand_save: {name, logo?, colors?, tone?, promptSuffix?, tagline?, cta?, castIds?, productIds?, watermark?, voice?}.' },
          tags: { type: 'array', items: { type: 'string' } },
          group: { type: 'string', enum: ['camera', 'vfx', 'look'], description: 'presets filter.' },
          sourcePath: { type: 'string', description: 'recast/lipsync: workspace video path.' },
          takeId: { type: 'string' },
          mode: { type: 'string', enum: ['edit', 'motion', 'swap'], description: 'recast mode.' },
          audioPath: { type: 'string' },
          line: { type: 'string', description: 'lipsync/talking_photo: line to voice.' },
          imagePath: { type: 'string' },
          sketchPath: { type: 'string' },
          factor: { type: 'number', description: 'upscale factor (default 2).' },
          topic: { type: 'string' },
          minutes: { type: 'number', description: 'faceless length 1-15.' },
          videoEvery: { type: 'integer' },
          script: { type: 'array', items: { type: 'object' }, description: 'faceless: [{line, visual}] (preferred).' },
          vary: { type: 'array', items: { type: 'string' }, description: 'batch_variants fields.' },
        },
      },
    },
  };
}

const HELP = {
  ops: OP_NAMES,
  examples: [
    { op: 'plan.setShots', shots: [{ title: 'Open', prompt: 'Barista pours latte art, warm morning light', camera: 'slow push-in', durationSec: 6, characterIds: ['char_x'] }] },
    { op: 'character.upsert', name: 'Mia', notes: 'barista, 20s, freckles, green apron', anchors: ['video-projects/vp_x/media/mia.png'] },
    { op: 'style.upsert', name: 'Warm film', promptSuffix: 'shot on 35mm film, warm grade, shallow depth of field' },
    { op: 'shot.update', id: 'shot_x', prompt: '...', modelId: 'fal/kling-v2.1-master-i2v', chainFromPrevious: true },
    { op: 'take.select', shotId: 'shot_x', takeId: 'take_y' },
    { op: 'timeline.assemble' },
    { op: 'clip.trim', id: 'clip_x', deltaEndMs: 2000 },
    { op: 'clip.split', id: 'clip_x', atMs: 3500 },
    { op: 'track.add', kind: 'audio' },
    { op: 'clip.add', trackId: 'track_a', assetPath: 'music/bed.mp3', startMs: 0, volume: 0.4 },
    { op: 'track.add', kind: 'overlay' },
  ],
  consistency: 'Characters carry anchor stills; shots referencing a character send them as reference_images (Grok) or as the start frame (image->video models). chainFromPrevious uses the previous shot\'s last frame.',
  costs: 'estimate first. generate returns needsApproval when above budget.autoApproveUsd or the cap; confirm with the user and retry with approved:true.',
};

function need(value: unknown, name: string): string {
  const v = String(value ?? '').trim();
  if (!v) throw new Error(`${name} is required.`);
  return v;
}

function brief(p: ReturnType<typeof loadProject>, ws: string) {
  return summarizeProject(p, historyDepth(ws, p.id));
}

let resumedFor = new Set<string>();

/** Wake the calling chat when these jobs settle (async generation). */
async function maybeWatch(ctx: { workspacePath: string; sessionId?: string }, projectId: string, jobIds: string[] | undefined, note: string, on: boolean): Promise<string | undefined> {
  if (!on || !ctx.sessionId || !jobIds?.length) return undefined;
  try {
    const { watchVideoJobs } = await import('../gateway/video-project-wake.js');
    watchVideoJobs({ workspacePath: ctx.workspacePath, sessionId: ctx.sessionId, projectId, jobIds, note });
    return 'This chat will be woken automatically when these jobs finish; you can end your turn.';
  } catch { return undefined; }
}

/** Autopilot runs in the background and wakes the chat when it settles. */
const activeRuns = new Map<string, Promise<unknown>>();
function startRunInBackground(ctx: { workspacePath: string; sessionId?: string }, projectId: string, runArgs: any): { started: boolean; note: string } {
  if (activeRuns.has(projectId)) return { started: false, note: 'An autopilot run is already in progress for this project; the card shows live progress.' };
  const p = studio.runAutopilot(ctx.workspacePath, projectId, runArgs).then(async (out) => {
    if (!ctx.sessionId) return;
    try {
      const { wakeSession } = await import('../gateway/session-wake.js');
      const r = out.lastRun;
      const steps = r.steps.filter((s) => s.state !== 'pending').map((s) => `${s.step}:${s.state}${s.note ? ` (${s.note})` : ''}`).join('; ');
      const exp = (out.render?.exports || []).map((e: any) => e.path).join(', ');
      wakeSession(ctx.sessionId, `[video_project wake] Autopilot ${r.state} for ${projectId}. ${steps}.${r.error ? ` Error: ${r.error}.` : ''}${exp ? ` Exports: ${exp}.` : ''} Review the result (show the card and embed the final video), then suggest improvements.`, { source: 'video_run', key: `run:${r.id}` });
    } catch { /* wake is best-effort */ }
  }).finally(() => activeRuns.delete(projectId));
  activeRuns.set(projectId, p);
  return { started: true, note: 'Autopilot started in the background. The chat card shows live progress, and this chat is woken when it finishes, so end your turn now.' };
}

export async function executeVideoProject(args: any, ctx: { workspacePath: string; sessionId?: string }): Promise<any> {
  const ws = ctx.workspacePath;
  if (!resumedFor.has(ws)) { resumedFor.add(ws); try { resumeJobs(ws); } catch { /* ignore */ } }
  const action = String(args?.action || '').trim();
  switch (action) {
    case 'help':
      return HELP;
    case 'list':
      return { projects: listProjects(ws) };
    case 'create': {
      const p = await createProject(ws, { title: args.title, brief: args.brief, target: args.target, defaults: args.defaults, budget: args.budget });
      return { created: p.id, project: brief(p, ws) };
    }
    case 'get':
      return brief(loadProject(ws, need(args.projectId, 'projectId')), ws);
    case 'delete':
      return { deleted: deleteProject(ws, need(args.projectId, 'projectId')) };
    case 'apply_ops': {
      let ops = args.ops ?? args.operations;
      // Models sometimes double-encode the array ("\"[...]\""); unwrap up to 3 string layers.
      for (let i = 0; i < 3 && typeof ops === 'string'; i++) {
        try { ops = JSON.parse(ops); }
        catch { throw new Error('ops must be a non-empty array (or a JSON-encoded array).'); }
      }
      if (ops && !Array.isArray(ops) && typeof ops === 'object' && (ops as any).op) ops = [ops];
      const { project, summaries } = await applyOps(ws, need(args.projectId, 'projectId'), ops, 'agent');
      return { applied: summaries, project: brief(project, ws) };
    }
    case 'undo':
    case 'redo': {
      const { project, applied } = await undoRedo(ws, need(args.projectId, 'projectId'), action, 'agent');
      return { applied, project: brief(project, ws) };
    }
    case 'syncModels':
      return await syncFalModels(true);
    case 'models': {
      const sync = await syncFalModels();
      const models = listModels({ kind: args.kind, provider: args.provider });
      return {
        count: models.length, sync,
        models: models.map((m: MediaModelManifest) => ({
          id: m.id, label: m.label, kind: m.kind, provider: m.provider, tags: m.tags,
          needs: m.requires, durations: m.limits?.durations || (m.limits?.maxDurationSec ? `${m.limits.minDurationSec ?? 1}-${m.limits.maxDurationSec}s` : undefined),
          price: liveFalPrice(m) || m.pricing, builtin: m.builtin, source: m.source, verified: m.source !== 'fal-sync',
        })),
      };
    }
    case 'import_models': {
      const provider = need(args.provider, 'provider');
      if (provider !== 'fal' && provider !== 'higgsfield') throw new Error('import_models supports provider fal or higgsfield.');
      const imported = await importModelManifests({ provider, endpoint: args.endpoint, save: true });
      return { imported: imported.map((m) => ({ id: m.id, kind: m.kind, map: m.map, limits: m.limits, pricing: m.pricing })), note: 'Saved to the user catalog. Imported pricing is unknown until set; use add_model to add pricing so the cost gate is accurate.' };
    }
    case 'add_model': {
      const file = saveUserManifest(args.manifest);
      return { saved: args.manifest?.id, file, model: getModel(args.manifest?.id) };
    }
    case 'remove_model':
      return { removed: removeUserManifest(need(args.modelId, 'modelId')) };
    case 'providers':
      return await providerStatus();
    case 'set_key': {
      const provider = need(args.provider, 'provider');
      if (provider !== 'fal' && provider !== 'higgsfield') throw new Error(`set_key supports fal or higgsfield. ${provider === 'xai' || provider === 'openai' ? 'xAI/OpenAI keys are managed in Settings -> Models.' : ''}`);
      setProviderKey(provider, need(args.apiKey, 'apiKey'));
      return { stored: true, provider, hint: providerKeyHint(provider) };
    }
    case 'estimate':
      return await estimate(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds, count: args.count, modelId: args.modelId });
    case 'generate': {
      const pid = need(args.projectId, 'projectId');
      const r: any = await generateShots(ws, pid, { shotIds: args.shotIds, count: args.count, modelId: args.modelId, approved: args.approved === true });
      const wake = await maybeWatch(ctx, pid, r.jobs?.map((j: any) => j.id), 'Shots generated.', args.notify === true);
      return wake ? { ...r, wake } : r;
    }
    case 'generate_anchor': {
      const pid = need(args.projectId, 'projectId');
      const r: any = await generateCharacterAnchor(ws, pid, {
        characterId: need(args.characterId, 'characterId'), prompt: args.prompt ? String(args.prompt) : undefined,
        modelId: args.modelId, count: args.count, approved: args.approved === true, referenceImages: args.referenceImages,
      });
      const wake = await maybeWatch(ctx, pid, r.jobs?.map((j: any) => j.id), 'Anchor candidates ready for approval on the card.', args.notify === true);
      return wake ? { ...r, wake } : r;
    }
    // ── studio ──
    case 'templates':
      return { templates: studio.listTemplates() };
    case 'music_beds':
      return { beds: studio.listMusicBeds() };
    case 'quickstart': {
      const out = await studio.quickstart(ws, {
        brief: need(args.brief, 'brief'), templateId: args.templateId, title: args.title, productPath: args.productPath, productName: args.productName,
        creator: args.creator, brandId: args.brandId, castIds: args.castIds, capUsd: args.capUsd, aspect: args.aspect, resolution: args.resolution, run: false,
      });
      if (args.audioMode === 'native' || args.audioMode === 'voiceover') await applyOps(ws, out.projectId, [{ op: 'project.update', audioMode: args.audioMode }], 'agent');
      const cost = await studio.planRunCost(ws, out.projectId, { storyboard: args.storyboard !== false, qaRerolls: args.qa === false ? 0 : 1 });
      const p = loadProject(ws, out.projectId);
      if (!args.approved && cost.usd > p.budget.autoApproveUsd + 1e-9) {
        await studio.runAutopilot(ws, out.projectId, { approved: false });
        return { ...out, needsApproval: cost, next: 'Show the card + this breakdown; after the user approves call run {projectId, approved:true}.', project: brief(p, ws) };
      }
      return { ...out, ...startRunInBackground(ctx, out.projectId, { approved: true, storyboard: args.storyboard, qa: args.qa, aspects: args.aspects }) };
    }
    case 'apply_template':
      return await studio.applyTemplate(ws, need(args.projectId, 'projectId'), { templateId: need(args.templateId, 'templateId'), product: args.productName, character: args.creator, brief: args.brief });
    case 'import_asset':
      return await studio.importAsset(ws, need(args.projectId, 'projectId'), { path: args.path, dataBase64: args.dataBase64, filename: args.filename, role: args.role, name: args.name, notes: args.notes });
    case 'storyboard': {
      const pid = need(args.projectId, 'projectId');
      const r: any = await generateStoryboards(ws, pid, { shotIds: args.shotIds, modelId: args.modelId, approved: args.approved === true, count: args.count });
      if (r.needsApproval) return { ...r, estimateUsd: r.estimate?.total };
      const wake = await maybeWatch(ctx, pid, r.jobs?.map((j: any) => j.id), 'Storyboard stills are on the card for approval.', args.notify === true);
      return wake ? { ...r, wake } : r;
    }
    case 'voiceover':
      return await studio.voiceover(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds, force: args.force === true });
    case 'captions':
      return await studio.captions(ws, need(args.projectId, 'projectId'), { style: args.style, enabled: args.enabled });
    case 'transcribe': {
      const { transcribeTakes } = await import('./transcribe.js');
      return await transcribeTakes(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds, force: args.force === true });
    }
    case 'music':
      return await studio.music(ws, need(args.projectId, 'projectId'), { builtin: args.builtin, path: args.path, volume: args.volume, duck: args.duck });
    case 'qa':
      return await studio.qa(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds });
    case 'hooks': {
      const pid = need(args.projectId, 'projectId');
      const r: any = await studio.generateHookVariants(ws, pid, { prompts: args.prompts, shotId: args.shotId, approved: args.approved === true });
      const wake = await maybeWatch(ctx, pid, r.jobs?.map((j: any) => j.id), 'Hook variants ready: call render_variants for the A/B exports.', args.notify === true);
      return wake ? { ...r, wake } : r;
    }
    case 'render_variants':
      return await studio.renderVariants(ws, need(args.projectId, 'projectId'), { shotId: need(args.shotId, 'shotId'), aspect: args.aspect });
    case 'upgrade': {
      const pid = need(args.projectId, 'projectId');
      const r: any = await studio.upgradeFinal(ws, pid, { shotIds: args.shotIds, resolution: args.resolution, approved: args.approved === true });
      const wake = await maybeWatch(ctx, pid, r.jobs?.map((j: any) => j.id), 'Final-resolution takes are ready.', args.notify === true);
      return wake ? { ...r, wake } : r;
    }
    case 'route':
      return await studio.routeModels(ws, need(args.projectId, 'projectId'), { quality: args.quality, apply: args.apply });
    case 'run_cost':
      return await studio.planRunCost(ws, need(args.projectId, 'projectId'), { storyboard: args.storyboard !== false, qaRerolls: args.qa === false ? 0 : Math.max(0, Math.min(3, Number(args.maxRerolls ?? 1))) });
    case 'run': {
      const pid = need(args.projectId, 'projectId');
      const runArgs = { approved: args.approved === true, storyboard: args.storyboard, qa: args.qa, maxRerolls: args.maxRerolls, aspects: args.aspects, steps: args.steps };
      const cost = await studio.planRunCost(ws, pid, { storyboard: args.storyboard !== false, qaRerolls: args.qa === false ? 0 : Math.max(0, Math.min(3, Number(args.maxRerolls ?? 1))) });
      const p = loadProject(ws, pid);
      if (!runArgs.approved && cost.usd > p.budget.autoApproveUsd + 1e-9) {
        const r = await studio.runAutopilot(ws, pid, runArgs);
        return { ...r, next: 'Show the cost breakdown; call run again with approved:true once the user says yes.' };
      }
      if (args.wait === true) return await studio.runAutopilot(ws, pid, { ...runArgs, approved: true });
      return { ...startRunInBackground(ctx, pid, { ...runArgs, approved: true }), costUsd: cost.usd };
    }
    case 'trend_transfer': {
      const pid = need(args.projectId, 'projectId');
      const r: any = await trend.trendTransfer(ws, pid, { sourcePath: need(args.sourcePath, 'sourcePath'), characterId: need(args.characterId, 'characterId'), cuts: args.cuts, maxParts: args.maxParts, looks: args.looks, startImages: args.startImages, prompt: args.prompt, modelId: args.modelId, approved: args.approved === true, shotIds: args.shotIds });
      const wake = await maybeWatch(ctx, pid, r.jobs?.map((j: any) => j.id), `Trend parts ready; then trend_assemble {shotIds:${JSON.stringify(r.shotIds)}, audioPath:${JSON.stringify(args.sourcePath)}}`, args.notify !== false);
      const next = r.needsApproval ? 'Show the matched start frames (parts[].frame) and the quote; after the user approves call trend_transfer again with the SAME shotIds and approved:true.' : undefined;
      return { ...r, ...(wake ? { wake } : {}), ...(next ? { next } : {}) };
    }
    case 'trend_assemble':
      return await trend.trendAssemble(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds || [], audioPath: args.audioPath || args.sourcePath, audioStartSec: args.audioStartSec, phoneLook: args.phoneLook });
    case 'phone_finish':
      return await trend.phoneFinish(ws, { path: need(args.path || args.sourcePath, 'path'), projectId: args.projectId, strength: args.strength });
    case 'presets':
      return { presets: listPresets(args.group) };
    case 'recast': {
      const pid = need(args.projectId, 'projectId');
      const r: any = await parity.recast(ws, pid, { sourcePath: args.sourcePath, shotId: args.shotId, takeId: args.takeId, prompt: String(args.prompt || ''), characterId: args.characterId, mode: args.mode, modelId: args.modelId, approved: args.approved === true, pendingShotId: args.pendingShotId });
      const wake = await maybeWatch(ctx, pid, r.jobs?.map((j: any) => j.id), 'Recast take is ready.', args.notify === true);
      return wake ? { ...r, wake } : r;
    }
    case 'lipsync':
      return await parity.lipsync(ws, need(args.projectId, 'projectId'), { shotId: args.shotId, sourcePath: args.sourcePath, audioPath: args.audioPath, line: args.line, modelId: args.modelId, approved: args.approved === true, pendingShotId: args.pendingShotId });
    case 'talking_photo':
      return await parity.talkingPhoto(ws, need(args.projectId, 'projectId'), { imagePath: args.imagePath, characterId: args.characterId, line: args.line, audioPath: args.audioPath, prompt: args.prompt, modelId: args.modelId, approved: args.approved === true, pendingShotId: args.pendingShotId });
    case 'draw_to_video':
      return await parity.drawToVideo(ws, need(args.projectId, 'projectId'), { sketchPath: args.sketchPath, dataBase64: args.dataBase64, prompt: String(args.prompt || ''), modelId: args.modelId, approved: args.approved === true, pendingShotId: args.pendingShotId });
    case 'upscale':
      return await parity.upscale(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds, factor: args.factor, modelId: args.modelId, approved: args.approved === true });
    case 'foley':
      return await parity.foley(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds, prompt: args.prompt, modelId: args.modelId, approved: args.approved === true });
    case 'faceless': {
      const r = await parity.faceless(ws, { projectId: args.projectId, topic: need(args.topic, 'topic'), minutes: args.minutes, style: args.style, videoEvery: args.videoEvery, script: args.script, capUsd: args.capUsd, resolution: args.resolution, imageModel: args.imageModel, videoModel: args.videoModel });
      return { ...r, next: r.needsApproval ? 'Show the cost breakdown; then call run {projectId, approved:true, storyboard:false, qa:false, aspects:["16:9"]}.' : 'Call run {projectId, storyboard:false, qa:false, aspects:["16:9"]}.' };
    }
    case 'batch_variants': {
      const pid = need(args.projectId, 'projectId');
      const r = await parity.batchVariants(ws, pid, { count: args.count, vary: args.vary });
      if (args.approved !== true) return { ...r, next: 'Show the combined cost; call batch_variants again with approved:true to run them all (creates a new batch).' };
      const ids = r.projects.map((x) => x.projectId);
      const job = (async () => {
        const done: string[] = [];
        for (const id of ids) { try { const o = await studio.runAutopilot(ws, id, { approved: true }); done.push(`${id}:${o.lastRun.state}`); } catch (e: any) { done.push(`${id}:failed`); } }
        if (ctx.sessionId) {
          try { const { wakeSession } = await import('../gateway/session-wake.js'); wakeSession(ctx.sessionId, `[video_project wake] Batch variants finished: ${done.join(', ')}. Show each card.`, { source: 'video_run', key: `batch:${ids[0]}` }); } catch { /* best-effort */ }
        }
      })();
      activeRuns.set(`batch:${pid}`, job);
      job.finally(() => activeRuns.delete(`batch:${pid}`));
      return { ...r, started: true, note: 'Variants run in sequence in the background; this chat is woken once when all finish.' };
    }
    case 'watch':
      return { note: await maybeWatch(ctx, need(args.projectId, 'projectId'), args.jobIds, String(args.note || ''), true) || 'No session to wake (not called from a chat).' };
    case 'cast_list':
      return { cast: studio.listCast(ws, args.kind ? { kind: args.kind } : undefined) };
    case 'cast_save':
      // Standalone: cast_save {name, anchors:[face], refs:[pack], notes(personality), voice, tags} needs no project.
      if (!args.projectId) {
        const anchors = Array.isArray(args.anchors) ? args.anchors.map(String) : args.path ? [String(args.path)] : [];
        if (!args.castId && !anchors.length) throw new Error('cast_save without projectId needs name + anchors (the approved face image) or castId to update.');
        return { saved: saveCast(ws, { id: args.castId, name: need(args.name, 'name'), kind: args.kind === 'product' ? 'product' : args.kind === 'person' ? 'person' : undefined,
          anchors: anchors.length ? anchors : undefined, refs: Array.isArray(args.refs) ? args.refs.map(String) : undefined,
          notes: args.notes, voice: args.voice, tags: args.tags } as any) };
      }
      return { saved: studio.castSave(ws, args.projectId, need(args.characterId, 'characterId'), { tags: args.tags }) };
    case 'cast_add':
      return await studio.castAdd(ws, need(args.projectId, 'projectId'), need(args.castId, 'castId'));
    case 'cast_delete':
      return { deleted: deleteCast(ws, need(args.castId, 'castId')) };
    case 'brand_list':
      return { brands: studio.listBrands(ws) };
    case 'brand_save':
      return { saved: studio.saveBrand(ws, { ...(args.brand || {}), name: need(args.brand?.name || args.name, 'brand.name') }) };
    case 'brand_apply':
      return await studio.brandApply(ws, need(args.projectId, 'projectId'), need(args.brandId, 'brandId'));
    case 'brand_delete':
      return { deleted: deleteBrand(ws, need(args.brandId, 'brandId')) };
    case 'jobs': {
      const p = loadProject(ws, need(args.projectId, 'projectId'));
      const jobs = (args.jobIds?.length ? p.jobs.filter((j) => args.jobIds.includes(j.id)) : p.jobs.slice(-15));
      return { jobs: jobs.map((j) => ({ id: j.id, state: j.state, model: j.modelId, target: j.target, usd: j.state === 'done' ? (j.actualUsd ?? j.estimateUsd) : 0, estimateUsd: j.estimateUsd, takes: j.takeIds, error: j.error })), spentUsd: p.budget.spentUsd };
    }
    case 'wait': {
      const projectId = need(args.projectId, 'projectId');
      const jobs = await waitForJobs(ws, projectId, args.jobIds, Number(args.timeoutMs) || 180_000);
      const p = loadProject(ws, projectId);
      return { jobs: jobs.map((j) => ({ id: j.id, state: j.state, model: j.modelId, target: j.target, takes: j.takeIds, error: j.error })), project: brief(p, ws) };
    }
    case 'cancel_job':
      return { canceled: await cancelJob(ws, need(args.projectId, 'projectId'), need(args.jobId, 'jobId')) };
    case 'render': {
      const pid = need(args.projectId, 'projectId');
      if (Array.isArray(args.aspects) && args.aspects.length) return await studio.renderAll(ws, pid, { aspects: args.aspects });
      return await renderProject(ws, pid, { output: args.output, aspect: args.aspect });
    }
    case 'frame':
      return { path: await renderFrame(ws, need(args.projectId, 'projectId'), Number(args.atSec) || 0) };
    default:
      throw new Error(`Unknown video_project action "${action}". Use one of: ${VIDEO_PROJECT_ACTIONS.join(', ')}.`);
  }
}

/** Test hook. */
export function __resetVideoProjectResume(): void { resumedFor = new Set(); }

/** Test hook: wait for a background autopilot run. */
export async function __awaitRun(projectId: string): Promise<void> { await activeRuns.get(projectId); }
