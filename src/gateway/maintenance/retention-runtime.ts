import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfig } from '../../config/config';
import { DEFAULT_RETENTION, validateRetentionPolicy, runRetention, type RetentionPolicy, type RetentionRoot } from './observation-retention';

export async function readRetentionPolicy(configDir = getConfig().getConfigDir()): Promise<RetentionPolicy> {
  try { return validateRetentionPolicy(JSON.parse(await fs.readFile(path.join(configDir, 'retention.json'), 'utf8'))); }
  catch (error: any) { if (error?.code === 'ENOENT') return { ...DEFAULT_RETENTION }; throw error; }
}
export async function writeRetentionPolicy(value: unknown, configDir = getConfig().getConfigDir()): Promise<RetentionPolicy> {
  const policy = validateRetentionPolicy(value);
  await fs.mkdir(configDir, { recursive: true });
  const target = path.join(configDir, 'retention.json'), temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(policy, null, 2)); await fs.rename(temp, target); return policy;
}
function sessionKeys(sessionId: string): string[] {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
  return [safe, `${safe.slice(0, 64)}-${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16)}`];
}
export async function retentionPass(dryRun = true) {
  if (dryRun) return collectRetention(true);
  const lock = path.join(getConfig().getConfigDir(), '.retention.lock');
  try { await fs.mkdir(lock); } catch { throw new Error('Retention locked by another pass. Inspect before removing a stale .retention.lock after a crash.'); }
  try { return await collectRetention(false); } finally { await fs.rmdir(lock); }
}
async function collectRetention(dryRun: boolean) {
  const config = getConfig(), configDir = config.getConfigDir(), workspace = config.getWorkspacePath();
  const policy = await readRetentionPolicy(configDir);
  const { listLiveRuntimes, listDurableRuntimes } = await import('../live-runtime-registry');
  let refreshedAt = 0;
  const protectedKeys = new Set<string>();
  const activeTeams = new Set<string>();
  const refreshProtection = () => {
    if (Date.now() - refreshedAt < 1000) return;
    refreshedAt = Date.now();
    for (const runtime of [...listLiveRuntimes(), ...listDurableRuntimes()]) {
      if (['completed', 'aborted', 'failed'].includes(String(runtime.status))) continue;
      if (runtime.sessionId) for (const key of sessionKeys(runtime.sessionId)) protectedKeys.add(key);
      if (runtime.teamId) activeTeams.add(runtime.teamId);
    }
  };
  refreshProtection();
  const roots: RetentionRoot[] = [
    { kind: 'observations', path: path.join(configDir, 'tool-observations', 'raw'), days: policy.rawDays, maxBytes: policy.rawMaxBytes, protectedDirectories: protectedKeys },
    { kind: 'results', path: path.join(configDir, 'tool-results', 'raw'), days: policy.rawDays, maxBytes: policy.resultMaxBytes, protectedDirectories: protectedKeys },
  ];
  // Scratch deletion needs a terminal receipt AND no newer/incomplete receipt for that workspace.
  // Never scan all teams recursively: their folders also contain user deliverables and memory.
  const receipts = path.join(workspace, '.prometheus', 'team-run-receipts');
  const workspaces = new Map<string, { teamId: string; terminal: boolean }>();
  try {
    const entries = await fs.opendir(receipts);
    let count = 0;
    for await (const entry of entries) {
      if (++count > 10000) { workspaces.clear(); break; } // unprovable ownership => retain
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(receipts, entry.name);
      const stat = await fs.lstat(file); if (stat.size > 128000) { workspaces.clear(); break; }
      const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
      const teamId = String(receipt.teamId || '');
      if (!/^team_[a-zA-Z0-9_-]+$/.test(teamId) || !receipt.workspacePath) continue;
      const candidate = path.resolve(receipt.workspacePath);
      const allowed = path.resolve(workspace, 'teams', teamId, 'workspace');
      if (candidate !== allowed) continue;
      const terminal = ['complete', 'failed', 'capacity_limited'].includes(receipt.status) && Number.isFinite(receipt.finishedAt);
      const previous = workspaces.get(candidate);
      workspaces.set(candidate, { teamId, terminal: terminal && previous?.terminal !== false });
    }
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  for (const [candidate, receipt] of workspaces) {
    if (receipt.terminal && !activeTeams.has(receipt.teamId)) roots.push({ kind: 'scratch', path: path.join(candidate, 'temp', 'tool-results'), days: policy.scratchDays, maxBytes: policy.scratchMaxBytes });
  }
  const report = await runRetention(roots, policy, dryRun, Date.now(), file => {
    refreshProtection();
    const parts = path.resolve(file).split(path.sep);
    return parts.some(part => protectedKeys.has(part) || activeTeams.has(part));
  });
  return { policy, report, scope: 'Raw txt bodies only; JSONL summaries, session history, snapshots, Brain and user artifacts retained.' };
}
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
export function startObservationRetention(): void {
  if (timer) return;
  stopped = false;
  const tick = async () => {
    try { if ((await readRetentionPolicy()).enabled) console.log('[Retention]', JSON.stringify(await retentionPass(false))); }
    catch (error: any) { console.warn('[Retention] retained data:', String(error?.message || error)); }
    finally { if (!stopped) { timer = setTimeout(tick, 3600000); timer.unref?.(); } }
  };
  timer = setTimeout(tick, 60000); timer.unref?.();
}
export function stopObservationRetention(): void { stopped = true; if (timer) clearTimeout(timer); timer = undefined; }
