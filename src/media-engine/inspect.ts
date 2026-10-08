/**
 * Pre- and post-generation inspection for the video engine.
 *
 *  - breakdownReel: understand a reference clip BEFORE paying for anything. Finds the
 *    cuts, enforces the target model's minimum clip length (merge / slow-down plan),
 *    and asks a vision model what happens inside each part (garment changes, props,
 *    fast moves, subject build). Garment changes feed the matched start frames so the
 *    motion model has the real garment to animate instead of inventing one.
 *  - denseTakeCheck: dense QA of a generated take. Samples a frame every ~0.25s into
 *    contact grids, compares them with the identity anchor (and the approved start
 *    frame), and returns timestamped defects (torn/split clothing, outfit morphs,
 *    identity or hair drift, hands, melting, pop-ins) plus deterministic length checks.
 *
 * Vision runs through executeVisionJudge (xAI -> Codex -> OpenAI), i.e. subscription
 * routes: $0 per call. Both functions are best-effort around vision failures and say so.
 */
import fs from 'fs';
import path from 'path';
import { mediaDurationSec, runFfmpeg } from './engine.js';
import { fromWorkspaceRel, type Shot, type Take, type VideoProject } from './project.js';

export type VisionJudge = (prompt: string, images: string[], opts?: { maxTokens?: number }) => Promise<{ success: boolean; text?: string; model?: string; error?: string }>;

let judgeOverride: VisionJudge | null = null;
/** Tests inject a fake judge so nothing touches real providers. */
export function setVisionJudgeForTests(fn: VisionJudge | null): void { judgeOverride = fn; }

async function judge(prompt: string, images: string[], maxTokens: number): Promise<{ success: boolean; text?: string; model?: string; error?: string }> {
  if (judgeOverride) return judgeOverride(prompt, images, { maxTokens });
  const { executeVisionJudge } = await import('../gateway/tools/handlers/xai-handlers.js');
  const { withRateLimitRetry } = await import('./engine.js');
  return withRateLimitRetry(async () => {
    const r = await executeVisionJudge(prompt, images, { maxTokens });
    if (!r.success && /rate|429/i.test(String(r.error || ''))) throw new Error(r.error);
    return r;
  });
}

export function toDataUrl(abs: string): string {
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function parseJson(text: string): any {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : text); } catch { return null; }
}

const GRID_COLS = 4;
const GRID_ROWS = 3;
const PER_GRID = GRID_COLS * GRID_ROWS;

/**
 * Tile frames sampled every `intervalSec` into 4x3 grids (row-major, left->right,
 * top->bottom). Frame k sits at ~startSec + k*intervalSec. One ffmpeg call.
 */
export async function contactGrids(videoAbs: string, outDir: string, opts: { startSec?: number; durationSec?: number; intervalSec: number; width?: number; prefix: string }): Promise<{ grids: string[]; frames: number; intervalSec: number }> {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.startsWith(`${opts.prefix}_`)) { try { fs.unlinkSync(path.join(outDir, f)); } catch { /* stale */ } }
  const w = opts.width || 300;
  const args = ['-y', '-loglevel', 'error'];
  if (opts.startSec) args.push('-ss', opts.startSec.toFixed(3));
  args.push('-i', videoAbs);
  if (opts.durationSec) args.push('-t', opts.durationSec.toFixed(3));
  args.push('-vf', `fps=1/${opts.intervalSec},scale=${w}:-2,tile=${GRID_COLS}x${GRID_ROWS}:padding=4:color=black`, '-q:v', '4', path.join(outDir, `${opts.prefix}_%02d.jpg`));
  const res = await runFfmpeg(args, 180_000);
  const grids = fs.readdirSync(outDir).filter((f) => f.startsWith(`${opts.prefix}_`) && f.endsWith('.jpg')).sort().map((f) => path.join(outDir, f));
  if (res.code !== 0 || !grids.length) throw new Error(`contact grid failed: ${res.stderr.slice(-300)}`);
  const span = opts.durationSec || 0;
  const frames = span ? Math.max(1, Math.floor(span / opts.intervalSec)) : grids.length * PER_GRID;
  return { grids, frames, intervalSec: opts.intervalSec };
}

// ── Dense take QA ─────────────────────────────────────────────────────────

export interface TakeDefect { atSec?: number; issue: string; severity: 'minor' | 'major' }
export interface DenseCheck { score: number; verdict: 'pass' | 'reroll'; issues: string[]; defects: TakeDefect[]; model: string; framesChecked: number; intervalSec: number }

/** Trend shots record their source window in notes: "trend tr_x 2.2-3.7s of ...". */
export function trendWindow(shot: Pick<Shot, 'notes'>): { startSec: number; endSec: number } | null {
  const m = String(shot.notes || '').match(/trend \S+ ([\d.]+)-([\d.]+)s/);
  return m ? { startSec: Number(m[1]), endSec: Number(m[2]) } : null;
}

/** Deterministic length checks: no vision needed. */
export function lengthDefects(shot: Shot, takeDurationSec: number | undefined, sourceDurationSec?: number): TakeDefect[] {
  const out: TakeDefect[] = [];
  if (!takeDurationSec) return out;
  const want = sourceDurationSec || shot.durationSec;
  if (want && takeDurationSec < want * 0.8 - 0.1) {
    out.push({ issue: `take is ${takeDurationSec.toFixed(1)}s but its reference/target is ${want.toFixed(1)}s (${(want - takeDurationSec).toFixed(1)}s short)`, severity: want - takeDurationSec > 1 ? 'major' : 'minor' });
  }
  return out;
}

/**
 * What a trend shot is expected to contain, recovered from its notes:
 * "trend tr_x 2.2-3.7s speed=0.49 of a.mp4 | puts on a white button-up | look: white tee, open white button-up".
 */
export function expectedFromNotes(notes?: string): { action?: string; look?: string } {
  const segs = String(notes || '').split('|').map((s) => s.trim()).slice(1).filter(Boolean);
  const look = segs.find((s) => /^look:/i.test(s))?.replace(/^look:\s*/i, '');
  const action = segs.find((s) => !/^look:/i.test(s));
  return { action: action || undefined, look: look || undefined };
}

interface PromptOpts { hasAnchor: boolean; hasStart: boolean; refGrids: number; refCells: number; grids: number; intervalSec: number; takeDurSec: number; expect?: string; look?: string }

const DENSE_PROMPT = (shot: Shot, p: VideoProject, opts: PromptOpts) => {
  const chars = shot.characterIds.map((id) => p.characters.find((c) => c.id === id)?.name).filter(Boolean).join(', ');
  let n = 0;
  const lead: string[] = [];
  if (opts.hasAnchor) lead.push(`image ${++n} is the identity reference for ${chars || 'the subject'}`);
  if (opts.hasStart) lead.push(`image ${++n} is the approved start frame (outfit + scene the clip starts from)`);
  const refFirst = n + 1; n += opts.refGrids;
  const first = n + 1;
  const refStep = opts.refCells ? opts.takeDurSec / opts.refCells : 0;
  return [
    `You are the final quality gate for one AI-generated video clip before a client sees it. Be strict: one visible defect is a fail.`,
    lead.length ? `${lead.join('; ')}.` : '',
    opts.refGrids ? `Images ${refFirst}-${refFirst + opts.refGrids - 1} are contact sheets of the ORIGINAL REFERENCE performance this clip copies (a different person, same motion and same garments). Reference cell j shows the same moment as clip time ~${refStep.toFixed(2)}*j s.` : '',
    `Images ${first}-${first + opts.grids - 1} are contact sheets of the GENERATED clip: each sheet is a ${GRID_COLS}x${GRID_ROWS} grid read left-to-right, top-to-bottom; consecutive cells are ${opts.intervalSec.toFixed(2)}s apart and sheets continue each other (cell index k counts across all sheets from 0, clip time = k*${opts.intervalSec.toFixed(2)}s).`,
    `The clip was meant to show: "${String(shot.prompt || '').slice(0, 300)}".${opts.expect ? ` Action in the reference: ${opts.expect}.` : ''}${opts.look ? ` Outfit the generated person must wear: ${opts.look}.` : ''}`,
    opts.refGrids || opts.look
      ? 'GARMENT CHECK (most important): list every garment the reference performer wears or handles (e.g. "open white button-up shirt", "blue tee", "grey wide-leg trousers") and, for each generated cell, confirm the generated person has the SAME garment type behaving the same way at the matching moment. A garment that turns into a different type of garment (an open button-up shirt that becomes a shrug, wrap, scarf, cape, bolero or two separate fabric panels), a garment that splits down the middle so the layer underneath shows through where the reference shows one continuous garment, a garment that appears/disappears where the reference keeps it, or missing collar/buttons/sleeves the reference garment clearly has, is a MAJOR defect even when it looks plausible as fashion on its own.'
      : '',
    'Also check EVERY cell for: clothing that tears, splits, opens or fuses unnaturally; garments changing type/color/pattern without a real action; identity drift (face, glasses, hairstyle, hair length/color) versus the identity reference; extra/missing/fused fingers or limbs; melting or morphing body parts; objects popping in/out; text garbling; severe blur/artifacts.',
    'Natural garment actions that the reference motion performs (putting on a shirt, opening a jacket) are fine ONLY when the same garment exists and moves physically like in the reference.',
    'Answer ONLY JSON: {"garments": ["reference garments you identified"], "score": 1-10, "verdict": "pass"|"reroll", "defects": [{"cell": <k generated-clip cell>, "issue": "short description", "severity": "minor"|"major"}]}. verdict is "reroll" if any major defect or score < 7.',
  ].filter(Boolean).join(' ');
};

export async function denseTakeCheck(ws: string, p: VideoProject, shot: Shot, take: Take, opts: { workDir: string; expect?: string; look?: string } ): Promise<DenseCheck> {
  const takeAbs = fromWorkspaceRel(ws, take.path);
  if (!fs.existsSync(takeAbs)) throw new Error(`take file missing: ${take.path}`);
  const dur = take.durationSec || (await mediaDurationSec(takeAbs)) || shot.durationSec;
  // Every 0.25s, but never more than 6 sheets (72 cells) for long clips.
  const intervalSec = Math.max(0.25, +(dur / (PER_GRID * 6)).toFixed(3));
  const { grids, frames } = await contactGrids(takeAbs, opts.workDir, { intervalSec, prefix: take.id, durationSec: dur });
  const images: string[] = [];
  let hasAnchor = false; let hasStart = false;
  const anchor = shot.characterIds.map((id) => p.characters.find((c) => c.id === id)?.anchors?.[0]).find(Boolean);
  if (anchor) { try { const a = fromWorkspaceRel(ws, anchor); if (fs.existsSync(a)) { images.push(toDataUrl(a)); hasAnchor = true; } } catch { /* optional */ } }
  if (shot.startImage) { try { const s = fromWorkspaceRel(ws, shot.startImage); if (fs.existsSync(s)) { images.push(toDataUrl(s)); hasStart = true; } } catch { /* optional */ } }
  // The motion reference (what the model copied) is the ground truth for garments: a judge that only
  // sees the face + start frame passed an open button-up that morphed into a split shrug (2026-10-07).
  const MAX_IMAGES = 8;
  let refGrids: string[] = []; let refCells = 0;
  if (shot.sourceVideo) {
    try {
      const refAbs = fromWorkspaceRel(ws, shot.sourceVideo);
      const refDur = fs.existsSync(refAbs) ? await mediaDurationSec(refAbs) : 0;
      if (refDur) {
        // 1-2 reference sheets, but never squeeze the take below 4 sheets of coverage.
        const want = Math.max(1, Math.min(2, grids.length, MAX_IMAGES - images.length - Math.min(grids.length, 4)));
        refCells = want * PER_GRID;
        const ref = await contactGrids(refAbs, opts.workDir, { intervalSec: +(refDur / refCells).toFixed(3), prefix: `ref_${take.id}`, durationSec: refDur });
        refGrids = ref.grids.slice(0, want);
        refCells = Math.min(refCells, ref.frames || refCells);
      }
    } catch { refGrids = []; refCells = 0; /* reference optional: fall back to anchor/start only */ }
  }
  images.push(...refGrids.map(toDataUrl));
  const sheets = grids.slice(0, MAX_IMAGES - images.length);
  images.push(...sheets.map(toDataUrl));

  const fromNotes = expectedFromNotes(shot.notes);
  const win = trendWindow(shot);
  const length = lengthDefects(shot, dur, win ? win.endSec - win.startSec : undefined);
  const r = await judge(DENSE_PROMPT(shot, p, {
    hasAnchor, hasStart, refGrids: refGrids.length, refCells, grids: sheets.length, intervalSec, takeDurSec: dur,
    expect: opts.expect || fromNotes.action, look: opts.look || fromNotes.look,
  }), images, 900);
  if (!r.success || !r.text) throw new Error(`dense QA vision failed: ${r.error || 'no response'}`);
  const j = parseJson(r.text) || {};
  const defects: TakeDefect[] = (Array.isArray(j.defects) ? j.defects : []).slice(0, 10).map((d: any) => {
    const cell = Number(d?.cell);
    return {
      atSec: Number.isFinite(cell) ? +(Math.max(0, cell) * intervalSec).toFixed(2) : undefined,
      issue: String(d?.issue || 'unspecified defect').slice(0, 140),
      severity: d?.severity === 'minor' ? 'minor' : 'major',
    } as TakeDefect;
  });
  defects.push(...length);
  let score = Math.max(1, Math.min(10, Math.round(Number(j.score) || 5)));
  if (defects.some((d) => d.severity === 'major')) score = Math.min(score, 5);
  const verdict: 'pass' | 'reroll' = j.verdict === 'reroll' || score < 7 || defects.some((d) => d.severity === 'major') ? 'reroll' : 'pass';
  const issues = defects.map((d) => `${d.atSec !== undefined ? `@${d.atSec.toFixed(2)}s ` : ''}${d.severity === 'major' ? '' : '(minor) '}${d.issue}`);
  return { score, verdict, issues, defects, model: r.model || 'vision', framesChecked: frames, intervalSec };
}

// ── Reel breakdown ────────────────────────────────────────────────────────

export interface BreakdownPart {
  startSec: number; endSec: number;
  /** Source playback speed for generation (<1 = slowed to reach the model minimum). Assembly undoes it. */
  speed: number;
  action?: string;
  garmentChange?: boolean;
  /** Outfit the start frame must show so the model has every garment it will animate. */
  look?: string;
  risks: string[];
}
export interface ReelBreakdown { durationSec: number; minPartSec: number; parts: BreakdownPart[]; subject?: string; vision: 'ok' | 'unavailable'; note?: string }

/**
 * Turn raw cut points into generation parts that respect the model minimum:
 * short parts merge into a neighbour when the merge stays sensible, otherwise
 * they are slowed (speed < 1) so the uploaded reference reaches minPartSec.
 */
export function planParts(total: number, cuts: number[], minPartSec: number, maxParts: number): Array<{ startSec: number; endSec: number; speed: number }> {
  let b = [0, ...cuts.filter((c) => c > 0.3 && c < total - 0.3).sort((x, y) => x - y), total];
  while (b.length - 1 > maxParts) {
    // drop the boundary that creates the shortest part
    let worst = 1; let shortest = Infinity;
    for (let i = 1; i < b.length - 1; i++) { const len = Math.min(b[i] - b[i - 1], b[i + 1] - b[i]); if (len < shortest) { shortest = len; worst = i; } }
    b.splice(worst, 1);
  }
  const parts = b.slice(1).map((e, i) => ({ startSec: +b[i].toFixed(2), endSec: +e.toFixed(2), speed: 1 }));
  for (const pt of parts) {
    const len = pt.endSec - pt.startSec;
    if (len < minPartSec) pt.speed = +(Math.max(0.33, len / (minPartSec + 0.05))).toFixed(3);
  }
  return parts;
}

async function detectCuts(abs: string, threshold = 0.08, minGapSec = 0.8): Promise<number[]> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', abs, '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'], 120_000).catch(() => ({ code: 1, stderr: '' }));
  const cuts: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const t = Number(m[1]);
    if (t > minGapSec && (!cuts.length || t - cuts[cuts.length - 1] >= minGapSec)) cuts.push(+t.toFixed(2));
  }
  return cuts;
}

const BREAKDOWN_PROMPT = (parts: Array<{ startSec: number; endSec: number }>, sheetsPerPart: number[], intervals: number[]) => [
  'You are planning an AI motion-transfer remake of a short vertical reel: a different person will perform each part. The model copies motion but must INVENT any garment that is not visible in the part\'s first frame, which causes tearing/splitting.',
  `The images are contact sheets (4x3 grids, read left-to-right, top-to-bottom) in order. ${parts.map((pt, i) => `Part ${i + 1} (${pt.startSec}-${pt.endSec}s) = ${sheetsPerPart[i]} sheet(s), cells ${intervals[i].toFixed(2)}s apart`).join('; ')}.`,
  'For EACH part report: action (what the person does, 1 sentence); garmentChange (true if any garment is put on, taken off, opened, closed, buttoned or swapped during the part); look (the full outfit the start frame must show so every garment that moves later is already present, e.g. "white tee, open blue button-up shirt draped on the shoulders, grey wide-leg trousers"); risks (short list from: fast spin, hands on clothing, garment change, occlusion, hair flip, object interaction, camera move, low light, partial body).',
  'Also report subject: the original performer\'s build/height impression in a few words.',
  'Answer ONLY JSON: {"subject": "...", "parts": [{"action": "...", "garmentChange": true|false, "look": "...", "risks": ["..."]}]}',
].join(' ');

export async function breakdownReel(sourceAbs: string, opts: { workDir: string; cuts?: number[]; maxParts?: number; minPartSec?: number }): Promise<ReelBreakdown> {
  const total = (await mediaDurationSec(sourceAbs)) || 5;
  const minPartSec = Math.max(0, opts.minPartSec ?? 0);
  const maxParts = Math.max(1, Math.min(6, Number(opts.maxParts) || 3));
  const cuts = opts.cuts?.length ? opts.cuts : await detectCuts(sourceAbs);
  const plan = planParts(total, cuts, minPartSec, maxParts);
  const parts: BreakdownPart[] = plan.map((pt) => ({ ...pt, risks: pt.speed < 1 ? [`shorter than the ${minPartSec}s model minimum: reference slowed to ${pt.speed}x, sped back up at assembly`] : [] }));

  try {
    const sheets: string[] = []; const perPart: number[] = []; const intervals: number[] = [];
    const budget = Math.max(1, Math.floor(7 / parts.length));
    for (const [i, pt] of parts.entries()) {
      const len = pt.endSec - pt.startSec;
      const interval = Math.max(0.2, +(len / (PER_GRID * budget)).toFixed(3));
      const g = await contactGrids(sourceAbs, opts.workDir, { startSec: pt.startSec, durationSec: len, intervalSec: interval, prefix: `p${i + 1}`, width: 260 });
      const use = g.grids.slice(0, budget);
      sheets.push(...use.map(toDataUrl)); perPart.push(use.length); intervals.push(interval);
    }
    const r = await judge(BREAKDOWN_PROMPT(parts, perPart, intervals), sheets.slice(0, 8), 900);
    const j = r.success ? parseJson(r.text || '') : null;
    if (!j || !Array.isArray(j.parts)) return { durationSec: +total.toFixed(2), minPartSec, parts, vision: 'unavailable', note: r.error || 'vision returned no part breakdown' };
    parts.forEach((pt, i) => {
      const v = j.parts[i] || {};
      if (v.action) pt.action = String(v.action).slice(0, 200);
      pt.garmentChange = v.garmentChange === true;
      if (v.look) pt.look = String(v.look).slice(0, 240);
      for (const risk of (Array.isArray(v.risks) ? v.risks : []).slice(0, 6)) pt.risks.push(String(risk).slice(0, 60));
    });
    return { durationSec: +total.toFixed(2), minPartSec, parts, subject: j.subject ? String(j.subject).slice(0, 120) : undefined, vision: 'ok' };
  } catch (e: any) {
    return { durationSec: +total.toFixed(2), minPartSec, parts, vision: 'unavailable', note: String(e?.message || e).slice(0, 200) };
  }
}
