/**
 * video_project — Prom's single control surface for the generative video
 * engine. Every edit goes through project ops (undoable, shared with the UI).
 */
import {
  getModel, importModelManifests, listModels, removeUserManifest, saveUserManifest, type MediaModelManifest,
} from './catalog.js';
import { providerKeyHint, providerStatus, setProviderKey } from './providers.js';
import {
  applyOps, createProject, deleteProject, historyDepth, listProjects, loadProject, OP_NAMES,
  summarizeProject, undoRedo,
} from './project.js';
import {
  cancelJob, estimate, generateCharacterAnchor, generateShots, renderFrame, renderProject, resumeJobs, waitForJobs,
} from './engine.js';

export const VIDEO_PROJECT_ACTIONS = [
  'help', 'list', 'create', 'get', 'delete', 'apply_ops', 'undo', 'redo',
  'models', 'import_models', 'add_model', 'remove_model', 'providers', 'set_key',
  'estimate', 'generate', 'generate_anchor', 'jobs', 'wait', 'cancel_job', 'render', 'frame',
] as const;

export const VIDEO_PROJECT_READ_ACTIONS = new Set(['help', 'list', 'get', 'models', 'providers', 'estimate', 'jobs', 'wait', 'frame']);
/** Actions that spend money with an external provider. */
export const VIDEO_PROJECT_PAID_ACTIONS = new Set(['generate', 'generate_anchor']);

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
          budget: { type: 'object', description: '{ capUsd, autoApproveUsd } (default auto-approve $1)' },
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
          kind: { type: 'string', enum: ['video', 'image'], description: 'models filter' },
          provider: { type: 'string', enum: ['xai', 'openai', 'fal', 'higgsfield'], description: 'models filter / import_models / set_key provider' },
          endpoint: { type: 'string', description: 'import_models: fal endpoint id or Higgsfield path (omit for all Higgsfield models).' },
          manifest: { type: 'object', description: 'add_model: full model manifest.' },
          apiKey: { type: 'string', description: 'set_key: provider API key (stored in the vault). Only when the user pastes it.' },
          output: { type: 'string', description: 'render: workspace-relative output path (.mp4).' },
          atSec: { type: 'number', description: 'frame: timeline time in seconds.' },
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

export async function executeVideoProject(args: any, ctx: { workspacePath: string }): Promise<any> {
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
      const { project, summaries } = await applyOps(ws, need(args.projectId, 'projectId'), args.ops, 'agent');
      return { applied: summaries, project: brief(project, ws) };
    }
    case 'undo':
    case 'redo': {
      const { project, applied } = await undoRedo(ws, need(args.projectId, 'projectId'), action, 'agent');
      return { applied, project: brief(project, ws) };
    }
    case 'models': {
      const models = listModels({ kind: args.kind, provider: args.provider });
      return {
        count: models.length,
        models: models.map((m: MediaModelManifest) => ({
          id: m.id, label: m.label, kind: m.kind, provider: m.provider, tags: m.tags,
          needs: m.requires, durations: m.limits?.durations || (m.limits?.maxDurationSec ? `${m.limits.minDurationSec ?? 1}-${m.limits.maxDurationSec}s` : undefined),
          price: m.pricing, builtin: m.builtin,
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
    case 'generate':
      return await generateShots(ws, need(args.projectId, 'projectId'), { shotIds: args.shotIds, count: args.count, modelId: args.modelId, approved: args.approved === true });
    case 'generate_anchor':
      return await generateCharacterAnchor(ws, need(args.projectId, 'projectId'), {
        characterId: need(args.characterId, 'characterId'), prompt: need(args.prompt, 'prompt'),
        modelId: args.modelId, count: args.count, approved: args.approved === true, referenceImages: args.referenceImages,
      });
    case 'jobs': {
      const p = loadProject(ws, need(args.projectId, 'projectId'));
      const jobs = (args.jobIds?.length ? p.jobs.filter((j) => args.jobIds.includes(j.id)) : p.jobs.slice(-15));
      return { jobs: jobs.map((j) => ({ id: j.id, state: j.state, model: j.modelId, target: j.target, usd: j.estimateUsd, takes: j.takeIds, error: j.error })), spentUsd: p.budget.spentUsd };
    }
    case 'wait': {
      const projectId = need(args.projectId, 'projectId');
      const jobs = await waitForJobs(ws, projectId, args.jobIds, Number(args.timeoutMs) || 180_000);
      const p = loadProject(ws, projectId);
      return { jobs: jobs.map((j) => ({ id: j.id, state: j.state, model: j.modelId, target: j.target, takes: j.takeIds, error: j.error })), project: brief(p, ws) };
    }
    case 'cancel_job':
      return { canceled: await cancelJob(ws, need(args.projectId, 'projectId'), need(args.jobId, 'jobId')) };
    case 'render':
      return await renderProject(ws, need(args.projectId, 'projectId'), { output: args.output });
    case 'frame':
      return { path: await renderFrame(ws, need(args.projectId, 'projectId'), Number(args.atSec) || 0) };
    default:
      throw new Error(`Unknown video_project action "${action}". Use one of: ${VIDEO_PROJECT_ACTIONS.join(', ')}.`);
  }
}

/** Test hook. */
export function __resetVideoProjectResume(): void { resumedFor = new Set(); }
