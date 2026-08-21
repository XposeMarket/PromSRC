import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PrometheusLayout } from './storage-layout.js';
import { resolvePrometheusLayout, standaloneSubagentWorkspace } from './storage-layout.js';

export const STORAGE_MIGRATION_ID = 'storage-layout-v2';

export interface StorageMigrationCandidate {
  kind: 'config' | 'workspace' | 'legacy-localclaw';
  path: string;
  active: boolean;
  exists: boolean;
}

export interface StorageMigrationConflict {
  source: string;
  target: string;
  sourceHash?: string;
  targetHash?: string;
  reason: 'different_file' | 'type_mismatch';
}

export interface StorageMigrationManifest {
  version: 1;
  migrationId: string;
  layoutVersion: number;
  startedAt: string;
  completedAt: string;
  sourceConfigRoot: string;
  sourceWorkspaceRoot: string;
  targetRuntimeRoot: string;
  targetWorkspaceRoot: string;
  backupRoot: string;
  copied: Array<{ source: string; target: string; hash: string; bytes: number }>;
  identical: Array<{ source: string; target: string; hash: string; bytes: number }>;
  conflicts: StorageMigrationConflict[];
  skippedSymlinks: string[];
  errors: Array<{ source?: string; target?: string; message: string }>;
  rewrittenConfig: boolean;
  readyToActivate: boolean;
}

export interface ExecuteStorageMigrationOptions {
  layout?: PrometheusLayout;
  sourceConfigRoot?: string;
  sourceWorkspaceRoot?: string;
  migrationId?: string;
  now?: Date;
}

type MigrationAccumulator = Pick<
  StorageMigrationManifest,
  'copied' | 'identical' | 'conflicts' | 'skippedSymlinks' | 'errors'
>;

function normalizeForCompare(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

function pathInside(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const rel = path.relative(base, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function fileHash(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function copyFileVerified(source: string, target: string, acc: MigrationAccumulator): void {
  try {
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) {
      acc.skippedSymlinks.push(source);
      return;
    }
    if (!sourceStat.isFile()) return;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const sourceDigest = fileHash(source);

    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
        acc.conflicts.push({ source, target, sourceHash: sourceDigest, reason: 'type_mismatch' });
        return;
      }
      const targetDigest = fileHash(target);
      if (sourceDigest === targetDigest) {
        acc.identical.push({ source, target, hash: sourceDigest, bytes: sourceStat.size });
      } else {
        acc.conflicts.push({
          source,
          target,
          sourceHash: sourceDigest,
          targetHash: targetDigest,
          reason: 'different_file',
        });
      }
      return;
    }

    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    const targetDigest = fileHash(target);
    if (targetDigest !== sourceDigest) {
      try { fs.rmSync(target, { force: true }); } catch {}
      throw new Error(`verification hash mismatch (${sourceDigest} != ${targetDigest})`);
    }
    acc.copied.push({ source, target, hash: sourceDigest, bytes: sourceStat.size });
  } catch (error: any) {
    acc.errors.push({ source, target, message: String(error?.message || error) });
  }
}

function copyTreeVerified(sourceRoot: string, targetRoot: string, acc: MigrationAccumulator): void {
  if (!fs.existsSync(sourceRoot)) return;
  const sourceStat = fs.lstatSync(sourceRoot);
  if (sourceStat.isSymbolicLink()) {
    acc.skippedSymlinks.push(sourceRoot);
    return;
  }
  if (sourceStat.isFile()) {
    copyFileVerified(sourceRoot, targetRoot, acc);
    return;
  }
  if (!sourceStat.isDirectory()) return;

  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isSymbolicLink()) {
      acc.skippedSymlinks.push(source);
      continue;
    }
    if (entry.isDirectory()) copyTreeVerified(source, target, acc);
    else if (entry.isFile()) copyFileVerified(source, target, acc);
  }
}

function safeMigrationSegment(input: string): string {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'migration';
}

export function discoverStorageMigrationCandidates(layout = resolvePrometheusLayout()): StorageMigrationCandidate[] {
  const rows: StorageMigrationCandidate[] = [];
  const add = (kind: StorageMigrationCandidate['kind'], candidate: string | null, active: boolean): void => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (rows.some((row) => samePath(row.path, resolved))) return;
    rows.push({ kind, path: resolved, active, exists: fs.existsSync(resolved) });
  };

  add('config', layout.legacy.activeConfig, true);
  add('config', layout.legacy.projectConfig, samePath(layout.legacy.projectConfig, layout.legacy.activeConfig));
  add('config', layout.legacy.homeConfig, samePath(layout.legacy.homeConfig, layout.legacy.activeConfig));
  add('config', layout.legacy.dataRootConfig, !!layout.legacy.dataRootConfig && samePath(layout.legacy.dataRootConfig, layout.legacy.activeConfig));
  add('workspace', layout.legacy.activeWorkspace, true);
  add('legacy-localclaw', layout.legacy.localclawProject, false);
  add('legacy-localclaw', layout.legacy.localclawHome, false);
  return rows;
}

function runtimeDirectoryTarget(layout: PrometheusLayout, entryName: string): string | null {
  const table: Record<string, string> = {
    sessions: layout.runtime.sessions,
    'agent-chats': layout.runtime.agentChats,
    'tool-observations': layout.runtime.toolObservations,
    resources: layout.runtime.resources,
    projects: layout.runtime.projects,
    tasks: layout.runtime.tasks,
    schedules: layout.runtime.schedules,
    cron: layout.runtime.cron,
    connectors: layout.runtime.connectors,
    vault: layout.runtime.vault,
    'memory-index': layout.runtime.memoryIndex,
    memory: layout.runtime.memoryIndex,
    browser: layout.runtime.browser,
    'browser-knowledge': path.join(layout.runtime.browser, 'knowledge'),
    'brain-state': layout.runtime.brainState,
    audit: layout.runtime.audit,
    diagnostics: layout.runtime.diagnostics,
    logs: path.join(layout.runtime.diagnostics, 'logs'),
    cache: layout.runtime.cache,
    'user-plugins': layout.runtime.plugins,
  };
  return table[entryName] || null;
}

function runtimeFileTarget(layout: PrometheusLayout, entryName: string): string {
  if (entryName === 'config.json') return path.join(layout.runtime.config, 'config.json');
  if (entryName === 'managed-teams.json') return path.join(layout.runtime.teams, entryName);
  if (/^(?:connections?|connection-|attempt|activity|secure-input)/i.test(entryName)) {
    return path.join(layout.runtime.connections, entryName);
  }
  if (/^(?:cron|jobs?)(?:[-_.]|$)/i.test(entryName)) return path.join(layout.runtime.cron, entryName);
  if (/^schedule/i.test(entryName)) return path.join(layout.runtime.schedules, entryName);
  if (/^(?:restart|startup|boot)/i.test(entryName)) return path.join(layout.runtime.boot, entryName);
  return path.join(layout.runtime.config, 'legacy-root', entryName);
}

function migrateLegacyAgentWorkspaces(
  sourceConfigRoot: string,
  layout: PrometheusLayout,
  acc: MigrationAccumulator,
): void {
  const agentsRoot = path.join(sourceConfigRoot, 'agents');
  if (!fs.existsSync(agentsRoot)) return;
  for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceAgentDir = path.join(agentsRoot, entry.name);
    const sourceWorkspace = path.join(sourceAgentDir, 'workspace');
    if (!fs.existsSync(sourceWorkspace)) continue;
    copyTreeVerified(sourceWorkspace, standaloneSubagentWorkspace(layout, entry.name), acc);
  }
}

function migrateConfigRoot(sourceConfigRoot: string, layout: PrometheusLayout, acc: MigrationAccumulator): void {
  if (!fs.existsSync(sourceConfigRoot) || samePath(sourceConfigRoot, layout.runtime.root) || samePath(sourceConfigRoot, layout.runtime.config)) return;
  for (const entry of fs.readdirSync(sourceConfigRoot, { withFileTypes: true })) {
    const source = path.join(sourceConfigRoot, entry.name);
    if (entry.isSymbolicLink()) {
      acc.skippedSymlinks.push(source);
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === 'skills') {
        copyTreeVerified(source, layout.workspace.skills, acc);
        continue;
      }
      if (entry.name === 'agents') {
        migrateLegacyAgentWorkspaces(sourceConfigRoot, layout, acc);
        // Preserve any non-workspace agent metadata for forensic rollback.
        copyTreeVerified(source, path.join(layout.runtime.config, 'legacy-root', 'agents'), acc);
        continue;
      }
      if (entry.name === '.clawhub') {
        copyTreeVerified(source, path.join(layout.runtime.config, '.clawhub'), acc);
        continue;
      }
      const mapped = runtimeDirectoryTarget(layout, entry.name);
      copyTreeVerified(source, mapped || path.join(layout.runtime.config, 'legacy-root', entry.name), acc);
      continue;
    }
    if (entry.isFile()) copyFileVerified(source, runtimeFileTarget(layout, entry.name), acc);
  }
}

function mapLegacyStoragePath(
  raw: unknown,
  sourceConfigRoot: string,
  sourceWorkspaceRoot: string,
  layout: PrometheusLayout,
): unknown {
  if (typeof raw !== 'string' || !raw.trim()) return raw;
  const value = raw.trim();
  if (!path.isAbsolute(value)) return raw;
  const resolved = path.resolve(value);

  if (pathInside(sourceWorkspaceRoot, resolved)) {
    return path.join(layout.workspace.root, path.relative(sourceWorkspaceRoot, resolved));
  }

  const legacyAgentMatch = path.relative(path.join(sourceConfigRoot, 'agents'), resolved).split(path.sep);
  if (legacyAgentMatch.length >= 3 && legacyAgentMatch[1] === 'workspace' && !legacyAgentMatch[0].startsWith('..')) {
    return path.join(standaloneSubagentWorkspace(layout, legacyAgentMatch[0]), ...legacyAgentMatch.slice(2));
  }

  const legacySkills = path.join(sourceConfigRoot, 'skills');
  if (pathInside(legacySkills, resolved)) return path.join(layout.workspace.skills, path.relative(legacySkills, resolved));
  const legacyMemory = path.join(sourceConfigRoot, 'memory');
  if (pathInside(legacyMemory, resolved)) return path.join(layout.runtime.memoryIndex, path.relative(legacyMemory, resolved));
  if (pathInside(sourceConfigRoot, resolved)) return path.join(layout.runtime.config, 'legacy-root', path.relative(sourceConfigRoot, resolved));
  return raw;
}

function rewriteStringArray(
  values: unknown,
  sourceConfigRoot: string,
  sourceWorkspaceRoot: string,
  layout: PrometheusLayout,
): unknown {
  if (!Array.isArray(values)) return values;
  return values.map((value) => mapLegacyStoragePath(value, sourceConfigRoot, sourceWorkspaceRoot, layout));
}

/**
 * Rewrite only known persisted path fields. Arbitrary strings are intentionally
 * untouched so migration cannot corrupt prompts, URLs, notes, or user content.
 */
export function rewriteMigratedConfigPaths(
  config: any,
  sourceConfigRoot: string,
  sourceWorkspaceRoot: string,
  layout: PrometheusLayout,
): any {
  const next = structuredClone(config || {});
  next.workspace = { ...(next.workspace || {}), path: layout.workspace.root };
  next.skills = { ...(next.skills || {}), directory: layout.workspace.skills };
  next.memory = { ...(next.memory || {}), path: layout.runtime.memoryIndex };

  const files = next?.tools?.permissions?.files;
  if (files && typeof files === 'object') {
    files.allowed_paths = rewriteStringArray(files.allowed_paths, sourceConfigRoot, sourceWorkspaceRoot, layout);
    files.blocked_paths = rewriteStringArray(files.blocked_paths, sourceConfigRoot, sourceWorkspaceRoot, layout);
    if (Array.isArray(files.allowed_paths) && !files.allowed_paths.some((item: unknown) => typeof item === 'string' && samePath(item, layout.workspace.root))) {
      files.allowed_paths.unshift(layout.workspace.root);
    }
  }

  if (Array.isArray(next.agents)) {
    next.agents = next.agents.map((agent: any) => ({
      ...agent,
      ...(agent?.workspace ? { workspace: mapLegacyStoragePath(agent.workspace, sourceConfigRoot, sourceWorkspaceRoot, layout) } : {}),
      ...(agent?.executionWorkspace ? { executionWorkspace: mapLegacyStoragePath(agent.executionWorkspace, sourceConfigRoot, sourceWorkspaceRoot, layout) } : {}),
      ...(Array.isArray(agent?.allowedWorkPaths) ? {
        allowedWorkPaths: rewriteStringArray(agent.allowedWorkPaths, sourceConfigRoot, sourceWorkspaceRoot, layout),
      } : {}),
    }));
  }
  return next;
}

function rewriteCopiedConfig(
  sourceConfigRoot: string,
  sourceWorkspaceRoot: string,
  layout: PrometheusLayout,
  acc: MigrationAccumulator,
): boolean {
  const sourceConfig = path.join(sourceConfigRoot, 'config.json');
  const targetConfig = path.join(layout.runtime.config, 'config.json');
  if (!fs.existsSync(sourceConfig) || !fs.existsSync(targetConfig)) return false;
  if (acc.conflicts.some((conflict) => samePath(conflict.target, targetConfig))) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(sourceConfig, 'utf-8'));
    const rewritten = rewriteMigratedConfigPaths(raw, sourceConfigRoot, sourceWorkspaceRoot, layout);
    const temp = `${targetConfig}.${process.pid}.${Date.now()}.migration.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf-8');
    fs.renameSync(temp, targetConfig);
    return true;
  } catch (error: any) {
    acc.errors.push({ source: sourceConfig, target: targetConfig, message: `config rewrite failed: ${String(error?.message || error)}` });
    return false;
  }
}

function writeManifest(filePath: string, manifest: StorageMigrationManifest): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  fs.renameSync(temp, filePath);
}

/**
 * Copy and verify legacy Prometheus state into layout v2.
 *
 * This function NEVER removes or renames source data and NEVER overwrites a
 * different destination file. Conflicts make the result non-activatable and are
 * written to the migration manifest for explicit resolution.
 */
export function executeStorageLayoutV2Migration(options: ExecuteStorageMigrationOptions = {}): StorageMigrationManifest {
  const layout = options.layout || resolvePrometheusLayout();
  const sourceConfigRoot = path.resolve(options.sourceConfigRoot || layout.legacy.activeConfig);
  const sourceWorkspaceRoot = path.resolve(options.sourceWorkspaceRoot || layout.legacy.activeWorkspace);
  const now = options.now || new Date();
  const migrationId = safeMigrationSegment(options.migrationId || `${STORAGE_MIGRATION_ID}-${now.toISOString().replace(/[:.]/g, '-')}`);
  const backupRoot = path.join(layout.runtime.backups, STORAGE_MIGRATION_ID, migrationId);
  const migrationRoot = path.join(layout.runtime.migrations, migrationId);
  const startedAt = new Date().toISOString();

  const acc: MigrationAccumulator = {
    copied: [],
    identical: [],
    conflicts: [],
    skippedSymlinks: [],
    errors: [],
  };

  fs.mkdirSync(backupRoot, { recursive: true });
  fs.mkdirSync(migrationRoot, { recursive: true });

  // Immutable safety copies first. Backup locations are unique per migration ID.
  if (fs.existsSync(sourceConfigRoot) && !samePath(sourceConfigRoot, layout.runtime.root)) {
    copyTreeVerified(sourceConfigRoot, path.join(backupRoot, 'source-config'), acc);
  }
  if (fs.existsSync(sourceWorkspaceRoot) && !samePath(sourceWorkspaceRoot, layout.workspace.root)) {
    copyTreeVerified(sourceWorkspaceRoot, path.join(backupRoot, 'source-workspace'), acc);
  }

  // Canonical copies. Existing identical files are accepted; different files are
  // conflicts and are never overwritten.
  migrateConfigRoot(sourceConfigRoot, layout, acc);
  if (fs.existsSync(sourceWorkspaceRoot) && !samePath(sourceWorkspaceRoot, layout.workspace.root)) {
    copyTreeVerified(sourceWorkspaceRoot, layout.workspace.root, acc);
  }

  const rewrittenConfig = rewriteCopiedConfig(sourceConfigRoot, sourceWorkspaceRoot, layout, acc);
  const readyToActivate = acc.conflicts.length === 0 && acc.errors.length === 0 && acc.skippedSymlinks.length === 0;
  const manifest: StorageMigrationManifest = {
    version: 1,
    migrationId,
    layoutVersion: layout.version,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceConfigRoot,
    sourceWorkspaceRoot,
    targetRuntimeRoot: layout.runtime.root,
    targetWorkspaceRoot: layout.workspace.root,
    backupRoot,
    copied: acc.copied,
    identical: acc.identical,
    conflicts: acc.conflicts,
    skippedSymlinks: acc.skippedSymlinks,
    errors: acc.errors,
    rewrittenConfig,
    readyToActivate,
  };

  writeManifest(path.join(migrationRoot, 'manifest.json'), manifest);
  if (readyToActivate) {
    writeManifest(path.join(layout.runtime.migrations, 'storage-layout-v2-ready.json'), manifest);
  }
  return manifest;
}
