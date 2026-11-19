/**
 * external-agents.json: the user's on/off choice per connected agent plus the
 * last cached status. Lives in the Prometheus data directory (same
 * `getConfig().getConfigDir()` root the import job store uses).
 *
 * Holds no tokens, no full account email and no paths to auth files. Written
 * atomically (temp file + rename).
 */
import fs from 'fs';
import path from 'path';

import { getConfig } from '../../config/config';
import { isExternalAgentId, type ExternalAgentId, type ExternalAgentStatus } from './types';

export interface ExternalAgentStoreEntry {
  enabled: boolean;
  enabledAt?: string;
  lastStatus?: ExternalAgentStatus;
  lastStatusText?: string;
  lastCheckedAt?: string;
  version?: string;
  /** Plan label only, e.g. "ChatGPT Plus". Never an email or token. */
  accountLabel?: string;
  accountKind?: string;
}

export interface ExternalAgentStoreFile {
  version: 1;
  agents: Partial<Record<ExternalAgentId, ExternalAgentStoreEntry>>;
}

const STATUSES: ExternalAgentStatus[] = ['not_installed', 'found', 'checking', 'ready', 'signed_out', 'too_old', 'unsupported', 'error'];

let storePathOverride: string | null = null;

/** Tests only. */
export function setExternalAgentStorePathForTests(file: string | null): void {
  storePathOverride = file;
}

export function externalAgentStorePath(): string {
  return storePathOverride || path.join(getConfig().getConfigDir(), 'external-agents.json');
}

function clean(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || undefined;
}

/** Defence in depth: never persist anything that looks like an email or a token. */
function safeLabel(value: unknown): string | undefined {
  const text = clean(value, 80);
  if (!text) return undefined;
  if (/@/.test(text) || /[A-Za-z0-9_\-]{32,}/.test(text)) return undefined;
  return text;
}

function normalizeEntry(input: any): ExternalAgentStoreEntry {
  const status = STATUSES.includes(input?.lastStatus) ? input.lastStatus as ExternalAgentStatus : undefined;
  return {
    enabled: input?.enabled === true,
    ...(clean(input?.enabledAt, 40) ? { enabledAt: clean(input.enabledAt, 40) } : {}),
    ...(status ? { lastStatus: status } : {}),
    ...(safeLabel(input?.lastStatusText) ? { lastStatusText: clean(input.lastStatusText, 300) } : {}),
    ...(clean(input?.lastCheckedAt, 40) ? { lastCheckedAt: clean(input.lastCheckedAt, 40) } : {}),
    ...(clean(input?.version, 40) ? { version: clean(input.version, 40) } : {}),
    ...(safeLabel(input?.accountLabel) ? { accountLabel: safeLabel(input.accountLabel) } : {}),
    ...(safeLabel(input?.accountKind) ? { accountKind: safeLabel(input.accountKind) } : {}),
  };
}

export function readExternalAgentStore(): ExternalAgentStoreFile {
  const file = externalAgentStorePath();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const agents: ExternalAgentStoreFile['agents'] = {};
    for (const [id, entry] of Object.entries(raw?.agents || {})) {
      if (isExternalAgentId(id)) agents[id] = normalizeEntry(entry);
    }
    return { version: 1, agents };
  } catch {
    return { version: 1, agents: {} };
  }
}

function writeExternalAgentStore(store: ExternalAgentStoreFile): void {
  const file = externalAgentStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

export function getExternalAgentEntry(id: ExternalAgentId): ExternalAgentStoreEntry {
  return readExternalAgentStore().agents[id] || { enabled: false };
}

export function updateExternalAgentEntry(id: ExternalAgentId, patch: Partial<ExternalAgentStoreEntry>): ExternalAgentStoreEntry {
  const store = readExternalAgentStore();
  const next = normalizeEntry({ ...(store.agents[id] || { enabled: false }), ...patch });
  store.agents[id] = next;
  writeExternalAgentStore(store);
  return next;
}
