import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SUPERVISOR_RESTART_REQUEST_FILENAME = 'supervisor-restart-request.json';
export const SUPERVISOR_RESTART_REQUEST_VERSION = 1 as const;
export const SUPERVISOR_RESTART_REQUEST_MAX_AGE_MS = 5 * 60_000;

export interface SupervisorRestartRequest {
  version: typeof SUPERVISOR_RESTART_REQUEST_VERSION;
  id: string;
  createdAt: number;
  gatewayPid: number;
  reason: string;
  affectedFiles: string[];
}

export interface SupervisorRestartRequestTakeResult {
  request: SupervisorRestartRequest | null;
  status: 'none' | 'accepted' | 'invalid' | 'stale' | 'pid_mismatch';
}

function boundedText(value: unknown, maxChars: number): string {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxChars);
}

function normalizedFile(value: unknown): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * Files executed by the long-lived CLI supervisor require replacing that
 * process. Ordinary gateway/backend files only require replacing its child.
 */
export function requiresSupervisorRestartForFiles(files: unknown): boolean {
  if (!Array.isArray(files)) return false;
  return files.some((raw) => {
    const file = normalizedFile(raw);
    if (!file) return false;
    return file.startsWith('src/cli/')
      || file.includes('/src/cli/')
      || file.startsWith('dist/cli/')
      || file.includes('/dist/cli/')
      || file === 'src/runtime/supervisor-restart-request.ts'
      || file.endsWith('/src/runtime/supervisor-restart-request.ts')
      || file.startsWith('bin/')
      || file.includes('/bin/prometheus.');
  });
}

export function resolveGatewayRestartScope(input: {
  affectedFiles?: unknown;
  requestedScope?: unknown;
  fullSupervisor?: unknown;
}): 'gateway' | 'supervisor' {
  return String(input.requestedScope || '').trim().toLowerCase() === 'supervisor'
    || input.fullSupervisor === true
    || requiresSupervisorRestartForFiles(input.affectedFiles)
    ? 'supervisor'
    : 'gateway';
}

export function supervisorRestartRequestPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), SUPERVISOR_RESTART_REQUEST_FILENAME);
}

export function writeSupervisorRestartRequest(
  stateDir: string,
  input: { gatewayPid: number; reason?: string; affectedFiles?: string[]; now?: number },
): SupervisorRestartRequest {
  const gatewayPid = Math.floor(Number(input.gatewayPid));
  if (!Number.isInteger(gatewayPid) || gatewayPid <= 0) {
    throw new Error('A valid gateway PID is required for supervisor replacement.');
  }
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const request: SupervisorRestartRequest = {
    version: SUPERVISOR_RESTART_REQUEST_VERSION,
    id: crypto.randomUUID(),
    createdAt: now,
    gatewayPid,
    reason: boundedText(input.reason, 240) || 'supervisor-owned source changed',
    affectedFiles: Array.from(new Set((input.affectedFiles || [])
      .map((file) => boundedText(file, 500))
      .filter(Boolean)))
      .slice(0, 100),
  };
  const target = supervisorRestartRequestPath(stateDir);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(request), { encoding: 'utf8', flag: 'wx' });
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return request;
}

export function removeSupervisorRestartRequest(stateDir: string): void {
  try { fs.rmSync(supervisorRestartRequestPath(stateDir), { force: true }); } catch {}
}

/**
 * Atomically claims and consumes the one-shot request. A stale or wrong-PID
 * request is discarded so it can never replace a later, unrelated supervisor.
 */
export function takeSupervisorRestartRequest(
  stateDir: string,
  expectedGatewayPid: number,
  now = Date.now(),
): SupervisorRestartRequestTakeResult {
  const target = supervisorRestartRequestPath(stateDir);
  if (!fs.existsSync(target)) return { request: null, status: 'none' };
  const claimed = `${target}.claim-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  try {
    fs.renameSync(target, claimed);
  } catch {
    return { request: null, status: 'none' };
  }
  try {
    let parsed: SupervisorRestartRequest;
    try {
      parsed = JSON.parse(fs.readFileSync(claimed, 'utf8')) as SupervisorRestartRequest;
    } catch {
      return { request: null, status: 'invalid' };
    }
    if (
      parsed?.version !== SUPERVISOR_RESTART_REQUEST_VERSION
      || !parsed.id
      || !Number.isFinite(Number(parsed.createdAt))
      || !Number.isInteger(Number(parsed.gatewayPid))
    ) return { request: null, status: 'invalid' };
    if (Math.max(0, now - Number(parsed.createdAt)) > SUPERVISOR_RESTART_REQUEST_MAX_AGE_MS) {
      return { request: null, status: 'stale' };
    }
    if (Number(parsed.gatewayPid) !== Number(expectedGatewayPid)) {
      return { request: null, status: 'pid_mismatch' };
    }
    return { request: parsed, status: 'accepted' };
  } finally {
    try { fs.rmSync(claimed, { force: true }); } catch {}
  }
}
