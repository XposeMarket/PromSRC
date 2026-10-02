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
    | { kind: 'skip_binary' }
    | { kind: 'no_match' }
    | { kind: 'content'; rel: string; content: string };

  // Decoding every file to a JS string was the dominant cost: a PromSRC-wide
  // search read 0.7s of bytes but spent ~2.4s turning 207 MB (PNGs, bundles,
  // HTML captures) into UTF-16. Now: read a Buffer, skip binaries the way
  // ripgrep does (NUL byte in the first 8 KB), and for case-sensitive literal
  // patterns do a byte-level indexOf before decoding anything.
  const literalNeedle = options.matcher.mode === 'literal' && !options.matcher.caseInsensitive && options.matcher.pattern
    ? Buffer.from(options.matcher.pattern, 'utf8')
    : null;
  const BINARY_SNIFF_BYTES = 8000;

  const probeFile = async (abs: string, rel: string): Promise<FileProbe> => {
    let fileSize = 0;
    try {
      fileSize = (await fs.promises.stat(abs)).size;
    } catch {
      return { kind: 'skip_error' };
    }
    if (fileSize > options.maxFileBytes) return { kind: 'skip_large', rel, bytes: fileSize };
    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(abs);
    } catch {
      return { kind: 'skip_error' };
    }
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: 'skip_binary' };
    if (literalNeedle && buffer.indexOf(literalNeedle) === -1) return { kind: 'no_match' };
    return { kind: 'content', rel, content: buffer.toString('utf8') };
  };

  const consumeProbe = (probe: FileProbe, fallbackName: string): void => {
    if (probe.kind === 'skip_error') return;
    if (probe.kind === 'skip_binary') { filesSkipped += 1; return; }
    if (probe.kind === 'no_match') { filesSearched += 1; return; }
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

  // Phase 1: enumerate the tree breadth-first with many directories in flight.
  // The walk is almost entirely I/O wait (a CPU profile of a 6.5k-file repo
  // search was 97% idle), so serial readdir + 12-wide file reads left the disk
  // underused: 4.5-4.9s for PromSRC. Enumeration is now concurrent, and file
  // reads run through a shared pool. Results are still consumed in a stable
  // depth-first order so limits and output ordering stay deterministic.
  const DIR_CONCURRENCY = 16;
  type DirNode = { dir: string; depth: number; files: Array<{ abs: string; rel: string; name: string }>; children: DirNode[] };
  const rootNode: DirNode = { dir: options.searchDir, depth: 0, files: [], children: [] };

  const enumerate = async (node: DirNode): Promise<void> => {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(node.dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = path.join(node.dir, entry.name);
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
        if (node.depth + 1 > options.maxDepth) {
          maxDepthReached = true;
          filesSkipped += 1;
          continue;
        }
        node.children.push({ dir: abs, depth: node.depth + 1, files: [], children: [] });
        continue;
      }
      if (!entry.isFile()) continue;
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
      node.files.push({ abs, rel, name: entry.name });
    }
  };

  {
    let frontier: DirNode[] = [rootNode];
    let enumeratedEntries = 0;
    while (frontier.length && !shouldStopEnumeration()) {
      const next: DirNode[] = [];
      for (let i = 0; i < frontier.length; i += DIR_CONCURRENCY) {
        if (shouldStopEnumeration()) break;
        const batch = frontier.slice(i, i + DIR_CONCURRENCY);
        await Promise.all(batch.map((node) => enumerate(node)));
        for (const node of batch) {
          enumeratedEntries += node.files.length;
          next.push(...node.children);
        }
        await yieldToGateway();
        // Stop discovering more of the tree once far more files are known
        // than the file budget can ever visit.
        if (enumeratedEntries > options.maxFiles * 2) break;
      }
      frontier = enumeratedEntries > options.maxFiles * 2 ? [] : next;
    }
  }

  function shouldStopEnumeration(): boolean {
    if (stopReason !== 'completed') return true;
    if (options.signal?.aborted) { stopReason = 'aborted'; return true; }
    if (Date.now() - startedAt >= options.maxDurationMs) { stopReason = 'time_limit'; return true; }
    return false;
  }

  // Phase 2: flatten in depth-first order (the old walker's order: a
  // directory's files, then its subdirectories), apply globs/path-only, and
  // honor the visited-file budget exactly as before.
  const ordered: Array<{ abs: string; rel: string; name: string }> = [];
  const flatten = (node: DirNode): void => {
    for (const file of node.files) {
      if (filesVisited >= options.maxFiles) return;
      filesVisited += 1;
      if (!matchesGlobList(file.rel, options.globs)) continue;
      if (options.pathOnly) {
        if (pathMatchesSearch(file.rel, options.matcher)) {
          totalMatchesObserved += 1;
          pathMatches.push(file.rel || file.name);
        }
        continue;
      }
      ordered.push(file);
    }
    for (const child of node.children) {
      if (filesVisited >= options.maxFiles) return;
      flatten(child);
    }
  };
  flatten(rootNode);
  if (filesVisited >= options.maxFiles && stopReason === 'completed') stopReason = 'file_limit';
  if (options.pathOnly && pathMatches.length >= options.storeLimit && stopReason === 'completed') stopReason = 'result_limit';

  // Phase 3: read + match with a bounded pool. Probes are consumed strictly in
  // order, so match ordering and the result limit are identical to a serial scan.
  const shouldStopDrain = (): boolean => {
    if (stopReason !== 'completed' && stopReason !== 'file_limit') return true;
    if (options.signal?.aborted) { stopReason = 'aborted'; return true; }
    if (Date.now() - startedAt >= options.maxDurationMs) { stopReason = 'time_limit'; return true; }
    const collected = options.pathOnly ? pathMatches.length : matches.length;
    if (collected >= options.storeLimit) { stopReason = 'result_limit'; return true; }
    return false;
  };
  if (!options.pathOnly) {
    const READ_CONCURRENCY = Math.max(FILE_CONCURRENCY, 32);
    const pending: Array<Promise<FileProbe> | undefined> = new Array(ordered.length);
    let launched = 0;
    const launch = (): void => {
      while (launched < ordered.length && launched < consumedIndex + READ_CONCURRENCY) {
        const file = ordered[launched];
        pending[launched] = probeFile(file.abs, file.rel);
        launched += 1;
      }
    };
    let consumedIndex = 0;
    launch();
    for (; consumedIndex < ordered.length; consumedIndex++) {
      if (shouldStopDrain()) break;
      const probe = await pending[consumedIndex]!;
      pending[consumedIndex] = undefined;
      consumeProbe(probe, ordered[consumedIndex].name);
      launch();
      if (consumedIndex % 64 === 63) await yieldToGateway();
    }
    // Let any in-flight reads settle quietly; their results are discarded.
    await Promise.allSettled(pending.filter(Boolean) as Array<Promise<FileProbe>>);
  }
  void shouldStop;

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
