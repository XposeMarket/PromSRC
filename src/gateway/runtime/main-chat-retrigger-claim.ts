import fs from 'fs';
import path from 'path';

/**
 * Cross-process claim for restarting an interrupted main-chat turn.
 *
 * During a warm handoff several gateway processes can be alive at once (a
 * draining host plus one or more replacements when the replacement itself
 * stalls and restarts). Each of them runs the interrupted-runtime recovery pass
 * over the same durable ledger, and the per-session admission lease is
 * in-memory, so it cannot stop a second process. Without a shared claim the
 * same interrupted turn was retriggered once per process (3x observed on
 * 2026-10-07), so one user message became three concurrent replies.
 *
 * The claim is an exclusively-created file keyed by the interrupted runtime id.
 * The first process wins; everyone else skips. Claims expire so a crashed
 * winner never blocks recovery forever.
 */
export const MAIN_CHAT_RETRIGGER_CLAIM_TTL_MS = 10 * 60_000;

function safeId(value: string): string {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 160);
}

function pruneExpiredClaims(dir: string, now: number, ttlMs: number): void {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.claim')) continue;
      const file = path.join(dir, name);
      try {
        if (now - fs.statSync(file).mtimeMs > ttlMs * 3) fs.rmSync(file, { force: true });
      } catch {}
    }
  } catch {}
}

/**
 * Returns a release function when this process now owns the retrigger, or
 * null when another process already claimed it. Filesystem errors other than
 * "already exists" fail open (returns a no-op release) so recovery is never
 * silently lost because of an unwritable claim directory.
 */
export function claimMainChatRetrigger(
  claimDir: string,
  runtimeId: string,
  opts: { ttlMs?: number; now?: number; owner?: string } = {},
): (() => void) | null {
  const id = safeId(runtimeId);
  if (!id) return () => {};
  const ttlMs = opts.ttlMs ?? MAIN_CHAT_RETRIGGER_CLAIM_TTL_MS;
  const now = opts.now ?? Date.now();
  const file = path.join(claimDir, `${id}.claim`);
  try {
    fs.mkdirSync(claimDir, { recursive: true });
    pruneExpiredClaims(claimDir, now, ttlMs);
    try {
      const age = now - fs.statSync(file).mtimeMs;
      if (age < ttlMs) return null;
      fs.rmSync(file, { force: true });
    } catch {}
    const fd = fs.openSync(file, 'wx');
    try {
      fs.writeSync(fd, JSON.stringify({ runtimeId, pid: process.pid, owner: opts.owner || '', claimedAt: now }));
    } finally {
      fs.closeSync(fd);
    }
    return () => {
      try { fs.rmSync(file, { force: true }); } catch {}
    };
  } catch (err: any) {
    if (err?.code === 'EEXIST') return null;
    return () => {};
  }
}
