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

/** What the gate could learn from the user plugins folder. */
export interface ImportLedgerScan {
  /** Resolved user plugins dir, when known. */
  dir?: string;
  ledgers: Array<{ dirName: string; ledger: GateLedger }>;
  /** Plugin folders that look imported but whose ledger is missing, unreadable or malformed. */
  unverifiable: string[];
  /** The folder itself could not be resolved or listed. */
  error?: string;
}

function looksLikeImportFolder(pluginDir: string): boolean {
  if (fs.existsSync(path.join(pluginDir, 'files'))) return true;
  try {
    const desc = JSON.parse(fs.readFileSync(path.join(pluginDir, 'prometheus.extension.json'), 'utf8'));
    return desc?.category === 'imported-plugin' || String(desc?.runtime?.binding || '').startsWith('imported-plugin:');
  } catch { return false; }
}

/** Read every import ledger. Never throws; problems are reported so callers can fail closed. */
export function scanImportLedgers(userPluginsDir?: string): ImportLedgerScan {
  let dir = userPluginsDir;
  if (!dir) { try { dir = resolveUserPluginsDir(); } catch (e: any) { return { ledgers: [], unverifiable: [], error: `plugins folder unavailable (${e?.message || e})` }; } }
  const out: ImportLedgerScan = { dir, ledgers: [], unverifiable: [] };
  if (!dir || !fs.existsSync(dir)) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e: any) { return { ...out, error: `plugins folder unreadable (${e?.code || e?.message || e})` }; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pluginDir = path.join(dir, e.name);
    const file = path.join(pluginDir, IMPORT_LEDGER_FILENAME);
    if (!fs.existsSync(file)) { if (looksLikeImportFolder(pluginDir)) out.unverifiable.push(e.name); continue; }
    let ledger: any;
    try { ledger = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { out.unverifiable.push(e.name); continue; }
    const valid = ledger && typeof ledger === 'object' && ledger.id === e.name
      && (ledger.mcpServers === undefined || (Array.isArray(ledger.mcpServers) && ledger.mcpServers.every((s: any) => s && typeof s.id === 'string')));
    if (!valid) { out.unverifiable.push(e.name); continue; }
    out.ledgers.push({ dirName: e.name, ledger });
  }
  return out;
}

/** The imported plugin that owns an MCP server id, if any (readable ledgers only). */
export function findImportedMcpOwner(serverId: string, userPluginsDir?: string): { ledger: GateLedger; entry: NonNullable<GateLedger['mcpServers']>[number] } | null {
  for (const { ledger } of scanImportLedgers(userPluginsDir).ledgers) {
    const entry = (ledger.mcpServers || []).find((s) => s && s.id === serverId);
    if (entry) return { ledger, entry };
  }
  return null;
}

const IMPORT_MARKER = /^Imported from plugin (\S+)/;

/** Which imported plugin a config claims to come from, judged from the config alone. */
export function importedPluginHint(cfg: Record<string, any>, userPluginsDir?: string): string | null {
  const marker = IMPORT_MARKER.exec(String(cfg?.description || ''));
  if (marker) return marker[1];
  if (!userPluginsDir) return null;
  // Paths into the importer's package or data folders mean the config was written by the importer.
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
  const roots = [path.resolve(userPluginsDir), path.join(path.dirname(path.resolve(userPluginsDir)), 'plugin-data')].map((r) => norm(r).replace(/\/+$/, '') + '/');
  const values = [cfg?.command, cfg?.cwd, ...(Array.isArray(cfg?.args) ? cfg.args : [])].filter((v) => typeof v === 'string').map((v) => norm(v));
  for (const v of values) {
    for (const root of roots) {
      const at = v.indexOf(root);
      if (at >= 0) return v.slice(at + root.length).split('/')[0] || 'unknown';
    }
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
 *
 * Fails closed: a config that carries the importer's marker ("Imported from plugin <id>")
 * or points into the importer's package/data folders, or whose id belongs to a plugin
 * folder with a missing/unreadable/malformed ledger, is blocked unless a readable ledger
 * owns it. Manual configs with none of those signs are untouched.
 */
export function checkImportedMcpLaunch(cfg: Record<string, any>, userPluginsDir?: string): string | null {
  const id = String(cfg?.id || '');
  const scan = scanImportLedgers(userPluginsDir);
  let owner: { ledger: GateLedger; entry: NonNullable<GateLedger['mcpServers']>[number] } | null = null;
  for (const { ledger } of scan.ledgers) {
    const entry = (ledger.mcpServers || []).find((s) => s && s.id === id);
    if (entry) { owner = { ledger, entry }; break; }
  }
  if (!owner) {
    const claimed = scan.unverifiable.find((name) => id === name || id.startsWith(`${name}-`));
    if (claimed) return `MCP server "${id}" may belong to imported plugin "${claimed}", whose import record is missing or unreadable. Reinstall or remove that plugin before using it.`;
    const hint = importedPluginHint(cfg, scan.dir);
    if (!hint) return null; // a manual configuration
    const why = scan.error ? ` (${scan.error})` : '';
    return `MCP server "${id}" came from imported plugin "${hint}", but no readable import record owns it${why}. Reinstall the plugin from Plugins to use it.`;
  }
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
