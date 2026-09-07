import fs from 'fs';
import path from 'path';
import { fork, type ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';

type StartAuditMaterializerOpts = {
  workspacePath: string;
  configDir: string;
  intervalMs?: number;
};

type MirrorFile = {
  srcAbs: string;
  destRel: string;
  domain: string;
};

export type AuditMaterializerLimits = {
  maxSingleFileBytes: number;
  maxTotalBytes: number;
  maxFilesPerRun: number;
  maxLineBytes: number;
  maxMetadataBytes: number;
};

export type AuditMaterializerStats = {
  copied: number;
  skipped: number;
  errors: number;
  redactions: number;
  filesDiscovered: number;
  filesConsidered: number;
  deferred: number;
  skippedTooLarge: number;
  deleted: number;
  bytesRead: number;
  bytesWritten: number;
  durationMs: number;
  excludedPrefixes: string[];
};

export type AuditMaterializerRunResult = {
  disabled: boolean;
  auditRoot: string;
  limits: AuditMaterializerLimits;
  stats: AuditMaterializerStats;
};

const REDACTION_SCHEMA_VERSION = 1;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'apikey', 'apitoken', 'authtoken', 'accesstoken', 'refreshtoken',
  'idtoken', 'clientsecret', 'privatekey', 'bottoken', 'gatewaytoken', 'desktoptoken', 'webhooktoken',
  'authorization', 'proxyauthorization', 'cookie', 'cookies', 'setcookie', 'credential', 'credentials',
]);

function scrubAuditText(value: string): { value: string; redactions: number } {
  let redactions = 0;
  let output = String(value || '');
  const replace = (pattern: RegExp, replacement: string): void => {
    output = output.replace(pattern, (...args: any[]) => { redactions += 1; return typeof replacement === 'string' ? replacement : args[0]; });
  };
  replace(/\b(Bearer)\s+[^\s"'<>]+/gi, '$1 [REDACTED]');
  replace(/\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|bot[_-]?token|webhook[_-]?token|cookie)\s*[:=]\s*([^\s&,;"']+)/gi, '$1=[REDACTED]');
  replace(/([?&](?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|cookie)=)[^&#\s]*/gi, '$1[REDACTED]');
  return { value: output, redactions };
}

function redactAuditValue(value: any, parentKey = ''): { value: any; redactions: number } {
  if (typeof value === 'string') return scrubAuditText(value);
  if (Array.isArray(value)) {
    let redactions = 0;
    const out = value.map((item) => { const next = redactAuditValue(item, parentKey); redactions += next.redactions; return next.value; });
    return { value: out, redactions };
  }
  if (!value || typeof value !== 'object') return { value, redactions: 0 };
  let redactions = 0;
  const out: Record<string, any> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SENSITIVE_KEYS.has(normalized)) { out[key] = REDACTED; redactions += 1; continue; }
    if (normalized === 'env' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const envOut: Record<string, any> = {};
      for (const [envKey, envValue] of Object.entries(raw as any)) {
        if (/(?:key|token|secret|password|credential|auth|cookie)/i.test(envKey)) { envOut[envKey] = REDACTED; redactions += 1; }
        else { const next = redactAuditValue(envValue, envKey); envOut[envKey] = next.value; redactions += next.redactions; }
      }
      out[key] = envOut;
      continue;
    }
    const next = redactAuditValue(raw, key);
    out[key] = next.value;
    redactions += next.redactions;
  }
  return { value: out, redactions };
}

function isTruthyEnv(name: string): boolean {
  return /^(?:1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
}

function normalizeMirrorPrefix(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized === 'tool-observations' ? 'chats/tool-observations' : normalized;
}

function getExcludedMirrorPrefixes(): string[] {
  const configured = process.env[MATERIALIZER_EXCLUDE_DOMAINS_ENV];
  if (configured !== undefined) {
    return [...new Set(configured.split(',').map(normalizeMirrorPrefix).filter((value) => value && value !== 'none'))];
  }
  if (isTruthyEnv(MATERIALIZER_INCLUDE_TOOL_OBSERVATIONS_ENV)) return [];
  // The raw observation corpus is append-only and can be many gigabytes. Keep
  // it available in the canonical store, but do not mirror it by default.
  return ['chats/tool-observations'];
}

function isMirrorPrefixExcluded(destRel: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => destRel === prefix || destRel.startsWith(`${prefix}/`));
}

export function isAuditMaterializerDisabled(): boolean {
  return isTruthyEnv(MATERIALIZER_DISABLED_ENV);
}

export function getAuditMaterializerLimits(): AuditMaterializerLimits {
  return {
    maxSingleFileBytes: boundedInt(process.env[MATERIALIZER_MAX_SINGLE_FILE_BYTES_ENV], DEFAULT_MAX_SINGLE_FILE_BYTES, 64 * 1024, 128 * 1024 * 1024),
    maxTotalBytes: boundedInt(process.env[MATERIALIZER_MAX_TOTAL_BYTES_ENV], DEFAULT_MAX_TOTAL_BYTES, 1 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxFilesPerRun: boundedInt(process.env[MATERIALIZER_MAX_FILES_ENV], DEFAULT_MAX_FILES_PER_RUN, 1, 50_000),
    maxLineBytes: boundedInt(process.env[MATERIALIZER_MAX_LINE_BYTES_ENV], DEFAULT_MAX_LINE_BYTES, 8 * 1024, 16 * 1024 * 1024),
    maxMetadataBytes: boundedInt(process.env[MATERIALIZER_MAX_METADATA_BYTES_ENV], DEFAULT_MAX_METADATA_BYTES, 32 * 1024, 16 * 1024 * 1024),
  };
}

type StreamLinesResult = {
  bytesRead: number;
  lines: number;
  oversizedLines: number;
};

export function streamLinesSync(filePath: string, maxLineBytes: number, onLine: (line: string, truncated: boolean) => void): StreamLinesResult {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let position = 0;
  let pending = '';
  let discardingOversizedLine = false;
  let oversizedSample = '';
  let bytesRead = 0;
  let lines = 0;
  let oversizedLines = 0;

  const emit = (line: string, truncated: boolean): void => {
    const value = line.endsWith('\r') ? line.slice(0, -1) : line;
    onLine(value, truncated);
    lines += 1;
  };

  const feed = (text: string): void => {
    let remaining = text;
    while (remaining.length || pending.length || discardingOversizedLine) {
      if (discardingOversizedLine) {
        const newline = remaining.indexOf('\n');
        if (newline < 0) return;
        emit(`${oversizedSample} ...[truncated]`, true);
        oversizedSample = '';
        discardingOversizedLine = false;
        remaining = remaining.slice(newline + 1);
        continue;
      }

      pending += remaining;
      remaining = '';
      const newline = pending.indexOf('\n');
      if (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        emit(line, false);
        continue;
      }

      if (Buffer.byteLength(pending, 'utf8') > maxLineBytes) {
        oversizedLines += 1;
        oversizedSample = Buffer.from(pending, 'utf8').subarray(0, maxLineBytes).toString('utf8');
        pending = '';
        discardingOversizedLine = true;
      }
      return;
    }
  };

  try {
    while (true) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (!count) break;
      position += count;
      bytesRead += count;
      feed(decoder.write(buffer.subarray(0, count)));
    }
    const decodedTail = decoder.end();
    if (decodedTail) feed(decodedTail);
    if (discardingOversizedLine) {
      emit(`${oversizedSample} ...[truncated]`, true);
    } else if (pending.length) {
      emit(pending, false);
    }
  } finally {
    fs.closeSync(fd);
  }

  return { bytesRead, lines, oversizedLines };
}

type StreamedMaterialization = {
  outputBytes: number;
  inputBytes: number;
  redactions: number;
  parseStatus: string;
};

function materializeRedactedFile(filePath: string, destAbs: string, limits: AuditMaterializerLimits): StreamedMaterialization {
  ensureDir(path.dirname(destAbs));
  const tempPath = `${destAbs}.tmp-${process.pid}-${Date.now()}`;
  const outputFd = fs.openSync(tempPath, 'w');
  let outputBytes = 0;
  let outputBuffer = '';
  let outputBufferBytes = 0;
  let redactions = 0;
  let inputBytes = 0;
  let parseStatus = 'text';
  let closed = false;

  const writeOutput = (value: string): void => {
    if (!value) return;
    const valueBytes = Buffer.byteLength(value, 'utf8');
    outputBytes += valueBytes;
    outputBuffer += value;
    outputBufferBytes += valueBytes;
    if (outputBufferBytes >= 64 * 1024) {
      fs.writeSync(outputFd, outputBuffer);
      outputBuffer = '';
      outputBufferBytes = 0;
    }
  };

  const flushOutput = (): void => {
    if (!outputBuffer) return;
    fs.writeSync(outputFd, outputBuffer);
    outputBuffer = '';
    outputBufferBytes = 0;
  };

  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
      const raw = fs.readFileSync(filePath, 'utf8');
      inputBytes = Buffer.byteLength(raw, 'utf8');
      const parsed = JSON.parse(raw);
      const clean = redactAuditValue(parsed);
      redactions += clean.redactions;
      parseStatus = 'json';
      writeOutput(`${JSON.stringify(clean.value, null, 2)}\n`);
    } else if (ext === '.jsonl' || ext === '.ndjson') {
      let malformed = false;
      const streamed = streamLinesSync(filePath, limits.maxLineBytes, (line, truncated) => {
        if (!line.length) return;
        try {
          if (truncated) throw new Error('line truncated');
          const clean = redactAuditValue(JSON.parse(line));
          redactions += clean.redactions;
          writeOutput(`${JSON.stringify(clean.value)}\n`);
        } catch {
          malformed = true;
          const clean = scrubAuditText(line);
          redactions += clean.redactions;
          writeOutput(`${clean.value}\n`);
        }
      });
      inputBytes = streamed.bytesRead;
      parseStatus = malformed || streamed.oversizedLines ? 'jsonl_partial' : 'jsonl';
    } else {
      const streamed = streamLinesSync(filePath, limits.maxLineBytes, (line) => {
        const clean = scrubAuditText(line);
        redactions += clean.redactions;
        writeOutput(`${clean.value}\n`);
      });
      inputBytes = streamed.bytesRead;
      parseStatus = 'text';
    }

    flushOutput();
    fs.closeSync(outputFd);
    closed = true;
    try {
      fs.renameSync(tempPath, destAbs);
    } catch {
      // Replacing a derived snapshot is safe; the canonical source remains
      // untouched. This fallback is needed on Windows when the destination
      // already exists and rename does not replace it.
      fs.rmSync(destAbs, { force: true });
      fs.renameSync(tempPath, destAbs);
    }
    return { outputBytes, inputBytes, redactions, parseStatus };
  } catch (error) {
    if (!closed) {
      try { fs.closeSync(outputFd); } catch { /* best effort */ }
    }
    try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

type SessionPreview = {
  id: string;
  mtimeMs: number;
  lastActiveAt?: number;
  title?: string;
  channel?: string;
  messageCount?: number;
  goalStatus?: string;
  historyLength?: number;
  hasSummary: boolean;
};

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 5 * 60_000;
const INITIAL_DELAY_MS = 5 * 60_000;
const COUNT_CAP = 5_000;
const MAX_PREVIEW_ROWS = 80;
const DEFAULT_MAX_SINGLE_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_FILES_PER_RUN = 2_000;
const DEFAULT_MAX_LINE_BYTES = 1 * 1024 * 1024;
const DEFAULT_MAX_METADATA_BYTES = 512 * 1024;
const MAX_MATERIALIZER_BACKOFF_MS = 60 * 60_000;
const MATERIALIZER_DISABLED_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_DISABLED';
const MATERIALIZER_EXCLUDE_DOMAINS_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_EXCLUDE_DOMAINS';
const MATERIALIZER_INCLUDE_TOOL_OBSERVATIONS_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_INCLUDE_TOOL_OBSERVATIONS';
const MATERIALIZER_MAX_SINGLE_FILE_BYTES_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_MAX_SINGLE_FILE_BYTES';
const MATERIALIZER_MAX_TOTAL_BYTES_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_MAX_TOTAL_BYTES';
const MATERIALIZER_MAX_FILES_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_MAX_FILES_PER_RUN';
const MATERIALIZER_MAX_LINE_BYTES_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_MAX_LINE_BYTES';
const MATERIALIZER_MAX_METADATA_BYTES_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_MAX_METADATA_BYTES';
const MATERIALIZER_CHILD_ENV = 'PROMETHEUS_AUDIT_MATERIALIZER_CHILD';
const DEFAULT_CHILD_MAX_OLD_SPACE_MB = 768;
const DEFAULT_CHILD_TIMEOUT_MS = 4 * 60_000;

let _timer: NodeJS.Timeout | null = null;
let _running = false;
let _lastRunAt = 0;
let _intervalMs: number | null = null;
let _failureStreak = 0;
let _backoffUntil = 0;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeJson(filePath: string, data: unknown): void {
  writeText(filePath, JSON.stringify(data, null, 2));
}

function readJson<T>(filePath: string, maxBytes = DEFAULT_MAX_METADATA_BYTES): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeRel(absPath: string, root: string): string {
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  return rel.startsWith('../') ? path.basename(absPath) : rel;
}

function* listFilesRecursive(rootDir: string): Generator<string> {
  if (!fs.existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        yield abs;
      }
    }
  }
}

function normalizePathForCompare(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

function isExcludedSourcePath(absPath: string, workspacePath: string): boolean {
  const full = normalizePathForCompare(absPath);
  const excluded = [
    path.join(workspacePath, 'teams'),
    path.join(workspacePath, '.prometheus', 'subagents'),
  ].map(normalizePathForCompare);
  return excluded.some((prefix) => full === prefix || full.startsWith(`${prefix}/`));
}

type MirrorCollection = {
  mirrors: MirrorFile[];
  excludedPrefixes: string[];
};

function collectMirrorFiles(configDir: string, workspacePath: string): MirrorCollection {
  const mirrors: MirrorFile[] = [];
  const excludedPrefixes = getExcludedMirrorPrefixes();

  const pushFile = (srcAbs: string, destRel: string, domain: string): void => {
    if (!fs.existsSync(srcAbs)) return;
    if (isExcludedSourcePath(srcAbs, workspacePath)) return;
    mirrors.push({ srcAbs, destRel, domain });
  };

  const pushDir = (srcDir: string, destPrefix: string, domain: string): void => {
    if (isMirrorPrefixExcluded(destPrefix, excludedPrefixes)) return;
    if (!fs.existsSync(srcDir)) return;
    for (const abs of listFilesRecursive(srcDir)) {
      if (isExcludedSourcePath(abs, workspacePath)) continue;
      const rel = safeRel(abs, srcDir);
      pushFile(abs, path.posix.join(destPrefix, rel), domain);
    }
  };

  pushDir(path.join(configDir, 'sessions'), 'chats/sessions', 'chats');
  pushDir(path.join(configDir, 'tool-observations'), 'chats/tool-observations', 'chats');
  pushDir(path.join(configDir, 'projects'), 'projects/state', 'projects');
  pushDir(path.join(configDir, 'tasks'), 'tasks/state', 'tasks');
  pushDir(path.join(workspacePath, 'proposals'), 'proposals/state', 'proposals');
  pushDir(path.join(workspacePath, 'diagnostics', 'incidents'), 'diagnostics/incidents', 'diagnostics');

  pushFile(path.join(configDir, 'cron', 'jobs.json'), 'cron/jobs/jobs.json', 'cron');
  pushDir(path.join(configDir, 'cron', 'runs'), 'cron/runs', 'cron');

  pushDir(path.join(configDir, 'schedules'), 'schedules/state', 'schedules');

  pushFile(path.join(configDir, 'managed-teams.json'), 'teams/state/managed-teams.json', 'teams');
  pushDir(path.join(configDir, 'team-state'), 'teams/state/team-state', 'teams');

  pushFile(path.join(configDir, 'connections.json'), 'connections/state/connections.json', 'connections');
  pushFile(path.join(configDir, 'connections-activity.jsonl'), 'connections/state/connections-activity.jsonl', 'connections');
  pushFile(path.join(configDir, 'integrations-state.json'), 'connections/state/integrations-state.json', 'connections');

  pushFile(path.join(configDir, 'restart-context.json'), 'restarts/state/restart-context.json', 'restarts');
  pushFile(path.join(configDir, 'startup-notifications.json'), 'startup/state/startup-notifications.json', 'startup');
  pushFile(path.join(workspacePath, '.prometheus', 'boot-md-state.json'), 'startup/state/boot-md-state.json', 'startup');

  pushDir(path.join(workspacePath, 'memory'), 'memory/files', 'memory');
  pushFile(path.join(workspacePath, 'USER.md'), 'memory/root/USER.md', 'memory');
  pushFile(path.join(workspacePath, 'SOUL.md'), 'memory/root/SOUL.md', 'memory');
  pushFile(path.join(workspacePath, 'MEMORY.md'), 'memory/root/MEMORY.md', 'memory');

  pushFile(path.join(configDir, 'audit-log.jsonl'), 'system/audit/audit-log.jsonl', 'system');
  pushDir(path.join(configDir, 'logs'), 'system/logs', 'system');

  // System configs (avoid duplicating encrypted/secret vault material)
  const systemFiles = [
    'config.json',
    'mcp-servers.json',
    'policy-rules.json',
    'workspace_state.json',
    'site-shortcuts.json',
    'facts.json',
    'self_learning.json',
    'update_state.json',
  ];
  for (const file of systemFiles) {
    pushFile(path.join(configDir, file), `system/state/${file}`, 'system');
  }

  return { mirrors, excludedPrefixes };
}

function readManifest(manifestPath: string): any {
  const parsed = readJson<any>(manifestPath, 64 * 1024 * 1024);
  return parsed?.entries ? parsed : { entries: {} };
}

function createMirrorStats(excludedPrefixes: string[]): AuditMaterializerStats {
  return {
    copied: 0,
    skipped: 0,
    errors: 0,
    redactions: 0,
    filesDiscovered: 0,
    filesConsidered: 0,
    deferred: 0,
    skippedTooLarge: 0,
    deleted: 0,
    bytesRead: 0,
    bytesWritten: 0,
    durationMs: 0,
    excludedPrefixes,
  };
}

function copyMirrors(
  auditRoot: string,
  workspacePath: string,
  mirrors: MirrorFile[],
  manifestPath: string,
  excludedPrefixes: string[],
  limits: AuditMaterializerLimits,
): AuditMaterializerStats {
  const startedAt = Date.now();
  const prev = readManifest(manifestPath);
  const previousEntries: Record<string, any> = prev.entries && typeof prev.entries === 'object' ? prev.entries : {};
  // Start from the last good manifest. A budgeted/deferred run must not make
  // the derived mirror appear empty or delete snapshots that are still useful.
  const next: Record<string, any> = { ...previousEntries };
  const stats = createMirrorStats(excludedPrefixes);
  stats.filesDiscovered = mirrors.length;
  const seenKeys = new Set<string>();
  const candidates: Array<{ item: MirrorFile; key: string; previous: any; base: any; size: number; mtimeMs: number }> = [];

  for (const item of mirrors) {
    try {
      const srcStat = fs.statSync(item.srcAbs);
      if (!srcStat.isFile()) continue;
      const key = item.destRel;
      seenKeys.add(key);
      const previous = previousEntries[key];
      const sourceModifiedAt = new Date(srcStat.mtimeMs).toISOString();
      const base = {
        ...previous,
        domain: item.domain,
        canonicalStore: item.srcAbs.startsWith(workspacePath) ? 'workspace' : 'config',
        canonicalRel: item.srcAbs.startsWith(workspacePath) ? safeRel(item.srcAbs, workspacePath) : path.basename(item.srcAbs),
        sourceModifiedAt,
        sourceSize: srcStat.size,
        materializedAt: previous?.materializedAt || null,
        redactionSchemaVersion: REDACTION_SCHEMA_VERSION,
      };
      next[key] = base;

      const unchanged =
        previous &&
        previous.deferred !== true &&
        previous.sourceModifiedAt === sourceModifiedAt &&
        previous.sourceSize === srcStat.size &&
        previous.redactionSchemaVersion === REDACTION_SCHEMA_VERSION;
      const destAbs = path.join(auditRoot, item.destRel);
      if (unchanged && fs.existsSync(destAbs)) {
        stats.skipped += 1;
        continue;
      }

      stats.filesConsidered += 1;
      candidates.push({ item, key, previous, base, size: srcStat.size, mtimeMs: srcStat.mtimeMs });
    } catch {
      stats.errors += 1;
    }
  }

  // Re-try deferred work first, then process the newest changed files. This
  // makes a bounded run useful even when old content is still backlogged.
  candidates.sort((a, b) => {
    const deferredDelta = Number(b.previous?.deferred === true) - Number(a.previous?.deferred === true);
    return deferredDelta || b.mtimeMs - a.mtimeMs;
  });

  for (const candidate of candidates) {
    const { item, key, base, size } = candidate;
    const destAbs = path.join(auditRoot, item.destRel);
    if (size > limits.maxSingleFileBytes) {
      stats.skippedTooLarge += 1;
      next[key] = {
        ...base,
        deferred: false,
        parseStatus: 'skipped_too_large',
        skipReason: 'single_file_limit',
      };
      continue;
    }
    if (stats.copied >= limits.maxFilesPerRun || stats.bytesRead + size > limits.maxTotalBytes) {
      stats.deferred += 1;
      next[key] = {
        ...base,
        deferred: true,
        skipReason: stats.copied >= limits.maxFilesPerRun ? 'file_budget' : 'byte_budget',
      };
      continue;
    }

    stats.bytesRead += size;
    try {
      const materialized = materializeRedactedFile(item.srcAbs, destAbs, limits);
      next[key] = {
        ...base,
        deferred: false,
        materializedAt: new Date().toISOString(),
        outputSize: materialized.outputBytes,
        redactions: materialized.redactions,
        parseStatus: materialized.parseStatus,
        artifactRole: 'redacted_snapshot',
        sourceOfTruth: false,
      };
      stats.redactions += materialized.redactions;
      stats.bytesWritten += materialized.outputBytes;
      stats.copied += 1;
    } catch {
      stats.errors += 1;
      stats.deferred += 1;
      next[key] = { ...base, deferred: true, skipReason: 'materialization_error' };
    }
  }

  const auditRootResolved = path.resolve(auditRoot);
  const auditRootPrefix = `${auditRootResolved}${path.sep}`;
  for (const oldRel of Object.keys(previousEntries)) {
    if (seenKeys.has(oldRel) || isMirrorPrefixExcluded(oldRel, excludedPrefixes)) continue;
    delete next[oldRel];
    const target = path.resolve(auditRoot, oldRel);
    if (target.startsWith(auditRootPrefix)) {
      try { fs.rmSync(target, { force: true }); stats.deleted += 1; } catch { /* best effort */ }
    }
  }

  writeJson(manifestPath, {
    schemaVersion: 2,
    redactionSchemaVersion: REDACTION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    entries: next,
  });
  stats.durationMs = Math.max(0, Date.now() - startedAt);
  return stats;
}

function buildDirectoryScaffold(auditRoot: string): void {
  const dirs = [
    '_index',
    'chats/sessions',
    'chats/transcripts',
    'chats/compactions',
    'chats/continuity',
    'projects/state',
    'tasks/state',
    'background-tasks',
    'proposals/state',
    'diagnostics/incidents',
    'cron/jobs',
    'cron/runs',
    'schedules/state',
    'teams/state',
    'connections/state',
    'restarts/state',
    'startup/state',
    'memory/files',
    'memory/root',
    'system/state',
    'system/audit',
    'system/logs',
  ];
  for (const rel of dirs) ensureDir(path.join(auditRoot, rel));
}

function buildAuditReadme(auditRoot: string): void {
  const lines = [
    '# Audit Directory',
    '',
    'This directory is a one-way redacted materialized mirror for observability.',
    '',
    '- Canonical runtime stores remain in `.prometheus/` and `workspace/`.',
    '- Files under `workspace/audit/` are snapshots for debugging and review.',
    '- Snapshots may lag live state; `_index/global.json` records freshness and provenance.',
    '- Canonical runtime stores and live tools remain the source of truth.',
    '- Sensitive structural fields and labeled secret values are redacted during materialization.',
    '- Team/subagent workspaces are intentionally not mirrored here.',
    '',
    '## Navigation',
    '',
    '- `_index/` global indexes and run metadata',
    '- `chats/` session snapshots, transcripts, compaction artifacts, and immediate continuity journals',
    '- `projects/` project state snapshots',
    '- `tasks/` task/background-task state snapshots',
    '- `proposals/` proposal timeline/state snapshots',
    '- `diagnostics/` sanitized structured incident packets',
    '- `cron/` cron scheduler config and run history',
    '- `schedules/` schedule memory and per-run logs',
    '- `teams/` managed-team state and run metadata (not workspace files)',
    '- `connections/` connector state and activity logs',
    '- `restarts/` restart context snapshots',
    '- `startup/` startup-notification and boot state snapshots',
    '- `memory/` memory markdown snapshots (intraday + USER.md/SOUL.md/MEMORY.md root snapshots)',
    '- `system/` selected system config, audit, and logs',
  ];
  writeText(path.join(auditRoot, 'README.md'), `${lines.join('\n')}\n`);
}

function buildSessionPreview(configDir: string): SessionPreview[] {
  const sessionsDir = path.join(configDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];

  const files = fs
    .readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(sessionsDir, f));

  const withMtime = files
    .map((file) => {
      try {
        return { file, mtimeMs: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((v): v is { file: string; mtimeMs: number } => !!v)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_PREVIEW_ROWS);

  const out: SessionPreview[] = [];
  for (const item of withMtime) {
    const data = readJson<any>(item.file);
    out.push({
      id: path.basename(item.file, '.json'),
      mtimeMs: item.mtimeMs,
      lastActiveAt: Number(data?.lastActiveAt) || undefined,
      title: typeof data?.title === 'string' ? data.title.slice(0, 160) : undefined,
      channel: typeof data?.channel === 'string' ? data.channel.slice(0, 40) : undefined,
      messageCount: Array.isArray(data?.history) ? data.history.length : undefined,
      goalStatus: typeof data?.mainChatGoal?.status === 'string' ? data.mainChatGoal.status.slice(0, 40) : undefined,
      historyLength: Array.isArray(data?.history) ? data.history.length : undefined,
      hasSummary: !!String(data?.latestContextSummary || '').trim(),
    });
  }
  return out;
}

function buildTasksSummary(configDir: string): { total: number; byStatus: Record<string, number> } {
  const tasksDir = path.join(configDir, 'tasks');
  if (!fs.existsSync(tasksDir)) return { total: 0, byStatus: {} };
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json') && !f.endsWith('.bus.json') && f !== '_index.json');
  const byStatus: Record<string, number> = {};
  for (const file of files) {
    const data = readJson<any>(path.join(tasksDir, file));
    const status = String(data?.status || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return { total: files.length, byStatus };
}

function buildProposalsSummary(workspacePath: string): { total: number; byBucket: Record<string, number> } {
  const root = path.join(workspacePath, 'proposals');
  const buckets = ['pending', 'approved', 'denied', 'archive'];
  const byBucket: Record<string, number> = {};
  let total = 0;
  for (const bucket of buckets) {
    const dir = path.join(root, bucket);
    if (!fs.existsSync(dir)) {
      byBucket[bucket] = 0;
      continue;
    }
    const count = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    byBucket[bucket] = count;
    total += count;
  }
  return { total, byBucket };
}

function buildTeamsSummary(configDir: string): { teamCount: number; totalRuns: number } {
  const data = readJson<any>(path.join(configDir, 'managed-teams.json'));
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  let totalRuns = 0;
  for (const t of teams) {
    totalRuns += Array.isArray(t?.runHistory) ? t.runHistory.length : 0;
  }
  return { teamCount: teams.length, totalRuns };
}

function countFiles(rootDir: string, cap = COUNT_CAP): number {
  if (!fs.existsSync(rootDir)) return 0;
  let count = 0;
  const stack = [rootDir];
  while (stack.length > 0 && count < cap) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= cap) break;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function writeIndexes(
  auditRoot: string,
  configDir: string,
  workspacePath: string,
  mirrors: MirrorFile[],
  mirrorStats: AuditMaterializerStats,
  limits: AuditMaterializerLimits,
): void {
  const nowIso = new Date().toISOString();
  const sessionPreview = buildSessionPreview(configDir);
  const tasksSummary = buildTasksSummary(configDir);
  const proposalsSummary = buildProposalsSummary(workspacePath);
  const teamsSummary = buildTeamsSummary(configDir);

  const byDomain: Record<string, number> = {};
  for (const item of mirrors) {
    byDomain[item.domain] = (byDomain[item.domain] || 0) + 1;
  }

  const globalIndex = {
    generatedAt: nowIso,
    artifactRole: 'redacted_snapshot',
    sourceOfTruth: false,
    provenance: 'materialized_mirror',
    freshness: {
      status: mirrorStats.errors ? 'error' : (mirrorStats.deferred || mirrorStats.skippedTooLarge || mirrorStats.excludedPrefixes.length ? 'partial' : 'fresh'),
      lastAttemptAt: nowIso,
      lastSuccessfulRunAt: mirrorStats.errors ? null : nowIso,
      expectedIntervalMs: _intervalMs,
      redactionSchemaVersion: REDACTION_SCHEMA_VERSION,
    },
    materializer: {
      intervalMs: _intervalMs,
      lastRunAt: _lastRunAt,
      filesMirrored: mirrors.length,
      copied: mirrorStats.copied,
      skipped: mirrorStats.skipped,
      errors: mirrorStats.errors,
      redactions: mirrorStats.redactions,
      filesDiscovered: mirrorStats.filesDiscovered,
      filesConsidered: mirrorStats.filesConsidered,
      deferred: mirrorStats.deferred,
      skippedTooLarge: mirrorStats.skippedTooLarge,
      deleted: mirrorStats.deleted,
      bytesRead: mirrorStats.bytesRead,
      bytesWritten: mirrorStats.bytesWritten,
      durationMs: mirrorStats.durationMs,
      excludedPrefixes: mirrorStats.excludedPrefixes,
      limits,
    },
    counts: {
      sessionsPreviewed: sessionPreview.length,
      tasks: tasksSummary.total,
      proposals: proposalsSummary.total,
      teams: teamsSummary.teamCount,
      teamRuns: teamsSummary.totalRuns,
      chatTranscripts: countFiles(path.join(auditRoot, 'chats', 'transcripts')),
      chatCompactions: countFiles(path.join(auditRoot, 'chats', 'compactions')),
    },
    byDomain,
  };

  writeJson(path.join(auditRoot, '_index', 'global.json'), globalIndex);
  writeJson(path.join(auditRoot, '_index', 'sessions-preview.json'), sessionPreview);
  writeJson(path.join(auditRoot, '_index', 'tasks-summary.json'), tasksSummary);
  writeJson(path.join(auditRoot, '_index', 'proposals-summary.json'), proposalsSummary);
  writeJson(path.join(auditRoot, '_index', 'teams-summary.json'), teamsSummary);

  const navLines = [
    '# Audit Index',
    '',
    `Generated: ${nowIso}`,
    '',
    '## Quick Links',
    '- chats/sessions/',
    '- chats/transcripts/',
    '- chats/compactions/',
    '- chats/continuity/',
    '- projects/state/',
    '- tasks/state/',
    '- proposals/state/',
    '- cron/jobs/ and cron/runs/',
    '- schedules/state/',
    '- teams/state/',
    '- connections/state/',
    '- restarts/state/',
    '- startup/state/',
    '- memory/files/',
    '- system/state/, system/audit/, system/logs/',
    '',
    '## Current Counts',
    `- mirrored files: ${mirrors.length}`,
    `- copied this run: ${mirrorStats.copied}`,
    `- skipped unchanged: ${mirrorStats.skipped}`,
    `- errors: ${mirrorStats.errors}`,
    `- deferred by budget: ${mirrorStats.deferred}`,
    `- skipped too large: ${mirrorStats.skippedTooLarge}`,
    `- bytes read: ${mirrorStats.bytesRead}`,
    `- bytes written: ${mirrorStats.bytesWritten}`,
    `- tasks: ${tasksSummary.total}`,
    `- proposals: ${proposalsSummary.total}`,
    `- teams: ${teamsSummary.teamCount}`,
    `- transcript files: ${countFiles(path.join(auditRoot, 'chats', 'transcripts'))}`,
  ];
  writeText(path.join(auditRoot, '_index', 'README.md'), `${navLines.join('\n')}\n`);

  const chatsMd = [
    '# Chats Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Sessions mirrored: ${byDomain.chats || 0}`,
    `- Transcript files: ${countFiles(path.join(auditRoot, 'chats', 'transcripts'))}`,
    `- Compaction artifacts: ${countFiles(path.join(auditRoot, 'chats', 'compactions'))}`,
    `- Continuity journals: ${countFiles(path.join(auditRoot, 'chats', 'continuity'))}`,
    '',
    '## Recent Sessions',
    ...sessionPreview.map((s) => {
      const active = s.lastActiveAt ? new Date(s.lastActiveAt).toISOString() : 'unknown';
      const msgs = Number.isFinite(Number(s.historyLength)) ? String(s.historyLength) : 'n/a';
      return `- ${s.id} | messages=${msgs} | lastActive=${active} | summary=${s.hasSummary ? 'yes' : 'no'}`;
    }),
  ];
  writeText(path.join(auditRoot, 'chats', 'INDEX.md'), `${chatsMd.join('\n')}\n`);

  const tasksMd = [
    '# Tasks Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Total task records: ${tasksSummary.total}`,
    '## By Status',
    ...Object.entries(tasksSummary.byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => `- ${status}: ${count}`),
  ];
  writeText(path.join(auditRoot, 'tasks', 'INDEX.md'), `${tasksMd.join('\n')}\n`);

  const propsMd = [
    '# Proposals Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Total proposals: ${proposalsSummary.total}`,
    ...Object.entries(proposalsSummary.byBucket).map(([bucket, count]) => `- ${bucket}: ${count}`),
  ];
  writeText(path.join(auditRoot, 'proposals', 'INDEX.md'), `${propsMd.join('\n')}\n`);

  const teamsMd = [
    '# Teams Index',
    '',
    `Generated: ${nowIso}`,
    '',
    `- Managed teams: ${teamsSummary.teamCount}`,
    `- Recorded team runs: ${teamsSummary.totalRuns}`,
    '- Note: team/subagent workspace files are intentionally excluded from this audit mirror.',
  ];
  writeText(path.join(auditRoot, 'teams', 'INDEX.md'), `${teamsMd.join('\n')}\n`);
}

export function materializeAuditSnapshot(configDir: string, workspacePath: string): AuditMaterializerRunResult {
  const auditRoot = path.join(workspacePath, 'audit');
  const limits = getAuditMaterializerLimits();
  if (isAuditMaterializerDisabled()) {
    return {
      disabled: true,
      auditRoot,
      limits,
      stats: createMirrorStats(getExcludedMirrorPrefixes()),
    };
  }
  buildDirectoryScaffold(auditRoot);
  buildAuditReadme(auditRoot);

  const collection = collectMirrorFiles(configDir, workspacePath);
  const manifestPath = path.join(auditRoot, '_index', 'materializer-manifest.json');
  const mirrorStats = copyMirrors(auditRoot, workspacePath, collection.mirrors, manifestPath, collection.excludedPrefixes, limits);
  _lastRunAt = Date.now();
  writeIndexes(auditRoot, configDir, workspacePath, collection.mirrors, mirrorStats, limits);
  return { disabled: false, auditRoot, limits, stats: mirrorStats };
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function materializerChildExecArgv(): string[] {
  const maxOldSpaceMb = boundedInt(
    process.env.PROMETHEUS_AUDIT_MATERIALIZER_MAX_OLD_SPACE_MB,
    DEFAULT_CHILD_MAX_OLD_SPACE_MB,
    256,
    2 * 1024,
  );
  return [
    ...process.execArgv.filter((arg) => !/^--max[-_]old[-_]space[-_]size(?:=|$)/i.test(arg)),
    `--max-old-space-size=${maxOldSpaceMb}`,
  ];
}

export function createAuditMaterializerProcess(opts: StartAuditMaterializerOpts, intervalMs: number): ChildProcess {
  const data = {
    type: 'prometheus_audit_materializer',
    workspacePath: opts.workspacePath,
    configDir: opts.configDir,
    intervalMs,
  };
  return fork(__filename, [], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [MATERIALIZER_CHILD_ENV]: Buffer.from(JSON.stringify(data), 'utf8').toString('base64url'),
    },
    execArgv: materializerChildExecArgv(),
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
}

function materializerBackoffMs(intervalMs: number, failureStreak: number): number {
  const exponent = Math.max(0, Math.min(8, failureStreak - 1));
  return Math.min(MAX_MATERIALIZER_BACKOFF_MS, Math.max(intervalMs, intervalMs * (2 ** exponent)));
}

export function startAuditMaterializer(opts: StartAuditMaterializerOpts): void {
  const intervalMs = Math.max(MIN_INTERVAL_MS, Number(opts.intervalMs || DEFAULT_INTERVAL_MS));
  if (_timer) return;
  if (isAuditMaterializerDisabled()) {
    console.warn(`[AuditMaterializer] Disabled by ${MATERIALIZER_DISABLED_ENV}.`);
    return;
  }
  _intervalMs = intervalMs;

  const runSafe = (): void => {
    if (_running || isAuditMaterializerDisabled() || Date.now() < _backoffUntil) return;
    _running = true;
    let settled = false;
    let childFailed = false;
    let stderrTail = '';
    let timeout: NodeJS.Timeout | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      _running = false;
    };
    const finishChild = (success: boolean, reason = '') => {
      if (settled) return;
      if (timeout) clearTimeout(timeout);
      if (success) {
        _failureStreak = 0;
        _backoffUntil = 0;
      } else {
        _failureStreak += 1;
        const backoffMs = materializerBackoffMs(intervalMs, _failureStreak);
        _backoffUntil = Date.now() + backoffMs;
        const detail = [reason, stderrTail.trim()].filter(Boolean).join(' | ').slice(0, 2_000);
        console.warn(`[AuditMaterializer] Run failed; backing off for ${backoffMs}ms${detail ? `: ${detail}` : '.'}`);
      }
      finish();
    };
    try {
      // The audit mirror can parse and redact tens of megabytes of append-only
      // logs and rebuild a very large manifest. A worker_thread still owns
      // memory inside the gateway process; repeated one-shot isolates caused
      // their released 16 MB V8 segments to remain committed to the gateway.
      // A capped child process gives the OS a hard reclamation boundary.
      const child = createAuditMaterializerProcess(opts, intervalMs);
      const timeoutMs = boundedInt(
        process.env.PROMETHEUS_AUDIT_MATERIALIZER_TIMEOUT_MS,
        DEFAULT_CHILD_TIMEOUT_MS,
        30_000,
        Math.max(30_000, intervalMs - 5_000),
      );
      timeout = setTimeout(() => {
        childFailed = true;
        console.warn(`[AuditMaterializer] Child exceeded ${timeoutMs}ms and was terminated.`);
        try { child.kill(); } catch {}
        finishChild(false, 'timeout');
      }, timeoutMs);
      timeout.unref?.();
      child.unref();
      child.channel?.unref?.();
      child.stderr?.on('data', (chunk) => {
        if (stderrTail.length >= 8_192) return;
        stderrTail += String(chunk).slice(0, 8_192 - stderrTail.length);
      });
      child.on('message', (message: any) => {
        if (message?.ok === false) {
          childFailed = true;
          console.warn('[AuditMaterializer] Child sync failed:', String(message?.error || 'unknown error'));
        } else if (message?.telemetry) {
          console.log(`[AuditMaterializer] telemetry=${JSON.stringify(message.telemetry)}`);
        }
      });
      child.on('error', (err) => {
        childFailed = true;
        console.warn('[AuditMaterializer] Child failed:', String(err?.message || err));
        finishChild(false, String(err?.message || err));
      });
      child.on('exit', (code) => {
        const success = code === 0 && !childFailed;
        if (!success) console.warn(`[AuditMaterializer] Child exited with code ${code}`);
        finishChild(success, `exit_code_${String(code)}`);
      });
    } catch (err: any) {
      console.warn('[AuditMaterializer] Could not start worker:', String(err?.message || err));
      _failureStreak += 1;
      _backoffUntil = Date.now() + materializerBackoffMs(intervalMs, _failureStreak);
      finish();
    }
  };

  const initialDelay = Math.min(INITIAL_DELAY_MS, intervalMs);
  const initialTimer = setTimeout(runSafe, initialDelay);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();
  _timer = setInterval(runSafe, intervalMs);
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log(`[AuditMaterializer] Started (interval=${intervalMs}ms)`);
}

export function stopAuditMaterializer(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _intervalMs = null;
  _running = false;
  _failureStreak = 0;
  _backoffUntil = 0;
}

function readMaterializerChildData(): any | null {
  const encoded = String(process.env[MATERIALIZER_CHILD_ENV] || '').trim();
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const materializerChildData = readMaterializerChildData();
if (materializerChildData?.type === 'prometheus_audit_materializer') {
  let exitCode = 0;
  let message: Record<string, unknown> = { ok: true };
  try {
    _intervalMs = Number(materializerChildData.intervalMs) || DEFAULT_INTERVAL_MS;
    const result = materializeAuditSnapshot(String(materializerChildData.configDir || ''), String(materializerChildData.workspacePath || ''));
    message = {
      ok: true,
      disabled: result.disabled,
      telemetry: { ...result.stats, limits: result.limits },
    };
  } catch (err: any) {
    exitCode = 1;
    message = { ok: false, error: String(err?.message || err) };
  }
  const exit = () => {
    try { process.disconnect?.(); } catch {}
    process.exit(exitCode);
  };
  if (typeof process.send === 'function' && process.connected) {
    try { process.send(message, exit); } catch { exit(); }
  } else {
    exit();
  }
}
