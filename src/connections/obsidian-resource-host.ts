import fs from 'node:fs';
import path from 'node:path';
import type { LocalResourceHost } from './adapters/local-resource.js';
import { loadObsidianBridgeState, upsertObsidianVault } from '../gateway/obsidian/bridge.js';

/** Selecting a vault never indexes it or changes an existing vault's write permissions. */
export const obsidianResourceHost: LocalResourceHost = {
  async validate(context, selectedPath, kind) {
    if (context.attempt.serviceId !== 'obsidian' || kind !== 'directory') return { ok: false, error: 'Unsupported local resource.' };
    try {
      if (!path.isAbsolute(selectedPath) || !fs.statSync(selectedPath).isDirectory()) return { ok: false, error: 'Select an existing absolute vault directory.' };
      const realPath = fs.realpathSync(selectedPath);
      const existing = loadObsidianBridgeState().vaults.find(vault => {
        try { return fs.realpathSync(vault.path) === realPath; } catch { return false; }
      });
      const expectedResource = context.configuration?.resourceId;
      if (typeof expectedResource === 'string' && existing?.id !== expectedResource) return { ok: false, error: 'The connected vault identity is no longer available.' };
      if (existing?.enabled === false) return { ok: false, error: 'This vault is disabled. Enable it explicitly before connecting.' };
      const vault = existing || upsertObsidianVault({ path: realPath, mode: 'read_only', enabled: true });
      return { ok: true, details: { resourceId: vault.id, path: realPath } };
    } catch { return { ok: false, error: 'The selected vault is unavailable.' }; }
  },
  // Disconnect revokes the canonical connection, not a shared vault or its indexed notes.
};
