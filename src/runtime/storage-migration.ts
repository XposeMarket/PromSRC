import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PrometheusLayout } from './storage-layout.js';
import { resolvePrometheusLayout, standaloneSubagentWorkspace } from './storage-layout.js';

export const STORAGE_MIGRATION_ID = 'storage-layout-v2';

export interface StorageMigrationCandidate {
  kind: 'config' | 'workspace';
  path: string;
  active: boolean;
  exists: boolean;
}

export interface StorageMigrationConflict {
  source: string;
  target: string;
  sourceHash?: string;
  targetHash?: string;
  reason: 'different_file' | 'type_mismatch' | 'destination_symlink';
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
  preflightRejected: boolean;
  copyVerified: boolean;
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

function pathsOverlap(a: string, b: string): boolean {
  return pathInside(a, b) || pathInside(b, a);
}

function existingSymlinkAncestor(candidate: string): string | null {
  let current = path.resolve(candidate);
  while (true) {
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function recordConflict(acc: MigrationAccumulator, conflict: StorageMigrationConflict): void {
  if (acc.conflicts.some((item) => item.source === conflict.source && item.target === conflict.target && item.reason === conflict.reason)) return;
  acc.conflicts.push(conflict);
}

function ensureTargetDirectory(target: string, source: string, acc: MigrationAccumulator): boolean {
  try {
    const existingLink = existingSymlinkAncestor(target);
    if (existingLink) {
      recordConflict(acc, { source, target: existingLink, reason: 'destination_symlink' });
      return false;
    }
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isDirectory()) {
        recordConflict(acc, { source, target, reason: 'type_mismatch' });
        return false;
      }
      return true;
    }
    fs.mkdirSync(target, { recursive: true });
    const createdLink = existingSymlinkAncestor(target);
    if (createdLink) {
      recordConflict(acc, { source, target: createdLink, reason: 'destination_symlink' });
      return false;
    }
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      recordConflict(acc, { source, target, reason: stat.isSymbolicLink() ? 'destination_symlink' : 'type_mismatch' });
      return false;
    }
    return true;
  } catch (error: any) {
    acc.errors.push({ source, target, message: `destination directory validation failed: ${String(error?.message || error)}` });
    return false;
  }
}

function digestBuffer(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
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

    if (!ensureTargetDirectory(path.dirname(target), source, acc)) return;
    const sourceDigest = fileHash(source);

    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      if (targetStat.isSymbolicLink()) {
        recordConflict(acc, { source, target, sourceHash: sourceDigest, reason: 'destination_symlink' });
        return;
      }
      if (!targetStat.isFile()) {
        recordConflict(acc, { source, target, sourceHash: sourceDigest, reason: 'type_mismatch' });
        return;
      }
      const targetDigest = fileHash(target);
      if (sourceDigest === targetDigest) {
        acc.identical.push({ source, target, hash: sourceDigest, bytes: sourceStat.size });
      } else {
        recordConflict(acc, {
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
  try {
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

    if (!ensureTargetDirectory(targetRoot, sourceRoot, acc)) return;
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
  } catch (error: any) {
    acc.errors.push({ source: sourceRoot, target: targetRoot, message: String(error?.message || error) });
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
  try {
    const agentsStat = fs.lstatSync(agentsRoot);
    if (agentsStat.isSymbolicLink()) {
      acc.skippedSymlinks.push(agentsRoot);
      return;
    }
    if (!agentsStat.isDirectory()) {
      recordConflict(acc, { source: agentsRoot, target: layout.workspace.standaloneSubagents, reason: 'type_mismatch' });
      return;
    }
    for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        acc.skippedSymlinks.push(path.join(agentsRoot, entry.name));
        continue;
      }
      if (!entry.isDirectory()) continue;
      const sourceAgentDir = path.join(agentsRoot, entry.name);
      const sourceWorkspace = path.join(sourceAgentDir, 'workspace');
      if (!fs.existsSync(sourceWorkspace)) continue;
      copyTreeVerified(sourceWorkspace, standaloneSubagentWorkspace(layout, entry.name), acc);
    }
  } catch (error: any) {
    acc.errors.push({ source: agentsRoot, target: layout.workspace.standaloneSubagents, message: String(error?.message || error) });
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

  const legacyAgentsRoot = path.join(sourceConfigRoot, 'agents');
  if (pathInside(legacyAgentsRoot, resolved)) {
    const parts = path.relative(legacyAgentsRoot, resolved).split(path.sep);
    if (parts.length >= 2 && parts[1] === 'workspace') {
      return path.join(standaloneSubagentWorkspace(layout, parts[0]), ...parts.slice(2));
    }
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

function writeContentVerified(
  sourceLabel: string,
  target: string,
  content: string,
  acc: MigrationAccumulator,
): boolean {
  try {
    if (!ensureTargetDirectory(path.dirname(target), sourceLabel, acc)) return false;
    const expectedHash = digestBuffer(content);
    const expectedBytes = Buffer.byteLength(content, 'utf-8');

    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target);
      if (targetStat.isSymbolicLink()) {
        recordConflict(acc, { source: sourceLabel, target, sourceHash: expectedHash, reason: 'destination_symlink' });
        return false;
      }
      if (!targetStat.isFile()) {
        recordConflict(acc, { source: sourceLabel, target, sourceHash: expectedHash, reason: 'type_mismatch' });
        return false;
      }
      const targetHash = fileHash(target);
      if (targetHash !== expectedHash) {
        recordConflict(acc, { source: sourceLabel, target, sourceHash: expectedHash, targetHash, reason: 'different_file' });
        return false;
      }
      acc.identical.push({ source: sourceLabel, target, hash: expectedHash, bytes: expectedBytes });
      return true;
    }

    const temp = `${target}.${process.pid}.${Date.now()}.migration.tmp`;
    fs.writeFileSync(temp, content, 'utf-8');
    fs.renameSync(temp, target);
    const targetHash = fileHash(target);
    if (targetHash !== expectedHash) {
      try { fs.rmSync(target, { force: true }); } catch {}
      throw new Error(`verification hash mismatch (${expectedHash} != ${targetHash})`);
    }
    acc.copied.push({ source: sourceLabel, target, hash: expectedHash, bytes: expectedBytes });
    return true;
  } catch (error: any) {
    acc.errors.push({ source: sourceLabel, target, message: String(error?.message || error) });
    return false;
  }
}

function migrateConfigJson(
  sourceConfigRoot: string,
  sourceWorkspaceRoot: string,
  layout: PrometheusLayout,
  acc: MigrationAccumulator,
): boolean {
  const source = path.join(sourceConfigRoot, 'config.json');
  if (!fs.existsSync(source)) return false;
  try {
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) {
      acc.skippedSymlinks.push(source);
      return false;
    }
    if (!sourceStat.isFile()) {
      recordConflict(acc, { source, target: path.join(layout.runtime.config, 'config.json'), reason: 'type_mismatch' });
      return false;
    }
    const raw = JSON.parse(fs.readFileSync(source, 'utf-8'));
    const rewritten = rewriteMigratedConfigPaths(raw, sourceConfigRoot, sourceWorkspaceRoot, layout);
    return writeContentVerified(source, path.join(layout.runtime.config, 'config.json'), `${JSON.stringify(rewritten, null, 2)}\n`, acc);
  } catch (error: any) {
    acc.errors.push({ source, target: path.join(layout.runtime.config, 'config.json'), message: `config migration failed: ${String(error?.message || error)}` });
    return false;
  }
}

function migrateConfigRoot(
  sourceConfigRoot: string,
  sourceWorkspaceRoot: string,
  layout: PrometheusLayout,
  acc: MigrationAccumulator,
): boolean {
  if (!fs.existsSync(sourceConfigRoot) || samePath(sourceConfigRoot, layout.runtime.root) || samePath(sourceConfigRoot, layout.runtime.config)) return false;
  let rewrittenConfig = false;
  try {
    const rootStat = fs.lstatSync(sourceConfigRoot);
    if (rootStat.isSymbolicLink()) {
      acc.skippedSymlinks.push(sourceConfigRoot);
      return false;
    }
    if (!rootStat.isDirectory()) {
      recordConflict(acc, { source: sourceConfigRoot, target: layout.runtime.config, reason: 'type_mismatch' });
      return false;
    }
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
        if (entry.name === 'skill-state') {
          copyTreeVerified(source, path.join(layout.runtime.config, 'skills'), acc);
          continue;
        }
        if (entry.name === 'agents') {
          migrateLegacyAgentWorkspaces(sourceConfigRoot, layout, acc);
          copyTreeVerified(source, path.join(layout.runtime.config, 'legacy-root', 'agents'), acc);
          continue;
        }
        const mapped = runtimeDirectoryTarget(layout, entry.name);
        copyTreeVerified(source, mapped || path.join(layout.runtime.config, 'legacy-root', entry.name), acc);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === 'config.json') {
        rewrittenConfig = migrateConfigJson(sourceConfigRoot, sourceWorkspaceRoot, layout, acc) || rewrittenConfig;
        continue;
      }
      copyFileVerified(source, runtimeFileTarget(layout, entry.name), acc);
    }
  } catch (error: any) {
    acc.errors.push({ source: sourceConfigRoot, target: layout.runtime.config, message: `config-root migration failed: ${String(error?.message || error)}` });
  }
  return rewrittenConfig;
}

function writeManifest(filePath: string, manifest: StorageMigrationManifest): void {
  const link = existingSymlinkAncestor(filePath);
  if (link) throw new Error(`refusing to write migration metadata through symbolic link: ${link}`);
  const parent = path.dirname(filePath);
  if (fs.existsSync(parent) && !fs.lstatSync(parent).isDirectory()) {
    throw new Error(`migration metadata parent is not a directory: ${parent}`);
  }
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`migration metadata target is a symbolic link: ${filePath}`);
  }
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  try {
    fs.renameSync(temp, filePath);
  } catch {
    fs.copyFileSync(temp, filePath);
    fs.rmSync(temp, { force: true });
  }
}

function preflightMigrationPaths(
  sourceConfigRoot: string,
  sourceWorkspaceRoot: string,
  layout: PrometheusLayout,
  backupRoot: string,
  migrationRoot: string,
  copyMarker: string,
): StorageMigrationManifest['errors'] {
  const errors: StorageMigrationManifest['errors'] = [];
  const sources = [sourceConfigRoot, sourceWorkspaceRoot];
  const destinations = [layout.runtime.root, layout.workspace.root, backupRoot, migrationRoot];

  if (pathsOverlap(sourceConfigRoot, sourceWorkspaceRoot)) {
    errors.push({ source: sourceConfigRoot, target: sourceWorkspaceRoot, message: 'source config and workspace roots overlap' });
  }
  if (pathsOverlap(layout.runtime.root, layout.workspace.root)) {
    errors.push({ source: layout.runtime.root, target: layout.workspace.root, message: 'canonical runtime and workspace roots overlap' });
  }
  for (const source of sources) {
    for (const target of destinations) {
      if (pathsOverlap(source, target)) {
        errors.push({ source, target, message: 'source and migration destination roots overlap' });
      }
    }
  }
  for (const target of [layout.runtime.root, layout.workspace.root, backupRoot, migrationRoot, copyMarker]) {
    try {
      const link = existingSymlinkAncestor(target);
      if (link) errors.push({ target, message: `migration destination contains symbolic-link/junction ancestor: ${link}` });
    } catch (error: any) {
      errors.push({ target, message: `destination preflight failed: ${String(error?.message || error)}` });
    }
  }
  return errors;
}

function removeCopyMarker(filePath: string, acc: MigrationAccumulator): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const link = existingSymlinkAncestor(filePath);
    if (link) {
      acc.errors.push({ target: filePath, message: `refusing to clear copy-verification marker through symbolic link: ${link}` });
      return;
    }
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) {
      acc.errors.push({ target: filePath, message: 'copy-verification marker is not a regular file' });
      return;
    }
    fs.rmSync(filePath, { force: true });
  } catch (error: any) {
    acc.errors.push({ target: filePath, message: `failed to clear stale copy-verification marker: ${String(error?.message || error)}` });
  }
}

/**
 * Copy and verify pre-v2 Prometheus state into layout v2.
 *
 * This phase NEVER removes or renames source data and NEVER overwrites a
 * different destination file. A successful marker certifies only copy integrity;
 * the later activation phase must separately prove that live readers resolve the
 * canonical locations before switching any running process.
 */
export function executeStorageLayoutV2Migration(options: ExecuteStorageMigrationOptions = {}): StorageMigrationManifest {
  const layout = options.layout || resolvePrometheusLayout();
  const sourceConfigRoot = path.resolve(options.sourceConfigRoot || layout.legacy.activeConfig);
  const sourceWorkspaceRoot = path.resolve(options.sourceWorkspaceRoot || layout.legacy.activeWorkspace);
  const now = options.now || new Date();
  const migrationId = safeMigrationSegment(options.migrationId || `${STORAGE_MIGRATION_ID}-${now.toISOString().replace(/[:.]/g, '-')}`);
  const backupRoot = path.join(layout.runtime.backups, STORAGE_MIGRATION_ID, migrationId);
  const migrationRoot = path.join(layout.runtime.migrations, migrationId);
  const copyMarker = path.join(layout.runtime.migrations, 'storage-layout-v2-copy-verified.json');
  const startedAt = new Date().toISOString();

  const acc: MigrationAccumulator = {
    copied: [],
    identical: [],
    conflicts: [],
    skippedSymlinks: [],
    errors: [],
  };

  const preflightErrors = preflightMigrationPaths(
    sourceConfigRoot,
    sourceWorkspaceRoot,
    layout,
    backupRoot,
    migrationRoot,
    copyMarker,
  );
  if (preflightErrors.length > 0) {
    return {
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
      copied: [],
      identical: [],
      conflicts: [],
      skippedSymlinks: [],
      errors: preflightErrors,
      rewrittenConfig: false,
      preflightRejected: true,
      copyVerified: false,
    };
  }

  // Invalidate any older stable marker before copying so a crash cannot leave a
  // stale success signal from a previous source snapshot.
  removeCopyMarker(copyMarker, acc);

  const backupReady = ensureTargetDirectory(backupRoot, sourceConfigRoot, acc);
  const manifestReady = ensureTargetDirectory(migrationRoot, sourceConfigRoot, acc);

  if (backupReady) {
    if (fs.existsSync(sourceConfigRoot) && !samePath(sourceConfigRoot, layout.runtime.root)) {
      copyTreeVerified(sourceConfigRoot, path.join(backupRoot, 'source-config'), acc);
    }
    if (fs.existsSync(sourceWorkspaceRoot) && !samePath(sourceWorkspaceRoot, layout.workspace.root)) {
      copyTreeVerified(sourceWorkspaceRoot, path.join(backupRoot, 'source-workspace'), acc);
    }
  }

  const rewrittenConfig = migrateConfigRoot(sourceConfigRoot, sourceWorkspaceRoot, layout, acc);
  if (fs.existsSync(sourceWorkspaceRoot) && !samePath(sourceWorkspaceRoot, layout.workspace.root)) {
    copyTreeVerified(sourceWorkspaceRoot, layout.workspace.root, acc);
  }

  let manifest: StorageMigrationManifest = {
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
    preflightRejected: false,
    copyVerified: acc.conflicts.length === 0 && acc.errors.length === 0 && acc.skippedSymlinks.length === 0,
  };

  if (manifestReady) {
    try {
      writeManifest(path.join(migrationRoot, 'manifest.json'), manifest);
    } catch (error: any) {
      acc.errors.push({ target: path.join(migrationRoot, 'manifest.json'), message: `manifest write failed: ${String(error?.message || error)}` });
      manifest = { ...manifest, errors: acc.errors, copyVerified: false };
    }
  } else {
    manifest = { ...manifest, errors: acc.errors, copyVerified: false };
  }

  if (manifest.copyVerified) {
    try {
      writeManifest(copyMarker, manifest);
    } catch (error: any) {
      acc.errors.push({ target: copyMarker, message: `copy-verification marker write failed: ${String(error?.message || error)}` });
      manifest = { ...manifest, errors: acc.errors, copyVerified: false };
      removeCopyMarker(copyMarker, acc);
      if (manifestReady) {
        try { writeManifest(path.join(migrationRoot, 'manifest.json'), manifest); } catch {}
      }
    }
  } else {
    removeCopyMarker(copyMarker, acc);
  }

  return manifest;
}
