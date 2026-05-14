import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';

export type CommandPermissionScope = 'session' | 'always';
export type CommandPermissionMatchMode = 'exact';
export type ToolPermissionScope = CommandPermissionScope;

export interface ToolPermissionCandidate {
  sessionId: string;
  toolName: string;
  action: string;
  targetKind: 'command_cwd' | 'desktop_window' | 'browser_page' | 'generic';
  target: string;
  targetDisplay?: string;
  workspaceRoot?: string;
  riskScore: number;
  command?: string;
  cwd?: string;
  cwdDisplay?: string;
}

export interface CommandPermissionCandidate extends ToolPermissionCandidate {
  toolName: 'run_command';
  targetKind: 'command_cwd';
  command: string;
  cwd: string;
  workspaceRoot: string;
}

export interface CommandPermissionGrant {
  id: string;
  scope: ToolPermissionScope;
  toolName: string;
  actionHash: string;
  targetHash: string;
  workspaceHash: string;
  actionDisplay: string;
  targetKind: ToolPermissionCandidate['targetKind'];
  targetDisplay: string;
  workspaceDisplay: string;
  matchMode: CommandPermissionMatchMode;
  riskCeiling: number;
  createdAt: string;
  createdBy: string;
  sessionId?: string;
  lastUsedAt?: string;
  useCount?: number;
  commandHash?: string;
  cwdHash?: string;
  commandDisplay?: string;
  cwdDisplay?: string;
}

const persistedGrants: { loaded: boolean; grants: CommandPermissionGrant[] } = {
  loaded: false,
  grants: [],
};

function storePath(): string {
  return path.join(getConfig().getConfigDir(), 'command-permissions.json');
}

function stablePath(value: string): string {
  const resolved = path.resolve(String(value || '.'));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf-8').digest('hex');
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function redactDisplay(value: string): string {
  return String(value || '')
    .replace(/(token|api[_-]?key|password|secret)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/ig, '$1=[redacted]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/ig, '$1[redacted]')
    .slice(0, 500);
}

function normalizeGrant(raw: any): CommandPermissionGrant | null {
  if (!raw || !raw.toolName) return null;
  const scope = raw.scope === 'session' ? 'session' : raw.scope === 'always' ? 'always' : null;
  if (!scope) return null;

  const commandHash = String(raw.commandHash || '').trim();
  const cwdHash = String(raw.cwdHash || '').trim();
  const actionHash = String(raw.actionHash || commandHash || '').trim();
  const targetHash = String(raw.targetHash || cwdHash || '').trim();
  const workspaceHash = String(raw.workspaceHash || '').trim();
  if (!actionHash || !targetHash || !workspaceHash) return null;

  const toolName = String(raw.toolName || '').trim();
  const targetKind = raw.targetKind === 'desktop_window' || raw.targetKind === 'browser_page' || raw.targetKind === 'generic'
    ? raw.targetKind
    : 'command_cwd';

  return {
    id: String(raw.id || crypto.randomUUID()),
    scope,
    toolName,
    actionHash,
    targetHash,
    workspaceHash,
    actionDisplay: String(raw.actionDisplay || raw.commandDisplay || toolName),
    targetKind,
    targetDisplay: String(raw.targetDisplay || raw.cwdDisplay || ''),
    workspaceDisplay: String(raw.workspaceDisplay || ''),
    matchMode: 'exact',
    riskCeiling: Math.max(0, Math.min(10, Number(raw.riskCeiling || 0))),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    createdBy: String(raw.createdBy || 'unknown'),
    sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
    lastUsedAt: raw.lastUsedAt ? String(raw.lastUsedAt) : undefined,
    useCount: Math.max(0, Math.floor(Number(raw.useCount || 0))),
    commandHash: commandHash || undefined,
    cwdHash: cwdHash || undefined,
    commandDisplay: raw.commandDisplay ? String(raw.commandDisplay) : undefined,
    cwdDisplay: raw.cwdDisplay ? String(raw.cwdDisplay) : undefined,
  };
}

function loadGrants(): CommandPermissionGrant[] {
  if (persistedGrants.loaded) return persistedGrants.grants;
  try {
    const file = storePath();
    if (!fs.existsSync(file)) {
      persistedGrants.grants = [];
      persistedGrants.loaded = true;
      return persistedGrants.grants;
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const rows = Array.isArray(parsed?.grants) ? parsed.grants : Array.isArray(parsed) ? parsed : [];
    persistedGrants.grants = rows.map(normalizeGrant).filter(Boolean) as CommandPermissionGrant[];
  } catch {
    persistedGrants.grants = [];
  }
  persistedGrants.loaded = true;
  return persistedGrants.grants;
}

function saveGrants(): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 2, grants: loadGrants() }, null, 2), 'utf-8');
}

export function buildCommandPermissionCandidate(input: CommandPermissionCandidate) {
  const command = normalizeText(input.command);
  const cwd = stablePath(input.cwd);
  const workspaceRoot = stablePath(input.workspaceRoot);
  return buildToolPermissionCandidate({
    ...input,
    action: command,
    target: cwd,
    targetDisplay: input.cwdDisplay || input.cwd,
    workspaceRoot,
  });
}

export function buildToolPermissionCandidate(input: ToolPermissionCandidate) {
  const action = normalizeText(input.action);
  const target = input.targetKind === 'command_cwd'
    ? stablePath(input.target)
    : normalizeText(input.target).toLowerCase();
  const workspaceRoot = input.workspaceRoot ? stablePath(input.workspaceRoot) : '';
  const command = input.command ? normalizeText(input.command) : '';
  const cwd = input.cwd ? stablePath(input.cwd) : '';
  return {
    sessionId: String(input.sessionId || 'default'),
    toolName: String(input.toolName || '').trim(),
    action,
    target,
    targetKind: input.targetKind,
    workspaceRoot,
    actionHash: hash(action),
    targetHash: hash(target),
    workspaceHash: hash(workspaceRoot),
    actionDisplay: redactDisplay(action),
    targetDisplay: input.targetDisplay || input.target,
    workspaceDisplay: input.workspaceRoot || '',
    riskScore: Math.max(0, Math.min(10, Number(input.riskScore || 0))),
    commandHash: command ? hash(command) : undefined,
    cwdHash: cwd ? hash(cwd) : undefined,
    commandDisplay: command ? redactDisplay(command) : undefined,
    cwdDisplay: input.cwdDisplay,
  };
}

function matchesGrant(grant: CommandPermissionGrant, candidate: ReturnType<typeof buildToolPermissionCandidate>): boolean {
  return grant.toolName === candidate.toolName
    && grant.matchMode === 'exact'
    && grant.actionHash === candidate.actionHash
    && grant.targetHash === candidate.targetHash
    && grant.workspaceHash === candidate.workspaceHash
    && Number(grant.riskCeiling || 0) >= candidate.riskScore
    && (grant.scope !== 'session' || String(grant.sessionId || '') === candidate.sessionId);
}

export function findCommandPermissionGrant(input: ToolPermissionCandidate): CommandPermissionGrant | null {
  const candidate = buildToolPermissionCandidate(input);
  const grant = loadGrants().find((item) => matchesGrant(item, candidate)) || null;
  if (grant) {
    grant.lastUsedAt = new Date().toISOString();
    grant.useCount = (grant.useCount || 0) + 1;
    saveGrants();
  }
  return grant;
}

export function addCommandPermissionGrant(
  input: ToolPermissionCandidate,
  scope: ToolPermissionScope,
  createdBy = 'web',
): CommandPermissionGrant {
  const candidate = buildToolPermissionCandidate(input);
  const grant: CommandPermissionGrant = {
    id: crypto.randomUUID(),
    scope,
    toolName: candidate.toolName,
    actionHash: candidate.actionHash,
    targetHash: candidate.targetHash,
    workspaceHash: candidate.workspaceHash,
    actionDisplay: candidate.actionDisplay,
    targetKind: candidate.targetKind,
    targetDisplay: candidate.targetDisplay,
    workspaceDisplay: candidate.workspaceDisplay,
    matchMode: 'exact',
    riskCeiling: candidate.riskScore,
    createdAt: new Date().toISOString(),
    createdBy,
    sessionId: scope === 'session' ? candidate.sessionId : undefined,
    useCount: 0,
    commandHash: candidate.commandHash,
    cwdHash: candidate.cwdHash,
    commandDisplay: candidate.commandDisplay,
    cwdDisplay: candidate.cwdDisplay,
  };

  const existing = loadGrants();
  persistedGrants.grants = [
    grant,
    ...existing.filter((item) => !matchesGrant(item, candidate)),
  ];
  saveGrants();
  return grant;
}

export function listCommandPermissionGrants(sessionId?: string): CommandPermissionGrant[] {
  const sid = String(sessionId || '').trim();
  return loadGrants()
    .filter((item) => !sid || item.scope === 'always' || String(item.sessionId || '') === sid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function revokeCommandPermissionGrant(id: string): boolean {
  const target = String(id || '').trim();
  if (!target) return false;
  const existing = loadGrants();
  const next = existing.filter((item) => item.id !== target);
  if (next.length === existing.length) return false;
  persistedGrants.grants = next;
  saveGrants();
  return true;
}
