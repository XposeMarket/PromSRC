/**
 * Launch gate for MCP servers that came from an imported plugin.
 *
 * The MCP manager calls checkImportedMcpLaunch() on EVERY connect (UI button,
 * agent tool, startup auto-connect, generic MCP save + connect). This is the
 * execution boundary: the `enabled` flag alone is never enough for an imported
 * server. It must be turned on through the plugin importer (activation 'active'),
 * its config must still match the approved hash, it may only use its own vault
 * secrets (plugins.<id>.*), and its working directory must stay inside the
 * plugin's own package/data folders (realpath, so junctions/symlinks can't escape).
 *
 * Kept dependency-light (fs/path/crypto + loader) so mcp-manager can import it.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveUserPluginsDir } from '../loader.js';

export const IMPORT_LEDGER_FILENAME = 'imported-plugin.json';

/** Stable hash of an MCP config, ignoring the enabled flag. A changed config needs fresh approval. */
export function mcpConfigHash(cfg: Record<string, any> | undefined | null): string {
  if (!cfg) return '';
  const { enabled: _enabled, ...rest } = cfg;
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
  return crypto.createHash('sha256').update(JSON.stringify(stable(rest))).digest('hex').slice(0, 32);
}

function realOrNull(p: string): string | null {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/** True when target exists and its real path is inside root's real path. */
export function insideReal(root: string, target: string): boolean {
  const r = realOrNull(root);
  const t = realOrNull(target);
  if (!r || !t) return false;
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

interface GateLedger {
  id: string;
  packageDir?: string;
  dataDir?: string;
  mcpServers?: Array<{ id: string; activation?: 'pending' | 'active'; approvedHash?: string }>;
}

/** The imported plugin that owns an MCP server id, if any. */
export function findImportedMcpOwner(serverId: string, userPluginsDir?: string): { ledger: GateLedger; entry: NonNullable<GateLedger['mcpServers']>[number] } | null {
  let dir = userPluginsDir;
  if (!dir) { try { dir = resolveUserPluginsDir(); } catch { return null; } }
  if (!dir || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, IMPORT_LEDGER_FILENAME);
    if (!fs.existsSync(file)) continue;
    let ledger: GateLedger;
    try { ledger = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const entry = (ledger.mcpServers || []).find((s) => s && s.id === serverId);
    if (entry) return { ledger, entry };
  }
  return null;
}

const INLINE_VAULT = /\$\{vault:([A-Za-z0-9_.:-]+)\}/g;

/** Every vault key an MCP config would decrypt (whole `vault:` values and inline `${vault:...}`). */
export function vaultRefsIn(cfg: Record<string, any>): string[] {
  const out = new Set<string>();
  const scan = (v: unknown) => {
    if (typeof v !== 'string') return;
    if (v.startsWith('vault:')) out.add(v.slice('vault:'.length).trim());
    for (const m of v.matchAll(INLINE_VAULT)) out.add(m[1]);
  };
  for (const v of Object.values(cfg.env || {})) scan(v);
  for (const v of Object.values(cfg.headers || {})) scan(v);
  for (const v of Array.isArray(cfg.args) ? cfg.args : []) scan(v);
  return [...out];
}

/**
 * null = allowed to launch. A string = the reason it is blocked (shown to the user).
 * Servers not owned by any imported plugin are never affected.
 */
export function checkImportedMcpLaunch(cfg: Record<string, any>, userPluginsDir?: string): string | null {
  const owner = findImportedMcpOwner(String(cfg?.id || ''), userPluginsDir);
  if (!owner) return null;
  const { ledger, entry } = owner;
  const scope = `plugins.${ledger.id}.`;
  const foreign = vaultRefsIn(cfg).filter((k) => !k.startsWith(scope));
  if (foreign.length) return `Imported plugin "${ledger.id}" may only use its own saved secrets (plugins.${ledger.id}.*); blocked: ${foreign.join(', ')}`;
  if (cfg.cwd) {
    const ok = [ledger.packageDir, ledger.dataDir].some((base) => !!base && insideReal(base, String(cfg.cwd)));
    if (!ok) return `MCP server "${cfg.id}" has a working directory outside the plugin's own folders`;
  }
  // Imports made before activation existed keep their earlier behavior.
  if (entry.activation === undefined) return null;
  if (entry.activation !== 'active') return `MCP server "${cfg.id}" from imported plugin "${ledger.id}" is off. Turn it on from Plugins (or plugin_ops activate_mcp).`;
  if (!entry.approvedHash || entry.approvedHash !== mcpConfigHash(cfg)) return `MCP server "${cfg.id}" changed since it was turned on. Turn it on again to approve the new settings.`;
  return null;
}
