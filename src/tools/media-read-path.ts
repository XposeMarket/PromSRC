import path from 'node:path';
import { getConfig } from '../config/config.js';
import { canonicalizePathForBoundarySync } from './workspace-boundary.js';
import { getActiveAllowedWorkspaces, isPathInWorkspace, isPathInAnyWorkspace } from './workspace-context.js';

// Read-only: outputs must use the tool's working-directory guard instead.
export function resolveMediaReadPath(workspaceRoot: string, requested: string): string {
  const cfg = getConfig().getConfig();
  const candidate = canonicalizePathForBoundarySync(path.resolve(workspaceRoot, requested));
  if (isPathInAnyWorkspace(cfg.tools.permissions.files.blocked_paths || [], candidate)) {
    throw new Error(`Path "${requested}" is in a blocked directory.`);
  }
  if (isPathInWorkspace(workspaceRoot, candidate)) return candidate;
  const parent = cfg.workspace.path;
  const uploads = path.join(canonicalizePathForBoundarySync(parent), 'uploads');
  const withinUploads = path.relative(uploads, candidate);
  if (path.isAbsolute(requested) && withinUploads && !withinUploads.startsWith('..') && !path.isAbsolute(withinUploads)
    && isPathInAnyWorkspace(getActiveAllowedWorkspaces(parent), candidate)) return candidate;
  throw new Error(`Path "${requested}" is outside workspace.`);
}
