import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { getMCPManager, MCPManager } from '../mcp-manager';

export type MigrationSourceKind = 'hermes' | 'openclaw' | 'localclaw' | 'custom';
export type MigrationMode = 'user-data' | 'full';
export type MigrationStatus = 'migrated' | 'skipped' | 'conflict' | 'archived' | 'error';
export type SkillConflictMode = 'skip' | 'overwrite' | 'rename';

export interface MigrationSource {
  id: string;
  kind: MigrationSourceKind;
  label: string;
  path: string;
  exists: boolean;
  confidence: 'high' | 'medium' | 'low';
  details: string[];
}

export interface MigrationOptions {
  sourceId?: string;
  sourcePath?: string;
  sourceKind?: MigrationSourceKind;
  mode?: MigrationMode;
  execute?: boolean;
  includeSecrets?: boolean;
  overwrite?: boolean;
  skillConflict?: SkillConflictMode;
  categories?: string[];
}

export interface MigrationItem {
  id: string;
  category: string;
  label: string;
  source?: string;
  destination?: string;
  status: MigrationStatus;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface MigrationReport {
  id: string;
  source: MigrationSource;
  mode: MigrationMode;
  execute: boolean;
  includeSecrets: boolean;
  overwrite: boolean;
  skillConflict: SkillConflictMode;
  startedAt: string;
  completedAt: string;
  outputDir: string;
  summary: Record<MigrationStatus | 'total', number>;
  items: MigrationItem[];
  notes: string[];
}

type SourceProfile = {
  kind: MigrationSourceKind;
  root: string;
  configFile?: string;
  envFile?: string;
  workspaceDirs: string[];
  skillDirs: string[];
  memoryFiles: Array<{ category: string; label: string; rel: string; destinationName: string }>;
  archiveFiles: Array<{ rel: string; label: string }>;
};

const SOURCE_LABELS: Record<MigrationSourceKind, string> = {
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  localclaw: 'LocalClaw',
  custom: 'Custom source',
};

const SECRET_ENV_TO_PROVIDER: Record<string, { provider: string; field: string }> = {
  OPENAI_API_KEY: { provider: 'openai', field: 'api_key' },
  ANTHROPIC_API_KEY: { provider: 'anthropic', field: 'api_key' },
  GEMINI_API_KEY: { provider: 'gemini', field: 'api_key' },
  GOOGLE_API_KEY: { provider: 'gemini', field: 'api_key' },
  PERPLEXITY_API_KEY: { provider: 'perplexity', field: 'api_key' },
  OPENROUTER_API_KEY: { provider: 'openrouter', field: 'api_key' },
  DEEPSEEK_API_KEY: { provider: 'deepseek', field: 'api_key' },
  ZAI_API_KEY: { provider: 'zai', field: 'api_key' },
  XAI_API_KEY: { provider: 'xai', field: 'api_key' },
  MOONSHOT_API_KEY: { provider: 'moonshot', field: 'api_key' },
  QWEN_API_KEY: { provider: 'qwen', field: 'api_key' },
  MINIMAX_API_KEY: { provider: 'minimax', field: 'api_key' },
};

const CHANNEL_SECRET_ENV = new Set([
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_WEBHOOK_SECRET',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'source';
}

function existsDir(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
}

function existsFile(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
}

function readJsonFile(file: string): any {
  try {
    if (!existsFile(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function readTextFile(file: string): string {
  try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; }
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function pathRelativeDisplay(root: string, p: string): string {
  const rel = path.relative(root, p);
  return rel && !rel.startsWith('..') ? rel : p;
}

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = readTextFile(file);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function coerceScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleYaml(file: string): any {
  const text = readTextFile(file);
  if (!text.trim()) return {};
  if (/^\s*[{[]/.test(text)) return readJsonFile(file) || {};

  const root: Record<string, any> = {};
  const stack: Array<{ indent: number; obj: Record<string, any> }> = [{ indent: -1, obj: root }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)?.[0].length || 0;
    const line = raw.trim();
    if (line.startsWith('- ')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().replace(/^['"]|['"]$/g, '');
    const rest = line.slice(idx + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (!rest) {
      parent[key] = parent[key] && typeof parent[key] === 'object' ? parent[key] : {};
      stack.push({ indent, obj: parent[key] });
    } else {
      parent[key] = coerceScalar(rest);
    }
  }
  return root;
}

function writeJsonAtomic(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function appendImportedBlock(dest: string, title: string, sourceLabel: string, content: string, execute: boolean): MigrationStatus {
  const normalized = content.trim();
  if (!normalized) return 'skipped';
  const header = `\n\n## Imported from ${sourceLabel} - ${new Date().toISOString().slice(0, 10)}\n\n`;
  const existing = readTextFile(dest);
  if (existing.includes(normalized)) return 'skipped';
  if (execute) {
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, `${existing.trimEnd()}${header}${normalized}\n`, 'utf-8');
  }
  return 'migrated';
}

function profileForSource(kind: MigrationSourceKind, root: string): SourceProfile {
  const workspaceCandidates = kind === 'hermes'
    ? [path.join(root, 'workspace')]
    : [path.join(root, 'workspace'), path.join(root, 'workspace.default'), path.join(root, 'workspace-main')];

  const skillDirs = kind === 'hermes'
    ? [path.join(root, 'skills')]
    : [
        path.join(root, 'workspace', 'skills'),
        path.join(root, 'skills'),
        path.join(root, 'workspace', '.agents', 'skills'),
      ];

  return {
    kind,
    root,
    configFile: kind === 'hermes' ? path.join(root, 'config.yaml') : path.join(root, 'openclaw.json'),
    envFile: path.join(root, '.env'),
    workspaceDirs: workspaceCandidates,
    skillDirs,
    memoryFiles: [
      { category: 'persona', label: 'SOUL.md', rel: kind === 'hermes' ? 'SOUL.md' : 'workspace/SOUL.md', destinationName: 'SOUL.md' },
      { category: 'memory', label: 'MEMORY.md', rel: kind === 'hermes' ? 'memories/MEMORY.md' : 'workspace/MEMORY.md', destinationName: 'MEMORY.md' },
      { category: 'memory', label: 'USER.md', rel: kind === 'hermes' ? 'memories/USER.md' : 'workspace/USER.md', destinationName: 'USER.md' },
      { category: 'context', label: 'AGENTS.md', rel: kind === 'hermes' ? 'AGENTS.md' : 'workspace/AGENTS.md', destinationName: `IMPORTED_${SOURCE_LABELS[kind].toUpperCase()}_AGENTS.md` },
    ],
    archiveFiles: [
      { rel: 'cron/jobs.json', label: 'Cron jobs' },
      { rel: 'cron-config.json', label: 'Cron configuration' },
      { rel: 'hooks-config.json', label: 'Hooks configuration' },
      { rel: 'plugins-config.json', label: 'Plugins configuration' },
      { rel: 'gateway.json', label: 'Gateway configuration' },
      { rel: 'sessions', label: 'Sessions' },
    ],
  };
}

function detectKindFromPath(root: string): MigrationSourceKind {
  if (existsFile(path.join(root, 'config.yaml')) || existsDir(path.join(root, 'memories'))) return 'hermes';
  if (existsFile(path.join(root, 'openclaw.json'))) return 'openclaw';
  if (path.basename(root).toLowerCase().includes('localclaw')) return 'localclaw';
  return 'custom';
}

function inspectSource(kind: MigrationSourceKind, root: string): MigrationSource {
  const profile = profileForSource(kind, root);
  const details: string[] = [];
  if (profile.configFile && existsFile(profile.configFile)) details.push(`Config: ${path.basename(profile.configFile)}`);
  if (existsFile(profile.envFile || '')) details.push('Environment file');
  if (profile.workspaceDirs.some(existsDir)) details.push('Workspace files');
  if (profile.skillDirs.some(existsDir)) details.push('Skills');
  if (existsDir(path.join(root, 'memories'))) details.push('Memories');

  return {
    id: `${kind}:${Buffer.from(path.resolve(root)).toString('base64url')}`,
    kind,
    label: `${SOURCE_LABELS[kind]}${details.length ? '' : ' candidate'}`,
    path: root,
    exists: existsDir(root),
    confidence: details.length >= 2 ? 'high' : details.length === 1 ? 'medium' : 'low',
    details,
  };
}

export function listMigrationSources(): MigrationSource[] {
  const home = os.homedir();
  const cwd = process.cwd();
  const candidates: Array<{ kind: MigrationSourceKind; root: string }> = [
    { kind: 'hermes', root: path.join(home, '.hermes') },
    { kind: 'openclaw', root: path.join(home, '.openclaw') },
    { kind: 'openclaw', root: path.join(home, '.clawdbot') },
    { kind: 'openclaw', root: path.join(home, '.moltbot') },
    { kind: 'localclaw', root: path.join(home, '.localclaw') },
    { kind: 'localclaw', root: path.join(cwd, '.localclaw') },
  ];
  const seen = new Set<string>();
  const sources: MigrationSource[] = [];
  for (const c of candidates) {
    const resolved = path.resolve(c.root);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = inspectSource(c.kind, resolved);
    if (source.exists) sources.push(source);
  }
  return sources;
}

function resolveSource(options: MigrationOptions): MigrationSource {
  if (options.sourcePath) {
    const root = path.resolve(String(options.sourcePath));
    const kind = options.sourceKind && options.sourceKind !== 'custom' ? options.sourceKind : detectKindFromPath(root);
    return inspectSource(kind, root);
  }
  const sources = listMigrationSources();
  if (options.sourceId) {
    const found = sources.find((s) => s.id === options.sourceId);
    if (found) return found;
  }
  const preferred = sources.find((s) => s.kind === 'hermes') || sources.find((s) => s.kind === 'openclaw') || sources[0];
  if (!preferred) throw new Error('No Hermes, OpenClaw, or LocalClaw source was found.');
  return preferred;
}

function addItem(items: MigrationItem[], item: Omit<MigrationItem, 'id'>): void {
  items.push({ id: crypto.randomUUID(), ...item });
}

function collectSkillDirs(profile: SourceProfile): string[] {
  const dirs: string[] = [];
  for (const base of profile.skillDirs) {
    if (!existsDir(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const full = path.join(base, entry.name);
      if (existsFile(path.join(full, 'SKILL.md')) || existsFile(path.join(full, 'skill.md'))) dirs.push(full);
    }
  }
  return Array.from(new Set(dirs.map((d) => path.resolve(d))));
}

function resolveSkillDestination(importRoot: string, sourceDir: string, mode: SkillConflictMode): { dest: string; status?: MigrationStatus; reason?: string } {
  const baseName = path.basename(sourceDir);
  let dest = path.join(importRoot, baseName);
  if (!existsDir(dest)) return { dest };
  if (mode === 'skip') return { dest, status: 'conflict', reason: 'A Prometheus skill with this imported name already exists.' };
  if (mode === 'overwrite') return { dest };
  let counter = 2;
  while (existsDir(dest)) {
    dest = path.join(importRoot, `${baseName}-${counter}`);
    counter += 1;
  }
  return { dest };
}

function readSourceConfig(profile: SourceProfile): any {
  if (!profile.configFile || !existsFile(profile.configFile)) return {};
  if (profile.configFile.endsWith('.json')) return readJsonFile(profile.configFile) || {};
  return parseSimpleYaml(profile.configFile);
}

function getNested(obj: any, pathParts: string[]): any {
  let cur = obj;
  for (const part of pathParts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function collectMcpServers(config: any): any[] {
  const servers = getNested(config, ['mcp_servers']) || getNested(config, ['mcp', 'servers']);
  if (!servers || typeof servers !== 'object') return [];
  if (Array.isArray(servers)) return servers;
  return Object.entries(servers).map(([id, value]) => ({ id, ...(value as any) }));
}

function collectConfigSuggestions(profile: SourceProfile, config: any): Record<string, any> {
  const updates: Record<string, any> = {};
  if (profile.kind === 'hermes') {
    const model = typeof config.model === 'string' ? config.model : '';
    if (model) {
      updates.models = { primary: model, roles: { manager: model, executor: model, verifier: model } };
      updates.llm = { provider: 'openai', providers: { openai: { model } } };
    }
    if (config.timezone) updates.timezone = config.timezone;
    if (config.terminal?.timeout) updates.terminal_timeout = config.terminal.timeout;
  } else {
    const model = getNested(config, ['agents', 'defaults', 'model']);
    const modelName = typeof model === 'string'
      ? model
      : typeof model?.primary === 'string'
        ? model.primary
        : '';
    if (modelName) {
      updates.models = { primary: modelName, roles: { manager: modelName, executor: modelName, verifier: modelName } };
      updates.llm = { provider: 'openai', providers: { openai: { model: modelName } } };
    }
    const workspace = getNested(config, ['agents', 'defaults', 'workspace']);
    if (typeof workspace === 'string' && workspace.trim()) updates.workspace = { path: workspace.trim() };
  }
  return updates;
}

function mergeConfigUpdates(updates: Record<string, any>, execute: boolean, overwrite: boolean, items: MigrationItem[], sourceLabel: string): void {
  if (!Object.keys(updates).length) {
    addItem(items, { category: 'config', label: 'Model and workspace config', status: 'skipped', reason: 'No compatible config values found.' });
    return;
  }

  const cm = getConfig();
  const current = cm.getConfig() as any;
  const next: Record<string, any> = {};
  const conflicts: string[] = [];

  if (updates.models) {
    const currentPrimary = String(current.models?.primary || '');
    if (currentPrimary && currentPrimary !== 'qwen3:4b' && !overwrite) conflicts.push('models.primary');
    else next.models = updates.models;
  }
  if (updates.llm) {
    const currentProvider = String(current.llm?.provider || '');
    if (currentProvider && currentProvider !== 'ollama' && !overwrite) conflicts.push('llm.provider');
    else next.llm = { ...(current.llm || {}), ...updates.llm, providers: { ...(current.llm?.providers || {}), ...(updates.llm.providers || {}) } };
  }
  if (updates.workspace?.path) {
    const currentWorkspace = String(current.workspace?.path || '');
    if (currentWorkspace && !overwrite) {
      conflicts.push('workspace.path');
    } else {
      next.workspace = { ...(current.workspace || {}), path: updates.workspace.path };
    }
  }

  if (conflicts.length && !Object.keys(next).length) {
    addItem(items, {
      category: 'config',
      label: 'Model and workspace config',
      status: 'conflict',
      reason: `Existing Prometheus config kept: ${conflicts.join(', ')}`,
      details: { source: sourceLabel },
    });
    return;
  }

  if (execute && Object.keys(next).length) cm.updateConfig(next as any);
  addItem(items, {
    category: 'config',
    label: 'Model and workspace config',
    status: 'migrated',
    destination: 'Prometheus config.json',
    reason: conflicts.length ? `Imported compatible values; kept existing ${conflicts.join(', ')}` : undefined,
    details: { keys: Object.keys(next), source: sourceLabel },
  });
}

function mergeProviderSecrets(env: Record<string, string>, execute: boolean, items: MigrationItem[], sourceLabel: string): void {
  const providerUpdates: Record<string, any> = {};
  for (const [envKey, mapping] of Object.entries(SECRET_ENV_TO_PROVIDER)) {
    const value = env[envKey];
    if (!value) continue;
    providerUpdates[mapping.provider] = {
      ...(providerUpdates[mapping.provider] || {}),
      [mapping.field]: value,
    };
  }
  if (!Object.keys(providerUpdates).length) {
    addItem(items, { category: 'secrets', label: 'Provider secrets', status: 'skipped', reason: 'No supported provider API keys found.' });
    return;
  }
  if (execute) {
    const cm = getConfig();
    const current = cm.getConfig() as any;
    cm.updateConfig({
      llm: {
        ...(current.llm || {}),
        providers: {
          ...(current.llm?.providers || {}),
          ...Object.fromEntries(Object.entries(providerUpdates).map(([provider, cfg]) => [
            provider,
            { ...(current.llm?.providers?.[provider] || {}), ...(cfg as any) },
          ])),
        },
      },
    } as any);
  }
  addItem(items, {
    category: 'secrets',
    label: 'Provider secrets',
    status: 'migrated',
    destination: 'Prometheus vault-backed provider config',
    details: { providers: Object.keys(providerUpdates), source: sourceLabel },
  });
}

function mergeChannelSettings(env: Record<string, string>, config: any, execute: boolean, items: MigrationItem[]): void {
  const updates: Record<string, any> = {};
  const telegramToken = env.TELEGRAM_BOT_TOKEN || getNested(config, ['channels', 'telegram', 'botToken']) || getNested(config, ['channels', 'telegram', 'accounts', 'default', 'botToken']);
  const discordToken = env.DISCORD_BOT_TOKEN || getNested(config, ['channels', 'discord', 'token']) || getNested(config, ['channels', 'discord', 'botToken']);
  const waToken = env.WHATSAPP_ACCESS_TOKEN || getNested(config, ['channels', 'whatsapp', 'accessToken']);

  const current = getConfig().getConfig() as any;
  const channels = { ...(current.channels || {}) };
  if (telegramToken) {
    channels.telegram = { ...(channels.telegram || {}), enabled: true, botToken: String(telegramToken) };
    updates.telegram = true;
  }
  if (discordToken) {
    channels.discord = { ...(channels.discord || {}), enabled: true, botToken: String(discordToken) };
    updates.discord = true;
  }
  if (waToken) {
    channels.whatsapp = { ...(channels.whatsapp || {}), enabled: true, accessToken: String(waToken) };
    updates.whatsapp = true;
  }

  if (!Object.keys(updates).length) {
    addItem(items, { category: 'channels', label: 'Messaging channel credentials', status: 'skipped', reason: 'No supported channel credentials found.' });
    return;
  }

  if (execute) getConfig().updateConfig({ channels, telegram: channels.telegram } as any);
  addItem(items, {
    category: 'channels',
    label: 'Messaging channel credentials',
    status: 'migrated',
    destination: 'Prometheus channel settings',
    details: { channels: Object.keys(updates) },
  });
}

function mergeMcpServers(config: any, execute: boolean, items: MigrationItem[]): void {
  const servers = collectMcpServers(config);
  if (!servers.length) {
    addItem(items, { category: 'mcp', label: 'MCP servers', status: 'skipped', reason: 'No MCP server definitions found.' });
    return;
  }
  const normalized = servers
    .map((server, i) => MCPManager.normalizeConfig(server, `imported_${i + 1}`))
    .filter((server): server is NonNullable<ReturnType<typeof MCPManager.normalizeConfig>> => !!server);
  if (!normalized.length) {
    addItem(items, { category: 'mcp', label: 'MCP servers', status: 'skipped', reason: 'No compatible MCP server definitions found.' });
    return;
  }
  if (execute) {
    const manager = getMCPManager();
    for (const server of normalized) {
      try { manager.upsertConfig({ ...server, enabled: false }); } catch {}
    }
  }
  addItem(items, {
    category: 'mcp',
    label: 'MCP servers',
    status: 'migrated',
    destination: path.join(getConfig().getConfigDir(), 'mcp-servers.json'),
    details: { count: normalized.length, ids: normalized.map((s) => s.id) },
  });
}

function archiveUnsupported(profile: SourceProfile, reportDir: string, execute: boolean, items: MigrationItem[]): void {
  for (const archive of profile.archiveFiles) {
    const source = path.join(profile.root, archive.rel);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(reportDir, 'archive', archive.rel);
    if (execute) copyRecursive(source, destination);
    addItem(items, {
      category: 'archive',
      label: archive.label,
      source,
      destination,
      status: 'archived',
      reason: 'No direct Prometheus equivalent yet; preserved for manual review.',
    });
  }
}

function summarize(items: MigrationItem[]): Record<MigrationStatus | 'total', number> {
  const summary: Record<MigrationStatus | 'total', number> = {
    total: items.length,
    migrated: 0,
    skipped: 0,
    conflict: 0,
    archived: 0,
    error: 0,
  };
  for (const item of items) summary[item.status] += 1;
  return summary;
}

export function listMigrationReports(): Array<{ id: string; source: string; sourceKind: string; completedAt: string; outputDir: string; summary: MigrationReport['summary'] }> {
  const root = path.join(getConfig().getConfigDir(), 'migrations');
  if (!existsDir(root)) return [];
  const reports: Array<{ id: string; source: string; sourceKind: string; completedAt: string; outputDir: string; summary: MigrationReport['summary'] }> = [];
  for (const kindDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!kindDir.isDirectory()) continue;
    const dir = path.join(root, kindDir.name);
    for (const runDir of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!runDir.isDirectory()) continue;
      const reportPath = path.join(dir, runDir.name, 'report.json');
      const report = readJsonFile(reportPath) as MigrationReport | null;
      if (!report) continue;
      reports.push({
        id: report.id,
        source: report.source.label,
        sourceKind: report.source.kind,
        completedAt: report.completedAt,
        outputDir: report.outputDir,
        summary: report.summary,
      });
    }
  }
  return reports.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function getMigrationReport(id: string): MigrationReport | null {
  const reportsRoot = path.join(getConfig().getConfigDir(), 'migrations');
  if (!existsDir(reportsRoot)) return null;
  const stack = [reportsRoot];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === 'report.json') {
        const report = readJsonFile(full) as MigrationReport | null;
        if (report?.id === id) return report;
      }
    }
  }
  return null;
}

export function runMigration(options: MigrationOptions = {}): MigrationReport {
  const execute = options.execute === true;
  const source = resolveSource(options);
  if (!source.exists) throw new Error(`Migration source does not exist: ${source.path}`);
  const mode: MigrationMode = options.mode === 'full' ? 'full' : 'user-data';
  const includeSecrets = options.includeSecrets === true || mode === 'full';
  const overwrite = options.overwrite === true;
  const skillConflict: SkillConflictMode = options.skillConflict === 'overwrite' || options.skillConflict === 'rename'
    ? options.skillConflict
    : 'skip';
  const startedAt = nowIso();
  const runStamp = startedAt.replace(/[:.]/g, '-');
  const reportId = crypto.randomUUID();
  const outputDir = path.join(getConfig().getConfigDir(), 'migrations', source.kind, runStamp);
  const profile = profileForSource(source.kind, source.path);
  const sourceLabel = SOURCE_LABELS[source.kind];
  const items: MigrationItem[] = [];
  const notes: string[] = [];

  const config = readSourceConfig(profile);
  const env = parseEnvFile(profile.envFile || '');
  const workspace = getConfig().getWorkspacePath();
  const skillsImportRoot = path.join(getConfig().getConfigDir(), 'skills', `${safeId(source.kind)}-imports`);

  for (const mem of profile.memoryFiles) {
    const candidates = [
      path.join(profile.root, mem.rel),
      ...profile.workspaceDirs.map((dir) => path.join(dir, path.basename(mem.rel))),
    ];
    const sourceFile = candidates.find(existsFile);
    if (!sourceFile) {
      addItem(items, { category: mem.category, label: mem.label, status: 'skipped', reason: 'Source file not found.' });
      continue;
    }
    const dest = path.join(workspace, mem.destinationName);
    const content = readTextFile(sourceFile);
    const wouldConflict = existsFile(dest) && readTextFile(dest).trim() && !overwrite && !readTextFile(dest).includes(content.trim());
    if (wouldConflict && mem.category === 'persona') {
      addItem(items, { category: mem.category, label: mem.label, source: sourceFile, destination: dest, status: 'conflict', reason: 'Existing Prometheus file kept. Enable overwrite to append imported content.' });
      continue;
    }
    const status = appendImportedBlock(dest, mem.label, sourceLabel, content, execute);
    addItem(items, {
      category: mem.category,
      label: mem.label,
      source: sourceFile,
      destination: dest,
      status,
      reason: status === 'skipped' ? 'Already present or empty.' : undefined,
    });
  }

  const skillDirs = collectSkillDirs(profile);
  if (!skillDirs.length) {
    addItem(items, { category: 'skills', label: 'Skills', status: 'skipped', reason: 'No skill directories found.' });
  } else {
    for (const skillDir of skillDirs) {
      const resolved = resolveSkillDestination(skillsImportRoot, skillDir, skillConflict);
      if (resolved.status) {
        addItem(items, { category: 'skills', label: path.basename(skillDir), source: skillDir, destination: resolved.dest, status: resolved.status, reason: resolved.reason });
        continue;
      }
      if (execute) {
        if (existsDir(resolved.dest) && skillConflict === 'overwrite') fs.rmSync(resolved.dest, { recursive: true, force: true });
        copyRecursive(skillDir, resolved.dest);
      }
      addItem(items, {
        category: 'skills',
        label: path.basename(skillDir),
        source: skillDir,
        destination: resolved.dest,
        status: 'migrated',
        details: { relativeSource: pathRelativeDisplay(profile.root, skillDir) },
      });
    }
  }

  mergeConfigUpdates(collectConfigSuggestions(profile, config), execute, overwrite, items, sourceLabel);
  mergeMcpServers(config, execute, items);

  if (includeSecrets) {
    mergeProviderSecrets(env, execute, items, sourceLabel);
    mergeChannelSettings(env, config, execute, items);
  } else if ([...Object.keys(env), ...Object.keys(config || {})].some((k) => SECRET_ENV_TO_PROVIDER[k] || CHANNEL_SECRET_ENV.has(k))) {
    addItem(items, { category: 'secrets', label: 'Secrets', status: 'skipped', reason: 'Secret import is off. Choose full import to bring compatible secrets into the Prometheus vault.' });
  }

  archiveUnsupported(profile, outputDir, execute, items);

  if (execute) {
    ensureDir(outputDir);
    writeJsonAtomic(path.join(outputDir, 'report.json'), {
      id: reportId,
      source,
      mode,
      execute,
      includeSecrets,
      overwrite,
      skillConflict,
      startedAt,
      completedAt: nowIso(),
      outputDir,
      summary: summarize(items),
      items,
      notes,
    } satisfies MigrationReport);
  }

  const report: MigrationReport = {
    id: reportId,
    source,
    mode,
    execute,
    includeSecrets,
    overwrite,
    skillConflict,
    startedAt,
    completedAt: nowIso(),
    outputDir,
    summary: summarize(items),
    items,
    notes,
  };
  if (execute) writeJsonAtomic(path.join(outputDir, 'report.json'), report);
  return report;
}
