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
    if (filesystemOps % 32 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };

  // Files within a directory are stat+read with bounded concurrency instead of
  // one-at-a-time. The old fully serial walker (await stat, await readFile per
  // file) starved whenever the gateway event loop was busy: the same src/ query
  // took 31.7s for 2 files under load vs 0.46s for 827 files idle. Results are
  // still collected in directory order so limits stay deterministic.
  const FILE_CONCURRENCY = 12;

  type FileProbe =
    | { kind: 'skip_large'; rel: string; bytes: number }
    | { kind: 'skip_error' }
    | { kind: 'content'; rel: string; content: string };

  const probeFile = async (abs: string, rel: string): Promise<FileProbe> => {
    let fileSize = 0;
    try {
      fileSize = (await fs.promises.stat(abs)).size;
    } catch {
      return { kind: 'skip_error' };
    }
    if (fileSize > options.maxFileBytes) return { kind: 'skip_large', rel, bytes: fileSize };
    try {
      const content = await fs.promises.readFile(abs, 'utf-8');
      return { kind: 'content', rel, content };
    } catch {
      return { kind: 'skip_error' };
    }
  };

  const consumeProbe = (probe: FileProbe, fallbackName: string): void => {
    if (probe.kind === 'skip_error') return;
    if (probe.kind === 'skip_large') {
      filesSkipped += 1;
      filesSkippedTooLarge += 1;
      if (skippedLargeSamples.length < 12) {
        skippedLargeSamples.push({ path: probe.rel || fallbackName, bytes: probe.bytes });
      }
      return;
    }
    filesSearched += 1;
    const grep = collectGrepMatchesInText(probe.rel || fallbackName, probe.content, options.matcher, {
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
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (shouldStop()) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    const pendingFiles: Array<{ abs: string; rel: string; name: string }> = [];

    for (const entry of entries) {
      // Enumeration stops on abort/time/result limits but NOT on the file
      // limit: files admitted here are drained below before the file limit is
      // re-checked, so a directory that lands exactly on maxFiles still gets
      // searched instead of being enumerated and then discarded.
      if (stopReason !== 'completed') return;
      if (options.signal?.aborted) { stopReason = 'aborted'; return; }
      if (Date.now() - startedAt >= options.maxDurationMs) { stopReason = 'time_limit'; return; }
      if (filesVisited >= options.maxFiles) break;
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
        subdirs.push(abs);
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
      pendingFiles.push({ abs, rel, name: entry.name });
    }

    // Files admitted during enumeration above are always drained, even if the
    // enumeration pass itself pushed filesVisited to maxFiles. Only abort,
    // time, and result limits interrupt the drain; the file limit is re-checked
    // once the directory's admitted files are consumed. Otherwise a directory
    // that exactly fills the file budget would enumerate and then search zero
    // of its files.
    const shouldStopDrain = (): boolean => {
      if (stopReason !== 'completed') return true;
      if (options.signal?.aborted) { stopReason = 'aborted'; return true; }
      if (Date.now() - startedAt >= options.maxDurationMs) { stopReason = 'time_limit'; return true; }
      const collected = options.pathOnly ? pathMatches.length : matches.length;
      if (collected >= options.storeLimit) { stopReason = 'result_limit'; return true; }
      return false;
    };
    for (let i = 0; i < pendingFiles.length; i += FILE_CONCURRENCY) {
      if (shouldStopDrain()) return;
      const chunk = pendingFiles.slice(i, i + FILE_CONCURRENCY);
      const probes = await Promise.all(chunk.map((f) => probeFile(f.abs, f.rel)));
      for (let j = 0; j < probes.length; j++) {
        if (shouldStopDrain()) return;
        consumeProbe(probes[j], chunk[j].name);
      }
      await yieldToGateway();
    }
    if (shouldStop()) return;

    for (const sub of subdirs) {
      if (shouldStop()) return;
      await walk(sub, depth + 1);
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
