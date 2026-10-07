/**
 * video-project-wake.ts
 *
 * Watches video-project jobs and wakes the originating main-chat session once
 * every watched job is terminal. Watches persist to
 * <workspace>/video-projects/_wake.json and are re-armed at gateway start.
 */
import fs from 'fs';
import path from 'path';
import { loadProject, onProjectChange, type VideoProject } from '../media-engine/project.js';
import { wakeSession } from './session-wake';

export interface VideoJobWatch {
  id: string;
  workspacePath: string;
  sessionId: string;
  projectId: string;
  jobIds: string[];
  note?: string;
  createdAt: number;
}

const TERMINAL = new Set(['done', 'failed', 'canceled']);
export const VIDEO_WAKE_TIMEOUT_MS = 45 * 60 * 1000;
const POLL_MS = 30_000;

const watches = new Map<string, VideoJobWatch>();
const armedWorkspaces = new Set<string>();
let unsubscribe: (() => void) | null = null;
let pollTimer: NodeJS.Timeout | null = null;

function storePath(workspacePath: string): string {
  return path.join(workspacePath, 'video-projects', '_wake.json');
}

function readStore(workspacePath: string): VideoJobWatch[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(workspacePath), 'utf8'));
    return Array.isArray(raw?.watches) ? raw.watches : [];
  } catch { return []; }
}

function writeStore(workspacePath: string): void {
  const list = [...watches.values()].filter((w) => w.workspacePath === workspacePath);
  const file = storePath(workspacePath);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ watches: list }, null, 2));
    fs.renameSync(tmp, file);
  } catch (err: any) {
    console.warn('[VideoProjectWake] persist failed:', err?.message || err);
  }
}

function ensureListeners(): void {
  if (!unsubscribe) {
    unsubscribe = onProjectChange((ev) => {
      for (const w of [...watches.values()]) {
        if (w.projectId === ev.projectId && path.resolve(w.workspacePath) === path.resolve(ev.workspacePath)) checkWatch(w);
      }
    });
  }
  if (!pollTimer) {
    pollTimer = setInterval(() => checkAllVideoWatches(), POLL_MS);
    (pollTimer as any).unref?.();
  }
}

export function watchVideoJobs(input: {
  workspacePath: string; sessionId: string; projectId: string; jobIds: string[]; note?: string;
}): { watchId: string; jobIds: string[] } {
  const jobIds = [...new Set((input.jobIds || []).map((j) => String(j || '').trim()).filter(Boolean))];
  if (!input.workspacePath || !input.sessionId || !input.projectId || jobIds.length === 0) {
    throw new Error('watchVideoJobs requires workspacePath, sessionId, projectId and at least one jobId.');
  }
  const w: VideoJobWatch = {
    id: `vw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    workspacePath: input.workspacePath,
    sessionId: input.sessionId,
    projectId: input.projectId,
    jobIds,
    note: input.note ? String(input.note) : undefined,
    createdAt: Date.now(),
  };
  watches.set(w.id, w);
  writeStore(w.workspacePath);
  ensureListeners();
  checkWatch(w); // jobs may already be finished
  return { watchId: w.id, jobIds };
}

export function initVideoProjectWake(workspacePath: string): number {
  if (!workspacePath) return 0;
  const key = path.resolve(workspacePath);
  if (!armedWorkspaces.has(key)) {
    armedWorkspaces.add(key);
    for (const w of readStore(workspacePath)) {
      if (w?.id && !watches.has(w.id)) watches.set(w.id, { ...w, workspacePath });
    }
  }
  ensureListeners();
  const mine = [...watches.values()].filter((w) => path.resolve(w.workspacePath) === key);
  for (const w of mine) checkWatch(w);
  return mine.length;
}

export function listVideoWatches(): VideoJobWatch[] { return [...watches.values()]; }

export function checkAllVideoWatches(): void {
  for (const w of [...watches.values()]) checkWatch(w);
}

/** Test helper: drop in-memory state (persisted file untouched). */
export function resetVideoProjectWakeForTests(): void {
  watches.clear(); armedWorkspaces.clear();
  unsubscribe?.(); unsubscribe = null;
  if (pollTimer) clearInterval(pollTimer); pollTimer = null;
}

function describeTarget(p: VideoProject, job: any): string {
  const t = job?.target || {};
  if (t.shotId) {
    const shot: any = (p.shots || []).find((s: any) => s.id === t.shotId);
    return `shot '${shot?.title || shot?.name || t.shotId}'`;
  }
  if (t.characterId) {
    const c: any = ((p as any).characters || []).find((x: any) => x.id === t.characterId);
    return `character '${c?.name || t.characterId}'`;
  }
  return 'asset';
}

function finish(w: VideoJobWatch, message: string): void {
  if (!watches.has(w.id)) return;
  watches.delete(w.id);
  writeStore(w.workspacePath);
  wakeSession(w.sessionId, message, { source: 'video_project', key: `video:${w.id}` });
}

function checkWatch(w: VideoJobWatch): void {
  if (!watches.has(w.id)) return;
  let project: VideoProject | null = null;
  try { project = loadProject(w.workspacePath, w.projectId); } catch { project = null; }
  const title = project?.title || w.projectId;
  const timedOut = Date.now() - w.createdAt > VIDEO_WAKE_TIMEOUT_MS;
  if (!project) {
    if (timedOut) finish(w, `[video_project wake] Timed out watching ${w.projectId}: project could not be loaded.${w.note ? ` ${w.note}.` : ''} Check the project state before continuing.`);
    return;
  }
  const jobs: any[] = (project.jobs || []).filter((j: any) => w.jobIds.includes(j.id));
  const missing = w.jobIds.filter((id) => !jobs.some((j) => j.id === id));
  const allTerminal = missing.length === 0 && jobs.every((j) => TERMINAL.has(j.state));
  if (!allTerminal && !timedOut) return;

  const count = (s: string) => jobs.filter((j) => j.state === s).length;
  const spent = jobs.filter((j) => j.state === 'done').reduce((sum, j) => sum + (Number(j.actualUsd ?? j.estimateUsd) || 0), 0);
  const failures = jobs.filter((j) => j.state === 'failed')
    .map((j) => `${describeTarget(project!, j)}: ${String(j.error || 'unknown error').slice(0, 200)}`);
  const parts = [`${count('done')} done`];
  if (count('failed')) parts.push(`${count('failed')} failed (${failures.join('; ')})`);
  if (count('canceled')) parts.push(`${count('canceled')} canceled`);
  const note = w.note ? ` ${w.note.replace(/\.?$/, '.')}` : '';
  if (allTerminal) {
    const done = count('done');
    if (done === 0) {
      finish(w, `[video_project wake] ALL ${jobs.length} job(s) FAILED for ${title} (${w.projectId}): ${parts.slice(1).join(', ') || 'no output'}. Nothing was generated; spent $${spent.toFixed(2)}. Tell the user what failed and why, fix the cause, then quote before rerunning.`);
    } else {
      const partial = done < jobs.length ? ` Only ${done} of ${jobs.length} succeeded.` : '';
      finish(w, `[video_project wake] Jobs finished for ${title} (${w.projectId}): ${parts.join(', ')}. Spent $${spent.toFixed(2)}.${partial}${note} Watch the new takes (analyze_video contact sheet) before calling them good, then the next step.`);
    }
  } else {
    const pending = jobs.filter((j) => !TERMINAL.has(j.state)).length + missing.length;
    finish(w, `[video_project wake] Timed out after 45 min watching ${title} (${w.projectId}): ${parts.join(', ')}, ${pending} still pending/unknown. Spent $${spent.toFixed(2)}.${note} Check job status, then decide whether to wait, retry, or continue.`);
  }
}
