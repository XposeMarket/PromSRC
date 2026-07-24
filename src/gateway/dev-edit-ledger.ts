/**
 * Durable, mutation-grade audit trail for approved Prometheus self-edits.
 *
 * This deliberately does not share the rotating general audit log.  A dev edit
 * must remain independently reconstructable after normal tool-log retention.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export interface DevEditLedgerMutation {
  sequence: number;
  toolName: string;
  file: string;
  operation: 'create' | 'update' | 'delete';
  status: 'pending' | 'applied' | 'failed';
  startedAt: string;
  completedAt?: string;
  beforeSha256?: string;
  afterSha256?: string;
  patchPath?: string;
  beforePath?: string;
  afterPath?: string;
  error?: string;
}

export interface DevEditLedgerRecord {
  version: 1;
  id: string;
  displayId: string;
  sessionId: string;
  approvalId?: string;
  planHash?: string;
  allowedFiles: string[];
  createdAt: string;
  updatedAt: string;
  mutations: DevEditLedgerMutation[];
}

export interface PreparedDevEditMutation {
  devEditId: string;
  sequence: number;
  file: string;
  absPath: string;
  beforePath?: string;
}

function root(): string {
  const base = process.env.PROMETHEUS_DATA_DIR || process.env.PROMETHEUS_APP_ROOT || path.resolve(__dirname, '..', '..');
  const dir = path.join(base, '.prometheus', 'dev-edits');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safe(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 180);
}

function recordPath(id: string): string { return path.join(root(), `${safe(id)}.json`); }
function editDir(id: string): string {
  const dir = path.join(root(), safe(id));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function writeJsonAtomic(target: string, value: unknown): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}
function hash(content: Buffer): string { return crypto.createHash('sha256').update(content).digest('hex'); }
function relativeToRoot(file: string): string { return path.relative(root(), file).replace(/\\/g, '/'); }

function nextDisplayId(): string {
  const counterPath = path.join(root(), '.counter.json');
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let state: { day?: string; value?: number } = {};
  try { state = JSON.parse(fs.readFileSync(counterPath, 'utf8')); } catch {}
  const value = state.day === day ? Number(state.value || 0) + 1 : 1;
  writeJsonAtomic(counterPath, { day, value });
  return `DEV-${day}-${String(value).padStart(5, '0')}`;
}

function load(id: string): DevEditLedgerRecord | null {
  try { return JSON.parse(fs.readFileSync(recordPath(id), 'utf8')) as DevEditLedgerRecord; } catch { return null; }
}
function save(record: DevEditLedgerRecord): void {
  record.updatedAt = new Date().toISOString();
  writeJsonAtomic(recordPath(record.id), record);
}

export function createDevEditLedger(input: {
  id: string; sessionId: string; approvalId?: string; planHash?: string; allowedFiles: string[];
}): DevEditLedgerRecord {
  const existing = load(input.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const record: DevEditLedgerRecord = {
    version: 1,
    id: input.id,
    displayId: nextDisplayId(),
    sessionId: input.sessionId,
    approvalId: input.approvalId,
    planHash: input.planHash,
    allowedFiles: Array.from(new Set(input.allowedFiles)),
    createdAt: now,
    updatedAt: now,
    mutations: [],
  };
  save(record);
  return record;
}

export function prepareDevEditMutation(input: {
  devEditId: string; toolName: string; file: string; absPath: string;
}): PreparedDevEditMutation {
  const record = load(input.devEditId);
  if (!record) throw new Error(`No durable dev-edit ledger exists for ${input.devEditId}.`);
  const sequence = record.mutations.length + 1;
  const dir = editDir(input.devEditId);
  const before = fs.existsSync(input.absPath) && fs.statSync(input.absPath).isFile()
    ? fs.readFileSync(input.absPath) : null;
  const beforePath = before ? path.join(dir, `${String(sequence).padStart(4, '0')}.before`) : undefined;
  if (beforePath && before) fs.writeFileSync(beforePath, before);
  record.mutations.push({
    sequence,
    toolName: input.toolName,
    file: input.file,
    operation: before ? 'update' : 'create',
    status: 'pending',
    startedAt: new Date().toISOString(),
    ...(before ? { beforeSha256: hash(before), beforePath: relativeToRoot(beforePath!) } : {}),
  });
  save(record); // Persist before the source write: failure here prevents the mutation.
  return { devEditId: input.devEditId, sequence, file: input.file, absPath: input.absPath, beforePath };
}

function fallbackPatch(file: string, before: string, after: string): string {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0; while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const old = a.slice(prefix, a.length - suffix);
  const next = b.slice(prefix, b.length - suffix);
  return [`--- a/${file}`, `+++ b/${file}`, `@@ -${prefix + 1},${old.length} +${prefix + 1},${next.length} @@`, ...old.map(line => `-${line}`), ...next.map(line => `+${line}`)].join('\n') + '\n';
}

function normalizePatchPaths(file: string, patch: string): string {
  const lines = String(patch || '').replace(/\r\n/g, '\n').split('\n');
  const body = lines.filter(line => !line.startsWith('diff --git ') && !line.startsWith('index '));
  return body.map((line) => {
    if (line.startsWith('--- ')) return `--- a/${file}`;
    if (line.startsWith('+++ ')) return `+++ b/${file}`;
    return line;
  }).filter((line, index) => line || index < body.length - 1).join('\n') + '\n';
}

function unifiedPatch(file: string, beforePath: string | undefined, afterPath: string | undefined, before: Buffer | null, after: Buffer | null): string {
  if (beforePath && afterPath) {
    try {
      return normalizePatchPaths(file, execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-ext-diff', '--unified=3', '--', beforePath, afterPath], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }));
    } catch (err: any) {
      if (typeof err?.stdout === 'string' && err.stdout.trim()) return normalizePatchPaths(file, err.stdout);
    }
  }
  return fallbackPatch(file, before?.toString('utf8') || '', after?.toString('utf8') || '');
}

export function finalizeDevEditMutation(prepared: PreparedDevEditMutation, error?: unknown): DevEditLedgerMutation | null {
  const record = load(prepared.devEditId);
  const mutation = record?.mutations.find(item => item.sequence === prepared.sequence);
  if (!record || !mutation) return null;
  if (error) {
    mutation.status = 'failed'; mutation.error = String(error); mutation.completedAt = new Date().toISOString(); save(record); return mutation;
  }
  const after = fs.existsSync(prepared.absPath) && fs.statSync(prepared.absPath).isFile() ? fs.readFileSync(prepared.absPath) : null;
  const before = prepared.beforePath && fs.existsSync(prepared.beforePath) ? fs.readFileSync(prepared.beforePath) : null;
  mutation.operation = !after ? 'delete' : !before ? 'create' : 'update';
  const dir = editDir(prepared.devEditId);
  const afterPath = after ? path.join(dir, `${String(prepared.sequence).padStart(4, '0')}.after`) : undefined;
  if (afterPath && after) fs.writeFileSync(afterPath, after);
  const patchPath = path.join(dir, `${String(prepared.sequence).padStart(4, '0')}.patch`);
  fs.writeFileSync(patchPath, unifiedPatch(prepared.file, prepared.beforePath, afterPath, before, after), 'utf8');
  mutation.status = 'applied'; mutation.completedAt = new Date().toISOString();
  if (after) { mutation.afterSha256 = hash(after); mutation.afterPath = relativeToRoot(afterPath!); }
  mutation.patchPath = relativeToRoot(patchPath);
  save(record);
  return mutation;
}

export function getDevEditLedger(id: string): DevEditLedgerRecord | null {
  const direct = load(id);
  if (direct) return direct;
  try {
    for (const file of fs.readdirSync(root())) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      const record = load(file.slice(0, -5));
      if (record?.displayId === id) return record;
    }
  } catch {}
  return null;
}

export function getDevEditLedgerPatch(id: string, sequence: number): string | null {
  const record = getDevEditLedger(id);
  const mutation = record?.mutations.find(item => item.sequence === sequence);
  if (!mutation?.patchPath) return null;
  try { return fs.readFileSync(path.join(root(), mutation.patchPath), 'utf8'); } catch { return null; }
}

export function linkDevEditLedgerApproval(id: string, approvalId?: string): void {
  if (!approvalId) return;
  const record = load(id);
  if (!record) return;
  record.approvalId = approvalId;
  save(record);
}
