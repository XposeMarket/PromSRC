import fs from 'fs';
import os from 'os';
import path from 'path';

export const PROMETHEUS_STORAGE_LAYOUT_VERSION = 2;

export type PrometheusStorageLayoutMode = 'legacy' | 'canonical';

export interface PrometheusRuntimePaths {
  root: string;
  config: string;
  sessions: string;
  agentChats: string;
  toolObservations: string;
  resources: string;
  projects: string;
  tasks: string;
  schedules: string;
  cron: string;
  teams: string;
  connections: string;
  connectors: string;
  plugins: string;
  vault: string;
  memoryIndex: string;
  browser: string;
  brainState: string;
  audit: string;
  diagnostics: string;
  updates: string;
  cache: string;
  migrations: string;
  backups: string;
  boot: string;
}

export interface PrometheusWorkspacePaths {
  root: string;
  memory: string;
  projects: string;
  proposals: string;
  generated: string;
  uploads: string;
  downloads: string;
  skills: string;
  hooks: string;
  brain: string;
  creativeProjects: string;
  creatives: string;
  analysis: string;
  entities: string;
  events: string;
  integrations: string;
  internal: string;
  standaloneSubagents: string;
  teams: string;
}

export interface PrometheusLegacyPaths {
  projectConfig: string;
  homeConfig: string;
  dataRootConfig: string | null;
  activeConfig: string;
  activeWorkspace: string;
  localclawProject: string;
  localclawHome: string;
}

export interface PrometheusLayout {
  version: typeof PROMETHEUS_STORAGE_LAYOUT_VERSION;
  mode: PrometheusStorageLayoutMode;
  appDataRoot: string;
  runtime: PrometheusRuntimePaths;
  workspace: PrometheusWorkspacePaths;
  legacy: PrometheusLegacyPaths;
  activeConfigRoot: string;
  activeWorkspaceRoot: string;
}

export interface ResolvePrometheusLayoutOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
  cwd?: string;
  existsSync?: (candidate: string) => boolean;
}

function resolveDefaultAppDataRoot(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homedir: string,
): string {
  if (env.PROMETHEUS_APP_DATA_DIR?.trim()) return path.resolve(env.PROMETHEUS_APP_DATA_DIR.trim());

  // PROMETHEUS_DATA_DIR is the legacy name for the Prometheus app-data parent.
  // Keep honoring it until every caller has migrated to explicit runtime/workspace
  // overrides. Canonical storage never appends `.prometheus` to this value.
  if (env.PROMETHEUS_DATA_DIR?.trim()) return path.resolve(env.PROMETHEUS_DATA_DIR.trim());

  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.join(homedir, 'AppData', 'Roaming');
    return path.join(path.resolve(appData), 'Prometheus');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'Prometheus');
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg ? path.resolve(xdg) : path.join(homedir, '.config'), 'Prometheus');
}

function buildRuntimePaths(root: string): PrometheusRuntimePaths {
  return {
    root,
    config: path.join(root, 'config'),
    sessions: path.join(root, 'sessions'),
    agentChats: path.join(root, 'agent-chats'),
    toolObservations: path.join(root, 'tool-observations'),
    resources: path.join(root, 'resources'),
    projects: path.join(root, 'projects'),
    tasks: path.join(root, 'tasks'),
    schedules: path.join(root, 'schedules'),
    cron: path.join(root, 'cron'),
    teams: path.join(root, 'teams'),
    connections: path.join(root, 'connections'),
    connectors: path.join(root, 'connectors'),
    plugins: path.join(root, 'plugins'),
    vault: path.join(root, 'vault'),
    memoryIndex: path.join(root, 'memory-index'),
    browser: path.join(root, 'browser'),
    brainState: path.join(root, 'brain-state'),
    audit: path.join(root, 'audit'),
    diagnostics: path.join(root, 'diagnostics'),
    updates: path.join(root, 'updates'),
    cache: path.join(root, 'cache'),
    migrations: path.join(root, 'migrations'),
    backups: path.join(root, 'backups'),
    boot: path.join(root, 'boot'),
  };
}

function buildWorkspacePaths(root: string): PrometheusWorkspacePaths {
  const internal = path.join(root, '.prometheus');
  return {
    root,
    memory: path.join(root, 'memory'),
    projects: path.join(root, 'projects'),
    proposals: path.join(root, 'proposals'),
    generated: path.join(root, 'generated'),
    uploads: path.join(root, 'uploads'),
    downloads: path.join(root, 'downloads'),
    skills: path.join(root, 'skills'),
    hooks: path.join(root, 'hooks'),
    brain: path.join(root, 'Brain'),
    creativeProjects: path.join(root, 'creative-projects'),
    creatives: path.join(root, 'creatives'),
    analysis: path.join(root, 'analysis'),
    entities: path.join(root, 'entities'),
    events: path.join(root, 'events'),
    integrations: path.join(root, 'integrations'),
    internal,
    standaloneSubagents: path.join(internal, 'subagents'),
    teams: path.join(root, 'teams'),
  };
}

function normalizeMode(env: NodeJS.ProcessEnv): PrometheusStorageLayoutMode {
  const requested = String(env.PROMETHEUS_STORAGE_LAYOUT || '').trim().toLowerCase();
  if (requested === 'canonical' || requested === 'v2' || requested === '2') return 'canonical';
  return 'legacy';
}

/**
 * Resolve Prometheus persistence locations without mutating disk.
 *
 * Layout v2 intentionally separates application source from durable local data:
 *   appDataRoot/runtime   -> Prometheus-owned machine/runtime state
 *   appDataRoot/workspace -> user/agent-owned durable work
 *
 * The resolver remains in `legacy` mode by default during the staged migration.
 * Callers can opt into the canonical layout with PROMETHEUS_STORAGE_LAYOUT=canonical
 * or explicit PROMETHEUS_RUNTIME_DIR / PROMETHEUS_WORKSPACE_DIR overrides.
 */
export function resolvePrometheusLayout(options: ResolvePrometheusLayoutOptions = {}): PrometheusLayout {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const homedir = path.resolve(options.homedir || os.homedir());
  const cwd = path.resolve(options.cwd || process.cwd());
  const exists = options.existsSync || fs.existsSync;

  const appDataRoot = resolveDefaultAppDataRoot(env, platform, homedir);
  const runtimeRoot = path.resolve(env.PROMETHEUS_RUNTIME_DIR?.trim() || path.join(appDataRoot, 'runtime'));
  const canonicalWorkspaceRoot = path.resolve(
    env.PROMETHEUS_WORKSPACE_DIR?.trim() || path.join(appDataRoot, 'workspace'),
  );

  const projectConfig = path.join(cwd, '.prometheus');
  const homeConfig = path.join(homedir, '.prometheus');
  const dataRootConfig = env.PROMETHEUS_DATA_DIR?.trim()
    ? path.join(path.resolve(env.PROMETHEUS_DATA_DIR.trim()), '.prometheus')
    : null;
  const activeLegacyConfig = dataRootConfig || (exists(projectConfig) ? projectConfig : homeConfig);
  const activeLegacyWorkspace = path.resolve(
    env.PROMETHEUS_WORKSPACE_DIR?.trim() || path.join(activeLegacyConfig, '..', 'workspace'),
  );

  // Explicit runtime selection is itself an opt-in to layout v2. An explicit
  // workspace alone is not: existing Electron builds already set that variable.
  const mode = env.PROMETHEUS_RUNTIME_DIR?.trim() ? 'canonical' : normalizeMode(env);
  const runtime = buildRuntimePaths(runtimeRoot);
  const workspace = buildWorkspacePaths(canonicalWorkspaceRoot);

  return {
    version: PROMETHEUS_STORAGE_LAYOUT_VERSION,
    mode,
    appDataRoot,
    runtime,
    workspace,
    legacy: {
      projectConfig,
      homeConfig,
      dataRootConfig,
      activeConfig: activeLegacyConfig,
      activeWorkspace: activeLegacyWorkspace,
      localclawProject: path.join(cwd, '.localclaw'),
      localclawHome: path.join(homedir, '.localclaw'),
    },
    activeConfigRoot: mode === 'canonical' ? runtime.config : activeLegacyConfig,
    activeWorkspaceRoot: mode === 'canonical' ? workspace.root : activeLegacyWorkspace,
  };
}

export function getPrometheusLayout(): PrometheusLayout {
  return resolvePrometheusLayout();
}

export function standaloneSubagentWorkspace(layout: PrometheusLayout, agentId: string): string {
  const safeId = String(agentId || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || 'agent';
  return path.join(layout.workspace.standaloneSubagents, safeId);
}

export function teamRoot(layout: PrometheusLayout, teamId: string): string {
  const safeId = String(teamId || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || 'team';
  return path.join(layout.workspace.teams, safeId);
}

export function teamSharedWorkspace(layout: PrometheusLayout, teamId: string): string {
  return path.join(teamRoot(layout, teamId), 'workspace');
}

export function teamSubagentWorkspace(layout: PrometheusLayout, teamId: string, agentId: string): string {
  const safeAgent = String(agentId || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || 'agent';
  return path.join(teamRoot(layout, teamId), 'subagents', safeAgent);
}
