/**
 * Cross-process recovery claims.
 *
 * During a warm handoff several gateway processes can be alive at once: the
 * draining host, the replacement, and (after a second stall restart) a newer
 * replacement that also adopted the same host. When that host dies, every
 * adopter used to run its own interrupted-runtime recovery pass, and each pass
 * retriggered the same main-chat turn. The in-process admission lease cannot
 * see the other processes, so one interrupted turn became 2-3 parallel turns in
 * the same chat.
 *
 * A claim is an exclusive-create marker file keyed by the interrupted runtime
 * id. Exactly one process wins `wx`; everyone else skips that runtime.
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';

const CLAIM_DIR_NAME = 'runtime-recovery-claims';
const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

let claimDirOverride: string | null = null;

/** Test hook. */
export function setRecoveryClaimDirForTests(dir: string | null): void {
  claimDirOverride = dir;
}

function claimDir(): string {
  return claimDirOverride || path.join(getConfig().getConfigDir(), CLAIM_DIR_NAME);
}

function safeId(id: string): string {
  return String(id || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160);
}

function pruneOldClaims(dir: string): void {
  try {
    const cutoff = Date.now() - CLAIM_RETENTION_MS;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      } catch {}
    }
  } catch {}
}

/**
 * Returns true only for the first process (and only the first call) that
 * claims recovery of `runtimeId`. Fails open (returns true) if the claim
 * directory is unusable, so recovery is never silently lost.
 */
export function claimRuntimeRecovery(runtimeId: string, kind = 'recovery'): boolean {
  const id = safeId(runtimeId);
  if (!id) return true;
  const dir = claimDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return true;
  }
  const file = path.join(dir, `${id}.${safeId(kind)}.claim`);
  try {
    const fd = fs.openSync(file, 'wx');
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, runtimeId, kind, at: new Date().toISOString() }));
    } finally {
      fs.closeSync(fd);
    }
    if (Math.random() < 0.05) pruneOldClaims(dir);
    return true;
  } catch (err: any) {
    if (err?.code === 'EEXIST') return false;
    return true;
  }
}
