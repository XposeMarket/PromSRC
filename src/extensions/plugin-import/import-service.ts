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
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { findPluginDirs, readPluginBundle, sanitizePluginId, summarizeBundle, type PluginBundle, type PluginFormat, type PluginHookSpec } from './formats.js';
import { resolveUserPluginsDir, EXTENSION_DESCRIPTOR_FILENAME } from '../loader.js';
import { reloadExtensions } from '../reload.js';

export const IMPORT_LEDGER_FILENAME = 'imported-plugin.json';

export interface ImportedPluginLedger {
  id: string;
  name: string;
  format: PluginFormat;
  source: string;
  version?: string;
  importedAt: string;
  skills: string[];
  mcpServers: Array<{ id: string; secretKeys: string[]; enabled: boolean }>;
  hooks: Array<PluginHookSpec & { id: string }>;
  hooksApproved: boolean;
  requiredEnv: string[];
  unsupported: Array<{ part: string; reason: string }>;
  pluginDir: string;
}

export interface SkillInstaller {
  importBundles(source: string, options?: { id?: string; overwrite?: boolean; mode?: 'adapt' | 'force'; applySafeFixes?: boolean }): Promise<Array<{ id: string }>>;
  deleteSkill(id: string): boolean;
  scanSkills(): void;
}

export interface McpConfigStore {
  getConfigs(): Array<{ id: string }>;
  upsertConfig(cfg: any): void;
  deleteConfig(id: string): boolean;
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

// ── Remote sources (git / GitHub / marketplace entries) ──────────────────────

function stagingRoot(userDir: string): string {
  const dir = path.join(path.dirname(userDir), 'plugin-import-staging');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function git(args: string[], cwd?: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 120_000, windowsHide: true });
}

/**
 * Resolve an install source to a local plugin directory.
 * Accepts: local dir, https git URL, owner/repo, github tree URL
 * (https://github.com/o/r/tree/<ref>/<subpath>), or "<url>#<subpath>".
 */
export function resolvePluginSource(source: string, userDir: string): { dir: string; cleanup?: () => void } {
  const text = String(source || '').trim();
  if (!text) throw new Error('source is required');
  const local = path.resolve(text);
  if (fs.existsSync(local)) return { dir: local };

  let url = text; let ref = ''; let subpath = '';
  const tree = text.match(/^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/tree\/([^/]+)\/?(.*)$/i);
  if (tree) { url = `https://github.com/${tree[1]}/${tree[2]}.git`; ref = tree[3]; subpath = tree[4]; }
  else if (/^[\w.-]+\/[\w.-]+(#.*)?$/.test(text)) { const [repo, sub] = text.split('#'); url = `https://github.com/${repo}.git`; subpath = sub || ''; }
  else if (text.includes('#')) { const [u, sub] = text.split('#'); url = u; subpath = sub; }
  if (!/^https:\/\//i.test(url)) throw new Error(`Unsupported plugin source "${text}". Use a local folder, https git URL, owner/repo, or GitHub tree URL.`);

  const dest = path.join(stagingRoot(userDir), `src-${Date.now().toString(36)}`);
  const cleanup = () => { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} };
  try {
    git(['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), url, dest]);
  } catch (err: any) {
    cleanup();
    throw new Error(`git clone failed for ${url}${ref ? `@${ref}` : ''}: ${String(err?.stderr || err?.message || err).slice(0, 300)}`);
  }
  const dir = subpath ? path.resolve(dest, subpath) : dest;
  if (!dir.startsWith(path.resolve(dest)) || !fs.existsSync(dir)) { cleanup(); throw new Error(`Subpath "${subpath}" not found in ${url}`); }
  return { dir, cleanup };
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

/** Translate a foreign MCP server config into a Prometheus MCPServerConfig with vault refs. */
export function convertMcpServer(pluginId: string, server: { id: string; config: Record<string, any> }, pluginRoot: string, vault?: SecretStore): { config: Record<string, any>; secretKeys: string[]; enabled: boolean; note?: string } {
  const src = server.config;
  const id = sanitizePluginId(`${pluginId}-${server.id}`.replace(new RegExp(`^${pluginId}-${pluginId}$`), pluginId));
  const secretKeys: string[] = [];
  const vaultKey = (envName: string) => `plugins.${pluginId}.${envName}`;
  const subst = (value: string): string => String(value)
    .replace(/\$\{(CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|PLUGIN_ROOT)\}/g, pluginRoot.replace(/\\/g, '/'))
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name, dflt) => {
      if (process.env[name]) return process.env[name] as string;
      if (!secretKeys.includes(name)) secretKeys.push(name);
      return dflt !== undefined && !vault?.has(vaultKey(name)) ? dflt : `\u0000${name}\u0000`;
    });
  const toVaultValue = (v: string): string => {
    const only = v.match(/^\u0000([A-Za-z_][A-Za-z0-9_]*)\u0000$/);
    if (only) return `vault:${vaultKey(only[1])}`;
    // Mixed literal + secret ("Bearer ${TOKEN}"): keep literal prefix via a vault ref holding the whole value.
    const inner = v.match(/\u0000([A-Za-z_][A-Za-z0-9_]*)\u0000/);
    return inner ? `vault:${vaultKey(inner[1])}` : v;
  };

  const cfg: Record<string, any> = { id, name: `${pluginId}: ${server.id}`, description: `Imported from plugin ${pluginId}` };
  const type = String(src.type || src.transport || (src.command ? 'stdio' : 'http')).toLowerCase();
  if (type === 'stdio' || src.command) {
    cfg.transport = 'stdio';
    cfg.command = subst(String(src.command || ''));
    cfg.args = (Array.isArray(src.args) ? src.args : []).map((a: any) => subst(String(a)).replace(/\u0000([A-Za-z_][A-Za-z0-9_]*)\u0000/g, (_m, n) => process.env[n] || ''));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(src.env || {})) env[k] = toVaultValue(subst(String(v)));
    for (const k of Array.isArray(src.env_vars) ? src.env_vars : []) { if (!env[k]) { env[k] = `vault:${vaultKey(k)}`; if (!secretKeys.includes(k)) secretKeys.push(k); } }
    if (Object.keys(env).length) cfg.env = env;
  } else {
    cfg.transport = type === 'sse' ? 'sse' : 'http';
    cfg.url = subst(String(src.url || '')).replace(/\u0000[A-Za-z_][A-Za-z0-9_]*\u0000/g, '');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(src.headers || {})) {
      const val = toVaultValue(subst(String(v)));
      if (val) headers[k] = val;
    }
    if (typeof src.bearer_token_env_var === 'string') {
      const n = src.bearer_token_env_var;
      if (!secretKeys.includes(n)) secretKeys.push(n);
      headers.Authorization = `vault:${vaultKey(n)}`;
    }
    if (Object.keys(headers).length) cfg.headers = headers;
  }
  // Only enable when every required secret is resolvable; otherwise the
  // server would fail its first connect with "Missing vault secret".
  const missing = secretKeys.filter((k) => !process.env[k] && !vault?.has(vaultKey(k)));
  const optionalOnly = missing.every((k) => new RegExp(`\\$\\{${k}:-`).test(JSON.stringify(src)));
  // Optional secrets with defaults: drop the vault ref instead of failing.
  if (missing.length && optionalOnly) {
    const strip = (map?: Record<string, string>) => { if (!map) return; for (const [k, v] of Object.entries(map)) if (missing.some((m) => v === `vault:${vaultKey(m)}`)) delete map[k]; };
    strip(cfg.headers); strip(cfg.env);
  }
  const enabled = missing.length === 0 || optionalOnly;
  cfg.enabled = enabled;
  return { config: cfg, secretKeys, enabled, note: enabled ? undefined : `Needs secret(s): ${missing.join(', ')} (vault keys ${missing.map(vaultKey).join(', ')})` };
}

export interface InstallPluginOptions {
  /** Which parts to import. Defaults to all importable parts. */
  parts?: Array<'skills' | 'commands' | 'agents' | 'mcp' | 'hooks'>;
  overwrite?: boolean;
  idOverride?: string;
}

export interface InstallPluginResult {
  id: string;
  format: PluginFormat;
  skills: string[];
  mcpServers: Array<{ id: string; enabled: boolean; note?: string }>;
  hooks: number;
  hooksApproved: boolean;
  unsupported: Array<{ part: string; reason: string }>;
  warnings: string[];
  nextSteps: string[];
}

export async function installPlugin(source: string, deps: PluginImportDeps, options: InstallPluginOptions = {}): Promise<InstallPluginResult> {
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  const resolved = resolvePluginSource(source, userDir);
  try {
    const bundle = readPluginBundle(resolved.dir);
    if (!bundle) {
      const nested = findPluginDirs(resolved.dir, 4);
      throw new Error(nested.length
        ? `"${source}" is a collection of ${nested.length} plugins, not one plugin. Install one of: ${nested.slice(0, 12).map((d) => path.relative(resolved.dir, d) || '.').join(', ')}`
        : `No Claude/Codex/Hermes/OpenClaw plugin manifest found at "${source}".`);
    }
    return await installBundle(bundle, resolved.cleanup ? String(source) : bundle.root, deps, options);
  } finally {
    resolved.cleanup?.();
  }
}

export async function installBundle(bundle: PluginBundle, source: string, deps: PluginImportDeps, options: InstallPluginOptions = {}): Promise<InstallPluginResult> {
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  const parts = new Set(options.parts?.length ? options.parts : ['skills', 'commands', 'agents', 'mcp', 'hooks']);
  const id = sanitizePluginId(options.idOverride || bundle.id);
  const pluginDir = path.join(userDir, id);
  const existing = readLedger(pluginDir);
  if (existing && !options.overwrite) throw new Error(`Plugin "${id}" is already imported (from ${existing.source}). Pass overwrite:true to reinstall.`);
  if (existing) await uninstallPlugin(id, deps, { keepDir: true });

  const warnings: string[] = [];
  const skillIds: string[] = [];
  const temp = fs.mkdtempSync(path.join(stagingRoot(userDir), `${id}-`));
  try {
    // Skills: stage each under a namespaced folder so ids are <plugin>-<skill>.
    const stageSkill = async (dir: string, skillId: string) => {
      try {
        const installed = await deps.skills.importBundles(dir, { id: skillId, overwrite: true, mode: 'adapt', applySafeFixes: true });
        skillIds.push(...installed.map((s) => s.id));
      } catch (err: any) {
        warnings.push(`skill ${skillId}: ${String(err?.message || err).slice(0, 240)}`);
      }
    };
    if (parts.has('skills')) {
      for (const dir of bundle.skillDirs) {
        const base = sanitizePluginId(path.basename(dir) === path.basename(bundle.root) ? id : path.basename(dir));
        await stageSkill(dir, base.startsWith(`${id}-`) || base === id ? base : `${id}-${base}`);
      }
    }
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

    const mcpServers: ImportedPluginLedger['mcpServers'] = [];
    const mcpReport: InstallPluginResult['mcpServers'] = [];
    if (parts.has('mcp')) {
      for (const server of bundle.mcpServers) {
        try {
          const conv = convertMcpServer(id, server, bundle.root, deps.vault);
          deps.mcp.upsertConfig(conv.config);
          mcpServers.push({ id: conv.config.id, secretKeys: conv.secretKeys, enabled: conv.enabled });
          mcpReport.push({ id: conv.config.id, enabled: conv.enabled, note: conv.note });
        } catch (err: any) {
          warnings.push(`mcp ${server.id}: ${String(err?.message || err).slice(0, 240)}`);
        }
      }
    }

    // Hooks: copy the plugin's hook scripts so ${CLAUDE_PLUGIN_ROOT} keeps working after the source is gone.
    const hooks = parts.has('hooks') ? bundle.hooks.filter((h) => h.type === 'command').map((h, i) => ({ ...h, id: `${id}:${h.event}:${i}` })) : [];
    fs.mkdirSync(pluginDir, { recursive: true });
    if (hooks.length) {
      for (const sub of ['hooks', 'scripts', 'bin']) {
        const from = path.join(bundle.root, sub);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(pluginDir, 'files', sub), { recursive: true, force: true });
      }
    }

    const unsupported = [...bundle.unsupported, ...bundle.hooks.filter((h) => h.type !== 'command').map((h) => ({ part: `hook ${h.sourceEvent}`, reason: h.note || 'unsupported' }))];
    const ledger: ImportedPluginLedger = {
      id, name: bundle.name, format: bundle.format, source, version: bundle.version,
      importedAt: new Date().toISOString(), skills: skillIds, mcpServers, hooks, hooksApproved: false,
      requiredEnv: bundle.requiredEnv, unsupported, pluginDir,
    };
    fs.writeFileSync(path.join(pluginDir, IMPORT_LEDGER_FILENAME), JSON.stringify(ledger, null, 2), 'utf8');
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
    for (const s of mcpReport.filter((m) => !m.enabled)) nextSteps.push(`MCP ${s.id}: ${s.note}. Store the secret, then plugin_ops(action:"enable_mcp", id:"${id}").`);
    if (hooks.length) nextSteps.push(`${hooks.length} hook(s) imported but inactive. They run shell commands; enable with plugin_ops(action:"approve_hooks", id:"${id}") after review.`);
    return { id, format: bundle.format, skills: skillIds, mcpServers: mcpReport, hooks: hooks.length, hooksApproved: false, unsupported, warnings, nextSteps };
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

export async function uninstallPlugin(id: string, deps: PluginImportDeps, options: { keepDir?: boolean } = {}): Promise<{ id: string; removedSkills: string[]; removedMcp: string[] }> {
  const userDir = deps.userPluginsDir || resolveUserPluginsDir();
  const pluginDir = path.join(userDir, sanitizePluginId(id));
  const ledger = readLedger(pluginDir);
  if (!ledger) throw new Error(`No imported plugin "${id}".`);
  const removedSkills = ledger.skills.filter((s) => { try { return deps.skills.deleteSkill(s); } catch { return false; } });
  const removedMcp = ledger.mcpServers.map((s) => s.id).filter((s) => { try { return deps.mcp.deleteConfig(s); } catch { return false; } });
  if (!options.keepDir) fs.rmSync(pluginDir, { recursive: true, force: true });
  else { for (const f of fs.readdirSync(pluginDir)) fs.rmSync(path.join(pluginDir, f), { recursive: true, force: true }); }
  if (!deps.skipReload && !options.keepDir) { try { reloadExtensions(); } catch {} }
  return { id: ledger.id, removedSkills, removedMcp };
}

/** Re-evaluate imported MCP servers after secrets were stored; enable the ready ones. */
export function enableReadyMcpServers(id: string, deps: PluginImportDeps): Array<{ id: string; enabled: boolean; missing: string[] }> {
  const ledger = getImportedPlugin(id, deps.userPluginsDir);
  if (!ledger) throw new Error(`No imported plugin "${id}".`);
  const out: Array<{ id: string; enabled: boolean; missing: string[] }> = [];
  for (const s of ledger.mcpServers) {
    const missing = s.secretKeys.filter((k) => !process.env[k] && !deps.vault?.has(`plugins.${ledger.id}.${k}`));
    const cfg = deps.mcp.getConfigs().find((c) => c.id === s.id) as any;
    if (cfg && !missing.length) { deps.mcp.upsertConfig({ ...cfg, enabled: true }); s.enabled = true; }
    out.push({ id: s.id, enabled: s.enabled, missing });
  }
  writeLedger(ledger);
  return out;
}
