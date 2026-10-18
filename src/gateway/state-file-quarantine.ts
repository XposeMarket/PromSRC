import fs from 'fs';

/**
 * Preserve a state file that failed to parse before its owner falls back to an
 * empty default. Without this, the next save silently overwrote the damaged
 * file (schedules, timers, the session index, dev-edit leases), turning a torn
 * write after a crash into permanent data loss with no trace.
 *
 * Copies (never moves) the bytes to `<file>.corrupt-<ts>-<pid>` once per
 * process per file, so a repeatedly re-read corrupt file does not spam copies.
 * Returns the quarantine path, or null if nothing was preserved.
 */
const quarantinedThisProcess = new Set<string>();

export function quarantineCorruptStateFile(filePath: string, owner: string, error?: unknown): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const key = `${filePath}:${stat.size}:${stat.mtimeMs}`;
    if (quarantinedThisProcess.has(key)) return null;
    quarantinedThisProcess.add(key);
    // An empty file is a torn create, not data worth keeping.
    if (stat.size === 0) {
      console.warn(`[${owner}] State file ${filePath} is empty; using defaults.`);
      return null;
    }
    const target = `${filePath}.corrupt-${Date.now()}-${process.pid}`;
    fs.copyFileSync(filePath, target);
    const reason = error instanceof Error ? error.message : String(error || 'parse failure');
    console.error(`[${owner}] State file ${filePath} could not be parsed (${reason}). Preserved a copy at ${target}; continuing with defaults.`);
    return target;
  } catch (copyErr: any) {
    console.error(`[${owner}] Could not quarantine corrupt state file ${filePath}:`, copyErr?.message || copyErr);
    return null;
  }
}

/** Atomic JSON-ish text write: temp file in the same directory, then rename. */
export function writeFileAtomicSync(filePath: string, data: string): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, data, 'utf-8');
  let lastErr: any;
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(tmp, filePath); return; } catch (err: any) {
      lastErr = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(String(err?.code))) break;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (i + 1)); } catch { /* best effort */ }
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  throw lastErr;
}
