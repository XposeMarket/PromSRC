import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PROCESS_HYGIENE_SCHEMA_VERSION = 'prometheus.process-hygiene.v1';
export const PROCESS_HYGIENE_RECENT_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_CANDIDATES = 200;
const MAX_STATE_ENTRIES_PER_SURFACE = 80;
const MAX_PROCESS_RECORDS = 250;
const MAX_JSON_BYTES = 512 * 1024;

export type HygieneClassification = 'active' | 'leased' | 'recent' | 'stale' | 'orphaned' | 'unknown' | 'protected';
export type HygieneOwnership = 'prometheus' | 'user' | 'external' | 'unknown';
export type HygieneResourceKind =
  | 'gateway'
  | 'runtime'
  | 'worker'
  | 'managed_process'
  | 'local_server'
  | 'desktop_lease'
  | 'vm'
  | 'browser_session'
  | 'timer'
  | 'subscription'
  | 'queue'
  | 'lock'
  | 'log'
  | 'state_file';

export type ProcessIdentityState = 'match' | 'pid_reused' | 'missing' | 'unknown' | 'not_applicable';

export interface ProcessIdentity {
  pid: number;
  parentPid?: number;
  creationTimeMs?: number;
}

export interface ListenerIdentity {
  pid: number;
  port: number;
  addressFamily?: string;
}

export interface VmIdentity {
  vmName: string;
  state: string;
  status?: string;
}

export interface BrowserHygieneSession {
  sessionId: string;
  ownerType?: string;
  ownerId?: string;
  profileKind?: 'prometheus' | 'user' | 'inhouse';
  browserTarget?: 'prometheus' | 'user' | 'inhouse';
  active?: boolean;
  streamActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface HygieneObservationInput {
  kind: HygieneResourceKind;
  identity: string;
  ownership: HygieneOwnership;
  knownPrometheusOwner?: boolean;
  ownerKey?: string;
  sessionKey?: string;
  relation: 'active' | 'terminal' | 'missing' | 'unknown';
  lease: 'active' | 'expired' | 'none' | 'unknown';
  preferLeaseClassification?: boolean;
  strongActiveEvidence?: boolean;
  processIdentity: ProcessIdentityState;
  lastObservedAt?: number;
  duplicateIdentity?: boolean;
  protectedReason?: string;
  evidenceCodes?: string[];
}

export interface HygieneCandidate {
  candidateId: string;
  kind: HygieneResourceKind;
  classification: HygieneClassification;
  ownership: HygieneOwnership;
  protection: 'none' | 'protected';
  identityRef: string;
  ownerRef?: string;
  sessionRef?: string;
  processIdentity: ProcessIdentityState;
  relation: HygieneObservationInput['relation'];
  lease: HygieneObservationInput['lease'];
  evidenceCodes: string[];
  flags: string[];
  recommendedReview: 'none' | 'recheck' | 'manual_review';
}

export interface HygieneSourceStatus {
  source: string;
  status: 'ok' | 'partial' | 'unavailable' | 'excluded';
  observed: number;
  protected: number;
  note?: string;
}

export interface HygieneCounts {
  byClassification: Record<HygieneClassification, number>;
  byKind: Partial<Record<HygieneResourceKind, number>>;
  duplicateIdentity: number;
  pidReuse: number;
  protected: number;
}

export interface HygieneThoughtSummary {
  schemaVersion: string;
  observedAt: number;
  counts: HygieneCounts;
  attention: Array<{
    candidateId: string;
    kind: HygieneResourceKind;
    classification: HygieneClassification;
    evidenceCodes: string[];
    flags: string[];
  }>;
  sourceStatus: Array<Pick<HygieneSourceStatus, 'source' | 'status' | 'observed'>>;
  safety: {
    reportOnly: true;
    mutationsAttempted: 0;
    rawCommandsIncluded: false;
    rawUrlsIncluded: false;
    rawPathsIncluded: false;
    secretsIncluded: false;
  };
}

export interface ProcessHygieneReport {
  schemaVersion: string;
  reportId: string;
  generatedAt: number;
  mode: 'observe' | 'dry_run';
  platform: NodeJS.Platform;
  counts: HygieneCounts;
  sources: HygieneSourceStatus[];
  candidates: HygieneCandidate[];
  candidateTotal: number;
  candidatesTruncated: boolean;
  audit: {
    eventType: 'process_hygiene_report_generated';
    eventId: string;
    reportOnly: true;
    mutationsAttempted: 0;
    privacy: 'hashed_refs_no_commands_urls_paths_or_secrets';
  };
  listeners: {
    observed: number;
    attributedPrometheus: number;
    unattributedProtected: number;
  };
  scope: {
    configStateReadOnly: true;
    workspaceFilesRead: false;
    chatHistoryRead: false;
    memoryRead: false;
    taskDataRead: false;
    auditLogsRead: false;
    personalChromeControl: 'excluded_and_protected';
    vmControl: 'excluded_and_protected';
    processControl: 'excluded_and_protected';
  };
  dryRun: {
    destructiveActions: 0;
    processTermination: 0;
    browserClose: 0;
    vmStop: 0;
    fileDeletion: 0;
    executableActions: [];
  };
  thoughtSummary: HygieneThoughtSummary;
}

export interface CurrentEnvironmentInventory {
  available: boolean;
  partial: boolean;
  processes: ProcessIdentity[];
  listeners: ListenerIdentity[];
  vms: VmIdentity[];
  note?: string;
}

export interface ProcessHygieneBuildOptions {
  configDir: string;
  now?: number;
  mode?: 'observe' | 'dry_run';
  processInventory?: CurrentEnvironmentInventory;
  browserSessions?: BrowserHygieneSession[];
  fixtureObservations?: HygieneObservationInput[];
  includeStateSurfaces?: boolean;
}

function stableRef(value: unknown): string {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

function boundedCode(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 80);
}

function uniqueCodes(values: unknown[]): string[] {
  return Array.from(new Set(values.map(boundedCode).filter(Boolean))).slice(0, 20);
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const value of values) out[value] = Number(out[value] || 0) + 1;
  return out;
}

function processIdentityState(expectedCreationTimeMs: unknown, observed: ProcessIdentity | undefined): ProcessIdentityState {
  if (!observed || !Number.isInteger(observed.pid) || observed.pid <= 0) return 'missing';
  const expected = Number(expectedCreationTimeMs || 0);
  const actual = Number(observed.creationTimeMs || 0);
  if (!expected || !actual) return 'unknown';
  return Math.abs(expected - actual) <= 2_000 ? 'match' : 'pid_reused';
}

export function classifyHygieneObservation(input: HygieneObservationInput, now = Date.now()): HygieneClassification {
  if (input.ownership === 'user' || input.ownership === 'external') return 'protected';
  // A Prometheus-owned resource may still be protected from any future
  // executor (for example the always-on gateway or an active desktop lease).
  // Keep its lifecycle classification useful while retaining protection on the
  // candidate, but fail closed when the owner itself is not proven.
  if (input.protectedReason && !input.knownPrometheusOwner) return 'protected';
  if (input.ownership === 'unknown' || !input.knownPrometheusOwner) return 'unknown';
  if (input.processIdentity === 'pid_reused') return 'unknown';
  if (input.preferLeaseClassification && input.lease === 'active') return 'leased';
  if (input.relation === 'active' && (input.processIdentity === 'match' || input.lease === 'active' || input.strongActiveEvidence)) return 'active';
  if (input.lease === 'active') return 'leased';
  if (input.processIdentity === 'match' && input.relation === 'missing' && input.lease === 'none') return 'orphaned';
  if (input.relation === 'terminal' && (input.lease === 'none' || input.lease === 'expired') && input.processIdentity === 'missing') {
    const last = Number(input.lastObservedAt || 0);
    if (last > now + 60_000) return 'unknown';
    return last > 0 && now - last <= PROCESS_HYGIENE_RECENT_WINDOW_MS ? 'recent' : 'stale';
  }
  if (input.lease === 'expired' && input.processIdentity === 'missing' && input.relation === 'missing') {
    const last = Number(input.lastObservedAt || 0);
    return last > now + 60_000 ? 'unknown' : 'stale';
  }
  const last = Number(input.lastObservedAt || 0);
  if (last > now + 60_000) return 'unknown';
  if (last > 0 && now - last <= PROCESS_HYGIENE_RECENT_WINDOW_MS) return 'recent';
  return 'unknown';
}

function makeCandidate(input: HygieneObservationInput, now: number): HygieneCandidate {
  const classification = classifyHygieneObservation(input, now);
  const flags: string[] = [];
  if (input.duplicateIdentity) flags.push('duplicate_identity');
  if (input.processIdentity === 'pid_reused') flags.push('pid_reuse');
  if (input.lease === 'expired') flags.push('lease_expired');
  if (input.evidenceCodes?.includes('progress_lease_pid_mismatch')) flags.push('progress_lease_pid_mismatch');
  if (input.protectedReason) flags.push(boundedCode(input.protectedReason));
  if (input.kind === 'gateway') flags.push('always_on_gateway_protected');
  const protection = classification === 'protected' || Boolean(input.protectedReason) || input.ownership !== 'prometheus'
    ? 'protected'
    : 'none';
  return {
    candidateId: `hyg_${stableRef(`${input.kind}|${input.identity}`)}`,
    kind: input.kind,
    classification,
    ownership: input.ownership,
    protection,
    identityRef: stableRef(input.identity),
    ownerRef: input.ownerKey ? stableRef(input.ownerKey) : undefined,
    sessionRef: input.sessionKey ? stableRef(input.sessionKey) : undefined,
    processIdentity: input.processIdentity,
    relation: input.relation,
    lease: input.lease,
    evidenceCodes: uniqueCodes(input.evidenceCodes || []),
    flags: uniqueCodes(flags),
    recommendedReview: ['stale', 'orphaned'].includes(classification) ? 'manual_review' : classification === 'unknown' ? 'recheck' : 'none',
  };
}

function parseJsonText(raw: string): any | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function readJsonFile(filePath: string): Promise<{ value: any | null; exists: boolean; partial: boolean }> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return { value: null, exists: true, partial: true };
    if (stat.size > MAX_JSON_BYTES) return { value: null, exists: true, partial: true };
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const value = parseJsonText(raw);
    return { value, exists: true, partial: value === null };
  } catch {
    return { value: null, exists: false, partial: false };
  }
}

interface StateEntry {
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  mtimeMs: number;
}

async function listStateEntries(dir: string, maxEntries = MAX_STATE_ENTRIES_PER_SURFACE): Promise<{ entries: StateEntry[]; status: HygieneSourceStatus }> {
  try {
    const allNames = await fs.promises.readdir(dir, { withFileTypes: true });
    const names = allNames.slice(0, maxEntries);
    const truncated = allNames.length > names.length;
    const entries: StateEntry[] = [];
    for (const entry of names) {
      try {
        const stat = await fs.promises.stat(path.join(dir, entry.name));
        entries.push({ name: entry.name, isDirectory: entry.isDirectory(), sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // A disappearing entry is represented by the partial source status.
      }
    }
    return {
      entries,
      status: {
        source: `state:${path.basename(dir)}`,
        status: entries.length < names.length || truncated ? 'partial' : 'ok',
        observed: entries.length,
        protected: entries.length,
        note: truncated ? 'Metadata only; bounded listing truncated; contents are not read.' : 'Metadata only; contents are not read.',
      },
    };
  } catch {
    return {
      entries: [],
      status: { source: `state:${path.basename(dir)}`, status: 'unavailable', observed: 0, protected: 0, note: 'Surface was not readable; no cleanup inference was made.' },
    };
  }
}

function processByPid(processes: ProcessIdentity[], pid: unknown): ProcessIdentity | undefined {
  const numeric = Number(pid || 0);
  return Number.isInteger(numeric) && numeric > 0 ? processes.find((entry) => entry.pid === numeric) : undefined;
}

function parseCreationDate(value: unknown): number | undefined {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

export async function readCurrentProcessInventory(): Promise<CurrentEnvironmentInventory> {
  if (process.platform !== 'win32') {
    return { available: false, partial: true, processes: [], listeners: [], vms: [], note: 'Current read-only process inventory is implemented for Windows first slice only.' };
  }
  const script = [
    '$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $created = 0;',
    '  try { $created = [DateTimeOffset]$_.CreationDate.ToUniversalTime() | ForEach-Object { $_.ToUnixTimeMilliseconds() } } catch {}',
    '  [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; creationTimeMs = [long]$created }',
    '});',
    '$listeners = @();',
    'try { $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ pid = [int]$_.OwningProcess; port = [int]$_.LocalPort; addressFamily = [string]$_.AddressFamily } }) } catch {}',
    '$vms = @();',
    'try { $vmName = [string]($env:PROMETHEUS_DESKTOP_VM_NAME); if (-not $vmName) { $vmName = "Prometheus-Desktop" }; $vms = @(Get-VM -Name $vmName -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ vmName = [string]$_.Name; state = [string]$_.State; status = [string]$_.Status } }) } catch {}',
    '[pscustomobject]@{ processes = $processes; listeners = $listeners; vms = $vms } | ConvertTo-Json -Compress -Depth 4',
  ].join(' ');
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 12_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = parseJsonText(String(stdout || '')) || {};
    const processes = normalizeArray(parsed.processes).map((entry: any) => ({
      pid: Number(entry?.pid || 0),
      parentPid: Number(entry?.parentPid || 0) || undefined,
      creationTimeMs: Number(entry?.creationTimeMs || 0) || undefined,
    })).filter((entry: ProcessIdentity) => Number.isInteger(entry.pid) && entry.pid > 0);
    const listeners = normalizeArray(parsed.listeners).map((entry: any) => ({
      pid: Number(entry?.pid || 0),
      port: Number(entry?.port || 0),
      addressFamily: String(entry?.addressFamily || '').slice(0, 32),
    })).filter((entry: ListenerIdentity) => entry.pid > 0 && entry.port > 0);
    const vms = normalizeArray(parsed.vms).map((entry: any) => ({
      vmName: String(entry?.vmName || '').slice(0, 120),
      state: String(entry?.state || '').slice(0, 80),
      status: String(entry?.status || '').slice(0, 160),
    })).filter((entry: VmIdentity) => entry.vmName);
    return { available: true, partial: false, processes, listeners, vms };
  } catch (error: any) {
    return { available: false, partial: true, processes: [], listeners: [], vms: [], note: boundedCode(error?.code || 'read_failed') };
  }
}

function sourceStatus(source: string, status: HygieneSourceStatus['status'], observed: number, note?: string): HygieneSourceStatus {
  return { source, status, observed, protected: 0, note };
}

async function collectStateSurfaceCandidates(configDir: string, now: number): Promise<{ candidates: HygieneCandidate[]; sources: HygieneSourceStatus[] }> {
  const candidates: HygieneCandidate[] = [];
  const sources: HygieneSourceStatus[] = [];
  const surfaces: Array<{ relative: string; kind: HygieneResourceKind }> = [
    { relative: 'timers', kind: 'timer' },
    { relative: 'subscriptions', kind: 'subscription' },
    { relative: 'queue', kind: 'queue' },
    { relative: 'queues', kind: 'queue' },
    { relative: 'internal-watch', kind: 'subscription' },
    { relative: 'locks', kind: 'lock' },
    { relative: 'runtime', kind: 'state_file' },
  ];
  for (const surface of surfaces) {
    const listed = await listStateEntries(path.join(configDir, surface.relative));
    sources.push({ ...listed.status, source: `state:${surface.relative}` });
    if (listed.status.status === 'unavailable' && listed.status.observed === 0) continue;
    if (!listed.entries.length) continue;
    candidates.push(makeCandidate({
      kind: surface.kind,
      identity: `${surface.relative}|${listed.entries.map((entry) => entry.name).join('|')}`,
      ownership: 'unknown',
      knownPrometheusOwner: false,
      relation: 'unknown',
      lease: 'unknown',
      processIdentity: 'not_applicable',
      lastObservedAt: now,
      protectedReason: 'state_surface_owner_not_proven',
      evidenceCodes: ['metadata_only', 'no_owner_lease_proof'],
    }, now));
  }

  const logDirs = [
    { relative: 'processes/logs', kind: 'log' as const },
    { relative: 'logs', kind: 'log' as const },
    { relative: 'runtimes', kind: 'log' as const },
    { relative: 'desktop-background', kind: 'state_file' as const },
  ];
  for (const surface of logDirs) {
    const listed = await listStateEntries(path.join(configDir, surface.relative));
    sources.push({ ...listed.status, source: `state:${surface.relative}` });
    if (listed.status.status === 'unavailable' && listed.status.observed === 0) continue;
    for (const entry of listed.entries.slice(0, MAX_STATE_ENTRIES_PER_SURFACE)) {
      if (entry.isDirectory) continue;
      const temporary = /\.tmp(?:-|\.)|\.lock$|\.lck$/i.test(entry.name);
      const kind = temporary ? 'lock' : surface.kind;
      candidates.push(makeCandidate({
        kind,
        identity: `${surface.relative}|${entry.name}`,
        ownership: 'unknown',
        knownPrometheusOwner: false,
        relation: 'unknown',
        lease: 'unknown',
        processIdentity: 'not_applicable',
        lastObservedAt: entry.mtimeMs,
        protectedReason: temporary ? 'owner_identity_not_proven' : 'logs_are_not_cleanup_authority',
        evidenceCodes: ['metadata_only', temporary ? 'temporary_or_lock_name' : 'log_metadata_only'],
      }, now));
    }
  }
  return { candidates, sources };
}

function countSources(sources: HygieneSourceStatus[], source: string, status: HygieneSourceStatus['status'], observed: number, protectedCount = 0, note?: string): void {
  sources.push({ source, status, observed, protected: protectedCount, note });
}

function summarizeCounts(candidates: HygieneCandidate[]): HygieneCounts {
  const byClassification = {
    active: 0,
    leased: 0,
    recent: 0,
    stale: 0,
    orphaned: 0,
    unknown: 0,
    protected: 0,
  } satisfies Record<HygieneClassification, number>;
  const byKind: Partial<Record<HygieneResourceKind, number>> = {};
  let duplicateIdentity = 0;
  let pidReuse = 0;
  let protectedCount = 0;
  for (const candidate of candidates) {
    byClassification[candidate.classification] += 1;
    byKind[candidate.kind] = Number(byKind[candidate.kind] || 0) + 1;
    if (candidate.flags.includes('duplicate_identity')) duplicateIdentity += 1;
    if (candidate.flags.includes('pid_reuse')) pidReuse += 1;
    if (candidate.protection === 'protected') protectedCount += 1;
  }
  return { byClassification, byKind, duplicateIdentity, pidReuse, protected: protectedCount };
}

const CANDIDATE_KIND_PRIORITY: Record<HygieneResourceKind, number> = {
  gateway: 0,
  runtime: 1,
  worker: 2,
  desktop_lease: 3,
  vm: 4,
  local_server: 5,
  managed_process: 6,
  browser_session: 7,
  timer: 8,
  subscription: 9,
  queue: 10,
  lock: 11,
  state_file: 12,
  log: 13,
};

export function buildBoundedHygieneSummary(report: Pick<ProcessHygieneReport, 'generatedAt' | 'counts' | 'candidates' | 'sources'>): HygieneThoughtSummary {
  const attention = report.candidates
    .filter((candidate) => ['stale', 'orphaned', 'unknown', 'protected'].includes(candidate.classification) || candidate.flags.length > 0)
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
    .slice(0, 20)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      classification: candidate.classification,
      evidenceCodes: candidate.evidenceCodes.slice(0, 8),
      flags: candidate.flags.slice(0, 8),
    }));
  return {
    schemaVersion: `${PROCESS_HYGIENE_SCHEMA_VERSION}.thought-summary`,
    observedAt: report.generatedAt,
    counts: report.counts,
    attention,
    sourceStatus: report.sources.map((source) => ({ source: source.source, status: source.status, observed: source.observed })).slice(0, 40),
    safety: {
      reportOnly: true,
      mutationsAttempted: 0,
      rawCommandsIncluded: false,
      rawUrlsIncluded: false,
      rawPathsIncluded: false,
      secretsIncluded: false,
    },
  };
}

function buildReportId(candidates: HygieneCandidate[], sources: HygieneSourceStatus[], now: number): string {
  return `phr_${stableRef(JSON.stringify({ now, candidates, sources }))}`;
}

export async function buildProcessHygieneReport(options: ProcessHygieneBuildOptions): Promise<ProcessHygieneReport> {
  const now = Number(options.now || Date.now());
  const configDir = path.resolve(options.configDir);
  const sources: HygieneSourceStatus[] = [];
  const observations: HygieneObservationInput[] = [];
  const current = options.processInventory || await readCurrentProcessInventory();
  countSources(sources, 'os_process_inventory', current.available ? (current.partial ? 'partial' : 'ok') : 'unavailable', current.processes.length, 0, current.note || 'Process command lines and executable paths are never returned.');
  countSources(sources, 'os_listener_inventory', current.available ? (current.partial ? 'partial' : 'ok') : 'unavailable', current.listeners.length, current.listeners.length, 'Unattributed listeners are protected and omitted from candidates.');
  countSources(sources, 'vm_probe', current.available ? 'ok' : 'unavailable', current.vms.length, current.vms.length, 'Only the exact configured Prometheus-Desktop target is probed; no VM is controlled.');

  const statusPath = path.join(configDir, 'gateway-runtime-status.json');
  const leasePath = path.join(configDir, 'gateway-progress-lease.json');
  const [gatewayStatus, progressLease, runtimeLedger, desktopState, hypervOwner, browserRegistry] = await Promise.all([
    readJsonFile(statusPath),
    readJsonFile(leasePath),
    readJsonFile(path.join(configDir, 'runtimes', 'active-runtimes.json')),
    readJsonFile(path.join(configDir, 'desktop-background', 'desktop-target-runtime.json')),
    readJsonFile(path.join(configDir, 'desktop-hyperv-owner.json')),
    readJsonFile(path.join(configDir, 'browser-sessions.json')),
  ]);
  countSources(sources, 'gateway_status', gatewayStatus.exists ? (gatewayStatus.partial ? 'partial' : 'ok') : 'unavailable', gatewayStatus.value ? 1 : 0, 1);
  countSources(sources, 'gateway_progress_lease', progressLease.exists ? (progressLease.partial ? 'partial' : 'ok') : 'unavailable', progressLease.value ? 1 : 0, 1);
  countSources(sources, 'runtime_ledger', runtimeLedger.exists ? (runtimeLedger.partial ? 'partial' : 'ok') : 'unavailable', Object.keys(runtimeLedger.value?.runtimes || {}).length, 0);
  countSources(sources, 'desktop_target_lease', desktopState.exists ? (desktopState.partial ? 'partial' : 'ok') : 'unavailable', desktopState.value ? 1 : 0, 1);
  countSources(sources, 'hyperv_owner_marker', hypervOwner.exists ? (hypervOwner.partial ? 'partial' : 'ok') : 'unavailable', hypervOwner.value ? 1 : 0, 1);
  countSources(sources, 'browser_registry', browserRegistry.exists ? (browserRegistry.partial ? 'partial' : 'ok') : 'unavailable', normalizeArray(browserRegistry.value?.sessions).length, normalizeArray(browserRegistry.value?.sessions).length, 'URLs and titles are read only for presence and never returned.');

  const statusGatewayPid = Number(gatewayStatus.value?.pid || 0);
  const leaseGatewayPid = Number(progressLease.value?.pid || 0);
  const gatewayPid = statusGatewayPid || leaseGatewayPid;
  const gatewayProcess = processByPid(current.processes, gatewayPid);
  const leaseCreation = Number(progressLease.value?.processStartedAt || 0);
  const statusCreation = Number(gatewayStatus.value?.processStartedAt || 0);
  const gatewayExpectedCreation = statusGatewayPid > 0 && statusGatewayPid === leaseGatewayPid ? leaseCreation || statusCreation : statusCreation;
  const gatewayProcessIdentity = gatewayPid > 0
    ? gatewayProcess
      ? gatewayExpectedCreation > 0 ? processIdentityState(gatewayExpectedCreation, gatewayProcess) : 'unknown'
      : 'missing'
    : 'missing';
  const heartbeatAt = Number(gatewayStatus.value?.timestamp || 0);
  const heartbeatFresh = heartbeatAt > 0 && now - heartbeatAt <= 45_000;
  const gatewayActive = heartbeatFresh || gatewayProcessIdentity === 'match';
  if (gatewayPid > 0 || gatewayStatus.value || progressLease.value) {
    observations.push({
      kind: 'gateway',
      identity: `gateway|${gatewayPid}|${leaseCreation}`,
      ownership: 'prometheus',
      knownPrometheusOwner: true,
      ownerKey: `gateway|${gatewayPid}|${leaseCreation}`,
      relation: gatewayActive ? 'active' : 'unknown',
      lease: progressLease.value?.state === 'active' ? 'active' : progressLease.value?.state === 'idle' ? 'none' : 'unknown',
      strongActiveEvidence: gatewayActive,
      processIdentity: gatewayProcessIdentity,
      lastObservedAt: Math.max(heartbeatAt, Number(gatewayStatus.value?.timestamp || 0)),
      protectedReason: 'always_on_gateway',
      evidenceCodes: [
        heartbeatFresh ? 'gateway_heartbeat_fresh' : 'gateway_heartbeat_not_fresh',
        gatewayProcess ? 'pid_observed' : 'pid_not_observed',
        statusGatewayPid > 0 && leaseGatewayPid > 0 && statusGatewayPid !== leaseGatewayPid ? 'progress_lease_pid_mismatch' : 'gateway_pid_consistent_or_unavailable',
        'idle_gateway_is_not_stale',
      ],
    });
  }

  const progress = progressLease.value;
  if (progress && progress.runtimeId) {
    const leaseProcess = processByPid(current.processes, progress.pid);
    const leaseIdentity = processIdentityState(progress.processStartedAt, leaseProcess);
    const leaseFresh = Number(progress.expiresAt || 0) > now && progress.state === 'active';
    observations.push({
      kind: 'runtime',
      identity: `progress_lease|${progress.leaseId || progress.runtimeId}`,
      ownership: 'prometheus',
      knownPrometheusOwner: true,
      ownerKey: String(progress.runtimeId),
      sessionKey: String(progress.sessionId || ''),
      relation: leaseFresh || gatewayActive ? 'active' : 'missing',
      lease: leaseFresh ? 'active' : progress.state === 'active' ? 'expired' : 'none',
      preferLeaseClassification: true,
      strongActiveEvidence: gatewayActive,
      processIdentity: leaseIdentity,
      lastObservedAt: Number(progress.updatedAt || progress.lastProgressAt || 0),
      protectedReason: gatewayActive ? 'gateway_process_is_alive' : undefined,
      evidenceCodes: [leaseFresh ? 'lease_valid' : 'lease_expired_or_idle', gatewayActive ? 'gateway_relationship_active' : 'gateway_relationship_unproven'],
    });
  }

  const runtimeEntries = Object.values(runtimeLedger.value?.runtimes || {}).slice(0, MAX_PROCESS_RECORDS);
  const runtimeDuplicateCounts = countBy(runtimeEntries
    .filter((entry: any) => String(entry?.status || '') === 'running')
    .map((entry: any) => `${entry?.kind || 'unknown'}|${entry?.sessionId || ''}|${entry?.taskId || ''}|${entry?.scheduleId || ''}`));
  for (const entry of runtimeEntries as any[]) {
    const status = String(entry?.status || '').trim();
    const pid = Number(entry?.pid || 0);
    const runtimeProcess = processByPid(current.processes, pid);
    const identity = progress?.processStartedAt && pid === Number(progress.pid || 0)
      ? processIdentityState(progress.processStartedAt, runtimeProcess)
      : pid > 0 && gatewayProcess && pid === gatewayProcess.pid ? 'unknown' : 'missing';
    const running = status === 'running';
    const interrupted = status === 'interrupted';
    const key = `${entry?.kind || 'unknown'}|${entry?.sessionId || ''}|${entry?.taskId || ''}|${entry?.scheduleId || ''}`;
    observations.push({
      kind: ['subagent', 'team_subagent', 'background_agent', 'background_task', 'team_member'].includes(String(entry?.kind || '')) ? 'worker' : 'runtime',
      identity: `runtime|${entry?.id || ''}`,
      ownership: 'prometheus',
      knownPrometheusOwner: true,
      ownerKey: key,
      sessionKey: String(entry?.sessionId || ''),
      relation: running ? 'active' : interrupted ? 'unknown' : 'terminal',
      lease: running && gatewayActive ? 'active' : interrupted ? 'unknown' : 'none',
      strongActiveEvidence: running && gatewayActive,
      processIdentity: identity,
      lastObservedAt: Number(entry?.updatedAt || entry?.startedAt || 0),
      duplicateIdentity: Number(runtimeDuplicateCounts[key] || 0) > 1,
      protectedReason: interrupted ? 'restart_recovery_or_interruption_requires_owner_review' : undefined,
      evidenceCodes: [running ? 'runtime_running' : `runtime_${boundedCode(status || 'unknown')}`, gatewayActive ? 'gateway_relationship_active' : 'gateway_relationship_unproven'],
    });
  }

  const processRecordsDir = path.join(configDir, 'processes', 'records');
  const processRecordList = await listStateEntries(processRecordsDir, MAX_PROCESS_RECORDS);
  countSources(sources, 'managed_process_records', processRecordList.status.status, processRecordList.entries.length, 0, 'Commands, cwd, and log contents are not returned.');
  const processRecords = new Map<string, any>();
  for (const file of processRecordList.entries.filter((entry) => !entry.isDirectory && /\.json$/i.test(entry.name)).slice(0, MAX_PROCESS_RECORDS)) {
    const record = await readJsonFile(path.join(processRecordsDir, file.name));
    const runId = String(record.value?.runId || file.name.replace(/\.json$/i, '')).trim();
    if (!runId) continue;
    processRecords.set(runId, record.value);
    const pid = Number(record.value?.pid || 0);
    const observedProcess = processByPid(current.processes, pid);
    const identity = processIdentityState(parseCreationDate(record.value?.startedAt), observedProcess);
    const state = String(record.value?.state || '').trim();
    const terminal = state === 'exited';
    observations.push({
      kind: 'managed_process',
      identity: `managed_process|${runId}`,
      ownership: 'prometheus',
      knownPrometheusOwner: true,
      ownerKey: runId,
      sessionKey: String(record.value?.sessionId || ''),
      relation: terminal ? 'terminal' : state === 'running' || state === 'starting' || state === 'exiting' ? 'active' : 'unknown',
      lease: state === 'running' && observedProcess ? 'active' : 'none',
      strongActiveEvidence: state === 'running' && identity === 'match',
      processIdentity: identity,
      lastObservedAt: Math.max(parseCreationDate(record.value?.updatedAt) || 0, file.mtimeMs),
      evidenceCodes: [boundedCode(`record_${state || 'unknown'}`), observedProcess ? 'pid_observed' : 'pid_not_observed'],
    });
  }

  const activeManagedProcessPids = new Set(
    Array.from(processRecords.values()).filter((record) => ['starting', 'running', 'exiting'].includes(String(record?.state || ''))).map((record) => Number(record?.pid || 0)).filter((pid) => pid > 0),
  );
  let attributedListeners = 0;
  for (const listener of current.listeners) {
    const isGateway = listener.pid === gatewayPid && gatewayActive;
    const isManaged = activeManagedProcessPids.has(listener.pid);
    if (!isGateway && !isManaged) continue;
    attributedListeners += 1;
    const observedProcess = processByPid(current.processes, listener.pid);
    observations.push({
      kind: 'local_server',
      identity: `listener|${listener.pid}|${listener.port}|${listener.addressFamily || ''}`,
      ownership: 'prometheus',
      knownPrometheusOwner: true,
      ownerKey: `listener|${listener.pid}|${listener.port}`,
      relation: 'active',
      lease: 'none',
      strongActiveEvidence: true,
      processIdentity: observedProcess ? 'match' : 'unknown',
      lastObservedAt: now,
      protectedReason: isGateway ? 'always_on_gateway_listener' : undefined,
      evidenceCodes: [isGateway ? 'gateway_pid_relationship' : 'managed_process_pid_relationship', 'listener_pid_and_owner_evidence'],
    });
  }

  const desktop = desktopState.value;
  if (desktop) {
    const activeLeases = Number(desktop.activeLeases || 0);
    const owned = desktop.ownership === 'owned';
    const state = String(desktop.state || 'unknown');
    observations.push({
      kind: 'desktop_lease',
      identity: `desktop_target|${desktop.targetId || 'unknown'}`,
      ownership: owned ? 'prometheus' : desktop.ownership === 'external' ? 'external' : 'unknown',
      knownPrometheusOwner: owned,
      ownerKey: String(desktop.targetId || ''),
      relation: state === 'ready' && owned ? 'active' : state === 'stopped' ? 'terminal' : 'unknown',
      lease: activeLeases > 0 ? 'active' : state === 'ready' && owned ? 'none' : 'unknown',
      preferLeaseClassification: activeLeases > 0,
      strongActiveEvidence: state === 'ready' && owned && activeLeases > 0,
      processIdentity: 'not_applicable',
      lastObservedAt: Number(desktop.updatedAt || desktop.lastActivityAt || 0),
      protectedReason: !owned ? 'desktop_target_ownership_not_proven' : activeLeases > 0 ? 'active_desktop_lease' : undefined,
      evidenceCodes: [boundedCode(`desktop_${state}`), owned ? 'ownership_marker_owned' : 'ownership_not_owned', activeLeases > 0 ? 'active_lease_count' : 'no_active_lease'],
    });
  }

  const owner = hypervOwner.value;
  const exactVmName = String(owner?.vmName || process.env.PROMETHEUS_DESKTOP_VM_NAME || 'Prometheus-Desktop');
  const vm = current.vms.find((entry) => entry.vmName === exactVmName);
  if (owner || vm) {
    const ownerPid = Number(owner?.ownerPid || 0);
    const ownerProcess = processByPid(current.processes, ownerPid);
    const vmRunning = /^running$/i.test(String(vm?.state || ''));
    const ownerIdentity = owner ? processIdentityState(Number(owner?.processStartedAt || 0), ownerProcess) : 'not_applicable';
    observations.push({
      kind: 'vm',
      identity: `hyperv|${exactVmName}`,
      ownership: owner ? 'prometheus' : vmRunning ? 'external' : 'unknown',
      knownPrometheusOwner: Boolean(owner),
      ownerKey: String(owner?.instanceId || exactVmName),
      relation: vmRunning && ownerIdentity === 'match' ? 'active' : !vmRunning ? 'terminal' : 'unknown',
      lease: vmRunning && ownerIdentity === 'match' ? 'active' : owner ? 'expired' : 'unknown',
      preferLeaseClassification: vmRunning && ownerIdentity === 'match',
      strongActiveEvidence: vmRunning && ownerIdentity === 'match',
      processIdentity: ownerIdentity,
      lastObservedAt: Number(owner?.startedAt || 0),
      protectedReason: 'exact_vm_boundary_no_control',
      evidenceCodes: [vm ? `vm_${boundedCode(vm.state)}` : 'vm_state_unavailable', owner ? 'ownership_marker_present' : 'no_prometheus_owner_marker', ownerIdentity === 'pid_reused' ? 'pid_reuse' : 'owner_pid_relationship'],
    });
  }

  const activeBrowserSessions = (options.browserSessions || []).slice(0, MAX_PROCESS_RECORDS);
  const browserOwnerCounts = countBy(activeBrowserSessions.map((session) => `${session.ownerType || ''}|${session.ownerId || session.sessionId}`));
  for (const session of activeBrowserSessions) {
    const isPersonal = session.profileKind === 'user' || session.browserTarget === 'user';
    const isKnownPrometheus = session.profileKind === 'prometheus' || session.profileKind === 'inhouse' || session.browserTarget === 'prometheus' || session.browserTarget === 'inhouse';
    const ownerKey = `${session.ownerType || ''}|${session.ownerId || session.sessionId}`;
    observations.push({
      kind: 'browser_session',
      identity: `browser|${session.sessionId}`,
      ownership: isPersonal ? 'user' : isKnownPrometheus ? 'prometheus' : 'unknown',
      knownPrometheusOwner: isKnownPrometheus,
      ownerKey,
      sessionKey: session.sessionId,
      relation: session.active === false ? 'terminal' : 'active',
      lease: session.streamActive ? 'active' : 'none',
      preferLeaseClassification: Boolean(session.streamActive),
      strongActiveEvidence: session.active !== false,
      processIdentity: 'not_applicable',
      lastObservedAt: Number(session.updatedAt || session.createdAt || 0),
      duplicateIdentity: Number(browserOwnerCounts[ownerKey] || 0) > 1,
      protectedReason: isPersonal ? 'personal_chrome_protected' : !isKnownPrometheus ? 'browser_profile_ownership_unknown' : undefined,
      evidenceCodes: [isPersonal ? 'user_profile_or_target' : isKnownPrometheus ? 'prometheus_profile_or_target' : 'profile_not_proven', session.streamActive ? 'live_stream_lease' : 'no_stream_lease'],
    });
  }
  if (browserRegistry.value) {
    for (const persisted of normalizeArray(browserRegistry.value.sessions).slice(0, MAX_PROCESS_RECORDS)) {
      const sessionId = String(persisted?.sessionId || '').trim();
      if (!sessionId || activeBrowserSessions.some((session) => session.sessionId === sessionId)) continue;
      observations.push({
        kind: 'browser_session',
        identity: `browser_registry|${sessionId}`,
        ownership: 'unknown',
        knownPrometheusOwner: false,
        sessionKey: sessionId,
        relation: 'unknown',
        lease: 'unknown',
        processIdentity: 'not_applicable',
        lastObservedAt: Number(persisted?.updatedAt || 0),
        protectedReason: 'persisted_browser_profile_not_proven',
        evidenceCodes: ['persisted_registry_only', 'profile_not_proven', 'never_close_from_registry_only'],
      });
    }
  }

  if (options.fixtureObservations) observations.push(...options.fixtureObservations);
  const duplicateCounts = countBy(observations.filter((item) => item.ownerKey).map((item) => `${item.kind}|${item.ownerKey}`));
  const candidates = observations.map((item) => makeCandidate({
    ...item,
    duplicateIdentity: item.duplicateIdentity || (item.ownerKey ? Number(duplicateCounts[`${item.kind}|${item.ownerKey}`] || 0) > 1 : false),
  }, now));

  if (options.includeStateSurfaces !== false) {
    const stateSurface = await collectStateSurfaceCandidates(configDir, now);
    candidates.push(...stateSurface.candidates);
    sources.push(...stateSurface.sources);
  }

  const sortedCandidates = candidates.sort((a, b) => (
    CANDIDATE_KIND_PRIORITY[a.kind] - CANDIDATE_KIND_PRIORITY[b.kind]
    || a.candidateId.localeCompare(b.candidateId)
  ));
  const reportCandidates = sortedCandidates.slice(0, MAX_CANDIDATES);
  const counts = summarizeCounts(reportCandidates);
  const thoughtSummary = buildBoundedHygieneSummary({ generatedAt: now, counts, candidates: reportCandidates, sources });
  const reportId = buildReportId(reportCandidates, sources, now);
  return {
    schemaVersion: PROCESS_HYGIENE_SCHEMA_VERSION,
    reportId,
    generatedAt: now,
    mode: options.mode || 'observe',
    platform: process.platform,
    counts,
    sources: sources.slice(0, 80),
    candidates: reportCandidates,
    candidateTotal: sortedCandidates.length,
    candidatesTruncated: sortedCandidates.length > MAX_CANDIDATES,
    audit: {
      eventType: 'process_hygiene_report_generated',
      eventId: `ph_audit_${stableRef(reportId)}`,
      reportOnly: true,
      mutationsAttempted: 0,
      privacy: 'hashed_refs_no_commands_urls_paths_or_secrets',
    },
    listeners: {
      observed: current.listeners.length,
      attributedPrometheus: attributedListeners,
      unattributedProtected: Math.max(0, current.listeners.length - attributedListeners),
    },
    scope: {
      configStateReadOnly: true,
      workspaceFilesRead: false,
      chatHistoryRead: false,
      memoryRead: false,
      taskDataRead: false,
      auditLogsRead: false,
      personalChromeControl: 'excluded_and_protected',
      vmControl: 'excluded_and_protected',
      processControl: 'excluded_and_protected',
    },
    dryRun: {
      destructiveActions: 0,
      processTermination: 0,
      browserClose: 0,
      vmStop: 0,
      fileDeletion: 0,
      executableActions: [],
    },
    thoughtSummary,
  };
}
