import fs from 'fs';
import path from 'path';

/**
 * Bounded, non-blocking traversal used to suggest near matches for a missing path.
 * Budgets count every directory entry examined (filter-independent), so a tree the
 * filters reject still terminates. Symlinks are never followed. Each directory is
 * read through an async handle and the event loop is yielded between directories.
 */
export interface PathSuggestionBudget {
  maxVisited: number;
  maxDirs: number;
  maxDepth: number;
  maxMs: number;
}

export const PATH_RECOVERY_BUDGET: PathSuggestionBudget = { maxVisited: 4000, maxDirs: 400, maxDepth: 12, maxMs: 1500 };

export const PATH_RECOVERY_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.vite', '.turbo', '.pnpm-store']);

export interface PathSuggestion {
  rel: string;
  isDirectory: boolean;
  score: number;
}

export interface FindPathSuggestionsOptions {
  rootDir: string;
  score: (rel: string) => number;
  directoriesOnly?: boolean;
  include?: (rel: string, isDirectory: boolean) => boolean;
  budget?: Partial<PathSuggestionBudget>;
}

export interface PathSuggestionScan {
  suggestions: PathSuggestion[];
  visited: number;
  dirsOpened: number;
  exhausted: boolean;
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export async function scanPathSuggestions(opts: FindPathSuggestionsOptions): Promise<PathSuggestionScan> {
  const budget: PathSuggestionBudget = { ...PATH_RECOVERY_BUDGET, ...(opts.budget || {}) };
  const deadline = Date.now() + budget.maxMs;
  const suggestions: PathSuggestion[] = [];
  // Dirent does not flag Windows junctions as symlinks, so every directory is
  // checked by realpath: anything resolving outside the real root is skipped.
  const realRoot = await fs.promises.realpath(opts.rootDir).catch(() => path.resolve(opts.rootDir));
  const normalizeCase = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const isInsideRoot = async (abs: string): Promise<boolean> => {
    const real = await fs.promises.realpath(abs).catch(() => null);
    if (!real) return false;
    const r = normalizeCase(real);
    const root = normalizeCase(realRoot);
    return r === root || r.startsWith(root + path.sep);
  };
  const queue: Array<{ abs: string; depth: number }> = [{ abs: opts.rootDir, depth: 0 }];
  let visited = 0;
  let dirsOpened = 0;
  let exhausted = false;
  // Entry budget only; the directory budget is checked before each open so the
  // last allowed directory (e.g. the root when maxDirs=1) is still scanned.
  const entriesExhausted = (): boolean => visited >= budget.maxVisited || Date.now() >= deadline;

  while (queue.length > 0) {
    if (dirsOpened >= budget.maxDirs || entriesExhausted()) {
      exhausted = true;
      break;
    }
    const current = queue.shift()!;
    dirsOpened += 1;
    let handle: fs.Dir;
    try {
      handle = await fs.promises.opendir(current.abs);
    } catch {
      continue;
    }
    try {
      for await (const entry of handle) {
        if (entriesExhausted()) {
          exhausted = true;
          break;
        }
        visited += 1;
        if (entry.isSymbolicLink()) continue;
        const isDirectory = entry.isDirectory();
        if (isDirectory && PATH_RECOVERY_SKIP_DIRS.has(entry.name)) continue;
        // Junctions/symlinked dirs resolving outside the root are never entered or listed.
        if (isDirectory && !(await isInsideRoot(path.join(current.abs, entry.name)))) continue;
        const abs = path.join(current.abs, entry.name);
        const rel = path.relative(opts.rootDir, abs).replace(/\\/g, '/');
        const accepted = (isDirectory || entry.isFile())
          && (!opts.directoriesOnly || isDirectory)
          && (!opts.include || opts.include(rel, isDirectory));
        if (accepted) {
          const score = opts.score(rel);
          if (score > 0) suggestions.push({ rel, isDirectory, score });
        }
        if (isDirectory && current.depth + 1 <= budget.maxDepth) {
          queue.push({ abs, depth: current.depth + 1 });
        }
      }
    } catch {
      // Permission or read error mid-iteration: keep what was collected.
    } finally {
      await handle.close().catch(() => undefined);
    }
    await yieldToEventLoop();
  }

  return { suggestions, visited, dirsOpened, exhausted };
}

export async function findPathSuggestions(opts: FindPathSuggestionsOptions): Promise<PathSuggestion[]> {
  const scan = await scanPathSuggestions(opts);
  return scan.suggestions.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length);
}
