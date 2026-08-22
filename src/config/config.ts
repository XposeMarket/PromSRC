import fs from 'fs';
import path from 'path';
import type { AgentDefinition, PrometheusConfig } from '../types.js';
import { getVault } from '../security/vault.js';
import { getConfigErrors } from './config-schema.js';
import { ensurePublicWorkspaceScaffold } from './public-workspace.js';
import { isPublicDistributionBuild } from '../runtime/distribution.js';
import { listProviderSecretFieldPaths } from '../providers/provider-registry.js';
import { ensureAgentPromptFile } from '../agents/agent-prompt-file.js';
import { seedLegacyMainChatRoute } from './main-chat-route.js';
import { getPrometheusLayout, standaloneSubagentWorkspace } from '../runtime/storage-layout.js';

const STORAGE_LAYOUT = getPrometheusLayout();

/**
 * Keep the pre-v2 ConfigManager available as an exact compatibility backend.
 * In canonical mode we load it only to reuse its mature default-config surface.
 * A temporary inert DATA_DIR prevents the classic module's old `.localclaw`
 * import shim from touching the source checkout while its constants initialize.
 */
function loadClassicConfigModule(): typeof import('./config-classic') {
  if (STORAGE_LAYOUT.mode === 'legacy') {
    return require('./config-classic.js') as typeof import('./config-classic');
  }

  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  const inertDataRoot = path.join(STORAGE_LAYOUT.runtime.migrations, '.classic-defaults');
  process.env.PROMETHEUS_DATA_DIR = inertDataRoot;
  try {
    return require('./config-classic.js') as typeof import('./config-classic');
  } finally {
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
  }
}

const classic = loadClassicConfigModule();

const CANONICAL_CONFIG_ROOT = STORAGE_LAYOUT.runtime.root;
const CANONICAL_CONFIG_FILE = path.join(STORAGE_LAYOUT.runtime.config, 'config.json');

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Arrays replace rather than concatenate; object branches merge recursively. */
function deepMerge<T>(base: T, overlay: any): T {
  if (!isObject(base) || !isObject(overlay)) return clone((overlay === undefined ? base : overlay) as T);
  const result: Record<string, any> = clone(base as any);
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    if (isObject(value) && isObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = clone(value);
  }
  return result as T;
}

function normalizePathList(values: unknown, required: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || !value.trim()) return;
    const resolved = path.resolve(value.trim());
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolved);
  };
  if (Array.isArray(values)) values.forEach(add);
  required.forEach(add);
  return out;
}

function canonicalizeConfigPaths(config: PrometheusConfig): PrometheusConfig {
  const next: any = clone(config);
  const workspaceRoot = path.resolve(process.env.PROMETHEUS_WORKSPACE_DIR || STORAGE_LAYOUT.workspace.root);

  next.workspace = { ...(next.workspace || {}), path: workspaceRoot };
  next.skills = { ...(next.skills || {}), directory: path.join(workspaceRoot, 'skills') };
  next.memory = { ...(next.memory || {}), path: STORAGE_LAYOUT.runtime.memoryIndex };

  next.tools = next.tools || {};
  next.tools.permissions = next.tools.permissions || {};
  next.tools.permissions.files = next.tools.permissions.files || {};
  next.tools.permissions.files.allowed_paths = normalizePathList(
    next.tools.permissions.files.allowed_paths,
    [workspaceRoot],
  );
  next.tools.permissions.files.blocked_paths = normalizePathList(next.tools.permissions.files.blocked_paths);

  if (Array.isArray(next.agents)) {
    next.agents = next.agents.map((agent: any) => ({
      ...agent,
      ...(agent?.workspace ? { workspace: path.resolve(agent.workspace) } : {}),
      ...(agent?.executionWorkspace ? { executionWorkspace: path.resolve(agent.executionWorkspace) } : {}),
      ...(Array.isArray(agent?.allowedWorkPaths)
        ? { allowedWorkPaths: normalizePathList(agent.allowedWorkPaths) }
        : {}),
    }));
  }

  return next as PrometheusConfig;
}

function canonicalDefaults(): PrometheusConfig {
  const defaults = canonicalizeConfigPaths(clone(classic.DEFAULT_CONFIG));
  return defaults;
}

export const DEFAULT_CONFIG: PrometheusConfig = STORAGE_LAYOUT.mode === 'canonical'
  ? canonicalDefaults()
  : classic.DEFAULT_CONFIG;

const SECRET_FIELD_MAP: Array<[string[], string]> = [
  [['gateway', 'auth', 'token'], 'gateway.auth_token'],
  [['channels', 'telegram', 'botToken'], 'channels.telegram.botToken'],
  [['channels', 'discord', 'botToken'], 'channels.discord.botToken'],
  [['channels', 'whatsapp', 'accessToken'], 'channels.whatsapp.accessToken'],
  [['channels', 'whatsapp', 'webhookSecret'], 'channels.whatsapp.webhookSecret'],
  [['search', 'tinyfish_api_key'], 'search.tinyfish_api_key'],
  [['search', 'tavily_api_key'], 'search.tavily_api_key'],
  [['search', 'google_api_key'], 'search.google_api_key'],
  [['search', 'google_cx'], 'search.google_cx'],
  [['search', 'brave_api_key'], 'search.brave_api_key'],
  ...listProviderSecretFieldPaths().map(([providerId, field]) => (
    [['llm', 'providers', providerId, field], `llm.${providerId}.${field}`] as [string[], string]
  )),
  [['hooks', 'token'], 'hooks.token'],
  [['hooks', 'providers', 'github', 'secret'], 'hooks.providers.github.secret'],
  [['hooks', 'providers', 'stripe', 'secret'], 'hooks.providers.stripe.secret'],
  [['hooks', 'providers', 'slack', 'secret'], 'hooks.providers.slack.secret'],
];

function deepGet(obj: any, keys: string[]): string | undefined {
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function deepSet(obj: any, keys: string[], value: string): void {
  let current = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!isObject(current[keys[i]])) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

function migrateSecretsToCanonicalVault(config: PrometheusConfig): PrometheusConfig {
  const copy = clone(config) as any;
  const vault = getVault(CANONICAL_CONFIG_ROOT);
  for (const [fieldPath, vaultKey] of SECRET_FIELD_MAP) {
    const value = deepGet(copy, fieldPath);
    if (!value || value.startsWith('vault:') || value.startsWith('env:') || value === '••••••••') continue;
    vault.set(vaultKey, value, 'config:migrate');
    deepSet(copy, fieldPath, `vault:${vaultKey}`);
  }
  return copy as PrometheusConfig;
}

class CanonicalConfigManager {
  private config: PrometheusConfig;

  constructor() {
    this.config = this.loadConfig();
    const legacyMainChatPatch = seedLegacyMainChatRoute(this.config);
    if (legacyMainChatPatch) {
      this.config = canonicalizeConfigPaths({ ...this.config, ...legacyMainChatPatch } as PrometheusConfig);
      this.saveConfig();
    }
  }

  private loadConfig(): PrometheusConfig {
    try {
      if (fs.existsSync(CANONICAL_CONFIG_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(CANONICAL_CONFIG_FILE, 'utf-8'));
        const merged = canonicalizeConfigPaths(deepMerge(canonicalDefaults(), parsed));
        const errors = getConfigErrors(merged);
        if (errors.length) {
          console.warn('[Config:v2] Validation warnings (non-fatal):');
          errors.forEach((error) => console.warn('  ⚠️', error));
        }
        return merged;
      }
    } catch (error) {
      console.warn('[Config:v2] Failed to load canonical config, using defaults:', error);
    }
    return canonicalDefaults();
  }

  public getConfig(): PrometheusConfig {
    return this.config;
  }

  public updateConfig(updates: Partial<PrometheusConfig>): void {
    this.config = canonicalizeConfigPaths(deepMerge(this.config, updates));
    this.saveConfig();
  }

  public reloadConfig(): void {
    this.config = this.loadConfig();
  }

  public saveConfig(): void {
    fs.mkdirSync(STORAGE_LAYOUT.runtime.config, { recursive: true });
    const sanitized = migrateSecretsToCanonicalVault(this.config);
    const tmp = `${CANONICAL_CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sanitized, null, 2), 'utf-8');
    fs.renameSync(tmp, CANONICAL_CONFIG_FILE);
  }

  public resolveSecret(value: string | undefined): string | undefined {
    if (!value) return value;
    if (value.startsWith('env:')) return process.env[value.slice(4)] || undefined;
    if (value.startsWith('vault:')) {
      const secret = getVault(CANONICAL_CONFIG_ROOT).get(value.slice(6), 'config:resolve');
      return secret ? secret.expose() : undefined;
    }
    return value;
  }

  public ensureDirectories(): void {
    const dirs = [
      STORAGE_LAYOUT.runtime.root,
      STORAGE_LAYOUT.runtime.config,
      STORAGE_LAYOUT.runtime.sessions,
      STORAGE_LAYOUT.runtime.diagnostics,
      path.join(STORAGE_LAYOUT.runtime.diagnostics, 'logs'),
      path.join(STORAGE_LAYOUT.runtime.cache, 'images'),
      STORAGE_LAYOUT.runtime.memoryIndex,
      this.config.workspace.path,
      this.config.skills.directory,
    ];
    for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
    if (isPublicDistributionBuild()) ensurePublicWorkspaceScaffold(this.config.workspace.path);
  }

  public getConfigDir(): string {
    // Existing stores append their own names (`sessions`, `resources`, `vault`,
    // `tasks`, ...). Returning the runtime root therefore moves those stores to
    // the clean v2 tree without each subsystem inventing its own app-data root.
    return STORAGE_LAYOUT.runtime.root;
  }

  public getWorkspacePath(): string {
    return this.config.workspace.path;
  }

  public getDatabasePath(): string {
    return path.join(STORAGE_LAYOUT.runtime.root, 'jobs.db');
  }
}

export class ConfigManager {
  private readonly impl: CanonicalConfigManager | InstanceType<typeof classic.ConfigManager>;

  constructor() {
    this.impl = STORAGE_LAYOUT.mode === 'canonical'
      ? new CanonicalConfigManager()
      : new classic.ConfigManager();
  }

  public getConfig(): PrometheusConfig { return this.impl.getConfig(); }
  public updateConfig(updates: Partial<PrometheusConfig>): void { this.impl.updateConfig(updates); }
  public reloadConfig(): void { this.impl.reloadConfig(); }
  public saveConfig(): void { this.impl.saveConfig(); }
  public resolveSecret(value: string | undefined): string | undefined { return this.impl.resolveSecret(value); }
  public ensureDirectories(): void { this.impl.ensureDirectories(); }
  public getConfigDir(): string { return this.impl.getConfigDir(); }
  public getWorkspacePath(): string { return this.impl.getWorkspacePath(); }
  public getDatabasePath(): string { return this.impl.getDatabasePath(); }
}

let configInstance: ConfigManager | null = null;

export function getConfig(): ConfigManager {
  if (!configInstance) configInstance = new ConfigManager();
  return configInstance;
}

export function getResolvedConfigDir(): string {
  return STORAGE_LAYOUT.mode === 'canonical'
    ? STORAGE_LAYOUT.runtime.root
    : classic.getResolvedConfigDir();
}

export function resolveAgentWorkspace(agent: AgentDefinition): string {
  if (agent.workspace) return path.resolve(agent.workspace);
  if (STORAGE_LAYOUT.mode === 'canonical') {
    return standaloneSubagentWorkspace(STORAGE_LAYOUT, agent.id);
  }
  return classic.resolveAgentWorkspace(agent);
}

export function getAgents(): AgentDefinition[] {
  const cfg = getConfig().getConfig();
  const defined = Array.isArray(cfg.agents) ? cfg.agents : [];
  const syntheticMain: AgentDefinition = {
    id: 'main',
    name: 'Main',
    description: 'Default assistant',
    default: true,
    workspace: cfg.workspace.path,
  };
  if (defined.length === 0) return [syntheticMain];
  if (defined.some((agent) => agent.id === 'main')) return defined;
  return [syntheticMain, ...defined];
}

export function getDefaultAgent(): AgentDefinition {
  const agents = getAgents();
  return agents.find((agent) => agent.default) ?? agents[0];
}

export function getAgentById(id: string): AgentDefinition | null {
  return getAgents().find((agent) => agent.id === id) ?? null;
}

export function ensureAgentWorkspace(agent: AgentDefinition): string {
  if (STORAGE_LAYOUT.mode === 'legacy') return classic.ensureAgentWorkspace(agent);

  const workspace = resolveAgentWorkspace(agent);
  fs.mkdirSync(workspace, { recursive: true });

  ensureAgentPromptFile(workspace, [
    `# ${agent.name}`,
    '',
    '## Role',
    agent.description ?? 'No description set. Update this file to define your role.',
    '',
    '## Instructions',
    '- Describe what this agent should do here.',
    '- Keep durable role-specific context in this workspace.',
    '- Treat external execution workspaces as separate from this identity workspace.',
    '',
    '## Output Format',
    'Return a concise summary of what was accomplished.',
  ].join('\n'));

  const memory = path.join(workspace, 'MEMORY.md');
  if (!fs.existsSync(memory)) {
    fs.writeFileSync(memory, [
      `# MEMORY.md - ${agent.name}`,
      '',
      'Durable personal memory for this agent.',
      '',
      'Store role-specific lessons, decisions, corrections, preferences, and open threads that should survive future runs.',
      'Do not copy main-user memory or unrelated team truth into this private file.',
      '',
    ].join('\n'), 'utf-8');
  }

  const heartbeat = path.join(workspace, 'HEARTBEAT.md');
  if (!fs.existsSync(heartbeat)) {
    fs.writeFileSync(heartbeat, [
      `# HEARTBEAT.md - ${agent.name}`,
      '',
      '## What to do when woken by the scheduler',
      '- Edit this file to define autonomous tasks for this agent.',
      '- Persist durable outputs to the appropriate workspace.',
      '- If no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else.',
      '',
    ].join('\n'), 'utf-8');
  }

  return workspace;
}
