/**
 * Plugin import service: scan Claude Code / Codex / Hermes / OpenClaw plugins,
 * convert them to Prometheus parts, install and uninstall them.
 *
 * Mapping (see formats.ts for reading):
 *   skills/<x>/SKILL.md      -> workspace skill  <pluginId>-<x>   (via SkillsManager.importBundles, audited)
 *   commands/<x>.md          -> workspace skill  <pluginId>-cmd-<x> (slash command body as a skill playbook)
 *   agents/<x>.md            -> workspace skill  <pluginId>-agent-<x> (role prompt; spawnable as a subagent brief)
 *   .mcp.json servers        -> MCP server config <pluginId>-<server>, secrets as vault: refs, disabled until secrets exist
 *   hooks.json command hooks -> plugin hook registry (plugin-hooks.ts), disabled until the user approves hooks
 *   apps / native runtimes   -> reported unsupported with a reason
 *
 * Every install writes a ledger entry in <userPluginsDir>/<id>/imported-plugin.json
 * plus a minimal prometheus.extension.json (kind: integration) so the plugin
 * shows up in the extensions catalog and can be removed as a unit.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findPluginDirs, findSkillDirs, readPluginBundle, readSkillBundle, sanitizePluginId, summarizeBundle, type PluginBundle, type PluginFormat, type PluginHookSpec } from './formats.js';
import { materializeGithub, isInside, safeSubpath, type Fetcher } from './source.js';
import { resolveCatalogEntry, type CatalogEntry, type CatalogLoadOptions } from './catalogs.js';
import { resolveUserPluginsDir, EXTENSION_DESCRIPTOR_FILENAME } from '../loader.js';
import { reloadExtensions } from '../reload.js';

import { IMPORT_LEDGER_FILENAME, mcpConfigHash } from './activation-gate.js';
export { IMPORT_LEDGER_FILENAME, mcpConfigHash };

export interface ImportedPluginLedger {
  id: string;
  name: string;
  format: PluginFormat;
  source: string;
  version?: string;
  importedAt: string;
  skills: string[];
  mcpServers: ImportedMcpEntry[];
  hooks: Array<PluginHookSpec & { id: string }>;
  hooksApproved: boolean;
  requiredEnv: string[];
  unsupported: Array<{ part: string; reason: string }>;
  pluginDir: string;
  /** Durable copy of the plugin files (MCP commands, hook scripts and cwd point here). */
  packageDir?: string;
  /** ${PLUGIN_DATA}: kept across reinstall and uninstall unless purged. */
  dataDir?: string;
  /** Where it came from: catalog entry, upstream repo/path and the exact commit installed. */
  provenance?: { catalog?: string; entry?: string; repo?: string; url?: string; path?: string; ref?: string; commit?: string; harness?: string };
}

export interface ImportedMcpEntry {
  id: string;
  secretKeys: string[];
  enabled: boolean;
  /** undefined = imported before activation existed (kept working as-is). */
  activation?: 'pending' | 'active';
  /** Hash of the config the user approved; a changed config needs fresh approval. */
  approvedHash?: string;
  /** Env var names the server may read from the gateway environment (never copied into config). */
  passthrough?: string[];
  /** Secrets with defaults that were not set when imported. */
  optional?: string[];
  /** Every required secret is present (last time it was checked). */
  ready?: boolean;
}

export interface SkillInstaller {
  importBundles(source: string, options?: { id?: string; overwrite?: boolean; mode?: 'adapt' | 'force'; applySafeFixes?: boolean }): Promise<Array<{ id: string }>>;
  deleteSkill(id: string): boolean;
  scanSkills(): void;
  /** Used to refuse overwriting skills an import does not own. */
  get?(id: string): unknown;
}

export interface McpConfigStore {
  getConfigs(): Array<{ id: string }>;
  upsertConfig(cfg: any): void;
  deleteConfig(id: string): boolean;
  connect?(id: string): Promise<unknown>;
  disconnect?(id: string): Promise<unknown>;
}

export interface SecretStore { has(key: string): boolean }

export interface PluginImportDeps {
  skills: SkillInstaller;
  mcp: McpConfigStore;
  vault?: SecretStore;
  /** Override for tests. */
  userPluginsDir?: string;
  /** Skip extension hot-reload (tests). */
  skipReload?: boolean;
  /** Network override for catalog/archive fetches (tests). */
  fetcher?: Fetcher;
  catalogOptions?: CatalogLoadOptions;
}

// ── Source discovery ────────────────────────────────────────────────────────

export interface PluginSourceRoot { harness: PluginFormat | 'marketplace'; label: string; dir: string }

/** Where each harness keeps installed plugins on this machine. */
export function defaultPluginSourceRoots(home = os.homedir()): PluginSourceRoot[] {
  const roots: PluginSourceRoot[] = [
    { harness: 'claude', label: 'Claude Code (synced)', dir: path.join(home, '.claude', 'plugins', 'synced') },
    { harness: 'claude', label: 'Claude Code (cache)', dir: path.join(home, '.claude', 'plugins', 'cache') },
    { harness: 'codex', label: 'Codex (installed)', dir: path.join(home, '.codex', 'plugins', 'cache') },
    { harness: 'hermes', label: 'Hermes Agent (user)', dir: path.join(process.env.HERMES_HOME || path.join(home, '.hermes'), 'plugins') },
    { harness: 'openclaw', label: 'OpenClaw (user)', dir: path.join(home, '.openclaw', 'extensions') },
  ];
  return roots.filter((r) => fs.existsSync(r.dir));
}

/** Marketplace checkouts already on disk (browsable, not installed). */
export function defaultMarketplaceRoots(home = os.homedir()): PluginSourceRoot[] {
  const out: PluginSourceRoot[] = [];
  const claudeMk = path.join(home, '.claude', 'plugins', 'marketplaces');
  if (fs.existsSync(claudeMk)) for (const d of fs.readdirSync(claudeMk)) out.push({ harness: 'marketplace', label: `Claude marketplace ${d}`, dir: path.join(claudeMk, d) });
  return out.filter((r) => fs.existsSync(r.dir));
}

/** Standalone skill folders other agents keep. Each SKILL.md folder imports as one skill. */
export interface SkillSourceRoot { harness: PluginFormat; prefix: string; label: string; dir: string }

export function defaultSkillRoots(home = os.homedir()): SkillSourceRoot[] {
  const hermesHome = process.env.HERMES_HOME || path.join(home, '.hermes');
  const roots: SkillSourceRoot[] = [
    { harness: 'hermes', prefix: 'hermes', label: 'Hermes skills', dir: path.join(hermesHome, 'skills') },
    { harness: 'openclaw', prefix: 'openclaw', label: 'OpenClaw skills', dir: path.join(home, '.openclaw', 'skills') },
    { harness: 'openclaw', prefix: 'openclaw', label: 'OpenClaw workspace skills', dir: path.join(home, '.openclaw', 'workspace', 'skills') },
    { harness: 'skill', prefix: 'agents', label: 'Agent Skills (~/.agents/skills)', dir: path.join(home, '.agents', 'skills') },
    { harness: 'claude', prefix: 'claude', label: 'Claude Code skills', dir: path.join(home, '.claude', 'skills') },
    { harness: 'codex', prefix: 'codex', label: 'Codex skills', dir: path.join(home, '.codex', 'skills') },
  ];
  return roots.filter((r) => fs.existsSync(r.dir));
}

/** Source-qualified id for a skill folder: <harness>-<relative path>, e.g. hermes-devops-deploy-k8s. */
export function skillImportId(dir: string, roots: SkillSourceRoot[] = defaultSkillRoots()): { id: string; label: string } {
  const abs = path.resolve(dir);
  for (const r of roots) {
    const rel = path.relative(path.resolve(r.dir), abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { id: sanitizePluginId(`${r.prefix}-${rel.split(path.sep).join('-')}`), label: r.label };
  }
  return { id: sanitizePluginId(`skill-${path.basename(abs)}`), label: 'skill folder' };
}

export interface ScannedPlugin extends ReturnType<typeof summarizeBundle> { harness: string; installedAs?: string }

export function scanPlugins(options: { roots?: PluginSourceRoot[]; includeMarketplaces?: boolean; filter?: string; userPluginsDir?: string } = {}): ScannedPlugin[] {
  const roots = options.roots || [...defaultPluginSourceRoots(), ...(options.includeMarketplaces ? defaultMarketplaceRoots() : [])];
  const installed = new Map(listImportedPlugins(options.userPluginsDir).map((l) => [path.resolve(l.source).toLowerCase(), l.id]));
  const byKey = new Map<string, { row: ScannedPlugin; score: number }>();
  const needle = String(options.filter || '').toLowerCase().trim();
  for (const root of roots) {
    for (const dir of findPluginDirs(root.dir, 5)) {
      const bundle = readPluginBundle(dir);
      if (!bundle) continue;
      if (needle && !`${bundle.id} ${bundle.name} ${bundle.description}`.toLowerCase().includes(needle)) continue;
      // The same plugin can exist in several caches/versions (Codex keeps
      // openai-curated and openai-curated-remote copies). Keep the copy with
      // the most importable content, newest mtime as tie-break.
      const key = `${bundle.format}:${bundle.id}`;
      let mtime = 0; try { mtime = fs.statSync(bundle.manifestPath).mtimeMs; } catch {}
      const score = (bundle.skillDirs.length + bundle.commands.length + bundle.agents.length + bundle.mcpServers.length * 5) * 1e13 + mtime;
      const prev = byKey.get(key);
      if (prev && prev.score >= score) continue;
      byKey.set(key, { score, row: { ...summarizeBundle(bundle), harness: root.label, installedAs: installed.get(path.resolve(dir).toLowerCase()) } as ScannedPlugin });
    }
  }
  return [...byKey.values()].map((v) => v.row);
}

/** Standalone skills in Hermes / OpenClaw / Agent Skills / Claude / Codex folders (bounded per root). */
export function scanSkillFolders(options: { roots?: SkillSourceRoot[]; filter?: string; userPluginsDir?: string; maxPerRoot?: number } = {}): ScannedPlugin[] {
  const roots = options.roots || defaultSkillRoots();
  const installed = new Map(listImportedPlugins(options.userPluginsDir).map((l) => [path.resolve(l.source).toLowerCase(), l.id]));
  const needle = String(options.filter || '').toLowerCase().trim();
  const max = Math.max(1, options.maxPerRoot || 300);
  const seen = new Set<string>();
  const out: ScannedPlugin[] = [];
  for (const root of roots) {
    for (const dir of findSkillDirs(root.dir, 4).slice(0, max)) {
      const real = path.resolve(dir).toLowerCase();
      if (seen.has(real)) continue;
      seen.add(real);
      const { id } = skillImportId(dir, roots);
      const bundle = readSkillBundle(dir, id, root.label);
      if (!bundle) continue;
      if (needle && !`${bundle.id} ${bundle.name} ${bundle.description}`.toLowerCase().includes(needle)) continue;
      out.push({ ...summarizeBundle(bundle), harness: root.label, installedAs: installed.get(real) } as ScannedPlugin);
    }
  }
  return out;
}

// ── Remote sources (GitHub archive without git; other https via git) ─────────

function stagingRoot(userDir: string): string {
  const dir = path.join(path.dirname(userDir), 'plugin-import-staging');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ResolvedSource { dir: string; cleanup: () => void; provenance: NonNullable<ImportedPluginLedger['provenance']> }

/**
 * Resolve an install source to a local plugin directory.
 * Accepts: local dir, owner/repo[#subdir], https://github.com/o/r[#subdir],
 * GitHub tree URL (https://github.com/o/r/tree/<ref>/<subdir>), or another
 * GitHub only for remote sources: they download as a zip through the guarded fetch (no git).
 */
export async function resolvePluginSource(source: string, userDir: string, opts: { fetcher?: Fetcher } = {}): Promise<ResolvedSource> {
  const text = String(source || '').trim();
  if (!text) throw new Error('source is required');
  const local = path.resolve(text);
  if (!/^https?:\/\//i.test(text) && fs.existsSync(local)) return { dir: local, cleanup: () => {}, provenance: {} };

  const tree = text.match(/^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/tree\/([^/]+)\/?([^#]*)$/i);
  const gh = text.match(/^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?(?:#(.*))?$/i);
  const short = text.match(/^([\w.-]+\/[\w.-]+)(?:#(.*))?$/);
  let m;
  if (tree) m = await materializeGithub({ repo: `${tree[1]}/${tree[2]}`, ref: tree[3], path: tree[4] }, stagingRoot(userDir), opts);
  else if (gh) m = await materializeGithub({ repo: `${gh[1]}/${gh[2]}`, path: gh[3] || '' }, stagingRoot(userDir), opts);
  else if (short) m = await materializeGithub({ repo: short[1], path: short[2] || '' }, stagingRoot(userDir), opts);
  else throw new Error(`Unsupported plugin source "${text}". Use a local folder, owner/repo[#subdir] or a GitHub URL (other hosts are not fetched).`);
  return { dir: m.dir, cleanup: m.cleanup, provenance: { repo: m.repo, path: m.path, ref: m.ref, commit: m.commit } };
}

/** Download one catalog entry's exact source (pinned commit when the catalog pins one). */
export async function resolveCatalogSource(entry: CatalogEntry, userDir: string, opts: { fetcher?: Fetcher } = {}): Promise<ResolvedSource> {
  const s = entry.source;
  const base = { catalog: entry.catalog, entry: entry.id };
  if (!entry.installable || s.kind === 'unsupported') throw new Error(`${entry.name} can't be imported: ${entry.reason || (s as any).reason || 'not installable'}`);
  if (s.kind === 'github') {
    const m = await materializeGithub({ repo: s.repo, path: s.path, ref: s.ref, sha: s.sha }, stagingRoot(userDir), opts);
    return { dir: m.dir, cleanup: m.cleanup, provenance: { ...base, repo: s.repo, path: m.path, ref: s.ref, commit: m.commit } };
  }
  if (!fs.existsSync(s.dir)) throw new Error(`${entry.name}: local path ${s.dir} does not exist`);
  return { dir: s.dir, cleanup: () => {}, provenance: base };
}


// ── Marketplace catalogs ─────────────────────────────────────────────────────

export interface MarketplaceEntry { name: string; description: string; category?: string; source: string; marketplace: string }

/** Read a Claude (.claude-plugin/marketplace.json) or Codex (.agents/plugins/marketplace.json) catalog. */
export function readMarketplace(dir: string): MarketplaceEntry[] {
  const files = [
    path.join(dir, '.claude-plugin', 'marketplace.json'),
    path.join(dir, '.agents', 'plugins', 'marketplace.json'),
    path.join(dir, 'marketplace.json'),
  ];
  const file = files.find((f) => fs.existsSync(f));
  if (!file) return [];
  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return []; }
  const market = String(raw?.name || path.basename(dir));
  const base = file.includes(`${path.sep}.agents${path.sep}`) ? path.resolve(path.dirname(file), '..', '..') : dir;
  return (Array.isArray(raw?.plugins) ? raw.plugins : []).map((p: any): MarketplaceEntry | null => {
    const s = p?.source;
    let source = '';
    if (typeof s === 'string') source = path.resolve(base, s);
    else if (s?.source === 'local' && s.path) source = path.resolve(base, s.path);
    else if (s?.source === 'github' && s.repo) source = `${s.repo}${s.path ? `#${s.path}` : ''}`;
    else if ((s?.source === 'url' || s?.source === 'git') && s.url) source = s.url;
    else if (s?.source === 'git-subdir' && s.url) source = /github\.com/i.test(s.url) && s.ref
      ? `${String(s.url).replace(/\.git$/, '')}/tree/${s.ref}/${s.path || ''}`
      : `${s.url}#${s.path || ''}`;
    if (!source || !p?.name) return null;
    return { name: String(p.name), description: String(p.description || '').slice(0, 240), category: p.category, source, marketplace: market };
  }).filter(Boolean) as MarketplaceEntry[];
}

// ── Install ─────────────────────────────────────────────────────────────────

function writeSkillFromMarkdown(tempRoot: string, id: string, name: string, description: string, body: string, extra: Record<string, unknown> = {}): string {
  const dir = path.join(tempRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  const fm = { name, description: description.replace(/\s+/g, ' ').slice(0, 400), ...extra };
  const yaml = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${yaml}\n---\n\n${body.trim()}\n`, 'utf8');
  return dir;
}

/** Prometheus MCP id for an imported server: <plugin>-<server> (just <plugin> when they match). */
export function importedMcpId(pluginId: string, serverId: string): string {
  return sanitizePluginId(pluginId === serverId ? pluginId : `${pluginId}-${serverId}`);
}

export interface ConvertedMcpServer {
  config: Record<string, any>;
  /** Required secrets (vault keys plugins.<id>.<NAME>). */
  secretKeys: string[];
  /** Secrets that had a default and were not set at import time. */
  optional: string[];
  /** True when every required secret is already available. Says nothing about activation. */
  enabled: boolean;
  note?: string;
  /** Non-empty = this server cannot be represented safely; it is skipped with a warning. */
  problems: string[];
  /** Env var names passed through by name from the gateway environment (value never stored). */
  passthrough: string[];
}

const ROOT_VARS = /\$\{(?:CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|PLUGIN_ROOT)\}/g;
const DATA_VARS = /\$\{(?:CLAUDE_PLUGIN_DATA|PLUGIN_DATA)\}/g;
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Translate a foreign MCP server config into a Prometheus MCPServerConfig.
 * Secrets become `${vault:plugins.<id>.<NAME>}` templates resolved by the MCP
 * manager at connect time; values from the gateway environment are NEVER copied
 * into the stored config. Plugin root/data placeholders resolve to the
 * Prometheus-owned package and data folders.
 */
export function convertMcpServer(pluginId: string, server: { id: string; config: Record<string, any> }, pluginRoot: string, vault?: SecretStore, opts: { dataDir?: string } = {}): ConvertedMcpServer {
  const src = server.config || {};
  const id = importedMcpId(pluginId, server.id);
  const vaultKey = (envName: string) => `plugins.${pluginId}.${envName}`;
  const rootPath = path.resolve(pluginRoot);
  const dataPath = path.resolve(opts.dataDir || path.join(pluginRoot, '..', 'data'));
  const secretKeys: string[] = [];
  const optional: string[] = [];
  const problems: string[] = [];
  const fwd = (p: string) => p.replace(/\\/g, '/');

  const roots = (value: unknown): string => String(value ?? '').replace(ROOT_VARS, fwd(rootPath)).replace(DATA_VARS, fwd(dataPath));
  /** Placeholders -> vault templates; defaults are used when the secret is not stored yet. */
  const secrets = (value: unknown): string => roots(value).replace(ENV_REF, (_m, name: string, dflt?: string) => {
    if (dflt !== undefined && !vault?.has(vaultKey(name))) { if (!optional.includes(name)) optional.push(name); return dflt; }
    if (!secretKeys.includes(name)) secretKeys.push(name);
    return `\${vault:${vaultKey(name)}}`;
  });
  const emptyAfterDefaults = (v: string) => !v.trim() || /^bearer\s*$/i.test(v.trim());
  const passthrough: string[] = [];
  // A plugin may only name its own secrets; Prometheus vault syntax in plugin config could read unrelated credentials.
  if (/\$\{vault:|"vault:/.test(JSON.stringify(src))) problems.push('config contains Prometheus vault references; plugins may only reference their own secrets by name');

  const cfg: Record<string, any> = { id, name: `${pluginId}: ${server.id}`, description: `Imported from plugin ${pluginId}` };
  const type = String(src.type || src.transport || (src.command ? 'stdio' : 'http')).toLowerCase();
  if (type === 'stdio' || src.command) {
    cfg.transport = 'stdio';
    cfg.command = roots(src.command);
    if (ENV_REF.test(cfg.command)) problems.push('command uses an environment placeholder, which is not supported');
    ENV_REF.lastIndex = 0;
    if (src.args !== undefined && !(Array.isArray(src.args) && src.args.every((a: unknown) => typeof a === 'string' || typeof a === 'number'))) problems.push('args must be a list of strings');
    cfg.args = (Array.isArray(src.args) ? src.args : []).map((a: any) => secrets(a));
    if (src.env !== undefined && (!src.env || typeof src.env !== 'object' || Array.isArray(src.env))) problems.push('env must map names to strings');
    const env: Record<string, string> = {};
    // The user already has NAME in the gateway environment and no saved secret: pass it through by name.
    const fromGateway = (name: string) => !vault?.has(vaultKey(name)) && typeof process.env[name] === 'string' && process.env[name] !== '';
    for (const [k, v] of Object.entries(src.env || {})) {
      if (typeof v === 'string' && v === `\${${k}}` && fromGateway(k)) { if (!passthrough.includes(k)) passthrough.push(k); continue; }
      const val = secrets(v); if (!emptyAfterDefaults(val)) env[k] = val;
    }
    for (const k of Array.isArray(src.env_vars) ? src.env_vars : []) {
      if (typeof k !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || env[k] || passthrough.includes(k)) continue;
      if (fromGateway(k)) { passthrough.push(k); continue; }
      env[k] = `\${vault:${vaultKey(k)}}`;
      if (!secretKeys.includes(k)) secretKeys.push(k);
    }
    if (Object.keys(env).length) cfg.env = env;
    if (passthrough.length) cfg.envPassthrough = passthrough;
    if (src.cwd !== undefined) {
      const raw = String(src.cwd);
      const abs = path.resolve(rootPath, roots(raw).replace(/^\.\//, ''));
      const inside = (base: string) => { const rel = path.relative(base, abs); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
      if (ENV_REF.test(raw.replace(ROOT_VARS, '').replace(DATA_VARS, ''))) problems.push('cwd may only use ./, ${PLUGIN_ROOT} or ${PLUGIN_DATA}');
      else if (!inside(rootPath) && !inside(dataPath)) problems.push(`cwd "${raw}" points outside the plugin`);
      else cfg.cwd = abs;
      ENV_REF.lastIndex = 0;
    }
  } else {
    cfg.transport = type === 'sse' ? 'sse' : 'http';
    const url = roots(src.url);
    if (ENV_REF.test(url)) problems.push('url contains a secret placeholder; Prometheus keeps secrets out of URLs');
    ENV_REF.lastIndex = 0;
    if (!/^https?:\/\//i.test(url)) problems.push('url must be http(s)');
    cfg.url = url;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(src.headers || {})) { const val = secrets(v); if (!emptyAfterDefaults(val)) headers[k] = val; }
    if (typeof src.bearer_token_env_var === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(src.bearer_token_env_var)) {
      const n = src.bearer_token_env_var;
      if (!secretKeys.includes(n)) secretKeys.push(n);
      headers.Authorization = `Bearer \${vault:${vaultKey(n)}}`;
    }
    if (Object.keys(headers).length) cfg.headers = headers;
  }
  const missing = secretKeys.filter((k) => !vault?.has(vaultKey(k)));
  const notes: string[] = [];
  if (missing.length) notes.push(`Needs secret(s): ${missing.join(', ')}`);
  if (optional.length) notes.push(`optional ${optional.join(', ')} not set (defaults used; reinstall after saving them)`);
  cfg.enabled = false;
  return { config: cfg, secretKeys, optional, enabled: missing.length === 0, note: notes.join('; ') || undefined, problems, passthrough };
}


export interface InstallPluginOptions {
  /** Which parts to import. Defaults to all importable parts. */
  parts?: Array<'skills' | 'commands' | 'agents' | 'mcp' | 'hooks'>;
  overwrite?: boolean;
  idOverride?: string;
  /** Official catalog entry id (`claude-official:<name>`); resolved and pinned server-side. */
  entry?: string;
  /** Internal: where the source came from (set by installPlugin). */
  provenance?: ImportedPluginLedger['provenance'];
}

export interface InstallPluginResult {
  id: string;
  format: PluginFormat;
  skills: string[];
  mcpServers: Array<{ id: string; enabled: boolean; activation: 'pending' | 'active'; note?: string }>;
  hooks: number;
  hooksApproved: boolean;
  unsupported: Array<{ part: string; reason: string }>;
  warnings: string[];
  nextSteps: string[];
  /** Some parts failed to import (see warnings). */
  partial: boolean;
  provenance?: ImportedPluginLedger['provenance'];
}

const PACKAGE_SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);
const PACKAGE_LIMITS = Object.freeze({ files: 6000, bytes: 60 * 1024 * 1024 });

/** Copy the plugin into Prometheus-owned storage (bounded, never follows links). */
function copyPackage(from: string, to: string): void {
  let files = 0; let bytes = 0;
  const walk = (src: string, dst: string) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (PACKAGE_SKIP.has(e.name) || e.isSymbolicLink()) continue;
      const s = path.join(src, e.name); const d = path.join(dst, e.name);
      if (e.isDirectory()) { walk(s, d); continue; }
      if (!e.isFile()) continue;
      files += 1; bytes += fs.statSync(s).size;
      if (files > PACKAGE_LIMITS.files || bytes > PACKAGE_LIMITS.bytes) throw new Error(`Plugin is too large to import (limit ${PACKAGE_LIMITS.files} files / 60 MB, not counting node_modules and .git).`);
      fs.copyFileSync(s, d);
    }
  };
  walk(from, to);
}

/** ${PLUGIN_DATA}: outside the plugin folder so it survives reinstall and (unless purged) uninstall. */
export function pluginDataDir(userDir: string, id: string): string {
  return path.join(path.dirname(userDir), 'plugin-data', sanitizePluginId(id));
}

export async function installPlugin(source: string, deps: PluginImportDeps, options: InstallPluginOptions = {}): Promise<InstallPluginResult> {
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  let label = String(source || '').trim();
  let resolved: ResolvedSource;
  if (options.entry) {
    const entry = await resolveCatalogEntry(options.entry, { ...(deps.catalogOptions || {}), fetcher: deps.catalogOptions?.fetcher || deps.fetcher });
    resolved = await resolveCatalogSource(entry, userDir, { fetcher: deps.fetcher });
    label = entry.id;
  } else {
    resolved = await resolvePluginSource(source, userDir, { fetcher: deps.fetcher });
  }
  try {
    let bundle = readPluginBundle(resolved.dir);
    if (!bundle && ['SKILL.md', 'skill.md'].some((f) => fs.existsSync(path.join(resolved.dir, f)))) {
      const sk = skillImportId(resolved.dir);
      bundle = readSkillBundle(resolved.dir, sk.id, sk.label);
      resolved.provenance.harness = sk.label;
    }
    if (!bundle) {
      const nested = findPluginDirs(resolved.dir, 4);
      throw new Error(nested.length
        ? `"${label}" is a collection of ${nested.length} plugins, not one plugin. Install one of: ${nested.slice(0, 12).map((d) => path.relative(resolved.dir, d) || '.').join(', ')}`
        : `No plugin manifest or SKILL.md found at "${label}".`);
    }
    const remote = !!(resolved.provenance.repo || resolved.provenance.url || resolved.provenance.catalog);
    return await installBundle(bundle, remote ? label : bundle.root, deps, { ...options, provenance: resolved.provenance });
  } finally {
    resolved.cleanup();
  }
}

export async function installBundle(bundle: PluginBundle, source: string, deps: PluginImportDeps, options: InstallPluginOptions = {}): Promise<InstallPluginResult> {
  if (bundle.invalid?.length) throw new Error(`"${bundle.name}" has an invalid manifest: ${bundle.invalid.slice(0, 6).join('; ')}`);
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  const parts = new Set(options.parts?.length ? options.parts : ['skills', 'commands', 'agents', 'mcp', 'hooks']);
  const id = sanitizePluginId(options.idOverride || bundle.id);
  const pluginDir = path.join(userDir, id);
  const existing = readLedger(pluginDir);
  if (existing && !options.overwrite) throw new Error(`Plugin "${id}" is already imported (from ${existing.source}). Pass overwrite:true to reinstall.`);

  // 1. Plan every resource id up front.
  const skillIdFor = (dir: string) => {
    const base = sanitizePluginId(path.basename(dir) === path.basename(bundle.root) ? id : path.basename(dir));
    return base.startsWith(`${id}-`) || base === id ? base : sanitizePluginId(`${id}-${base}`);
  };
  const planned = {
    skills: parts.has('skills') ? bundle.skillDirs.map(skillIdFor) : [],
    commands: parts.has('commands') ? bundle.commands.map((c) => sanitizePluginId(`${id}-cmd-${c.name.replace(/:/g, '-')}`)) : [],
    agents: parts.has('agents') ? bundle.agents.map((a) => sanitizePluginId(`${id}-agent-${a.name}`)) : [],
    mcp: parts.has('mcp') ? bundle.mcpServers.map((s) => importedMcpId(id, s.id)) : [],
    hooks: parts.has('hooks') ? bundle.hooks.filter((h) => h.type === 'command') : [],
  };
  const unsupported = [...bundle.unsupported, ...bundle.hooks.filter((h) => h.type !== 'command').map((h) => ({ part: `hook ${h.sourceEvent}`, reason: h.note || 'unsupported' }))];
  if (!planned.skills.length && !planned.commands.length && !planned.agents.length && !planned.mcp.length && !planned.hooks.length) {
    throw new Error(`Nothing usable to import from "${bundle.name}".${unsupported.length ? ` Not importable: ${unsupported.map((u) => `${u.part} (${u.reason})`).join('; ')}` : ''}`);
  }

  // Two parts of one plugin must not map to the same id (one would silently replace the other).
  const dupes = (ids: string[]) => ids.filter((x, i) => ids.indexOf(x) !== i);
  const dupSkills = dupes([...planned.skills, ...planned.commands, ...planned.agents]);
  const dupMcp = dupes(planned.mcp);
  if (dupSkills.length || dupMcp.length) throw new Error(`"${bundle.name}" maps several parts to the same id: ${[...new Set([...dupSkills, ...dupMcp])].slice(0, 8).join(', ')}`);

  // 2. Refuse to replace skills/MCP servers that this import does not own.
  const owned = new Set([...(existing?.skills || []), ...(existing?.mcpServers || []).map((s) => s.id)]);
  const others = listImportedPlugins(userDir).filter((l) => l.id !== id);
  const ownerOf = (rid: string) => others.find((l) => l.skills.includes(rid) || l.mcpServers.some((s) => s.id === rid))?.id;
  const conflicts: string[] = [];
  for (const sid of [...planned.skills, ...planned.commands, ...planned.agents]) {
    if (!owned.has(sid) && deps.skills.get?.(sid)) conflicts.push(`skill ${sid}${ownerOf(sid) ? ` (from import "${ownerOf(sid)}")` : ''}`);
  }
  const mcpIds = new Set(deps.mcp.getConfigs().map((c) => c.id));
  for (const mid of planned.mcp) if (!owned.has(mid) && mcpIds.has(mid)) conflicts.push(`MCP server ${mid}${ownerOf(mid) ? ` (from import "${ownerOf(mid)}")` : ''}`);
  if (conflicts.length) throw new Error(`Importing "${id}" would replace ${conflicts.length} existing resource(s) it does not own: ${conflicts.slice(0, 8).join(', ')}. Remove them first, or import with a different id.`);

  // 3. Stage the durable package copy before touching anything that exists.
  const temp = fs.mkdtempSync(path.join(stagingRoot(userDir), `${id}-`));
  const warnings: string[] = [];
  const skillIds: string[] = [];
  try {
    const stagedPkg = path.join(temp, 'package');
    copyPackage(bundle.root, stagedPkg);
    const packageDir = path.join(pluginDir, 'files');
    const dataDir = pluginDataDir(userDir, id);

    // 4. Convert every MCP server up front (pure; paths point at the final package dir).
    const converted: Array<{ server: { id: string }; conv?: ConvertedMcpServer; error?: string }> = parts.has('mcp') ? bundle.mcpServers.map((server) => {
      try { return { server, conv: convertMcpServer(id, server, packageDir, deps.vault, { dataDir }) }; }
      catch (err: any) { return { server, error: String(err?.message || err).slice(0, 240) }; }
    }) : [];

    // 5. Swap with rollback: the previous install keeps working until the new one is fully written.
    fs.mkdirSync(pluginDir, { recursive: true });
    const previousPkg = path.join(temp, 'previous-files');
    const previousMcp = new Map<string, any>();
    for (const c of deps.mcp.getConfigs()) {
      if ((existing?.mcpServers || []).some((s) => s.id === c.id) || planned.mcp.includes(c.id)) previousMcp.set(c.id, JSON.parse(JSON.stringify(c)));
    }
    const movePath = (from: string, to: string) => {
      try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
    };
    if (fs.existsSync(packageDir)) movePath(packageDir, previousPkg);
    movePath(stagedPkg, packageDir);
    fs.mkdirSync(dataDir, { recursive: true });
    const rollback = () => {
      try { fs.rmSync(packageDir, { recursive: true, force: true }); if (fs.existsSync(previousPkg)) movePath(previousPkg, packageDir); } catch { /* best effort */ }
      for (const mid of planned.mcp) if (!previousMcp.has(mid)) { try { deps.mcp.deleteConfig(mid); } catch { /* best effort */ } }
      for (const cfg of previousMcp.values()) { try { deps.mcp.upsertConfig(cfg); } catch { /* best effort */ } }
      if (existing) { try { writeLedger(existing); } catch { /* best effort */ } }
    };
    try {

    const stageSkill = async (dir: string, skillId: string) => {
      try {
        const installed = await deps.skills.importBundles(dir, { id: skillId, overwrite: true, mode: 'adapt', applySafeFixes: true });
        skillIds.push(...installed.map((s) => s.id));
      } catch (err: any) {
        warnings.push(`skill ${skillId}: ${String(err?.message || err).slice(0, 240)}`);
      }
    };
    if (parts.has('skills')) for (const dir of bundle.skillDirs) await stageSkill(dir, skillIdFor(dir));
    if (parts.has('commands')) {
      for (const cmd of bundle.commands) {
        const sid = sanitizePluginId(`${id}-cmd-${cmd.name.replace(/:/g, '-')}`);
        const body = `# /${cmd.name} (imported ${bundle.format} command)\n\nRun this when the user invokes \`/${cmd.name}\`${cmd.argumentHint ? ` with ${cmd.argumentHint}` : ''} or asks for: ${cmd.description}\n\`$ARGUMENTS\` below means the text the user supplied after the command.\n\n${cmd.body}`;
        await stageSkill(writeSkillFromMarkdown(temp, sid, `/${cmd.name}`, cmd.description, body, { triggers: [`/${cmd.name}`, `/${cmd.name.split(':').pop()}`] }), sid);
      }
    }
    if (parts.has('agents')) {
      for (const agent of bundle.agents) {
        const sid = sanitizePluginId(`${id}-agent-${agent.name}`);
        const body = `# ${agent.name} (imported ${bundle.format} agent)\n\nUse this role when the task matches: ${agent.description}\nTo run it in parallel, spawn a background agent and pass the role prompt below verbatim as its instructions.\n\n## Role prompt\n\n${agent.body}`;
        await stageSkill(writeSkillFromMarkdown(temp, sid, `${agent.name} agent`, agent.description, body), sid);
      }
    }

    // MCP servers land OFF (activation pending) no matter the source or secret state.
    const mcpServers: ImportedMcpEntry[] = [];
    const mcpReport: InstallPluginResult['mcpServers'] = [];
    if (parts.has('mcp')) {
      for (const { server, conv, error } of converted) {
        try {
          if (error || !conv) { warnings.push(`mcp ${server.id}: ${error || 'conversion failed'}`); continue; }
          if (conv.problems.length) { warnings.push(`mcp ${server.id}: ${conv.problems.join('; ')}`); continue; }
          deps.mcp.upsertConfig({ ...conv.config, enabled: false });
          mcpServers.push({ id: conv.config.id, secretKeys: conv.secretKeys, optional: conv.optional, passthrough: conv.passthrough.length ? conv.passthrough : undefined, enabled: false, activation: 'pending', ready: conv.enabled });
          mcpReport.push({ id: conv.config.id, enabled: false, activation: 'pending', note: conv.note });
        } catch (err: any) {
          warnings.push(`mcp ${server.id}: ${String(err?.message || err).slice(0, 240)}`);
        }
      }
    }

    const hooks = planned.hooks.map((h, i) => ({ ...h, id: `${id}:${h.event}:${i}` }));
    const ledger: ImportedPluginLedger = {
      id, name: bundle.name, format: bundle.format, source, version: bundle.version,
      importedAt: new Date().toISOString(), skills: skillIds, mcpServers, hooks, hooksApproved: false,
      requiredEnv: bundle.requiredEnv, unsupported, pluginDir, packageDir, dataDir,
      provenance: options.provenance && Object.keys(options.provenance).length ? options.provenance : undefined,
    };
    writeLedger(ledger);
    // Drop what the previous version owned and this one no longer ships.
    if (existing) {
      for (const sid of existing.skills) if (!skillIds.includes(sid)) { try { deps.skills.deleteSkill(sid); } catch { /* best effort */ } }
      for (const s of existing.mcpServers) if (!mcpServers.some((m) => m.id === s.id)) { try { void deps.mcp.disconnect?.(s.id); deps.mcp.deleteConfig(s.id); } catch { /* best effort */ } }
    }
    fs.writeFileSync(path.join(pluginDir, EXTENSION_DESCRIPTOR_FILENAME), JSON.stringify({
      id, kind: 'integration', name: bundle.name,
      description: bundle.description || `Imported ${bundle.format} plugin`,
      trustLevel: 'third_party', category: 'imported-plugin',
      tags: ['imported', bundle.format],
      runtime: { binding: `imported-plugin:${bundle.format}` },
      contracts: { mcpPresets: mcpServers.map((s) => s.id) },
    }, null, 2), 'utf8');
    if (!deps.skipReload) { try { reloadExtensions(); } catch (err: any) { warnings.push(`extension reload: ${err?.message || err}`); } }
    try { deps.skills.scanSkills(); } catch {}

    const nextSteps: string[] = [];
    const needSecrets = mcpReport.filter((m) => m.note);
    if (needSecrets.length) nextSteps.push(`Secrets needed: ${needSecrets.map((m) => `${m.id} (${m.note})`).join('; ')}. The user saves them on the Plugins page; never ask for them in chat.`);
    if (mcpReport.length) nextSteps.push(`${mcpReport.length} MCP server(s) imported but OFF. They run third-party code; turn on with plugin_ops(action:"activate_mcp", id:"${id}") only when the user wants them (it asks for approval).`);
    if (hooks.length) nextSteps.push(`${hooks.length} hook(s) imported but inactive. They run shell commands; enable with plugin_ops(action:"approve_hooks", id:"${id}") only when the user asks.`);
    return { id, format: bundle.format, skills: skillIds, mcpServers: mcpReport, hooks: hooks.length, hooksApproved: false, unsupported, warnings, nextSteps, partial: warnings.length > 0, provenance: ledger.provenance };
    } catch (err) { rollback(); throw err; }
  } finally {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  }
}



// ── Ledger / uninstall / list ────────────────────────────────────────────────

export function readLedger(pluginDir: string): ImportedPluginLedger | null {
  const file = path.join(pluginDir, IMPORT_LEDGER_FILENAME);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeLedger(ledger: ImportedPluginLedger): void {
  fs.writeFileSync(path.join(ledger.pluginDir, IMPORT_LEDGER_FILENAME), JSON.stringify(ledger, null, 2), 'utf8');
}

export function listImportedPlugins(userPluginsDir?: string): ImportedPluginLedger[] {
  const dir = userPluginsDir || resolveUserPluginsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readLedger(path.join(dir, e.name)))
    .filter(Boolean) as ImportedPluginLedger[];
}

export function getImportedPlugin(id: string, userPluginsDir?: string): ImportedPluginLedger | null {
  return readLedger(path.join(userPluginsDir || resolveUserPluginsDir(), sanitizePluginId(id)));
}

export interface UninstallResult { id: string; removedSkills: string[]; removedMcp: string[]; failed: string[]; dataKept?: string; skipped?: string[] }

/** Remove an import and everything it owns. Plugin data is kept unless purgeData is set. */
export async function uninstallPlugin(id: string, deps: PluginImportDeps, options: { keepDir?: boolean; purgeData?: boolean } = {}): Promise<UninstallResult> {
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  const pluginDir = path.join(userDir, sanitizePluginId(id));
  const ledger = readLedger(pluginDir);
  if (!ledger) throw new Error(`No imported plugin "${id}".`);
  const failed: string[] = [];
  // Only remove what this import still owns: skip ids another import claims and MCP configs replaced by something else.
  const others = listImportedPlugins(userDir).filter((l) => l.id !== ledger.id);
  const claimed = (rid: string) => others.some((l) => l.skills.includes(rid) || l.mcpServers.some((m) => m.id === rid));
  const skipped: string[] = [];
  const removedSkills = ledger.skills.filter((s) => {
    if (claimed(s)) { skipped.push(`skill ${s}`); return false; }
    try { return deps.skills.deleteSkill(s); } catch { failed.push(`skill ${s}`); return false; }
  });
  const removedMcp = ledger.mcpServers.map((s) => s.id).filter((s) => {
    const cfg = deps.mcp.getConfigs().find((c) => c.id === s) as any;
    if (claimed(s) || (cfg?.description && cfg.description !== `Imported from plugin ${ledger.id}`)) { skipped.push(`MCP ${s}`); return false; }
    try { void deps.mcp.disconnect?.(s); return deps.mcp.deleteConfig(s); } catch { failed.push(`MCP ${s}`); return false; }
  });
  if (!options.keepDir) fs.rmSync(pluginDir, { recursive: true, force: true });
  else { for (const f of fs.readdirSync(pluginDir)) fs.rmSync(path.join(pluginDir, f), { recursive: true, force: true }); }
  let dataKept: string | undefined;
  if (ledger.dataDir && fs.existsSync(ledger.dataDir)) {
    if (options.purgeData) fs.rmSync(ledger.dataDir, { recursive: true, force: true });
    else dataKept = ledger.dataDir;
  }
  if (!deps.skipReload && !options.keepDir) { try { reloadExtensions(); } catch {} }
  return { id: ledger.id, removedSkills, removedMcp, failed, dataKept, ...(skipped.length ? { skipped } : {}) };
}

// ── MCP activation (separate from secret readiness) ───────────────────────────

// mcpConfigHash lives in activation-gate.ts so the MCP manager's launch gate and the importer hash identically.

function missingSecrets(ledger: ImportedPluginLedger, s: ImportedMcpEntry, deps: PluginImportDeps): string[] {
  const has = (k: string) => !!deps.vault?.has(`plugins.${ledger.id}.${k}`);
  // Imports from before activation existed resolved env vars at import time.
  if (s.activation === undefined) return s.secretKeys.filter((k) => !process.env[k] && !has(k));
  const pass = new Set(s.passthrough || []);
  return s.secretKeys.filter((k) => !(pass.has(k) && process.env[k]) && !has(k));
}

export interface McpActivationRow { id: string; activation: 'pending' | 'active'; enabled: boolean; missing: string[] }

/**
 * Turn ON an import's MCP servers. This runs third-party code or connects to a
 * third-party endpoint, so callers must already hold the user's consent (the UI
 * button, or the plugin_ops approval card). Servers still missing a secret are
 * approved now and start as soon as the secret is saved.
 */
export async function activateMcpServers(id: string, deps: PluginImportDeps): Promise<McpActivationRow[]> {
  // Connect only after the approval is on disk: the MCP manager's launch gate reads the ledger.
  const toConnect: string[] = [];
  const ledger = getImportedPlugin(id, deps.userPluginsDir);
  if (!ledger) throw new Error(`No imported plugin "${id}".`);
  const out: McpActivationRow[] = [];
  for (const s of ledger.mcpServers) {
    const missing = missingSecrets(ledger, s, deps);
    const cfg = deps.mcp.getConfigs().find((c) => c.id === s.id) as any;
    if (!cfg) { out.push({ id: s.id, activation: s.activation || 'pending', enabled: false, missing: ['(config was removed; reinstall the plugin)'] }); continue; }
    s.activation = 'active';
    s.approvedHash = mcpConfigHash(cfg);
    if (!missing.length) {
      deps.mcp.upsertConfig({ ...cfg, enabled: true });
      s.enabled = true;
      toConnect.push(s.id);
    }
    out.push({ id: s.id, activation: 'active', enabled: s.enabled, missing });
  }
  writeLedger(ledger);
  for (const sid of toConnect) { try { await deps.mcp.connect?.(sid); } catch { /* reported by the MCP page; config stays enabled */ } }
  return out;
}

/** Turn OFF an import's MCP servers and stop them. Reversible with activateMcpServers. */
export async function deactivateMcpServers(id: string, deps: PluginImportDeps): Promise<McpActivationRow[]> {
  const ledger = getImportedPlugin(id, deps.userPluginsDir);
  if (!ledger) throw new Error(`No imported plugin "${id}".`);
  const out: McpActivationRow[] = [];
  for (const s of ledger.mcpServers) {
    const cfg = deps.mcp.getConfigs().find((c) => c.id === s.id) as any;
    if (cfg) deps.mcp.upsertConfig({ ...cfg, enabled: false });
    try { await deps.mcp.disconnect?.(s.id); } catch {}
    s.enabled = false;
    s.activation = 'pending';
    delete s.approvedHash;
    out.push({ id: s.id, activation: 'pending', enabled: false, missing: missingSecrets(ledger, s, deps) });
  }
  writeLedger(ledger);
  return out;
}

/**
 * Re-check imported MCP servers after a secret was stored. Only servers the user
 * already turned on (or legacy imports) are enabled; saving a secret never
 * activates a pending server, and a config changed since approval goes back to pending.
 */
export function enableReadyMcpServers(id: string, deps: PluginImportDeps): Array<McpActivationRow> {
  const ledger = getImportedPlugin(id, deps.userPluginsDir);
  if (!ledger) throw new Error(`No imported plugin "${id}".`);
  const out: McpActivationRow[] = [];
  for (const s of ledger.mcpServers) {
    const missing = missingSecrets(ledger, s, deps);
    const cfg = deps.mcp.getConfigs().find((c) => c.id === s.id) as any;
    if (s.activation === 'active' && cfg && s.approvedHash && s.approvedHash !== mcpConfigHash(cfg)) {
      s.activation = 'pending';
      delete s.approvedHash;
      if (cfg.enabled) deps.mcp.upsertConfig({ ...cfg, enabled: false });
      s.enabled = false;
    }
    const approved = s.activation === undefined || s.activation === 'active';
    if (cfg && !missing.length && approved && !cfg.enabled) { deps.mcp.upsertConfig({ ...cfg, enabled: true }); s.enabled = true; }
    s.ready = !missing.length;
    out.push({ id: s.id, activation: s.activation || 'active', enabled: s.enabled, missing });
  }
  writeLedger(ledger);
  return out;
}
