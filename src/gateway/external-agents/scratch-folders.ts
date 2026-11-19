/**
 * Folder-picker hygiene for connected agents.
 *
 * A harness's history includes throwaway working directories: OS temp dirs
 * (test runs, one-off probes) and Prometheus's own workspace scratch folder.
 * Those are not projects, so the Chat/Project picker and the harness sections
 * hide them, along with folders that no longer exist (a new chat can't start
 * there anyway). The harness's own history is never modified.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

function norm(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(child: string, parent: string): boolean {
  if (!parent) return false;
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
}

export function scratchRoots(workspacePath?: string): string[] {
  const roots = [os.tmpdir()];
  if (process.platform !== 'win32') roots.push('/tmp', '/private/tmp', '/var/folders');
  if (workspacePath) roots.push(path.join(workspacePath, 'temp'));
  return roots;
}

export function isPickableAgentFolder(
  folderPath: string,
  opts: { workspacePath?: string; exists?: (p: string) => boolean } = {},
): boolean {
  const p = String(folderPath || '').trim();
  if (!p || !path.isAbsolute(p)) return false;
  if (scratchRoots(opts.workspacePath).some((root) => isInside(p, root))) return false;
  const exists = opts.exists || ((x: string) => { try { return fs.statSync(x).isDirectory(); } catch { return false; } });
  return exists(p);
}
