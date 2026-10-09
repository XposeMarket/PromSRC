import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { getActiveAllowedWorkspaces, hasActiveWorkspaceScope, isPathInWorkspace } from '../../tools/workspace-context';

/**
 * Validate a background_spawn work_dir. It must be an existing directory inside
 * a root the spawner may already use (its workspace, the active scope, or the
 * configured allowed_paths). The worker keeps access to the spawner workspace
 * and those roots so it can still write reports and read shared context.
 */
export function resolveBackgroundWorkDirArg(raw: unknown, spawnerWorkspace: string): { workDir?: string; allowedWorkPaths?: string[]; error?: string } {
  const requested = String(raw ?? '').trim();
  if (!requested) return {};
  const base = path.resolve(spawnerWorkspace || getConfig().getWorkspacePath() || '.');
  const workDir = path.resolve(path.isAbsolute(requested) ? requested : path.join(base, requested));
  try {
    if (!fs.statSync(workDir).isDirectory()) return { error: `work_dir is not a directory: ${workDir}` };
  } catch {
    return { error: `work_dir not found: ${workDir}` };
  }
  const cfg = getConfig().getConfig() as any;
  const configuredWorkspace = path.resolve(String(cfg?.workspace?.path || base));
  const configuredAllowed = Array.isArray(cfg?.tools?.permissions?.files?.allowed_paths)
    ? cfg.tools.permissions.files.allowed_paths.map((p: any) => String(p || '').trim()).filter(Boolean)
    : [];
  const spawnerRoots = hasActiveWorkspaceScope()
    ? getActiveAllowedWorkspaces(configuredWorkspace, configuredAllowed)
    : [base, configuredWorkspace, ...configuredAllowed].map((p) => path.resolve(p));
  if (!spawnerRoots.some((root) => isPathInWorkspace(root, workDir))) {
    return { error: `work_dir is outside the allowed directories (${spawnerRoots.join(', ')}): ${workDir}` };
  }
  const blocked = Array.isArray(cfg?.tools?.permissions?.files?.blocked_paths)
    ? cfg.tools.permissions.files.blocked_paths.map((p: any) => String(p || '').trim()).filter(Boolean).map((p: string) => path.resolve(p))
    : [];
  if (blocked.some((root: string) => isPathInWorkspace(root, workDir))) {
    return { error: `work_dir is in a blocked directory: ${workDir}` };
  }
  const allowedWorkPaths = Array.from(new Set([workDir, base, ...spawnerRoots].map((p) => path.resolve(p))));
  return { workDir, allowedWorkPaths };
}
