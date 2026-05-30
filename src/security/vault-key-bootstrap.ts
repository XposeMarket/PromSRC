/**
 * vault-key-bootstrap.ts — Master key handoff from the Electron main process.
 *
 * When Prometheus runs as the desktop app, the gateway is a child process spawned
 * by electron/main.js. The vault master key is OS-sealed (Electron safeStorage /
 * DPAPI) on disk and can only be unsealed in the main process. Main unseals it and
 * writes it as the first line on this process's stdin. We read that single line
 * SYNCHRONOUSLY here, before any vault access or config side effects run.
 *
 * This module MUST be imported first in the gateway entrypoint (server-v2.ts) so it
 * executes before SecretVault is constructed. loadOrCreateMasterKey() is synchronous,
 * so an async stdin read would race; a blocking fs.readSync on fd 0 avoids that.
 *
 * In non-managed runs (Docker, `npm run gateway`) PROMETHEUS_ELECTRON_MANAGED is
 * unset and this module is a no-op — the vault falls back to its local key file.
 */

import fs from 'fs';

let injectedKeyHex: string | null = null;
let attempted = false;

/** Synchronously read exactly one '\n'-terminated line from fd 0. */
function readKeyLineSync(): string {
  const buf = Buffer.alloc(1);
  let line = '';
  // Cap the read so a missing handoff can't spin forever; a 32-byte key is 64 hex
  // chars, so anything past a few hundred bytes means the protocol is broken.
  const MAX = 4096;
  for (let i = 0; i < MAX; i++) {
    let bytes = 0;
    try {
      bytes = fs.readSync(0, buf, 0, 1, null);
    } catch (err: any) {
      // EAGAIN can occur on a non-blocking fd; retry a bounded number of times.
      if (err && err.code === 'EAGAIN') continue;
      break;
    }
    if (bytes === 0) break; // EOF
    const ch = buf.toString('utf-8');
    if (ch === '\n') break;
    if (ch !== '\r') line += ch;
  }
  return line.trim();
}

function bootstrap(): void {
  if (attempted) return;
  attempted = true;
  if (process.env.PROMETHEUS_ELECTRON_MANAGED !== '1') return;
  try {
    const hex = readKeyLineSync();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      injectedKeyHex = hex.toLowerCase();
    }
  } catch {
    // Leave injectedKeyHex null; vault.ts will fall back to its key file.
  }
}

bootstrap();

/**
 * Returns the injected 32-byte master key, or null if none was handed off.
 * Called by SecretVault.loadOrCreateMasterKey().
 */
export function getInjectedMasterKey(): Buffer | null {
  if (!injectedKeyHex) return null;
  const buf = Buffer.from(injectedKeyHex, 'hex');
  return buf.length === 32 ? buf : null;
}
