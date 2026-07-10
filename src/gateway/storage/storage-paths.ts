import fs from 'fs';
import path from 'path';

const STORAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export class StorageBoundaryError extends Error {
  readonly code = 'INVALID_STORAGE_BOUNDARY';

  constructor(message: string) {
    super(message);
    this.name = 'StorageBoundaryError';
  }
}

export function isStorageBoundaryError(error: unknown): error is StorageBoundaryError {
  return error instanceof StorageBoundaryError
    || (typeof error === 'object' && error !== null && (error as any).code === 'INVALID_STORAGE_BOUNDARY');
}

export function isSafeStorageId(value: unknown): value is string {
  const id = String(value ?? '').trim();
  return STORAGE_ID_RE.test(id) && !WINDOWS_DEVICE_RE.test(id);
}

export function assertSafeStorageId(value: unknown, label = 'id'): string {
  const id = String(value ?? '').trim();
  if (!isSafeStorageId(id)) {
    throw new StorageBoundaryError(`${label} must be a valid opaque identifier.`);
  }
  return id;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSafeRelativePath(value: unknown, label: string): string {
  const relative = String(value ?? '').trim();
  if (!relative || relative.length > 1024 || path.isAbsolute(relative) || relative.includes('\0')) {
    throw new StorageBoundaryError(`${label} must be a confined relative path.`);
  }
  const parts = relative.split(/[\\/]+/);
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new StorageBoundaryError(`${label} must not contain traversal components.`);
  }
  return parts.join(path.sep);
}

function realpathNative(target: string): string {
  return fs.realpathSync.native ? fs.realpathSync.native(target) : fs.realpathSync(target);
}

/**
 * Resolve a storage-relative path while proving both lexical and canonical
 * confinement. Existing symlink/junction components are rejected rather than
 * followed, including a reparse point used as the leaf being read/deleted.
 */
export function resolveConfinedStoragePath(
  root: string,
  relativePath: string,
  options: { createRoot?: boolean; label?: string } = {},
): string {
  const label = options.label || 'storage path';
  const rootAbs = path.resolve(String(root || ''));
  if (options.createRoot !== false) fs.mkdirSync(rootAbs, { recursive: true });
  if (!fs.existsSync(rootAbs)) throw new StorageBoundaryError(`${label} root does not exist.`);

  const rootStat = fs.lstatSync(rootAbs);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new StorageBoundaryError(`${label} root must be a real directory, not a link or junction.`);
  }

  const normalizedRelative = assertSafeRelativePath(relativePath, label);
  const candidate = path.resolve(rootAbs, normalizedRelative);
  if (!isWithin(rootAbs, candidate)) {
    throw new StorageBoundaryError(`${label} escaped its storage root.`);
  }

  const canonicalRoot = realpathNative(rootAbs);
  let cursor = rootAbs;
  for (const segment of path.relative(rootAbs, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new StorageBoundaryError(`${label} crosses a symbolic link or junction.`);
    }
    const canonicalCursor = realpathNative(cursor);
    if (!isWithin(canonicalRoot, canonicalCursor)) {
      throw new StorageBoundaryError(`${label} escaped its canonical storage root.`);
    }
  }

  // For a missing leaf, verify the nearest existing ancestor as a final guard.
  let ancestor = candidate;
  while (!fs.existsSync(ancestor) && ancestor !== rootAbs) ancestor = path.dirname(ancestor);
  const canonicalAncestor = realpathNative(ancestor);
  if (!isWithin(canonicalRoot, canonicalAncestor)) {
    throw new StorageBoundaryError(`${label} escaped its canonical storage root.`);
  }
  return candidate;
}

export function storageFilePath(root: string, id: unknown, suffix = '.json', label = 'id'): string {
  const safeId = assertSafeStorageId(id, label);
  return resolveConfinedStoragePath(root, `${safeId}${suffix}`, { label: `${label} file` });
}
