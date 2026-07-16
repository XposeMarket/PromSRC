import fs from 'fs';
import path from 'path';
import {
  collectGrepMatchesInText,
  matchesGlobList,
  shouldSkipSearchPath,
  type GrepMatchRecord,
  type SearchMatcher,
} from '../tools/file-intelligence';

export type WorkspaceSearchStopReason =
  | 'completed'
  | 'result_limit'
  | 'file_limit'
  | 'time_limit'
  | 'depth_limit'
  | 'aborted';

export type BoundedWorkspaceSearchOptions = {
  searchDir: string;
  displayRoot: string;
  matcher: SearchMatcher;
  globs: string[];
  excludes: Set<string>;
  gitignoreRules: string[];
  maxResults: number;
  storeLimit: number;
  maxFileBytes: number;
  maxFiles: number;
  maxDurationMs: number;
  maxDepth: number;
  contextLines: number;
  before: number;
  after: number;
  charBefore?: number;
  charAfter?: number;
  charWindow?: number;
  includeLockfiles: boolean;
  pathOnly: boolean;
  signal?: AbortSignal;
};

export type BoundedWorkspaceSearchResult = {
  matches: GrepMatchRecord[];
  pathMatches: string[];
  totalMatchesObserved: number;
  filesSearched: number;
  filesVisited: number;
  filesSkipped: number;
  filesSkippedTooLarge: number;
  skippedLargeSamples: Array<{ path: string; bytes: number }>;
  elapsedMs: number;
  truncated: boolean;
  stopReason: WorkspaceSearchStopReason;
  filesRemainingUnknown: boolean;
  maxDepthReached: boolean;
};

function pathMatchesSearch(rel: string, matcher: SearchMatcher): boolean {
  matcher.regex.lastIndex = 0;
  return matcher.regex.test(rel);
}

export async function runBoundedWorkspaceSearch(
  options: BoundedWorkspaceSearchOptions,
): Promise<BoundedWorkspaceSearchResult> {
  const startedAt = Date.now();
  const matches: GrepMatchRecord[] = [];
  const pathMatches: string[] = [];
  let totalMatchesObserved = 0;
  let filesSearched = 0;
  let filesVisited = 0;
  let filesSkipped = 0;
  let filesSkippedTooLarge = 0;
  let filesystemOps = 0;
  let maxDepthReached = false;
  let stopReason: WorkspaceSearchStopReason = 'completed';
  const skippedLargeSamples: Array<{ path: string; bytes: number }> = [];

  const shouldStop = (): boolean => {
    if (stopReason !== 'completed') return true;
    if (options.signal?.aborted) {
      stopReason = 'aborted';
      return true;
    }
    if (Date.now() - startedAt >= options.maxDurationMs) {
      stopReason = 'time_limit';
      return true;
    }
    if (filesVisited >= options.maxFiles) {
      stopReason = 'file_limit';
      return true;
    }
    const collected = options.pathOnly ? pathMatches.length : matches.length;
    if (collected >= options.storeLimit) {
      stopReason = 'result_limit';
      return true;
    }
    return false;
  };

  const yieldToGateway = async (): Promise<void> => {
    filesystemOps += 1;
    if (filesystemOps % 16 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (shouldStop()) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      await yieldToGateway();
      if (shouldStop()) return;
      const abs = path.join(dir, entry.name);
      const relForIgnore = path.relative(options.searchDir, abs).replace(/\\/g, '/');
      const rel = path.join(options.displayRoot === '.' ? '' : options.displayRoot, relForIgnore).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (shouldSkipSearchPath(relForIgnore, entry.name, {
          excludes: options.excludes,
          gitignoreRules: options.gitignoreRules,
        })) {
          filesSkipped += 1;
          continue;
        }
        if (depth >= options.maxDepth) {
          maxDepthReached = true;
          filesSkipped += 1;
          continue;
        }
        await walk(abs, depth + 1);
        if (shouldStop()) return;
        continue;
      }
      if (!entry.isFile()) continue;
      filesVisited += 1;
      if (shouldSkipSearchPath(relForIgnore, entry.name, {
        excludes: options.excludes,
        gitignoreRules: options.gitignoreRules,
      })) {
        filesSkipped += 1;
        continue;
      }
      if (!options.includeLockfiles && /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i.test(rel)) {
        filesSkipped += 1;
        continue;
      }
      if (!matchesGlobList(rel, options.globs)) continue;
      if (options.pathOnly) {
        if (pathMatchesSearch(rel, options.matcher)) {
          totalMatchesObserved += 1;
          pathMatches.push(rel || entry.name);
        }
        continue;
      }
      let fileSize = 0;
      try {
        fileSize = (await fs.promises.stat(abs)).size;
      } catch {
        continue;
      }
      if (fileSize > options.maxFileBytes) {
        filesSkipped += 1;
        filesSkippedTooLarge += 1;
        if (skippedLargeSamples.length < 12) {
          skippedLargeSamples.push({ path: rel || entry.name, bytes: fileSize });
        }
        continue;
      }
      let content = '';
      try {
        content = await fs.promises.readFile(abs, 'utf-8');
      } catch {
        continue;
      }
      filesSearched += 1;
      const grep = collectGrepMatchesInText(rel || entry.name, content, options.matcher, {
        maxResults: Math.max(1, options.storeLimit - matches.length),
        contextLines: options.contextLines,
        before: options.before,
        after: options.after,
        charBefore: options.charBefore,
        charAfter: options.charAfter,
        charWindow: options.charWindow,
      });
      totalMatchesObserved += grep.totalMatches;
      if (matches.length < options.storeLimit) {
        matches.push(...grep.matches.slice(0, Math.max(0, options.storeLimit - matches.length)));
      }
    }
  };

  await walk(options.searchDir, 0);
  if (stopReason === 'completed' && maxDepthReached) stopReason = 'depth_limit';
  const truncated = stopReason !== 'completed';
  return {
    matches,
    pathMatches,
    totalMatchesObserved,
    filesSearched,
    filesVisited,
    filesSkipped,
    filesSkippedTooLarge,
    skippedLargeSamples,
    elapsedMs: Date.now() - startedAt,
    truncated,
    stopReason,
    filesRemainingUnknown: truncated,
    maxDepthReached,
  };
}
