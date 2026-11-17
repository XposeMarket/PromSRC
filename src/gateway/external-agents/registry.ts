/**
 * Connected-agent registry: adapters by id, the user's on/off choice
 * (store.ts) and the cached status. Listing never starts a process; only
 * enable/verify run the agent's own status path.
 */
import { CodexAdapter } from './adapters/codex';
import { getExternalAgentEntry, readExternalAgentStore, updateExternalAgentEntry } from './store';
import { cancelPendingRequests } from './pending-requests';
import {
  isExternalAgentId,
  type ExternalAgentAdapter,
  type ExternalAgentId,
  type ExternalAgentSnapshot,
  type ExternalAgentVerifyResult,
} from './types';

type ManagedAdapter = ExternalAgentAdapter & { closeIdle?: () => Promise<boolean>; activeTurnCount?: () => number };

const adapters = new Map<ExternalAgentId, ManagedAdapter>();
const detection = new Map<ExternalAgentId, { found: boolean; at: number }>();
const verifying = new Map<ExternalAgentId, Promise<ExternalAgentSnapshot>>();
/** Live turn aborts per agent, so turning an agent off interrupts its running turns. */
const liveTurnAborts = new Map<ExternalAgentId, Set<() => void>>();
const DETECT_TTL_MS = 60_000;

function ensureDefaults(): void {
  if (!adapters.has('codex')) adapters.set('codex', new CodexAdapter());
}

/** Tests: replace an adapter (for example one that runs the fake app-server). */
export function setExternalAgentAdapterForTests(adapter: ManagedAdapter | null, id: ExternalAgentId = 'codex'): void {
  if (adapter) adapters.set(id, adapter);
  else adapters.delete(id);
  detection.delete(id);
}

export function getExternalAgentAdapter(id: ExternalAgentId): ManagedAdapter | null {
  ensureDefaults();
  return adapters.get(id) || null;
}

export function listExternalAgentAdapters(): ManagedAdapter[] {
  ensureDefaults();
  return [...adapters.values()];
}

async function detectCached(adapter: ManagedAdapter, fresh = false): Promise<boolean> {
  const cached = detection.get(adapter.id);
  if (!fresh && cached && Date.now() - cached.at < DETECT_TTL_MS) return cached.found;
  let found = false;
  try { found = (await adapter.detect()).found; } catch { found = false; }
  detection.set(adapter.id, { found, at: Date.now() });
  return found;
}

function snapshotFrom(adapter: ManagedAdapter, found: boolean): ExternalAgentSnapshot {
  const entry = getExternalAgentEntry(adapter.id);
  let status = entry.lastStatus || (found ? 'found' : 'not_installed');
  let statusText = entry.lastStatusText || '';
  if (!found) {
    status = 'not_installed';
    statusText = "Codex isn't installed on this computer.".replace('Codex', adapter.name);
  } else if (!entry.enabled) {
    status = 'found';
    statusText = '';
  } else if (status === 'found' || status === 'not_installed') {
    status = 'checking';
    statusText = `Checking ${adapter.name}…`;
  }
  const fixHint = status === 'signed_out' ? `Run \`${adapter.id} login\` in a terminal, then Check again.` : undefined;
  return {
    id: adapter.id,
    name: adapter.name,
    tile: adapter.tile,
    detected: found,
    enabled: entry.enabled,
    status,
    statusText,
    ...(fixHint ? { fixHint } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    ...(entry.accountKind ? { account: { kind: entry.accountKind, ...(entry.accountLabel ? { label: entry.accountLabel } : {}) } } : {}),
    capabilities: adapter.capabilities,
    selectable: entry.enabled && found && status === 'ready',
    ...(entry.lastCheckedAt ? { lastCheckedAt: entry.lastCheckedAt } : {}),
  };
}

/** Cached snapshots; no agent process is started. */
export async function listExternalAgentSnapshots(): Promise<ExternalAgentSnapshot[]> {
  const out: ExternalAgentSnapshot[] = [];
  for (const adapter of listExternalAgentAdapters()) {
    out.push(snapshotFrom(adapter, await detectCached(adapter)));
  }
  return out;
}

export async function getExternalAgentSnapshot(id: ExternalAgentId): Promise<ExternalAgentSnapshot | null> {
  const adapter = getExternalAgentAdapter(id);
  if (!adapter) return null;
  return snapshotFrom(adapter, await detectCached(adapter));
}

/** Synchronous view for the turn path: enabled AND last verify said ready. */
export function isExternalAgentUsable(id: ExternalAgentId): { ok: boolean; reason?: 'disabled' | 'not_ready' } {
  const entry = getExternalAgentEntry(id);
  if (!entry.enabled) return { ok: false, reason: 'disabled' };
  if (entry.lastStatus !== 'ready') return { ok: false, reason: 'not_ready' };
  return { ok: true };
}

function persistVerify(id: ExternalAgentId, result: ExternalAgentVerifyResult): void {
  updateExternalAgentEntry(id, {
    lastStatus: result.status,
    lastStatusText: result.statusText,
    lastCheckedAt: new Date().toISOString(),
    version: result.version,
    accountKind: result.account?.kind,
    accountLabel: result.account?.label,
  });
}

export async function verifyExternalAgent(id: ExternalAgentId): Promise<ExternalAgentSnapshot | null> {
  const adapter = getExternalAgentAdapter(id);
  if (!adapter) return null;
  const inFlight = verifying.get(id);
  if (inFlight) return inFlight;
  const run = (async () => {
    await detectCached(adapter, true);
    let result: ExternalAgentVerifyResult;
    try {
      result = await adapter.verify();
    } catch (error: any) {
      result = { status: 'error', statusText: `Couldn't start ${adapter.name}: ${String(error?.message || error).slice(0, 160)}. Check again`, capabilities: adapter.capabilities };
    }
    persistVerify(id, result);
    detection.set(id, { found: result.status !== 'not_installed', at: Date.now() });
    return snapshotFrom(adapter, result.status !== 'not_installed');
  })();
  verifying.set(id, run);
  try {
    return await run;
  } finally {
    verifying.delete(id);
  }
}

/** Enabled stays true even if verify fails, so the row can show the reason and Check again. */
export async function enableExternalAgent(id: ExternalAgentId): Promise<ExternalAgentSnapshot | null> {
  if (!getExternalAgentAdapter(id)) return null;
  const entry = getExternalAgentEntry(id);
  updateExternalAgentEntry(id, { enabled: true, ...(entry.enabled ? {} : { enabledAt: new Date().toISOString() }) });
  return verifyExternalAgent(id);
}

/** Off: stop new turns, interrupt running ones, cancel their requests, close the idle process. Nothing is deleted. */
export async function disableExternalAgent(id: ExternalAgentId): Promise<ExternalAgentSnapshot | null> {
  const adapter = getExternalAgentAdapter(id);
  if (!adapter) return null;
  updateExternalAgentEntry(id, { enabled: false });
  for (const abort of [...(liveTurnAborts.get(id) || [])]) {
    try { abort(); } catch { /* best effort */ }
  }
  cancelPendingRequests({ agentId: id });
  if (adapter.closeIdle) {
    // Give interrupted turns a moment to settle, then stop the process.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await adapter.closeIdle()) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } else {
    await adapter.shutdown().catch(() => undefined);
  }
  return getExternalAgentSnapshot(id);
}

export function registerLiveExternalTurn(id: ExternalAgentId, abort: () => void): () => void {
  const set = liveTurnAborts.get(id) || new Set<() => void>();
  set.add(abort);
  liveTurnAborts.set(id, set);
  return () => { set.delete(abort); };
}

/** Gateway exit: cancel every pending request and stop every child process. */
export async function shutdownExternalAgents(): Promise<void> {
  cancelPendingRequests({});
  await Promise.all([...adapters.values()].map((adapter) => adapter.shutdown().catch(() => undefined)));
}

export function parseExternalAgentId(value: unknown): ExternalAgentId | null {
  const id = String(value || '').trim().toLowerCase();
  return isExternalAgentId(id) ? id : null;
}

export function enabledExternalAgentIds(): ExternalAgentId[] {
  const store = readExternalAgentStore();
  return Object.entries(store.agents).filter(([, entry]) => entry?.enabled).map(([id]) => id as ExternalAgentId);
}
