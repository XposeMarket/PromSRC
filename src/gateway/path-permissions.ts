import path from 'path';
import { getConfig } from '../config/config.js';

// In-memory session-scoped allowed paths, keyed by sessionId
const sessionAllowedPaths: Map<string, Set<string>> = new Map();

function normalize(p: string): string {
  const resolved = path.resolve(String(p || '.'));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sessionSet(sessionId: string): Set<string> {
  let set = sessionAllowedPaths.get(sessionId);
  if (!set) { set = new Set(); sessionAllowedPaths.set(sessionId, set); }
  return set;
}

export function addSessionAllowedPath(sessionId: string, dirPath: string): void {
  sessionSet(sessionId).add(normalize(dirPath));
}

export function isSessionAllowedPath(sessionId: string, dirPath: string): boolean {
  const set = sessionAllowedPaths.get(sessionId);
  if (!set || set.size === 0) return false;
  const target = normalize(dirPath);
  for (const allowed of set) {
    if (target === allowed || target.startsWith(allowed + path.sep)) return true;
  }
  return false;
}

export function addPersistentAllowedPath(dirPath: string): void {
  const cfg = getConfig();
  const current = cfg.getConfig();
  const existing: string[] = current.tools?.permissions?.files?.allowed_paths ?? [];
  const normalized = path.resolve(dirPath);
  if (!existing.includes(normalized)) {
    cfg.updateConfig({
      tools: {
        ...current.tools,
        permissions: {
          ...current.tools?.permissions,
          files: {
            ...(current.tools?.permissions?.files ?? {}),
            allowed_paths: [...existing, normalized],
          },
        },
      },
    } as any);
  }
}
