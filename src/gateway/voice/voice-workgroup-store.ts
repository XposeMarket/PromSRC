import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';

export type VoiceWorkgroupMode = 'parallel' | 'sequential';
export type VoiceWorkgroupDelivery = 'report_each' | 'grouped_summary' | 'task_panel_only';
export type VoiceWorkgroupStatus = 'queued' | 'running' | 'partially_complete' | 'complete' | 'failed';

export interface VoiceWorkgroupWorker {
  taskId: string;
  title: string;
  prompt: string;
  index: number;
  status: string;
  createdAt: number;
}

export interface VoiceWorkgroupRecord {
  id: string;
  parentSessionId: string;
  sourceTranscript?: string;
  source?: string;
  mode: VoiceWorkgroupMode;
  delivery: VoiceWorkgroupDelivery;
  status: VoiceWorkgroupStatus;
  createdAt: number;
  updatedAt: number;
  workers: VoiceWorkgroupWorker[];
}

function getWorkgroupsDir(): string {
  return path.join(getConfig().getConfigDir(), 'voice-workgroups');
}

function ensureWorkgroupsDir(): void {
  fs.mkdirSync(getWorkgroupsDir(), { recursive: true });
}

function workgroupPath(id: string): string {
  return path.join(getWorkgroupsDir(), `${id}.json`);
}

function normalizeMode(value: unknown): VoiceWorkgroupMode {
  return String(value || '').trim() === 'sequential' ? 'sequential' : 'parallel';
}

function normalizeDelivery(value: unknown): VoiceWorkgroupDelivery {
  const raw = String(value || '').trim();
  if (raw === 'grouped_summary' || raw === 'task_panel_only') return raw;
  return 'report_each';
}

function computeStatus(workers: VoiceWorkgroupWorker[]): VoiceWorkgroupStatus {
  if (!workers.length) return 'queued';
  const statuses = workers.map((worker) => String(worker.status || '').trim());
  if (statuses.every((status) => status === 'complete')) return 'complete';
  if (statuses.some((status) => status === 'failed')) {
    return statuses.some((status) => status === 'complete' || status === 'running' || status === 'queued')
      ? 'partially_complete'
      : 'failed';
  }
  if (statuses.some((status) => status === 'complete')) return 'partially_complete';
  if (statuses.some((status) => status === 'running')) return 'running';
  return 'queued';
}

export function saveVoiceWorkgroup(record: VoiceWorkgroupRecord): VoiceWorkgroupRecord {
  ensureWorkgroupsDir();
  const workers = Array.isArray(record.workers) ? record.workers : [];
  const next: VoiceWorkgroupRecord = {
    ...record,
    mode: normalizeMode(record.mode),
    delivery: normalizeDelivery(record.delivery),
    workers,
    status: computeStatus(workers),
    updatedAt: Date.now(),
  };
  fs.writeFileSync(workgroupPath(next.id), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function createVoiceWorkgroup(params: {
  parentSessionId: string;
  sourceTranscript?: string;
  source?: string;
  mode?: VoiceWorkgroupMode;
  delivery?: VoiceWorkgroupDelivery;
}): VoiceWorkgroupRecord {
  const now = Date.now();
  return saveVoiceWorkgroup({
    id: `voice_wg_${crypto.randomUUID()}`,
    parentSessionId: String(params.parentSessionId || '').trim(),
    sourceTranscript: String(params.sourceTranscript || '').trim() || undefined,
    source: String(params.source || '').trim() || undefined,
    mode: normalizeMode(params.mode),
    delivery: normalizeDelivery(params.delivery),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    workers: [],
  });
}

export function loadVoiceWorkgroup(id: string): VoiceWorkgroupRecord | null {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  const filePath = workgroupPath(cleanId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const workers = Array.isArray(parsed.workers)
      ? parsed.workers.map((worker: any, index: number) => ({
          taskId: String(worker?.taskId || '').trim(),
          title: String(worker?.title || '').trim(),
          prompt: String(worker?.prompt || '').trim(),
          index: Number.isFinite(Number(worker?.index)) ? Number(worker.index) : index,
          status: String(worker?.status || 'queued').trim() || 'queued',
          createdAt: Number.isFinite(Number(worker?.createdAt)) ? Number(worker.createdAt) : Date.now(),
        })).filter((worker: VoiceWorkgroupWorker) => worker.taskId)
      : [];
    return {
      id: String(parsed.id || cleanId),
      parentSessionId: String(parsed.parentSessionId || '').trim(),
      sourceTranscript: String(parsed.sourceTranscript || '').trim() || undefined,
      source: String(parsed.source || '').trim() || undefined,
      mode: normalizeMode(parsed.mode),
      delivery: normalizeDelivery(parsed.delivery),
      status: computeStatus(workers),
      createdAt: Number.isFinite(Number(parsed.createdAt)) ? Number(parsed.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : Date.now(),
      workers,
    };
  } catch {
    return null;
  }
}

export function addVoiceWorkgroupWorker(workgroupId: string, worker: Omit<VoiceWorkgroupWorker, 'createdAt'> & { createdAt?: number }): VoiceWorkgroupRecord | null {
  const record = loadVoiceWorkgroup(workgroupId);
  if (!record) return null;
  const taskId = String(worker.taskId || '').trim();
  if (!taskId) return record;
  const nextWorker: VoiceWorkgroupWorker = {
    taskId,
    title: String(worker.title || '').trim() || `Worker ${record.workers.length + 1}`,
    prompt: String(worker.prompt || '').trim(),
    index: Number.isFinite(Number(worker.index)) ? Number(worker.index) : record.workers.length,
    status: String(worker.status || 'queued').trim() || 'queued',
    createdAt: Number.isFinite(Number(worker.createdAt)) ? Number(worker.createdAt) : Date.now(),
  };
  const workers = record.workers.filter((entry) => entry.taskId !== taskId);
  workers.push(nextWorker);
  workers.sort((a, b) => a.index - b.index);
  return saveVoiceWorkgroup({ ...record, workers });
}

export function updateVoiceWorkgroupWorkerStatus(workgroupId: string, taskId: string, status: string): VoiceWorkgroupRecord | null {
  const record = loadVoiceWorkgroup(workgroupId);
  if (!record) return null;
  const cleanTaskId = String(taskId || '').trim();
  const cleanStatus = String(status || '').trim();
  if (!cleanTaskId || !cleanStatus) return record;
  let changed = false;
  const workers = record.workers.map((worker) => {
    if (worker.taskId !== cleanTaskId) return worker;
    changed = true;
    return { ...worker, status: cleanStatus };
  });
  return changed ? saveVoiceWorkgroup({ ...record, workers }) : record;
}

export function listVoiceWorkgroupsForSession(parentSessionId: string): VoiceWorkgroupRecord[] {
  const sid = String(parentSessionId || '').trim();
  if (!sid) return [];
  ensureWorkgroupsDir();
  return fs.readdirSync(getWorkgroupsDir())
    .filter((file) => file.endsWith('.json'))
    .map((file) => loadVoiceWorkgroup(path.basename(file, '.json')))
    .filter((record): record is VoiceWorkgroupRecord => !!record && record.parentSessionId === sid)
    .sort((a, b) => b.createdAt - a.createdAt);
}
