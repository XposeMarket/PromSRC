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
/** An unreadable claim younger than this may still be mid-write by its winner. */
const UNREADABLE_CLAIM_GRACE_MS = 30_000;

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
 * claims recovery of `runtimeId`, or for a single takeover of a claim whose
 * owner process has died. Fails open (returns true) if the claim directory is
 * unusable, so recovery is never silently lost.
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
    if (err?.code === 'EEXIST') return takeOverAbandonedClaim(file, runtimeId, kind);
    return true;
  }
}

/** True for this process and for any other process that still exists. */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM: the process exists but belongs to another user.
    return err?.code === 'EPERM';
  }
}

/**
 * A claim outlives the process that wrote it. Incident 2026-11-03: the claimer
 * froze right after starting the replayed turn, the supervisor killed it, and
 * its ledger update was never persisted. Every later gateway then skipped the
 * turn for 24h as "claimed by another gateway process", so the chat never
 * resumed and the deferred drain retried it every few seconds forever.
 *
 * Take over a dead owner's claim ONCE per runtime. The exclusive `wx` takeover
 * marker keeps concurrent adopters to a single winner, and the one-shot limit
 * stops a replay that keeps killing its gateway from becoming a crash loop.
 */
function takeOverAbandonedClaim(file: string, runtimeId: string, kind: string): boolean {
  let ownerPid = 0;
  try {
    ownerPid = Number(JSON.parse(fs.readFileSync(file, 'utf8'))?.pid) || 0;
  } catch {
    try {
      if (Date.now() - fs.statSync(file).mtimeMs < UNREADABLE_CLAIM_GRACE_MS) return false;
    } catch {
      return false;
    }
  }
  if (isPidAlive(ownerPid)) return false;
  const at = new Date().toISOString();
  try {
    const fd = fs.openSync(`${file}.takeover`, 'wx');
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, runtimeId, kind, previousPid: ownerPid || null, at }));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, runtimeId, kind, takeoverFrom: ownerPid || null, at }));
  } catch {
    // Without our pid on disk a lease-busy release could never give the claim
    // back, and the marker would refuse every later takeover. Undo it instead.
    try { fs.unlinkSync(`${file}.takeover`); } catch {}
    return false;
  }
  console.warn(`[RuntimeRecovery] Took over recovery claim for ${runtimeId} (${kind}) from dead process ${ownerPid || 'unknown'}.`);
  return true;
}

/**
 * Give back a claim this process won but could not act on (e.g. the session
 * was already busy). Without this, a claim is permanent for 24h and every
 * later recovery attempt for the runtime is silently suppressed instead of
 * re-evaluating (and, if the user moved on, retiring) the interrupted turn.
 * Only removes a claim owned by this pid.
 */
export function releaseRuntimeRecoveryClaim(runtimeId: string, kind = 'recovery'): boolean {
  const id = safeId(runtimeId);
  if (!id) return false;
  const file = path.join(claimDir(), `${id}.${safeId(kind)}.claim`);
  try {
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number(owner?.pid) !== process.pid) return false;
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
