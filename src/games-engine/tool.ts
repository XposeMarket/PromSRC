/**
 * game_project — Games mode control surface (our answer to Higgsfield Games):
 * design questions -> design doc -> staged, cost-approved art -> free audio ->
 * scaffold that loads the assets -> the agent writes build/game.js -> play/publish.
 */
import {
  createGame, deleteGame, GAME_GENRES, GAME_STYLES, listGames, loadGame, mutateGame, normalizeDesign, summarizeGame,
} from './project.js';
import {
  designQuestions, estimateAssets, generateAssets, makeMusic, makeSfx, planAssets, SFX_RECIPES, setAssetStatus,
} from './assets.js';
import { writeScaffold } from './scaffold.js';
import { playPath, publishGame } from './publish.js';

export const GAME_PROJECT_ACTIONS = [
  'help', 'list', 'create', 'get', 'design', 'questions', 'plan_assets', 'estimate', 'generate_assets',
  'approve_asset', 'reject_asset', 'reroll_asset', 'sfx', 'music', 'scaffold', 'play_url', 'publish', 'delete',
] as const;
export const GAME_PROJECT_READ_ACTIONS = new Set(['help', 'list', 'get', 'questions', 'estimate', 'play_url']);
export const GAME_PROJECT_PAID_ACTIONS = new Set(['generate_assets', 'reroll_asset']);

const FLOW = 'questions -> design (answers + controls/coreLoop/winLose) -> plan_assets -> estimate -> generate_assets (approved:true after the user OKs cost) -> approve_asset/reject_asset/reroll_asset each image -> sfx + music (free) -> scaffold -> EDIT build/game.js (and index.html if needed) with normal file tools to write the actual game around assets.js MANIFEST -> play_url -> publish';

export function getGameProjectToolDef(): any {
  return {
    type: 'function',
    function: {
      name: 'game_project',
      description: [
        'Games mode: build a playable browser game with generated art + audio. Server-owned project at game-projects/<gp_id>/ (assets/, audio/, build/).',
        `STAGED FLOW: ${FLOW}.`,
        'Ask the user the design questions (tappable options) before planning assets. Art costs money (image models, ~$0.04-0.07/img): always estimate first; generate_assets returns needsApproval above budget.autoApproveUsd (default $1) - confirm with the user, then retry with approved:true. capUsd is a hard stop. Sprites come back with transparent backgrounds (magenta chroma key).',
        'Audio stage requires art approved (every visual asset approved or rejected) unless force:true. sfx/music are free (procedural ffmpeg).',
        'scaffold writes a RUNNING starter (canvas2d, or three.js for 3d/voxel) that preloads approved assets (build/assets.js: loadAssets(), play(assets,name)) and, for multiplayer, build/mp.js (MP.connect(room), MP.send(state), MP.on("state"|"join"|"leave",fn)) backed by the gateway room relay. You then WRITE THE REAL GAME in build/game.js. Re-running scaffold refreshes assets.js/mp.js but keeps your game.js unless overwrite:true.',
        'CHAT CARD: include the chatCard fence (```game-project\\n{"projectId":"gp_..."}\\n```) in your reply once per project; it shows stage, assets with approve/reject/reroll, cost approval, audio and an embedded playable preview.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...GAME_PROJECT_ACTIONS] },
          projectId: { type: 'string', description: 'gp_... id (all actions except help/list/create).' },
          title: { type: 'string' },
          pitch: { type: 'string', description: 'One-paragraph game pitch / design doc summary.' },
          genre: { type: 'string', enum: [...GAME_GENRES] },
          style: { type: 'string', enum: [...GAME_STYLES] },
          setting: { type: 'string' },
          multiplayer: { type: 'boolean' },
          engine: { type: 'string', enum: ['canvas2d', 'three'], description: 'Default: three for 3d/voxel, else canvas2d.' },
          controls: { type: 'string' }, coreLoop: { type: 'string' }, winLose: { type: 'string' }, notes: { type: 'string' },
          answers: { type: 'object', description: 'design: { questionId: answer } for questions returned by action=questions.' },
          ids: { type: 'array', items: { type: 'string' }, description: 'Asset ids or names (generate_assets/estimate).' },
          assetId: { type: 'string', description: 'Asset id or name (approve/reject/reroll).' },
          candidate: { type: 'string', description: 'approve_asset: candidate index ("0") or file path to use; default latest.' },
          prompt: { type: 'string', description: 'reroll_asset: optional replacement prompt.' },
          approved: { type: 'boolean', description: 'Set true only after the user approved the quoted cost.' },
          modelId: { type: 'string', description: 'Image model override (e.g. xai/grok-imagine-image-2.0, openai/gpt-image).' },
          names: { type: 'array', items: { type: 'string' }, description: `sfx names: ${Object.keys(SFX_RECIPES).join(', ')}.` },
          bed: { type: 'string', description: 'music bed id (pulse, ambient, ...).' },
          force: { type: 'boolean', description: 'sfx/music: skip the art-approved gate.' },
          overwrite: { type: 'boolean', description: 'scaffold: overwrite existing game.js/index.html.' },
          replace: { type: 'boolean', description: 'plan_assets: replace the existing planned list.' },
          autoApproveUsd: { type: 'number' }, capUsd: { type: 'number' },
          deploy: { type: 'boolean', description: 'publish: false to skip Vercel deploy.' },
        },
        required: ['action'],
      },
    },
  };
}

function need(v: unknown, name: string): string {
  const s = String(v ?? '').trim();
  if (!s) throw new Error(`${name} is required.`);
  return s;
}

export async function executeGameProject(args: any, ctx: { workspacePath: string; sessionId?: string; baseUrl?: string }): Promise<any> {
  const ws = ctx.workspacePath;
  const action = String(args?.action || '').trim().toLowerCase();
  const pid = () => need(args?.projectId, 'projectId');
  switch (action) {
    case 'help':
      return { actions: GAME_PROJECT_ACTIONS, flow: FLOW, genres: GAME_GENRES, styles: GAME_STYLES, sfx: Object.keys(SFX_RECIPES) };
    case 'list':
      return { projects: listGames(ws) };
    case 'create': {
      const p = createGame(ws, args || {});
      const { project } = await mutateGame(ws, p.id, (x) => { x.questions = designQuestions(x.design); });
      return { ...summarizeGame(project), questions: project.questions, next: 'Ask the user these design questions (offer the options as tappable choices), then call design with answers.' };
    }
    case 'get':
      return summarizeGame(loadGame(ws, pid()));
    case 'questions': {
      const p = loadGame(ws, pid());
      const qs = p.questions.length ? p.questions : designQuestions(p.design);
      if (!p.questions.length) await mutateGame(ws, p.id, (x) => { x.questions = qs; });
      return { projectId: p.id, questions: qs };
    }
    case 'design': {
      const { project } = await mutateGame(ws, pid(), (p) => {
        const genreBefore = p.design.genre;
        p.design = normalizeDesign(args, p.design);
        if (args.style !== undefined && args.engine === undefined && (args.style === '3d' || args.style === 'voxel')) p.design.engine = 'three';
        if (args.title) p.title = String(args.title).slice(0, 120);
        if (args.pitch !== undefined) p.pitch = String(args.pitch).slice(0, 2000);
        if (Number.isFinite(Number(args.autoApproveUsd)) && args.autoApproveUsd !== undefined) p.budget.autoApproveUsd = Math.max(0, Number(args.autoApproveUsd));
        if (args.capUsd !== undefined) { const c = Number(args.capUsd); if (c > 0) p.budget.capUsd = c; else delete p.budget.capUsd; }
        if (args.modelId) p.imageModel = String(args.modelId);
        if (genreBefore !== p.design.genre || (args.multiplayer !== undefined && !p.questions.some((q) => q.id === 'mp_mode') === p.design.multiplayer)) {
          const answered = new Map(p.questions.map((q) => [q.id, q.answer]));
          p.questions = designQuestions(p.design).map((q) => ({ ...q, ...(answered.get(q.id) ? { answer: answered.get(q.id) } : {}) }));
        }
        const answers = args.answers && typeof args.answers === 'object' ? args.answers : {};
        for (const [k, v] of Object.entries(answers)) {
          const q = p.questions.find((x) => x.id === k);
          if (q) q.answer = String(v);
          else p.questions.push({ id: k.slice(0, 40), q: k, options: [], answer: String(v) });
        }
      });
      return summarizeGame(project);
    }
    case 'plan_assets': {
      const { project } = await mutateGame(ws, pid(), (p) => {
        const plan = planAssets(p.design);
        const keep = p.assets.filter((a) => a.kind === 'sfx' || a.kind === 'music' || (!args.replace && a.status !== 'planned'));
        const names = new Set(keep.map((a) => a.name));
        p.assets = [...keep, ...plan.filter((a) => !names.has(a.name))];
      });
      return { ...summarizeGame(project), prompts: project.assets.filter((a) => a.status === 'planned').map((a) => ({ id: a.id, name: a.name, kind: a.kind, prompt: a.prompt })), estimate: estimateAssets(ws, project.id) };
    }
    case 'estimate':
      return estimateAssets(ws, pid(), { ids: args.ids, modelId: args.modelId });
    case 'generate_assets':
      return generateAssets(ws, pid(), { ids: args.ids, approved: args.approved === true, modelId: args.modelId, wait: args.wait === true });
    case 'approve_asset':
      return { asset: await setAssetStatus(ws, pid(), need(args.assetId, 'assetId'), 'approved', args.candidate) };
    case 'reject_asset':
      return { asset: await setAssetStatus(ws, pid(), need(args.assetId, 'assetId'), 'rejected') };
    case 'reroll_asset': {
      const id = need(args.assetId, 'assetId');
      const projectId = pid();
      let assetKey = id;
      if (args.prompt) {
        await mutateGame(ws, projectId, (p) => {
          const a = p.assets.find((x) => x.id === id || x.name === id);
          if (!a) throw new Error(`Asset "${id}" not found.`);
          a.prompt = String(args.prompt);
          assetKey = a.id;
        });
      }
      return generateAssets(ws, projectId, { ids: [assetKey], approved: args.approved === true, modelId: args.modelId, wait: args.wait === true });
    }
    case 'sfx':
      return { sfx: await makeSfx(ws, pid(), { names: args.names, force: args.force === true }) };
    case 'music':
      return { music: await makeMusic(ws, pid(), { bed: args.bed, seconds: args.seconds, force: args.force === true }) };
    case 'scaffold': {
      const out = await writeScaffold(ws, pid(), { overwrite: args.overwrite === true });
      return { ...out, playUrl: playPath(pid()), next: `Now write the real game in ${out.gameJs} with normal file tools (assets via loadAssets()/MANIFEST), then play_url and publish.` };
    }
    case 'play_url': {
      const p = loadGame(ws, pid());
      return { playUrl: `${(ctx.baseUrl || '').replace(/\/$/, '')}${playPath(p.id)}`, publish: p.publish, stage: p.stage };
    }
    case 'publish':
      return publishGame(ws, pid(), { baseUrl: ctx.baseUrl, deploy: args.deploy });
    case 'delete':
      deleteGame(ws, pid());
      return { deleted: pid() };
    default:
      throw new Error(`Unknown game_project action "${action}". Use one of: ${GAME_PROJECT_ACTIONS.join(', ')}.`);
  }
}
