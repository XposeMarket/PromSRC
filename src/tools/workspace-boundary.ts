import fs from 'fs';
import path from 'path';

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceBoundaryError';
  }
}

function realpathNative(target: string): string {
  return fs.realpathSync.native ? fs.realpathSync.native(target) : fs.realpathSync(target);
}

function comparisonPath(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Canonicalize an existing path, or a not-yet-created path through its nearest
 * existing ancestor. Existing-but-unresolvable entries (including broken links)
 * are rejected instead of being treated as ordinary missing path components.
 */
export function canonicalizePathForBoundarySync(targetPath: string): string {
  const resolvedTarget = path.resolve(String(targetPath || ''));
  let cursor = resolvedTarget;
  const missingSuffix: string[] = [];

  while (true) {
    try {
      const canonicalAncestor = realpathNative(cursor);
      return path.resolve(canonicalAncestor, ...missingSuffix);
    } catch (realpathError: any) {
      try {
        fs.lstatSync(cursor);
        throw new WorkspaceBoundaryError(
          `Existing path component could not be canonicalized: ${cursor} (${String(realpathError?.message || realpathError)})`,
        );
      } catch (lstatError: any) {
        if (lstatError instanceof WorkspaceBoundaryError) throw lstatError;
        if (lstatError?.code !== 'ENOENT' && lstatError?.code !== 'ENOTDIR') {
          throw new WorkspaceBoundaryError(
            `Path component could not be inspected: ${cursor} (${String(lstatError?.message || lstatError)})`,
          );
        }
      }

      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new WorkspaceBoundaryError(`No canonical ancestor exists for path: ${resolvedTarget}`);
      }
      missingSuffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export function isCanonicalPathInsideSync(basePath: string, targetPath: string): boolean {
  const base = comparisonPath(canonicalizePathForBoundarySync(basePath));
  const target = comparisonPath(canonicalizePathForBoundarySync(targetPath));
  if (base === target) return true;
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function assertCanonicalPathInsideSync(basePath: string, targetPath: string, label = 'Path'): void {
  if (!isCanonicalPathInsideSync(basePath, targetPath)) {
    throw new WorkspaceBoundaryError(`${label} escapes the allowed root: ${targetPath}`);
  }
}
