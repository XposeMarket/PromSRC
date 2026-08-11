import path from 'path';
import { getConfig } from '../config/config.js';

// In-memory session-scoped allowed paths, keyed by sessionId
const sessionAllowedPaths: Map<string, Set<string>> = new Map();

function resolvePath(value: unknown): string {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : '';
}

function normalize(p: string): string {
  const resolved = resolvePath(p) || path.resolve('.');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function persistentPathKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function sessionSet(sessionId: string): Set<string> {
  let set = sessionAllowedPaths.get(sessionId);
  if (!set) { set = new Set(); sessionAllowedPaths.set(sessionId, set); }
  return set;
}

export function addSessionAllowedPath(sessionId: string, dirPath: string): void {
  const normalized = resolvePath(dirPath);
  if (normalized) sessionSet(sessionId).add(normalize(normalized));
}

export function addSessionAllowedPaths(sessionId: string, dirPaths: string[]): void {
  for (const dirPath of dirPaths) addSessionAllowedPath(sessionId, dirPath);
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

export function addPersistentAllowedPaths(dirPaths: string[]): string[] {
  const additions = Array.from(new Set(
    (Array.isArray(dirPaths) ? dirPaths : [])
      .map(resolvePath)
      .filter(Boolean),
  ));
  if (!additions.length) return [];

  const cfg = getConfig();
  const current = cfg.getConfig();
  const existing: string[] = current.tools?.permissions?.files?.allowed_paths ?? [];
  const existingKeys = new Set(
    existing
      .map(resolvePath)
      .filter(Boolean)
      .map(persistentPathKey),
  );
  const missing = additions.filter((candidate) => {
    const key = persistentPathKey(candidate);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  if (missing.length) {
    cfg.updateConfig({
      tools: {
        ...current.tools,
        permissions: {
          ...current.tools?.permissions,
          files: {
            ...(current.tools?.permissions?.files ?? {}),
            allowed_paths: [...existing, ...missing],
          },
        },
      },
    } as any);
  }
  return missing;
}

export function addPersistentAllowedPath(dirPath: string): void {
  addPersistentAllowedPaths([dirPath]);
}
