/**
 * Canonical updater primitives shared by the gateway, CLI and packaged
 * Electron main process.
 *
 * This module deliberately has no Electron, git or npm dependency.  A source
 * checkout can inspect the protocol, but only the trusted packaged Electron
 * main process is allowed to consume an apply request and install a release.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type UpdateAction = 'check' | 'apply';

export interface UpdateRequest {
  schemaVersion: 1;
  requestId: string;
  action: UpdateAction;
  source: string;
  confirmed: boolean;
  createdAt: number;
  // These are paths selected by the gateway from local configuration.  They
  // are never written to status messages or logs.
  stateRoots?: Array<{ label: string; path: string }>;
}

export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'preparing'
  | 'installing'
  | 'relaunching'
  | 'validated'
  | 'busy'
  | 'error';

export interface CanonicalUpdateStatus {
  schemaVersion: 1;
  supported: boolean;
  phase: UpdatePhase;
  currentVersion: string;
  targetVersion?: string;
  message: string;
  progress?: number;
  requestId?: string;
  source?: string;
  backupId?: string;
  recoveryAvailable?: boolean;
  releaseValidated?: boolean;
  sha512Verified?: boolean;
  stateBackupCreated?: boolean;
  restartValidated?: boolean;
  updatedAt: number;
  // Deliberately a short, scrubbed diagnostic. Never put a credential or
  // response body in this file.
  errorCode?: string;
}

export interface UpdatePaths {
  configDir: string;
  updateDir: string;
  requestFile: string;
  statusFile: string;
  lockFile: string;
  backupsDir: string;
  pendingValidationFile: string;
}

export interface PreflightInput {
  activeOperations?: number;
  pendingWrites?: number;
  persistenceBusy?: boolean;
}

export interface PreflightResult {
  ready: boolean;
  activeOperations: number;
  pendingWrites: number;
  reasons: string[];
}

export interface ReleaseFileInfo {
  url?: string;
  path?: string;
  sha512?: string;
  size?: number;
}

export interface ReleaseInfo {
  version: string;
  sha512?: string;
  files?: ReleaseFileInfo[];
}

export interface StateRoot {
  label: string;
  path: string;
}

export interface ManifestEntry {
  label: string;
  sourcePath: string;
  backupPath: string;
  exists: boolean;
  fileCount: number;
  byteCount: number;
}

export interface StateBackupManifest {
  schemaVersion: 1;
  backupId: string;
  createdAt: number;
  currentVersion: string;
  targetVersion: string;
  entries: ManifestEntry[];
  // This is metadata only. Contents are in manifest.enc and are encrypted by
  // the Electron safeStorage callback supplied by the caller.
  protection: 'encrypted-manifest';
}

export interface StateBackupResult {
  backupId: string;
  backupDir: string;
  manifest: StateBackupManifest;
}

export interface CreateStateBackupOptions {
  stateRoot: string;
  updateDir: string;
  backupsDir: string;
  currentVersion: string;
  targetVersion: string;
  stateRoots?: StateRoot[];
  encryptManifest: (plaintext: string) => Buffer | string;
  protectBackup: (backupDir: string) => void;
}

export interface UpdateLock {
  token: string;
  release: () => void;
}

function now(): number {
  return Date.now();
}

function randomId(prefix: string): string {
  return `${prefix}-${now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function isPathWithin(candidate: string, parent: string): boolean {
  const child = path.resolve(candidate);
  const root = path.resolve(parent);
  const relative = path.relative(root, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function secureMkdir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
}

export function getUpdatePaths(configDir: string): UpdatePaths {
  const root = path.resolve(configDir);
  const updateDir = path.join(root, 'updates');
  return {
    configDir: root,
    updateDir,
    requestFile: path.join(updateDir, 'request.json'),
    statusFile: path.join(updateDir, 'status.json'),
    lockFile: path.join(updateDir, 'operation.lock'),
    backupsDir: path.join(updateDir, 'backups'),
    pendingValidationFile: path.join(updateDir, 'pending-validation.json'),
  };
}

export function isPackagedPublicUpdaterEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROMETHEUS_ELECTRON_MANAGED === '1' && env.PROMETHEUS_PUBLIC_BUILD === '1';
}

function writeJson(filePath: string, value: unknown, mode = 0o600): void {
  secureMkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode });
  try { fs.chmodSync(filePath, mode); } catch {}
}

export function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function readCanonicalUpdateStatus(
  configDir: string,
  fallback: Partial<CanonicalUpdateStatus> = {},
): CanonicalUpdateStatus {
  const parsed = readJson<Partial<CanonicalUpdateStatus>>(getUpdatePaths(configDir).statusFile);
  return {
    schemaVersion: 1,
    supported: false,
    phase: 'unsupported',
    currentVersion: '0.0.0',
    message: 'Updates are available only in packaged public builds.',
    updatedAt: now(),
    ...(parsed || {}),
    // Runtime capability/version supplied by the caller wins over stale
    // persisted status from a previous packaged process.
    ...fallback,
  } as CanonicalUpdateStatus;
}

export function writeCanonicalUpdateStatus(
  configDir: string,
  patch: Partial<CanonicalUpdateStatus> & Pick<CanonicalUpdateStatus, 'supported' | 'phase' | 'currentVersion' | 'message'>,
): CanonicalUpdateStatus {
  const current = readCanonicalUpdateStatus(configDir, patch);
  const next: CanonicalUpdateStatus = {
    ...current,
    ...patch,
    schemaVersion: 1,
    updatedAt: now(),
  };
  writeJson(getUpdatePaths(configDir).statusFile, next);
  return next;
}

export function requestCanonicalUpdate(
  configDir: string,
  options: {
    action: UpdateAction;
    source: string;
    confirmed?: boolean;
    stateRoots?: StateRoot[];
    env?: NodeJS.ProcessEnv;
  },
): { ok: true; request: UpdateRequest } | { ok: false; code: string; message: string } {
  if (!isPackagedPublicUpdaterEnvironment(options.env)) {
    return { ok: false, code: 'unsupported', message: 'Safe updates require a packaged public Prometheus build.' };
  }
  if (options.action === 'apply' && options.confirmed !== true) {
    return { ok: false, code: 'confirmation_required', message: 'Explicit confirmation is required before installing an update.' };
  }

  const paths = getUpdatePaths(configDir);
  secureMkdir(paths.updateDir);
  const requestedRoots = Array.isArray(options.stateRoots) ? options.stateRoots.slice(0, 64) : [];
  const request: UpdateRequest = {
    schemaVersion: 1,
    requestId: randomId('update-request'),
    action: options.action,
    source: String(options.source || 'unknown').slice(0, 64),
    confirmed: options.confirmed === true,
    createdAt: now(),
    stateRoots: requestedRoots.map((root) => ({
      label: String(root?.label || 'configured').slice(0, 80),
      path: path.resolve(String(root?.path || '')),
    })).filter((root, index) => {
      const original = requestedRoots[index];
      return typeof original?.path === 'string'
        && original.path.trim().length > 0
        && root.path !== path.parse(root.path).root;
    }),
  };
  try {
    fs.writeFileSync(paths.requestFile, JSON.stringify(request), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(paths.requestFile, 0o600); } catch {}
    return { ok: true, request };
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return { ok: false, code: 'busy', message: 'Another Prometheus update request is already in progress.' };
    }
    return { ok: false, code: 'request_failed', message: 'Prometheus could not queue the update request.' };
  }
}

export function consumeCanonicalUpdateRequest(configDir: string): UpdateRequest | null {
  const filePath = getUpdatePaths(configDir).requestFile;
  const request = readJson<UpdateRequest>(filePath);
  if (!request || request.schemaVersion !== 1 || !['check', 'apply'].includes(request.action)) return null;
  try { fs.unlinkSync(filePath); } catch {}
  return request;
}

export async function waitForCanonicalUpdateStatus(
  configDir: string,
  requestId: string,
  timeoutMs = 5000,
): Promise<CanonicalUpdateStatus> {
  const deadline = now() + Math.max(250, timeoutMs);
  let status = readCanonicalUpdateStatus(configDir);
  while (now() < deadline) {
    status = readCanonicalUpdateStatus(configDir);
    if (status.requestId === requestId && !['checking', 'downloading', 'preparing', 'installing', 'relaunching'].includes(status.phase)) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return status;
}

export function evaluateUpdatePreflight(input: PreflightInput = {}): PreflightResult {
  const activeOperations = Math.max(0, Number(input.activeOperations || 0));
  const pendingWrites = Math.max(0, Number(input.pendingWrites || 0));
  const reasons: string[] = [];
  if (activeOperations > 0) reasons.push('active_operations');
  if (pendingWrites > 0 || input.persistenceBusy === true) reasons.push('pending_writes');
  return { ready: reasons.length === 0, activeOperations, pendingWrites, reasons };
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function acquireUpdateLock(configDir: string, owner = 'electron-main'): UpdateLock | null {
  const paths = getUpdatePaths(configDir);
  secureMkdir(paths.updateDir);
  const token = randomId('lock');
  const payload = { schemaVersion: 1, token, owner: String(owner).slice(0, 64), pid: process.pid, createdAt: now() };
  try {
    const fd = fs.openSync(paths.lockFile, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(payload));
    fs.closeSync(fd);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') return null;
    const existing = readJson<{ pid?: number; createdAt?: number }>(paths.lockFile);
    // Never delete an unknown lock. A dead owner may be recovered by rename,
    // preserving the old record for support and audit.
    if (existing?.pid && existing.createdAt && now() - existing.createdAt > 10 * 60 * 1000 && !processIsAlive(existing.pid)) {
      try {
        fs.renameSync(paths.lockFile, `${paths.lockFile}.stale-${now()}`);
        return acquireUpdateLock(configDir, owner);
      } catch {}
    }
    return null;
  }

  return {
    token,
    release: () => {
      const current = readJson<{ token?: string }>(paths.lockFile);
      if (current?.token !== token) return;
      try { fs.unlinkSync(paths.lockFile); } catch {}
    },
  };
}

function parseVersion(version: string): [number, number, number, string] | null {
  const match = String(version || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)([-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] || ''];
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  if (!left[3] && right[3]) return 1;
  if (left[3] && !right[3]) return -1;
  return left[3].localeCompare(right[3]);
}

export function validateReleaseInfo(currentVersion: string, info: ReleaseInfo): { ok: true } | { ok: false; message: string } {
  if (!parseVersion(currentVersion)) return { ok: false, message: 'Current Prometheus version is invalid.' };
  if (!parseVersion(info?.version)) return { ok: false, message: 'Release version is invalid.' };
  if (compareVersions(info.version, currentVersion) <= 0) return { ok: false, message: 'Release version is not newer than the installed version.' };
  const files = Array.isArray(info.files) ? info.files : [];
  const digest = String(info.sha512 || files.find((file) => file?.sha512)?.sha512 || '').trim();
  if (!/^[A-Za-z0-9+/]{80,}={0,2}$/.test(digest) && !/^[a-f0-9]{128}$/i.test(digest)) {
    return { ok: false, message: 'Release metadata has no valid SHA-512 digest.' };
  }
  if (files.length > 0) {
    const usable = files.some((file) => {
      const value = String(file?.url || file?.path || '').trim();
      return value && !/^(?:javascript|data|file|shell):/i.test(value);
    });
    if (!usable) return { ok: false, message: 'Release metadata has no safe installer path.' };
  }
  return { ok: true };
}

export async function verifyFileSha512(filePath: string, expectedDigest: string): Promise<boolean> {
  const expectedRaw = String(expectedDigest || '').trim();
  const expectedHex = expectedRaw.toLowerCase();
  if (!expectedRaw) return false;
  const hash = crypto.createHash('sha512');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const hex = hash.digest('hex').toLowerCase();
  const base64 = Buffer.from(hex, 'hex').toString('base64');
  // Hex is case-insensitive; base64 is not.
  return expectedHex === hex || expectedRaw === base64;
}

export function sanitizeUpdateError(error: unknown): string {
  const raw = String((error as any)?.message || error || 'Update failed')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .trim();
  return raw.slice(0, 500) || 'Update failed';
}

function summarizeTree(root: string): { fileCount: number; byteCount: number } {
  let fileCount = 0;
  let byteCount = 0;
  const visit = (current: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        fileCount += 1;
        try { byteCount += fs.statSync(entryPath).size; } catch {}
      }
    }
  };
  try {
    if (fs.statSync(root).isFile()) return { fileCount: 1, byteCount: fs.statSync(root).size };
    visit(root);
  } catch {}
  return { fileCount, byteCount };
}

function safeBackupName(value: string): string {
  return String(value || 'root').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'root';
}

function copyRoot(sourcePath: string, destinationPath: string, skipPath?: string): void {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isSymbolicLink()) throw new Error('Configured state root is a symbolic link; refusing to follow it.');
  if (sourceStat.isDirectory()) {
    // The canonical backup lives under the user-data root. Node's cpSync
    // rejects copying a directory into its own descendant even when a filter
    // would exclude that descendant, so walk the tree explicitly and refuse
    // both the update protocol directory and the destination itself.
    secureMkdir(destination);
    const copyDirectory = (currentSource: string, currentDestination: string): void => {
      for (const entry of fs.readdirSync(currentSource, { withFileTypes: true })) {
        const sourceEntry = path.join(currentSource, entry.name);
        const destinationEntry = path.join(currentDestination, entry.name);
        if (skipPath && isPathWithin(sourceEntry, skipPath)) continue;
        if (isPathWithin(sourceEntry, destination)) continue;
        if (entry.isDirectory()) {
          secureMkdir(destinationEntry);
          copyDirectory(sourceEntry, destinationEntry);
        } else if (entry.isSymbolicLink()) {
          secureMkdir(path.dirname(destinationEntry));
          fs.symlinkSync(fs.readlinkSync(sourceEntry), destinationEntry, entry.isDirectory() ? 'junction' : 'file');
        } else if (entry.isFile()) {
          secureMkdir(path.dirname(destinationEntry));
          fs.copyFileSync(sourceEntry, destinationEntry, fs.constants.COPYFILE_EXCL);
        }
      }
    };
    copyDirectory(source, destination);
  } else if (sourceStat.isFile()) {
    secureMkdir(path.dirname(destination));
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  } else {
    throw new Error(`Unsupported configured state root: ${path.basename(source)}`);
  }
}

export function createVersionedStateBackup(options: CreateStateBackupOptions): StateBackupResult {
  const stateRoot = path.resolve(options.stateRoot);
  const updateDir = path.resolve(options.updateDir);
  const backupsDir = path.resolve(options.backupsDir);
  if (!fs.existsSync(stateRoot)) throw new Error('Prometheus user data root does not exist.');
  if (typeof options.encryptManifest !== 'function' || typeof options.protectBackup !== 'function') {
    throw new Error('Encrypted backup protection is unavailable; update is blocked.');
  }
  const backupId = randomId('backup');
  const backupDir = path.join(backupsDir, backupId);
  secureMkdir(backupDir);

  try {

  const roots: StateRoot[] = [
    { label: 'user-data', path: stateRoot },
    ...(options.stateRoots || []).map((root) => ({ label: String(root.label || 'configured'), path: path.resolve(root.path) })),
  ];
  const uniqueRoots = roots.filter((root, index, all) => all.findIndex((other) => samePath(other.path, root.path)) === index);
  const entries: ManifestEntry[] = [];
  let externalIndex = 0;
  for (const root of uniqueRoots) {
    const sourcePath = path.resolve(root.path);
    if (sourcePath === path.parse(sourcePath).root) {
      throw new Error('Configured state root cannot be a filesystem root.');
    }
    if (isPathWithin(sourcePath, updateDir)) {
      throw new Error('Configured state root overlaps the update protocol directory.');
    }
    if (isPathWithin(sourcePath, backupDir)) throw new Error('Configured state root overlaps the backup destination.');
    const exists = fs.existsSync(sourcePath);
    const backupRelativePath = isPathWithin(sourcePath, stateRoot)
      ? path.join('state', path.relative(stateRoot, sourcePath))
      : path.join('external', `${externalIndex++}-${safeBackupName(root.label)}`);
    const destinationPath = path.join(backupDir, backupRelativePath);
    // The user-data root already contains every nested Prometheus state
    // directory. Keep the per-area manifest entries for auditability, but do
    // not copy nested roots a second time or risk merging them over the root
    // snapshot with different filesystem semantics.
    const coveredByStateRoot = isPathWithin(sourcePath, stateRoot) && !samePath(sourcePath, stateRoot);
    if (exists && !coveredByStateRoot) {
      copyRoot(sourcePath, destinationPath, isPathWithin(sourcePath, stateRoot) ? updateDir : undefined);
    }
    const summary = exists ? summarizeTree(destinationPath) : { fileCount: 0, byteCount: 0 };
    entries.push({
      label: root.label,
      sourcePath,
      backupPath: backupRelativePath,
      exists,
      fileCount: summary.fileCount,
      byteCount: summary.byteCount,
    });
  }

  const manifest: StateBackupManifest = {
    schemaVersion: 1,
    backupId,
    createdAt: now(),
    currentVersion: String(options.currentVersion || '0.0.0'),
    targetVersion: String(options.targetVersion || 'unknown'),
    entries,
    protection: 'encrypted-manifest',
  };
  const encrypted = options.encryptManifest(JSON.stringify(manifest));
  fs.writeFileSync(path.join(backupDir, 'manifest.enc'), encrypted, { mode: 0o600 });
  try { fs.chmodSync(path.join(backupDir, 'manifest.enc'), 0o600); } catch {}
  options.protectBackup(backupDir);
  return { backupId, backupDir, manifest };
  } catch (error) {
    // A partial or unprotected copy is not a recovery artifact. Retain it
    // under an explicit incomplete name for audit/recovery; never delete even
    // a newly-created backup tree as part of an update failure.
    try { fs.renameSync(backupDir, `${backupDir}.incomplete-${now()}`); } catch {}
    throw error;
  }
}

export function collectUserStateRoots(stateRoot: string, config: any = {}, configuredExternalPaths: string[] = []): StateRoot[] {
  const root = path.resolve(stateRoot);
  const candidates: StateRoot[] = [
    { label: 'vault', path: path.join(root, '.prometheus', 'vault') },
    { label: 'settings', path: path.join(root, '.prometheus') },
    // Packaged Electron installs imported skills in the data-local skills
    // directory. Keep the source/manual workspace location explicit too so
    // the manifest remains complete across install modes.
    { label: 'skills', path: path.join(root, '.prometheus', 'skills') },
    { label: 'memory', path: path.join(root, '.prometheus', 'memory') },
    { label: 'sessions', path: path.join(root, '.prometheus', 'sessions') },
    { label: 'projects', path: path.join(root, '.prometheus', 'projects') },
    { label: 'browser-state', path: path.join(root, '.prometheus', 'browser-sessions.json') },
    { label: 'browser-state', path: path.join(root, '.prometheus', 'browser-activity') },
    { label: 'workspace', path: path.join(root, 'workspace') },
    { label: 'workspace-skills', path: path.join(root, 'workspace', 'skills') },
    { label: 'memory', path: path.join(root, 'memory') },
    { label: 'sessions', path: path.join(root, 'sessions') },
    { label: 'projects', path: path.join(root, 'projects') },
    { label: 'browser-state', path: path.join(root, 'browser-state') },
    { label: 'browser-partitions', path: path.join(root, 'Partitions') },
  ];
  const add = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    candidates.push({ label, path: path.resolve(value) });
  };
  const addSkillRoot = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const skillRoot = path.resolve(value);
    add(label, skillRoot);
    // Imported-skill provenance and audit manifests are stored beside the
    // skills directory, not inside each skill. Preserve those sidecars for
    // custom external skill roots as well as the packaged root.
    const parent = path.dirname(skillRoot);
    if (parent !== path.parse(parent).root) {
      add(`${label}-manifests`, path.join(parent, '.manifests'));
      add(`${label}-state`, path.join(parent, 'skills_state.json'));
      add(`${label}-lock`, path.join(parent, '.clawhub'));
    }
  };
  addSkillRoot('skills', path.join(root, '.prometheus', 'skills'));
  addSkillRoot('workspace-skills', path.join(root, 'workspace', 'skills'));
  add('configured-workspace', config?.workspace?.path);
  add('configured-workspace-root', config?.workspace?.root);
  addSkillRoot('configured-skills', config?.skills?.directory);
  addSkillRoot('configured-skills', config?.workspace?.skillsPath);
  for (const value of Array.isArray(config?.skills?.paths) ? config.skills.paths : []) addSkillRoot('configured-skills', value);
  for (const value of Array.isArray(config?.skills?.directories) ? config.skills.directories : []) addSkillRoot('configured-skills', value);
  for (const value of Array.isArray(config?.skills?.roots) ? config.skills.roots : []) addSkillRoot('configured-skills', value);
  for (const value of Array.isArray(config?.workspace?.paths) ? config.workspace.paths : []) add('configured-workspace', value);
  for (const value of Array.isArray(config?.workspaces) ? config.workspaces : []) add('configured-workspace', typeof value === 'string' ? value : value?.path);
  for (const value of Array.isArray(config?.externalWorkspaces) ? config.externalWorkspaces : []) add('external-workspace', typeof value === 'string' ? value : value?.path);
  for (const value of Array.isArray(config?.tools?.permissions?.files?.allowed_paths)
    ? config.tools.permissions.files.allowed_paths
    : []) add('configured-file-root', value);
  for (const value of configuredExternalPaths) add('configured-external', value);
  return candidates
    .filter((rootValue) => {
      const resolved = path.resolve(rootValue.path);
      return resolved !== path.parse(resolved).root;
    })
    .filter((rootValue, index, all) => all.findIndex((other) => samePath(other.path, rootValue.path)) === index);
}

export function writePendingValidation(configDir: string, value: Record<string, unknown>): void {
  writeJson(getUpdatePaths(configDir).pendingValidationFile, { schemaVersion: 1, ...value, createdAt: now() });
}

export function readPendingValidation(configDir: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown>>(getUpdatePaths(configDir).pendingValidationFile);
}
