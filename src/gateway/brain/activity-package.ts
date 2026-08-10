/**
 * Canonical, redacted activity package for Brain Thoughts.
 *
 * The package is assembled from the durable runtime stores immediately before
 * the Thought model call.  It deliberately does not use workspace/audit: that
 * directory is a lagging materialized view and is not complete for all runtime
 * lanes.  The package uses a half-open UTC window, [start, end), so adjacent
 * windows cannot double count an event at their shared boundary.
 *
 * Large windows are represented by an inline, model-sized ledger plus direct
 * continuation JSONL files.  Every discovered event is in either the inline
 * ledger or a continuation; a source error, missing store, mtime shortcut, or
 * continuation write failure is recorded in the package manifest.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';

export const ACTIVITY_PACKAGE_SCHEMA = 'prometheus.thoughts.activity-package.v1';
export const ACTIVITY_WINDOW_BOUNDARY = '[start,end)';

const MAX_INLINE_CHARS = 120_000;
const MAX_EVENT_DETAIL_CHARS = 1_200;
const MAX_FILES_PER_SOURCE = 120_000;
const MAX_SOURCE_ERRORS = 40;
const MAX_STORES_PER_SOURCE = 32;
const MAX_WALK_DEPTH = 12;
const MAX_UNRESOLVED_ITEMS = 200;
const SECRET_KEY_RE = /(password|token|secret|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|set-cookie)/i;
const SENSITIVE_PATH_RE = /(^|[\\/])(vault|credentials?|secrets?)([\\/]|$)/i;

export interface ActivityPackageWindow {
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  timezone: 'UTC';
  boundary: typeof ACTIVITY_WINDOW_BOUNDARY;
}

export interface ActivityProvenance {
  source: string;
  store: string;
  ref: string;
  recordId?: string;
  line?: number;
  timeField?: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  type: string;
  actor?: string;
  entity?: Record<string, string>;
  summary: string;
  details?: Record<string, unknown>;
  provenance: ActivityProvenance[];
  redacted: true;
}

export interface ActivitySourceCoverage {
  source: string;
  status: 'ok' | 'empty' | 'partial' | 'failed' | 'not_configured';
  stores: string[];
  filesVisited: number;
  filesParsed: number;
  filesSkippedByMtime: number;
  recordsScanned: number;
  eventsDiscovered: number;
  eventsIncluded: number;
  duplicateRecords: number;
  errors: string[];
  pagination: {
    pageSize: number;
    pages: number;
    truncated: boolean;
    continuationRequired: boolean;
  };
  limitations: string[];
}

export interface ActivityUnresolvedWork {
  id: string;
  kind: string;
  status: string;
  summary: string;
  provenance: ActivityProvenance[];
  redacted: true;
}

export interface ActivityPackageMetrics {
  assemblyStartedAt: string;
  assemblyCompletedAt: string;
  assemblyLatencyMs: number;
  filesVisited: number;
  filesParsed: number;
  recordsScanned: number;
  eventsDiscovered: number;
  eventsIncluded: number;
  duplicateEvents: number;
  inlineEventCount: number;
  continuationEventCount: number;
  inlineChars: number;
  fullLedgerChars: number;
  packageChars: number;
  estimatedPackageTokens: number;
  continuationWriteFailures: number;
  sourceFailures: number;
  sourcePartial: number;
  thoughtSearchCalls?: number;
}

export interface ActivityPackage {
  schemaVersion: typeof ACTIVITY_PACKAGE_SCHEMA;
  packageId: string;
  correlationId?: string;
  window: ActivityPackageWindow;
  authority: 'canonical_runtime_stores';
  eventLedger: {
    complete: boolean;
    inline: ActivityEvent[];
    inlineSelection: 'all' | 'head_tail_sample';
    totalEvents: number;
    omittedFromInline: number;
    continuations: Array<{
      path: string;
      eventCount: number;
      sha256: string;
      directReadOnly: true;
    }>;
  };
  counts: Record<string, number>;
  sourceCoverage: ActivitySourceCoverage[];
  unresolvedWork: ActivityUnresolvedWork[];
  redaction: {
    applied: true;
    policy: 'secret-key-and-payload-redaction-v1';
    rawPayloadsIncluded: false;
    rawPayloadRefsIncluded: false;
    note: string;
  };
  completeness: {
    status: 'complete' | 'partial' | 'failed';
    omissions: string[];
    continuationRequired: boolean;
    directContextRule: 'do_not_search_covered_activity';
  };
  observability: {
    packagePath?: string;
    metricsPath?: string;
    searchCallsAtAssembly: 0;
    thoughtSearchCalls?: number;
    coveredActivitySearchCalls?: number;
  };
  metrics: ActivityPackageMetrics;
}

export interface BuildActivityPackageOptions {
  configDir: string;
  workspacePath: string;
  repoRoot?: string;
  start: Date | number;
  end: Date | number;
  correlationId?: string;
  outputDir?: string;
  metricsPath?: string;
  browserSessions?: unknown[];
}

export interface BuiltActivityPackage {
  package: ActivityPackage;
  packagePath?: string;
  continuationPaths: string[];
  metricsPath?: string;
}

interface SourceDefinition {
  name: string;
  roots: string[];
  mode?: 'json' | 'jsonl' | 'mixed';
  limitations?: string[];
}

interface MutableCoverage extends ActivitySourceCoverage {}

interface CollectorState {
  options: BuildActivityPackageOptions;
  startMs: number;
  endMs: number;
  repoRoot: string;
  eventsByIdentity: Map<string, ActivityEvent>;
  coverage: Map<string, MutableCoverage>;
  unresolved: Map<string, ActivityUnresolvedWork>;
  filesVisited: number;
  filesParsed: number;
  recordsScanned: number;
  discovered: number;
  duplicateEvents: number;
  continuationWriteFailures: number;
  unresolvedTruncated: boolean;
}

function epoch(value: unknown): number | null {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cleanText(value: unknown, max = 500): string {
  let text = typeof value === 'string' ? value : (() => {
    try { return JSON.stringify(value); } catch { return String(value ?? ''); }
  })();
  text = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/([?&](?:token|access_token|refresh_token|api_key|key|secret)=)[^&\s]+/gi, '$1[REDACTED]');
  text = text.replace(/\b(?:password|token|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]');
  return text.length <= max ? text : `${text.slice(0, max)} [...truncated]`;
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => scrub(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = '[REDACTED]';
      } else if (/^(raw|rawPayload|rawResult|rawResponse|credentialPayload)$/i.test(key)) {
        out[key] = '[OMITTED_RAW_PAYLOAD]';
      } else {
        out[key] = scrub(inner, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string') return cleanText(value, 1_000);
  return value;
}

function relativeRef(filePath: string, repoRoot: string): string {
  const relative = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  if (relative && !relative.startsWith('..')) return relative;
  return `external/${path.basename(filePath)}`;
}

function readId(record: Record<string, unknown>): string | undefined {
  for (const key of ['eventId', 'messageId', 'observationId', 'runId', 'taskId', 'scheduleId', 'sessionId', 'id']) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') return `${key}:${String(value)}`;
  }
  return undefined;
}

function readStableEventId(record: Record<string, unknown>): string | undefined {
  for (const key of ['eventId', 'messageId', 'observationId', 'runId', 'id']) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') return `${key}:${String(value)}`;
  }
  return undefined;
}

function findTimes(record: Record<string, unknown>): Array<{ field: string; ms: number }> {
  const fields = ['timestamp', 'createdAt', 'updatedAt', 'at', 't', 'startedAt', 'finishedAt', 'completedAt', 'eventAt', 'proposedAt', 'resolvedAt', 'lastRunStartedAt', 'lastRunAt', 'occurredAt'];
  const result: Array<{ field: string; ms: number }> = [];
  for (const field of fields) {
    const value = epoch(record[field]);
    if (value !== null) result.push({ field, ms: value });
  }
  return result;
}

function getSource(state: CollectorState, name: string, stores: string[] = [], limitations: string[] = []): MutableCoverage {
  const existing = state.coverage.get(name);
  if (existing) {
    for (const store of stores) {
      if (existing.stores.includes(store)) continue;
      if (existing.stores.length < MAX_STORES_PER_SOURCE) existing.stores.push(store);
      else if (!existing.limitations.includes(`source store list capped at ${MAX_STORES_PER_SOURCE}; event-level provenance remains complete`)) existing.limitations.push(`source store list capped at ${MAX_STORES_PER_SOURCE}; event-level provenance remains complete`);
    }
    for (const limitation of limitations) if (!existing.limitations.includes(limitation)) existing.limitations.push(limitation);
    return existing;
  }
  const created: MutableCoverage = {
    source: name,
    status: 'empty',
    stores: [...stores],
    filesVisited: 0,
    filesParsed: 0,
    filesSkippedByMtime: 0,
    recordsScanned: 0,
    eventsDiscovered: 0,
    eventsIncluded: 0,
    duplicateRecords: 0,
    errors: [],
    pagination: { pageSize: MAX_FILES_PER_SOURCE, pages: 1, truncated: false, continuationRequired: false },
    limitations: [...limitations],
  };
  state.coverage.set(name, created);
  return created;
}

function addSourceError(coverage: MutableCoverage, error: unknown): void {
  if (coverage.errors.length < MAX_SOURCE_ERRORS) coverage.errors.push(cleanText(error instanceof Error ? error.message : error, 400));
  coverage.status = 'partial';
}

function inferType(source: string, record: Record<string, unknown>, timeField: string): string {
  const raw = record.type || record.kind || record.event || record.messageKind || record.category || record.status;
  const suffix = typeof raw === 'string' && raw.trim() ? raw.trim().replace(/\s+/g, '_').slice(0, 80) : timeField;
  return `${source}.${suffix}`;
}

function pickActor(record: Record<string, unknown>): string | undefined {
  for (const key of ['actor', 'actorId', 'agentId', 'userId', 'ownerId', 'from', 'role']) {
    if (typeof record[key] === 'string' && record[key]) return cleanText(record[key], 120);
  }
  return undefined;
}

function pickEntity(record: Record<string, unknown>): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const key of ['sessionId', 'taskId', 'runId', 'threadId', 'teamId', 'agentId', 'scheduleId', 'processId', 'fileId', 'observationId']) {
    if (typeof record[key] === 'string' || typeof record[key] === 'number') result[key] = String(record[key]);
  }
  return Object.keys(result).length ? result : undefined;
}

function pickSummary(record: Record<string, unknown>, type: string): string {
  const values = ['summary', 'content', 'message', 'text', 'title', 'name', 'label', 'detail', 'reason', 'error', 'resultPreview', 'argsPreview', 'url'];
  const parts: string[] = [];
  for (const key of values) {
    if (record[key] !== undefined && record[key] !== null) {
      const value = cleanText(record[key], 420);
      if (value) parts.push(`${key}=${value}`);
      if (parts.length >= 2) break;
    }
  }
  return parts.length ? `${type}: ${parts.join(' | ')}` : type;
}

function pickDetails(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const allowed = new Set([
    'role', 'type', 'kind', 'status', 'toolName', 'category', 'taskId', 'sessionId', 'runId', 'threadId', 'teamId', 'agentId', 'scheduleId',
    'processId', 'filePath', 'path', 'pathsTouched', 'url', 'title', 'error', 'reason', 'summary', 'content', 'message', 'resultPreview', 'argsPreview',
    'exitCode', 'durationMs', 'stepNum', 'source', 'action', 'operation', 'channel', 'ownerType', 'ownerId', 'workspacePath',
  ]);
  const selected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (allowed.has(key)) selected[key] = scrub(value);
  }
  if (!Object.keys(selected).length) return undefined;
  const encoded = JSON.stringify(selected);
  if (encoded.length <= MAX_EVENT_DETAIL_CHARS) return selected;
  return { excerpt: cleanText(encoded, MAX_EVENT_DETAIL_CHARS), truncated: true };
}

function identityFor(record: Record<string, unknown>, source: string, ref: ActivityProvenance, timeField: string, timeMs: number): string {
  const id = readStableEventId(record);
  if (id) return `${id}|${timeField}|${timeMs}`;
  const stable = {
    source,
    ref: ref.ref,
    line: ref.line,
    timeField,
    timeMs,
    type: record.type || record.kind || record.category || '',
    summary: pickSummary(record, source),
  };
  return stableHash(stable);
}

function addTimedRecord(state: CollectorState, sourceName: string, filePath: string, record: Record<string, unknown>, line?: number, parentTimeField?: string): void {
  const coverage = getSource(state, sourceName, [relativeRef(filePath, state.repoRoot)]);
  const times = findTimes(record);
  if (!times.length && parentTimeField) return;
  for (const time of times) {
    state.recordsScanned += 1;
    coverage.recordsScanned += 1;
    if (time.ms < state.startMs || time.ms >= state.endMs) continue;
    const provenance: ActivityProvenance = {
      source: sourceName,
      store: relativeRef(filePath, state.repoRoot),
      ref: `file:${relativeRef(filePath, state.repoRoot)}${line ? `#L${line}` : ''}`,
      recordId: readId(record),
      line,
      timeField: time.field,
    };
    const type = inferType(sourceName, record, time.field);
    const identity = identityFor(record, sourceName, provenance, time.field, time.ms);
    state.discovered += 1;
    coverage.eventsDiscovered += 1;
    const existing = state.eventsByIdentity.get(identity);
    if (existing) {
      existing.provenance.push(provenance);
      coverage.duplicateRecords += 1;
      state.duplicateEvents += 1;
      continue;
    }
    const event: ActivityEvent = {
      id: `evt_${stableHash(identity).slice(0, 20)}`,
      timestamp: new Date(time.ms).toISOString(),
      timestampMs: time.ms,
      type,
      actor: pickActor(record),
      entity: pickEntity(record),
      summary: pickSummary(record, type),
      details: pickDetails(record),
      provenance: [provenance],
      redacted: true,
    };
    state.eventsByIdentity.set(identity, event);
    coverage.eventsIncluded += 1;
  }
}

function shouldSkipKey(key: string): boolean {
  return /^(raw|rawPayload|rawResult|rawResponse|credentials?|secrets?|vault|attachments|binary|screenshots?)$/i.test(key);
}

function visitTimedRecords(state: CollectorState, sourceName: string, filePath: string, value: unknown, line?: number, location = '', depth = 0): void {
  if (depth > MAX_WALK_DEPTH || value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitTimedRecords(state, sourceName, filePath, item, line, `${location}[${index}]`, depth + 1));
    return;
  }
  const record = value as Record<string, unknown>;
  addTimedRecord(state, sourceName, filePath, record, line);
  for (const [key, child] of Object.entries(record)) {
    if (shouldSkipKey(key)) continue;
    if (child && typeof child === 'object') visitTimedRecords(state, sourceName, filePath, child, line, `${location}.${key}`, depth + 1);
  }
}

function walkFiles(root: string, out: string[], depth = 0): void {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_FILES_PER_SOURCE || !fs.existsSync(root)) return;
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES_PER_SOURCE) return;
    if (/^(raw|vault|node_modules|\.git|dist|build|\.cache|activity-packages)$/i.test(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, out, depth + 1);
    else if (entry.isFile()) out.push(full);
  }
}

function safeJsonRead(filePath: string): unknown {
  const stat = fs.statSync(filePath);
  if (stat.size > 50 * 1024 * 1024) throw new Error(`json file exceeds 50 MiB safety limit (${stat.size})`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function readJsonLines(state: CollectorState, sourceName: string, filePath: string): Promise<void> {
  const coverage = getSource(state, sourceName, [relativeRef(filePath, state.repoRoot)]);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        visitTimedRecords(state, sourceName, filePath, parsed, lineNumber);
      } catch (err) {
        addSourceError(coverage, `line ${lineNumber}: invalid JSON (${String(err)})`);
      }
    }
  } finally {
    lines.close();
    stream.close();
  }
}

function getSourceDefinitions(options: BuildActivityPackageOptions): SourceDefinition[] {
  const c = options.configDir;
  const w = options.workspacePath;
  const sources = (name: string, roots: string[], limitations: string[] = [], mode: SourceDefinition['mode'] = 'mixed'): SourceDefinition => ({ name, roots, limitations, mode });
  return [
    sources('chat_sessions', [path.join(c, 'sessions')], ['Session snapshots are read for timestamped messages and lifecycle fields.'], 'json'),
    sources('tool_calls', [path.join(c, 'tool-observations')], ['Raw tool payload directories are intentionally excluded; redacted observations and refs are included.'], 'jsonl'),
    sources('tasks', [path.join(c, 'tasks')], ['Task journals/evidence are included when timestamped; current unresolved tasks are separately listed.'], 'json'),
    sources('runs_and_schedules', [path.join(c, 'cron'), path.join(c, 'schedules'), path.join(c, 'agents'), path.join(c, 'workflows.json')], ['Schedule configuration is only an event when its persisted timestamp is in the window.'], 'mixed'),
    sources('managed_threads_and_teams', [path.join(c, 'managed-teams.json'), path.join(c, 'thread-supervisions.json'), path.join(w, 'teams')], ['Team workspace files are scanned as event-bearing state; no raw provider payloads are read.'], 'mixed'),
    sources('browser', [path.join(c, 'browser-sessions.json'), path.join(c, 'browser-activity'), path.join(c, 'connections-activity.json')], ['Browser registry snapshots and browser tool observations are included; historical DOM/screenshot payloads are not.'], 'mixed'),
    sources('files_and_workspace_changes', [path.join(w, '.prometheus', 'history'), path.join(c, 'dev-edits'), path.join(c, 'file-changes')], ['Filesystem mtime is observational; deletions are only authoritative when recorded by history/tool events.'], 'mixed'),
    sources('agents_and_subagents', [path.join(c, 'agent-chats'), path.join(w, '.prometheus', 'subagents'), path.join(c, 'config.json')], ['Agent identity files are represented by timestamped metadata, not secret configuration.'], 'mixed'),
    sources('runtime_and_errors', [path.join(c, 'runtimes'), path.join(c, 'runtime'), path.join(c, 'gateway-runtime-status.json'), path.join(c, 'model-runtime-status.json'), path.join(c, 'gateway-event-stalls'), path.join(c, 'errors'), path.join(c, 'error-history'), path.join(c, 'audit-log.jsonl')], ['Live runtime snapshots may lag by persistence cadence; source status exposes read failures.'], 'mixed'),
    sources('important_events_and_unresolved', [path.join(w, 'Brain'), path.join(w, 'events'), path.join(w, 'proposals'), path.join(w, 'diagnostics'), path.join(c, 'approvals.json'), path.join(c, 'questions.json'), path.join(c, 'heartbeat')], ['Open work is listed separately even if created before the six-hour event window.'], 'mixed'),
  ];
}

function isJsonl(filePath: string): boolean {
  return /\.(jsonl|ndjson)$/i.test(filePath);
}

function shouldReadFile(filePath: string, startMs: number): { read: boolean; skipped: boolean } {
  try {
    const stat = fs.statSync(filePath);
    // Small JSON snapshots are cheap to inspect and may carry an updated
    // embedded timestamp even when a surrounding registry write did not
    // advance its mtime. Keep the mtime shortcut for large histories and all
    // JSONL stores, where rescanning is materially expensive.
    if (/\.json$/i.test(filePath) && stat.size <= 256 * 1024) return { read: true, skipped: false };
    // A durable event cannot be written after the containing file's mtime.
    // This shortcut is explicit in source coverage and avoids rescanning the
    // multi-gigabyte historical observation store on every Thought.
    if (stat.mtimeMs < startMs) return { read: false, skipped: true };
    return { read: true, skipped: false };
  } catch {
    return { read: false, skipped: false };
  }
}

async function collectSource(state: CollectorState, definition: SourceDefinition): Promise<void> {
  const coverage = getSource(state, definition.name, [], definition.limitations || []);
  const files: string[] = [];
  for (const root of definition.roots) {
    if (!fs.existsSync(root)) continue;
    let stat: fs.Stats;
    try { stat = fs.statSync(root); } catch (err) { addSourceError(coverage, `${root}: ${String(err)}`); continue; }
    if (stat.isDirectory()) walkFiles(root, files);
    else files.push(root);
  }
  files.sort((a, b) => a.localeCompare(b));
  if (!files.length) {
    coverage.status = 'not_configured';
    return;
  }
  if (files.length >= MAX_FILES_PER_SOURCE) {
    coverage.pagination.truncated = true;
    coverage.pagination.continuationRequired = true;
    addSourceError(coverage, `file enumeration capped at ${MAX_FILES_PER_SOURCE}`);
  }
  for (const filePath of files) {
    if (SENSITIVE_PATH_RE.test(filePath)) continue;
    coverage.filesVisited += 1;
    state.filesVisited += 1;
    if (!/\.(json|jsonl|ndjson)$/i.test(filePath)) {
      if (!coverage.limitations.includes('Non-JSON files are covered by workspace mtime/history events, not parsed as structured records.')) {
        coverage.limitations.push('Non-JSON files are covered by workspace mtime/history events, not parsed as structured records.');
      }
      continue;
    }
    const decision = shouldReadFile(filePath, state.startMs);
    if (decision.skipped) { coverage.filesSkippedByMtime += 1; continue; }
    if (!decision.read) { addSourceError(coverage, `${relativeRef(filePath, state.repoRoot)}: stat failed`); continue; }
    try {
      coverage.filesParsed += 1;
      state.filesParsed += 1;
      if (isJsonl(filePath) || definition.mode === 'jsonl') await readJsonLines(state, definition.name, filePath);
      else visitTimedRecords(state, definition.name, filePath, safeJsonRead(filePath));
    } catch (err) {
      addSourceError(coverage, `${relativeRef(filePath, state.repoRoot)}: ${String(err)}`);
    }
  }
  if (!coverage.errors.length) coverage.status = coverage.eventsIncluded ? 'ok' : 'empty';
  else if (coverage.eventsIncluded) coverage.status = 'partial';
}

function addBrowserSnapshot(state: CollectorState): void {
  const sessions = state.options.browserSessions || [];
  const coverage = getSource(state, 'browser', ['live:browser-session-registry'], ['Live browser metadata is captured at package-build time; transient DOM is represented only by redacted tool observations.']);
  for (const session of sessions) {
    if (session && typeof session === 'object') visitTimedRecords(state, 'browser', 'live:browser-session-registry', session);
  }
  if (sessions.length) coverage.status = coverage.eventsIncluded ? 'ok' : 'empty';
}

function readUnresolved(state: CollectorState): void {
  const add = (kind: string, value: unknown, filePath: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const status = String(record.status || record.state || '').toLowerCase();
    const open = /^(queued|running|paused|stalled|needs_assistance|needs_input|blocked|pending|draft|active|in_progress|idea|proposed|interrupted|awaiting_)/.test(status);
    if (!open) return;
    const id = readId(record) || `hash:${stableHash({ kind, filePath, status, title: record.title, summary: record.summary })}`;
    const ref: ActivityProvenance = { source: 'unresolved', store: relativeRef(filePath, state.repoRoot), ref: `file:${relativeRef(filePath, state.repoRoot)}`, recordId: id };
    const item: ActivityUnresolvedWork = { id, kind, status, summary: pickSummary(record, `unresolved.${kind}`), provenance: [ref], redacted: true };
    const existing = state.unresolved.get(id);
    if (existing) {
      // A durable snapshot can repeat the same open entity across many
      // runtime/task files. Keep bounded provenance without allowing an
      // unresolved-work section to consume the model context.
      if (existing.provenance.length < 4) existing.provenance.push(ref);
    }
    else if (state.unresolved.size < MAX_UNRESOLVED_ITEMS) state.unresolved.set(id, item);
    else state.unresolvedTruncated = true;
  };
  const roots = [path.join(state.options.configDir, 'tasks'), path.join(state.options.configDir, 'runtimes'), path.join(state.options.configDir, 'approvals.json'), path.join(state.options.configDir, 'questions.json'), path.join(state.options.workspacePath, 'Brain', 'active-work.jsonl'), path.join(state.options.workspacePath, 'proposals')];
  for (const root of roots) {
    const files: string[] = [];
    if (!fs.existsSync(root)) continue;
    try { if (fs.statSync(root).isDirectory()) walkFiles(root, files); else files.push(root); } catch { continue; }
    for (const filePath of files.sort()) {
      try {
        if (isJsonl(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          for (const line of content.split(/\r?\n/)) { if (!line.trim()) continue; try { add(path.basename(root), JSON.parse(line), filePath); } catch { /* source parser records the operational error */ } }
        } else {
          const parsed = safeJsonRead(filePath);
          if (Array.isArray(parsed)) parsed.forEach((item) => add(path.basename(root), item, filePath));
          else add(path.basename(root), parsed, filePath);
        }
      } catch { /* the primary source coverage contains the read error */ }
    }
  }
}

function scanWorkspaceMtimes(state: CollectorState): void {
  const source = getSource(state, 'workspace_files', ['filesystem:workspace'], ['This source observes current file mtimes. It cannot prove an unrecorded deletion; history/tool events are the deletion authority.']);
  const files: string[] = [];
  walkFiles(state.options.workspacePath, files);
  for (const filePath of files) {
    const normalized = path.relative(state.options.workspacePath, filePath).replace(/\\/g, '/');
    if (/^(audit|\.prometheus\/audit|node_modules|\.git|dist|build|\.cache|Brain\/activity-packages)(\/|$)/i.test(normalized)) continue;
    try {
      const stat = fs.statSync(filePath);
      source.filesVisited += 1;
      state.filesVisited += 1;
      if (stat.mtimeMs < state.startMs || stat.mtimeMs >= state.endMs) continue;
      source.recordsScanned += 1;
      state.recordsScanned += 1;
      const record = { type: 'file_mtime_change', path: normalized, filePath: normalized, updatedAt: stat.mtimeMs, status: 'observed' };
      addTimedRecord(state, 'workspace_files', filePath, record);
    } catch (err) { addSourceError(source, `${normalized}: ${String(err)}`); }
  }
  if (!source.errors.length) source.status = source.eventsIncluded ? 'ok' : 'empty';
}

function sortEvents(events: ActivityEvent[]): ActivityEvent[] {
  return events.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
}

function eventCounts(events: ActivityEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function estimateTokens(chars: number): number { return Math.ceil(chars / 4); }

function appendJsonl(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8');
}

function writeActivityArtifacts(state: CollectorState, pkg: ActivityPackage, allEvents: ActivityEvent[]): { packagePath?: string; continuationPaths: string[] } {
  if (!state.options.outputDir) return { continuationPaths: [] };
  const outputDir = state.options.outputDir;
  const continuationDir = path.join(outputDir, 'continuations');
  fs.mkdirSync(continuationDir, { recursive: true });
  const continuationPaths: string[] = [];
  const inlineSet = new Set(pkg.eventLedger.inline.map((event) => event.id));
  const omitted = allEvents.filter((event) => !inlineSet.has(event.id));
  const partSize = 500;
  for (let index = 0; index < omitted.length; index += partSize) {
    const rows = omitted.slice(index, index + partSize);
    const filePath = path.join(continuationDir, `part-${String(Math.floor(index / partSize) + 1).padStart(4, '0')}.jsonl`);
    try {
      appendJsonl(filePath, rows);
      const raw = fs.readFileSync(filePath);
      pkg.eventLedger.continuations.push({ path: path.relative(state.options.workspacePath, filePath).replace(/\\/g, '/'), eventCount: rows.length, sha256: crypto.createHash('sha256').update(raw).digest('hex'), directReadOnly: true });
      continuationPaths.push(filePath);
    } catch (err) {
      state.continuationWriteFailures += 1;
      pkg.completeness.omissions.push(`continuation write failed for part ${Math.floor(index / partSize) + 1}: ${cleanText(err, 300)}`);
    }
  }
  const packagePath = path.join(outputDir, 'activity-package.json');
  try {
    fs.mkdirSync(path.dirname(packagePath), { recursive: true });
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    pkg.observability.packagePath = path.relative(state.options.workspacePath, packagePath).replace(/\\/g, '/');
    // Persist the final package path into the on-disk copy as well.
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  } catch (err) {
    state.continuationWriteFailures += 1;
    pkg.completeness.omissions.push(`package write failed: ${cleanText(err, 300)}`);
  }
  return { packagePath, continuationPaths };
}

function appendMetrics(pathname: string | undefined, metrics: ActivityPackageMetrics): void {
  if (!pathname) return;
  try { appendJsonl(pathname, [metrics]); } catch { /* observability must not break Thoughts */ }
}

export async function buildThoughtActivityPackage(options: BuildActivityPackageOptions): Promise<BuiltActivityPackage> {
  const started = Date.now();
  const startMs = epoch(options.start);
  const endMs = epoch(options.end);
  if (startMs === null || endMs === null || endMs <= startMs) throw new Error('Thought activity package requires a positive UTC window');
  const state: CollectorState = {
    options,
    startMs,
    endMs,
    repoRoot: options.repoRoot || process.cwd(),
    eventsByIdentity: new Map(),
    coverage: new Map(),
    unresolved: new Map(),
    filesVisited: 0,
    filesParsed: 0,
    recordsScanned: 0,
    discovered: 0,
    duplicateEvents: 0,
    continuationWriteFailures: 0,
    unresolvedTruncated: false,
  };
  for (const definition of getSourceDefinitions(options)) await collectSource(state, definition);
  addBrowserSnapshot(state);
  readUnresolved(state);
  scanWorkspaceMtimes(state);

  const events = sortEvents([...state.eventsByIdentity.values()]);
  const serializedEvents = JSON.stringify(events);
  let inline: ActivityEvent[] = [];
  let inlineSelection: ActivityPackage['eventLedger']['inlineSelection'] = 'all';
  let inlineChars = 2;
  for (const event of events) {
    const candidate = JSON.stringify([...inline, event]);
    if (candidate.length > MAX_INLINE_CHARS) break;
    inline.push(event);
  }
  if (inline.length < events.length) {
    inlineSelection = 'head_tail_sample';
    const half = Math.max(1, Math.floor((inline.length || 300) / 2));
    inline = [...events.slice(0, half), ...events.slice(-half)];
    const seen = new Set<string>();
    inline = inline.filter((event) => !seen.has(event.id) && seen.add(event.id));
  }
  inlineChars = JSON.stringify(inline).length;
  const window: ActivityPackageWindow = {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
    durationMs: endMs - startMs,
    timezone: 'UTC',
    boundary: ACTIVITY_WINDOW_BOUNDARY,
  };
  const sourceCoverage = [...state.coverage.values()].sort((a, b) => a.source.localeCompare(b.source));
  const omissions = sourceCoverage.flatMap((source) => source.errors.map((error) => `${source.source}: ${error}`));
  if (state.unresolvedTruncated) omissions.push(`unresolved work manifest capped at ${MAX_UNRESOLVED_ITEMS} items`);
  const continuationRequired = inline.length < events.length;
  if (continuationRequired && !options.outputDir) omissions.push('continuation output directory unavailable for oversized activity ledger');
  const metricsBase: ActivityPackageMetrics = {
    assemblyStartedAt: new Date(started).toISOString(),
    assemblyCompletedAt: new Date().toISOString(),
    assemblyLatencyMs: Date.now() - started,
    filesVisited: state.filesVisited,
    filesParsed: state.filesParsed,
    recordsScanned: state.recordsScanned,
    eventsDiscovered: state.discovered,
    eventsIncluded: events.length,
    duplicateEvents: state.duplicateEvents,
    inlineEventCount: inline.length,
    continuationEventCount: events.length - inline.length,
    inlineChars,
    fullLedgerChars: serializedEvents.length,
    packageChars: 0,
    estimatedPackageTokens: 0,
    continuationWriteFailures: 0,
    sourceFailures: sourceCoverage.filter((source) => source.status === 'failed').length,
    sourcePartial: sourceCoverage.filter((source) => source.status === 'partial').length,
  };
  const digestInput = { schema: ACTIVITY_PACKAGE_SCHEMA, window, events, sourceCoverage, unresolved: [...state.unresolved.values()] };
  const pkg: ActivityPackage = {
    schemaVersion: ACTIVITY_PACKAGE_SCHEMA,
    packageId: `ap_${stableHash(digestInput).slice(0, 24)}`,
    correlationId: options.correlationId,
    window,
    authority: 'canonical_runtime_stores',
    eventLedger: { complete: !continuationRequired, inline, inlineSelection, totalEvents: events.length, omittedFromInline: events.length - inline.length, continuations: [] },
    counts: eventCounts(events),
    sourceCoverage,
    unresolvedWork: [...state.unresolved.values()].sort((a, b) => a.id.localeCompare(b.id)),
    redaction: {
      applied: true,
      policy: 'secret-key-and-payload-redaction-v1',
      rawPayloadsIncluded: false,
      rawPayloadRefsIncluded: false,
      note: 'Credentials, tokens, cookies, secret-key values, raw tool payloads, and binary/screenshot payloads are omitted or redacted. Stable IDs and safe provenance refs remain.',
    },
    completeness: {
      status: omissions.length || state.continuationWriteFailures ? 'partial' : 'complete',
      omissions,
      continuationRequired,
      directContextRule: 'do_not_search_covered_activity',
    },
    observability: {
      packagePath: undefined,
      metricsPath: options.metricsPath ? relativeRef(options.metricsPath, options.repoRoot || process.cwd()) : undefined,
      searchCallsAtAssembly: 0,
    },
    metrics: metricsBase,
  };
  const artifacts = writeActivityArtifacts(state, pkg, events);
  pkg.eventLedger.complete = !continuationRequired || (!!options.outputDir && state.continuationWriteFailures === 0);
  metricsBase.continuationWriteFailures = state.continuationWriteFailures;
  metricsBase.packageChars = JSON.stringify(pkg).length;
  metricsBase.estimatedPackageTokens = estimateTokens(metricsBase.packageChars);
  pkg.metrics = metricsBase;
  appendMetrics(options.metricsPath, metricsBase);
  if (artifacts.packagePath) {
    try { fs.writeFileSync(artifacts.packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8'); } catch { /* package remains in prompt even if debug write fails */ }
  }
  return { package: pkg, packagePath: artifacts.packagePath, continuationPaths: artifacts.continuationPaths, metricsPath: options.metricsPath };
}

export function recordThoughtSearchCalls(built: BuiltActivityPackage, searchCalls: number, coveredActivitySearchCalls = searchCalls): void {
  built.package.observability.thoughtSearchCalls = searchCalls;
  built.package.observability.coveredActivitySearchCalls = coveredActivitySearchCalls;
  built.package.metrics.thoughtSearchCalls = searchCalls;
  if (built.packagePath) {
    try { fs.writeFileSync(built.packagePath, `${JSON.stringify(built.package, null, 2)}\n`, 'utf8'); } catch { /* non-fatal */ }
  }
  if (built.metricsPath) {
    try { appendJsonl(built.metricsPath, [{ ...built.package.metrics, phase: 'post_thought', packageId: built.package.packageId }]); } catch { /* non-fatal */ }
  }
}
