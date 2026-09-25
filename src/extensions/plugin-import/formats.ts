/**
 * Foreign plugin format readers: Claude Code, Codex, Hermes Agent, OpenClaw.
 *
 * Each reader normalizes a plugin directory into a PluginBundle describing the
 * parts Prometheus can import (skills, MCP servers, commands, agents, hooks)
 * and the parts it cannot (hosted apps, native Python/TS runtimes), with a
 * reason for each. Reading never executes plugin code.
 */
import fs from 'fs';
import path from 'path';

export type PluginFormat = 'claude' | 'codex' | 'hermes' | 'openclaw';

export interface PluginCommand { name: string; description: string; argumentHint?: string; body: string; sourcePath: string }
export interface PluginAgent { name: string; description: string; model?: string; body: string; sourcePath: string }
export interface PluginHookSpec {
  /** Prometheus event: PreToolUse | PostToolUse | PostToolUseFailure | UserPromptSubmit | Stop | SessionStart | SessionEnd */
  event: string;
  /** Original event name in the source format. */
  sourceEvent: string;
  matcher?: string;
  type: 'command' | 'unsupported';
  command?: string;
  timeoutSec?: number;
  note?: string;
}
export interface PluginMcpServer { id: string; config: Record<string, any> }
export interface UnsupportedPart { part: string; reason: string }

export interface PluginBundle {
  id: string;
  name: string;
  version?: string;
  description: string;
  author?: string;
  format: PluginFormat;
  root: string;
  manifestPath: string;
  skillDirs: string[];
  commands: PluginCommand[];
  agents: PluginAgent[];
  mcpServers: PluginMcpServer[];
  hooks: PluginHookSpec[];
  requiredEnv: string[];
  unsupported: UnsupportedPart[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.cache']);

export function sanitizePluginId(raw: string): string {
  const id = String(raw || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return /^[a-z0-9]/.test(id) ? id : `plugin-${id || 'unnamed'}`.slice(0, 64);
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function readYaml(file: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require('js-yaml') as { load: (s: string) => unknown };
    return yaml.load(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch { return null; }
}

function isDir(p: string): boolean { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p: string): boolean { try { return fs.statSync(p).isFile(); } catch { return false; } }

/** Resolve a manifest-relative path, refusing escapes outside the plugin root. */
function within(root: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  const abs = path.resolve(root, rel.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '.'));
  const base = path.resolve(root);
  return abs === base || abs.startsWith(base + path.sep) ? abs : null;
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

/** Frontmatter + body of a markdown file (YAML frontmatter optional). */
export function parseMarkdownDoc(text: string): { data: Record<string, any>; body: string } {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw.trim() };
  let data: Record<string, any> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parsed = (require('js-yaml') as { load: (s: string) => unknown }).load(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, any>;
  } catch {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: m[2].trim() };
}

/** Every directory under `dir` (bounded) that holds a SKILL.md. */
export function findSkillDirs(dir: string, maxDepth = 4): string[] {
  const out: string[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > maxDepth || !isDir(current)) return;
    if (isFile(path.join(current, 'SKILL.md')) || isFile(path.join(current, 'skill.md'))) {
      out.push(current);
      return; // a skill's own subfolders are its resources, not more skills
    }
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(current, e.name), depth + 1);
  };
  walk(dir, 0);
  return out.sort();
}

function readMarkdownDir<T>(dir: string | null, make: (name: string, data: Record<string, any>, body: string, file: string) => T): T[] {
  if (!dir || !isDir(dir)) return [];
  const out: T[] = [];
  const walk = (current: string, prefix: string) => {
    for (const e of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) { walk(abs, prefix ? `${prefix}:${e.name}` : e.name); continue; }
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
      const { data, body } = parseMarkdownDoc(fs.readFileSync(abs, 'utf8'));
      const base = e.name.replace(/\.md$/i, '');
      out.push(make(prefix ? `${prefix}:${base}` : base, data, body, abs));
    }
  };
  walk(dir, '');
  return out;
}

// ── Env placeholders ────────────────────────────────────────────────────────

/** Env var names referenced as ${VAR} / ${VAR:-default} (plugin-root vars excluded). */
export function collectEnvRefs(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g)) {
      if (!/^(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|PLUGIN_ROOT|CODEX_PLUGIN_ROOT|PROMETHEUS_PLUGIN_ROOT)$/.test(m[1])) into.add(m[1]);
    }
  } else if (Array.isArray(value)) value.forEach((v) => collectEnvRefs(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectEnvRefs(v, into));
  return into;
}

// ── Hooks (Claude/Codex hooks.json shape) ────────────────────────────────────

// Only events Prometheus actually dispatches (subagent-executor tool path and
// main-chat turn end). Anything else is reported unsupported, never silently dropped.
const HOOK_EVENT_MAP: Record<string, string> = {
  PreToolUse: 'PreToolUse', PostToolUse: 'PostToolUse', PostToolUseFailure: 'PostToolUseFailure',
  Stop: 'Stop',
  // Hermes names
  pre_tool_call: 'PreToolUse', post_tool_call: 'PostToolUse',
  // Codex names
  turn_end: 'Stop', 'turn-end': 'Stop',
};

export function parseHooksJson(raw: any): PluginHookSpec[] {
  const hooks = raw?.hooks && typeof raw.hooks === 'object' ? raw.hooks : raw;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const out: PluginHookSpec[] = [];
  for (const [sourceEvent, groups] of Object.entries(hooks)) {
    const event = HOOK_EVENT_MAP[sourceEvent];
    for (const group of Array.isArray(groups) ? groups : []) {
      const inner = Array.isArray((group as any)?.hooks) ? (group as any).hooks : [group];
      for (const h of inner) {
        const base = { sourceEvent, event: event || sourceEvent, matcher: typeof (group as any)?.matcher === 'string' ? (group as any).matcher : undefined };
        if (!event) { out.push({ ...base, type: 'unsupported', note: `Event "${sourceEvent}" has no Prometheus equivalent.` }); continue; }
        if (h?.type === 'command' && typeof h.command === 'string') {
          out.push({ ...base, type: 'command', command: h.command, timeoutSec: Number(h.timeout) > 0 ? Math.min(60, Number(h.timeout)) : 10 });
        } else {
          out.push({ ...base, type: 'unsupported', note: `Hook type "${h?.type || 'unknown'}" is not supported (only command hooks).` });
        }
      }
    }
  }
  return out;
}

// ── MCP servers ─────────────────────────────────────────────────────────────

function mcpServersFrom(root: string, spec: unknown): PluginMcpServer[] {
  let raw: any = null;
  if (typeof spec === 'string') { const p = within(root, spec); raw = p ? readJson(p) : null; }
  else if (spec && typeof spec === 'object') raw = spec;
  const servers = raw?.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers : raw;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  return Object.entries(servers)
    .filter(([, cfg]) => cfg && typeof cfg === 'object')
    .map(([id, cfg]) => ({ id: sanitizePluginId(id), config: cfg as Record<string, any> }));
}

// ── Detection ───────────────────────────────────────────────────────────────

export function detectPluginFormat(dir: string): { format: PluginFormat; manifestPath: string } | null {
  const candidates: Array<[PluginFormat, string]> = [
    ['claude', path.join(dir, '.claude-plugin', 'plugin.json')],
    ['codex', path.join(dir, '.codex-plugin', 'plugin.json')],
    ['openclaw', path.join(dir, 'openclaw.plugin.json')],
    ['hermes', path.join(dir, 'plugin.yaml')],
    ['hermes', path.join(dir, 'plugin.yml')],
  ];
  for (const [format, manifestPath] of candidates) if (isFile(manifestPath)) return { format, manifestPath };
  return null;
}

/** Read any supported plugin directory. Returns null if it is not a plugin. */
export function readPluginBundle(dir: string): PluginBundle | null {
  const root = path.resolve(dir);
  const detected = detectPluginFormat(root);
  if (!detected) return null;
  const { format, manifestPath } = detected;
  const manifest = format === 'hermes' ? readYaml(manifestPath) : readJson(manifestPath);
  if (!manifest || typeof manifest !== 'object') return null;

  const name = String(manifest.name || manifest.id || path.basename(root));
  const bundle: PluginBundle = {
    id: sanitizePluginId(manifest.id || manifest.name || path.basename(root)),
    name: String(manifest.interface?.displayName || name),
    version: manifest.version ? String(manifest.version) : undefined,
    description: String(manifest.description || manifest.interface?.shortDescription || ''),
    author: typeof manifest.author === 'string' ? manifest.author : manifest.author?.name,
    format, root, manifestPath,
    skillDirs: [], commands: [], agents: [], mcpServers: [], hooks: [], requiredEnv: [], unsupported: [],
  };

  // Skills: explicit manifest path(s), then the conventional skills/ dir.
  const skillRoots = new Set<string>();
  for (const rel of asList(manifest.skills)) { const p = within(root, rel); if (p) skillRoots.add(p); }
  if (isDir(path.join(root, 'skills'))) skillRoots.add(path.join(root, 'skills'));
  // Hermes/OpenClaw plugins may keep a SKILL.md at the plugin root.
  if (isFile(path.join(root, 'SKILL.md'))) bundle.skillDirs.push(root);
  for (const sr of skillRoots) for (const d of findSkillDirs(sr)) if (!bundle.skillDirs.includes(d)) bundle.skillDirs.push(d);

  if (format === 'claude' || format === 'codex') {
    const cmdDirs = asList(manifest.commands).map((r) => within(root, r)).filter(Boolean) as string[];
    if (!cmdDirs.length) cmdDirs.push(path.join(root, 'commands'));
    for (const d of cmdDirs) bundle.commands.push(...readMarkdownDir(d, (n, data, body, file) => ({
      name: n, description: String(data.description || `Command /${n}`), argumentHint: data['argument-hint'] ? String(data['argument-hint']) : undefined, body, sourcePath: file,
    })));
    const agentDirs = asList(manifest.agents).map((r) => within(root, r)).filter(Boolean) as string[];
    if (!agentDirs.length) agentDirs.push(path.join(root, 'agents'));
    for (const d of agentDirs) bundle.agents.push(...readMarkdownDir(d, (n, data, body, file) => ({
      name: String(data.name || n), description: String(data.description || `Agent ${n}`), model: data.model ? String(data.model) : undefined, body, sourcePath: file,
    })));

    bundle.mcpServers.push(...mcpServersFrom(root, manifest.mcpServers ?? (isFile(path.join(root, '.mcp.json')) ? '.mcp.json' : undefined)));

    let hooksRaw: any = null;
    if (typeof manifest.hooks === 'string') { const p = within(root, manifest.hooks); hooksRaw = p ? readJson(p) : null; }
    else if (manifest.hooks && typeof manifest.hooks === 'object') hooksRaw = manifest.hooks;
    else if (isFile(path.join(root, 'hooks', 'hooks.json'))) hooksRaw = readJson(path.join(root, 'hooks', 'hooks.json'));
    else if (isFile(path.join(root, 'hooks.json'))) hooksRaw = readJson(path.join(root, 'hooks.json'));
    if (hooksRaw) bundle.hooks.push(...parseHooksJson(hooksRaw));

    const appsPath = typeof manifest.apps === 'string' ? within(root, manifest.apps) : (isFile(path.join(root, '.app.json')) ? path.join(root, '.app.json') : null);
    if (appsPath && isFile(appsPath)) {
      const apps = Object.keys(readJson(appsPath)?.apps || {});
      bundle.unsupported.push({ part: `apps (${apps.join(', ') || 'hosted connectors'})`, reason: 'ChatGPT-hosted connectors are bound to the OpenAI account and cannot run outside Codex. Use the matching Prometheus connector or the plugin MCP server instead.' });
    }
    // Codex bundled system plugins depend on the Codex binary.
    if (format === 'codex' && /^(browser|chrome|computer-use|computer_use|unified-computer-use|codex-app-tools)$/i.test(name)) {
      bundle.unsupported.push({ part: 'native runtime', reason: 'Depends on codex.exe / the Codex app sandbox (its MCP servers talk to Codex over a local pipe); Prometheus has its own browser and desktop tools.' });
      bundle.mcpServers = [];
    }
  }

  if (format === 'hermes') {
    for (const env of asList(manifest.requires_env)) bundle.requiredEnv.push(String(env));
    for (const e of Array.isArray(manifest.requires_env) ? manifest.requires_env : []) if (e && typeof e === 'object' && e.name) bundle.requiredEnv.push(String(e.name));
    if (isFile(path.join(root, '__init__.py')) || fs.readdirSync(root).some((f) => f.endsWith('.py'))) {
      const provides = [
        ...asList(manifest.provides_tools).map((t) => `tool ${t}`),
        ...asList(manifest.provides_hooks).map((h) => `hook ${h}`),
        ...Object.keys(manifest).filter((k) => /^provides_/.test(k) && !/^provides_(tools|hooks)$/.test(k)).map((k) => k.replace(/^provides_/, '')),
      ];
      bundle.unsupported.push({ part: `python runtime${provides.length ? ` (${provides.join(', ')})` : ''}`, reason: 'Hermes plugins register tools/hooks from Python at load time; Prometheus does not execute foreign Python plugin runtimes. Skills and MCP servers are imported.' });
    }
    bundle.mcpServers.push(...mcpServersFrom(root, manifest.mcp_servers ?? manifest.mcpServers ?? (isFile(path.join(root, '.mcp.json')) ? '.mcp.json' : undefined)));
  }

  if (format === 'openclaw') {
    bundle.mcpServers.push(...mcpServersFrom(root, manifest.mcpServers ?? (isFile(path.join(root, '.mcp.json')) ? '.mcp.json' : undefined)));
    const hasRuntime = ['index.ts', 'index.js', 'src'].some((f) => fs.existsSync(path.join(root, f))) || manifest.providers || manifest.channels;
    if (hasRuntime) {
      const parts = ['providers', 'channels', 'cliBackends', 'commandAliases'].filter((k) => manifest[k]);
      bundle.unsupported.push({ part: `typescript runtime${parts.length ? ` (${parts.join(', ')})` : ''}`, reason: 'OpenClaw plugins run inside the OpenClaw plugin SDK; Prometheus imports their skills and MCP servers only.' });
    }
    for (const env of Object.values(manifest.providerAuthEnvVars || {})) for (const v of asList(env)) bundle.requiredEnv.push(v);
  }

  // Env refs used by MCP servers and hooks.
  const envRefs = collectEnvRefs(bundle.mcpServers.map((s) => s.config));
  for (const s of bundle.mcpServers) {
    if (typeof s.config.bearer_token_env_var === 'string') envRefs.add(s.config.bearer_token_env_var);
    for (const v of asList(s.config.env_vars)) envRefs.add(v);
  }
  for (const v of envRefs) if (!bundle.requiredEnv.includes(v)) bundle.requiredEnv.push(v);
  bundle.requiredEnv = [...new Set(bundle.requiredEnv)];
  return bundle;
}

/** Plugin dirs under a root (a marketplace checkout, an oss repo, a plugins folder). */
export function findPluginDirs(root: string, maxDepth = 4): string[] {
  const out: string[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > maxDepth || !isDir(current)) return;
    if (detectPluginFormat(current)) { out.push(current); return; }
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && e.name !== '.claude-plugin' && e.name !== '.codex-plugin') walk(path.join(current, e.name), depth + 1);
  };
  walk(path.resolve(root), 0);
  return out.sort();
}

/** One-line part summary with import compatibility, for scan/inspect output. */
export function summarizeBundle(b: PluginBundle): Record<string, unknown> {
  return {
    id: b.id, name: b.name, format: b.format, version: b.version, description: b.description.slice(0, 200), root: b.root,
    importable: {
      skills: b.skillDirs.map((d) => path.basename(d)),
      commands: b.commands.map((c) => c.name),
      agents: b.agents.map((a) => a.name),
      mcpServers: b.mcpServers.map((s) => s.id),
      hooks: b.hooks.filter((h) => h.type === 'command').map((h) => `${h.event}${h.matcher ? `(${h.matcher})` : ''}`),
    },
    // Only what is actually missing; PATH/HOME-style refs are already set.
    requiredEnv: b.requiredEnv.filter((v) => !process.env[v]),
    unsupported: [...b.unsupported, ...b.hooks.filter((h) => h.type !== 'command').map((h) => ({ part: `hook ${h.sourceEvent}`, reason: h.note || 'unsupported' }))],
  };
}
