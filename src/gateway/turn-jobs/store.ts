import { randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  CLAIMABLE_TURN_JOB_STATES,
  type AcquireResourceLeaseInput,
  type AppendTurnEventInput,
  type BeginToolEffectResult,
  type ClaimTurnDeliveryOptions,
  type ClaimTurnJobOptions,
  type ClaimSpecificTurnJobOptions,
  type EnqueueTurnJobInput,
  type EnqueueTurnJobResult,
  type JsonObject,
  type JsonValue,
  type PersistTurnFinalInput,
  type PersistTurnFinalResult,
  type PrepareToolEffectInput,
  type ResourceLease,
  type SaveTurnCheckpointInput,
  type StaleLeaseReconciliation,
  type ToolEffectRecord,
  type TurnCheckpoint,
  type TurnDelivery,
  type TurnDeliveryLease,
  type TurnDeliveryStatus,
  type TurnEvent,
  type TurnEventSource,
  type TurnJob,
  type TurnJobKind,
  type TurnJobLease,
  type TurnJobState,
} from './types.js';

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DELIVERY_MAX_ATTEMPTS = 10;
const MAX_ERROR_LENGTH = 4_000;

interface TurnJobRow {
  id: string;
  session_id: string;
  kind: string;
  task_id: string | null;
  goal_id: string | null;
  goal_turn_id: string | null;
  client_request_id: string | null;
  request_fingerprint: string;
  payload_ref: string;
  actor_context_json: string | null;
  state: string;
  priority: number;
  attempt: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: number | null;
  worker_pid: number | null;
  last_heartbeat_at: number | null;
  last_event_seq: number;
  checkpoint_id: string | null;
  checkpoint_ref: string | null;
  final_ref: string | null;
  last_error: string | null;
  interruption_reason: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface TurnEventRow {
  job_id: string;
  seq: number;
  attempt: number;
  source: string;
  type: string;
  at: number;
  payload_json: string | null;
  payload_ref: string | null;
  dedupe_key: string | null;
}

interface TurnCheckpointRow {
  id: string;
  job_id: string;
  attempt: number;
  event_seq: number;
  phase: string;
  model_round: number | null;
  continuation_ref: string;
  continuation_hash: string | null;
  tool_effect_id: string | null;
  metadata_json: string | null;
  created_at: number;
}

interface ToolEffectRow {
  effect_id: string;
  job_id: string;
  logical_sequence: number;
  tool_call_id: string;
  tool_name: string;
  args_hash: string;
  replay_policy: string;
  state: string;
  attempt: number;
  execution_count: number;
  result_ref: string | null;
  error: string | null;
  prepared_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

interface TurnDeliveryRow {
  id: string;
  job_id: string;
  channel: string;
  destination: string | null;
  dedupe_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  delivered_at: number | null;
}

interface ResourceLeaseRow {
  resource_key: string;
  job_id: string;
  lease_owner: string;
  lease_token: string;
  lease_until: number;
  acquired_at: number;
  updated_at: number;
}

export interface SqliteTurnJobStoreOptions {
  busyTimeoutMs?: number;
  defaultLeaseMs?: number;
  defaultMaxAttempts?: number;
  reconcileOnOpen?: boolean;
  now?: () => number;
}

export interface ListTurnJobsOptions {
  states?: readonly TurnJobState[];
  sessionId?: string;
  limit?: number;
}

export interface PruneTerminalTurnJobsOptions {
  /** Delete terminal jobs completed strictly before this timestamp. */
  olderThan: number;
  /** Hard cap for one maintenance transaction. */
  limit?: number;
}

export interface PruneTerminalTurnJobsResult {
  deleted: number;
  olderThan: number;
  limit: number;
}

export interface ReconcileFinalizedTurnJobsOptions {
  /** Hard cap for one recovery transaction. */
  limit?: number;
  at?: number;
}

export interface ReconcileFinalizedTurnJobsResult {
  recovered: number;
  recoveredJobIds: string[];
  remainingRecoverable: number;
  /** Final rows with any outbox intent are deliberately never auto-completed. */
  deferredWithDeliveries: number;
  at: number;
  limit: number;
}

export class TurnJobStoreError extends Error {}

export class TurnJobNotFoundError extends TurnJobStoreError {
  constructor(jobId: string) {
    super(`Turn job not found: ${jobId}`);
    this.name = 'TurnJobNotFoundError';
  }
}

export class TurnJobIdempotencyConflictError extends TurnJobStoreError {
  readonly sessionId: string;
  readonly clientRequestId: string;

  constructor(sessionId: string, clientRequestId: string) {
    super(`Client request ${clientRequestId} for session ${sessionId} was already used with a different fingerprint`);
    this.name = 'TurnJobIdempotencyConflictError';
    this.sessionId = sessionId;
    this.clientRequestId = clientRequestId;
  }
}

export class TurnJobLeaseLostError extends TurnJobStoreError {
  constructor(jobId: string) {
    super(`Turn job lease is no longer owned by this worker: ${jobId}`);
    this.name = 'TurnJobLeaseLostError';
  }
}

export class TurnJobStateError extends TurnJobStoreError {
  constructor(jobId: string, state: string, operation: string) {
    super(`Cannot ${operation} turn job ${jobId} while it is ${state}`);
    this.name = 'TurnJobStateError';
  }
}

export class ToolEffectConflictError extends TurnJobStoreError {
  constructor(effectId: string) {
    super(`Tool effect ${effectId} conflicts with its durable logical effect record`);
    this.name = 'ToolEffectConflictError';
  }
}

function validateText(name: string, value: string, maximum = 1_024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function optionalText(name: string, value: string | null | undefined, maximum = 1_024): string | null {
  if (value == null) return null;
  return validateText(name, value, maximum);
}

function positiveInteger(name: string, value: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function timestamp(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer timestamp`);
  return value;
}

function errorText(value: string): string {
  return String(value || 'unknown error').slice(0, MAX_ERROR_LENGTH);
}

function canonicalJson(value: JsonValue): string {
  const seen = new Set<object>();
  const visit = (current: JsonValue): string => {
    if (current === null) return 'null';
    if (typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('Turn-job JSON cannot contain non-finite numbers');
      return JSON.stringify(current);
    }
    if (typeof current !== 'object') throw new TypeError('Turn-job JSON must contain JSON-compatible values');
    if (seen.has(current)) throw new TypeError('Turn-job JSON cannot contain cycles');
    seen.add(current);
    try {
      if (Array.isArray(current)) return `[${current.map((entry) => visit(entry)).join(',')}]`;
      return `{${Object.keys(current).sort().map((key) => `${JSON.stringify(key)}:${visit(current[key])}`).join(',')}}`;
    } finally {
      seen.delete(current);
    }
  };
  return visit(value);
}

function parseJson<T>(value: string | null): T | null {
  return value == null ? null : JSON.parse(value) as T;
}

function newToken(): string {
  return randomBytes(24).toString('hex');
}

function toJob(row: TurnJobRow): TurnJob {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind as TurnJobKind,
    taskId: row.task_id,
    goalId: row.goal_id,
    goalTurnId: row.goal_turn_id,
    clientRequestId: row.client_request_id,
    requestFingerprint: row.request_fingerprint,
    payloadRef: row.payload_ref,
    actorContext: parseJson<JsonObject>(row.actor_context_json),
    state: row.state as TurnJobState,
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
    workerPid: row.worker_pid,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastEventSeq: row.last_event_seq,
    checkpointId: row.checkpoint_id,
    checkpointRef: row.checkpoint_ref,
    finalRef: row.final_ref,
    lastError: row.last_error,
    interruptionReason: row.interruption_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function toEvent(row: TurnEventRow): TurnEvent {
  return {
    jobId: row.job_id,
    seq: row.seq,
    attempt: row.attempt,
    source: row.source as TurnEventSource,
    type: row.type,
    at: row.at,
    payload: parseJson<JsonValue>(row.payload_json),
    payloadRef: row.payload_ref,
    dedupeKey: row.dedupe_key,
  };
}

function toCheckpoint(row: TurnCheckpointRow): TurnCheckpoint {
  return {
    id: row.id,
    jobId: row.job_id,
    attempt: row.attempt,
    eventSeq: row.event_seq,
    phase: row.phase,
    modelRound: row.model_round,
    continuationRef: row.continuation_ref,
    continuationHash: row.continuation_hash,
    toolEffectId: row.tool_effect_id,
    metadata: parseJson<JsonObject>(row.metadata_json),
    createdAt: row.created_at,
  };
}

function toToolEffect(row: ToolEffectRow): ToolEffectRecord {
  return {
    effectId: row.effect_id,
    jobId: row.job_id,
    logicalSequence: row.logical_sequence,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    argsHash: row.args_hash,
    replayPolicy: row.replay_policy as ToolEffectRecord['replayPolicy'],
    state: row.state as ToolEffectRecord['state'],
    attempt: row.attempt,
    executionCount: row.execution_count,
    resultRef: row.result_ref,
    error: row.error,
    preparedAt: row.prepared_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function toDelivery(row: TurnDeliveryRow): TurnDelivery {
  return {
    id: row.id,
    jobId: row.job_id,
    channel: row.channel,
    destination: row.destination,
    dedupeKey: row.dedupe_key,
    status: row.status as TurnDeliveryStatus,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveredAt: row.delivered_at,
  };
}

function toResourceLease(row: ResourceLeaseRow): ResourceLease {
  return {
    resourceKey: row.resource_key,
    jobId: row.job_id,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
    acquiredAt: row.acquired_at,
    updatedAt: row.updated_at,
  };
}

/**
 * SQLite-WAL-backed authoritative journal for turn work.
 *
 * All compound state transitions run in IMMEDIATE transactions. A worker can
 * only append events, checkpoint, or settle tool effects while its opaque lease
 * token still matches the job row, fencing late messages from a replaced worker.
 */
export class SqliteTurnJobStore {
  private readonly db: Database.Database;
  private readonly clock: () => number;
  private readonly defaultLeaseMs: number;
  private readonly defaultMaxAttempts: number;

  constructor(filePath: string, options: SqliteTurnJobStoreOptions = {}) {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    this.clock = options.now || Date.now;
    this.defaultLeaseMs = positiveInteger('defaultLeaseMs', options.defaultLeaseMs ?? DEFAULT_LEASE_MS, 24 * 60 * 60_000);
    this.defaultMaxAttempts = positiveInteger('defaultMaxAttempts', options.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS, 100);
    const busyTimeoutMs = positiveInteger('busyTimeoutMs', options.busyTimeoutMs ?? 5_000, 60_000);
    this.db = new Database(filePath);
    this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    if (options.reconcileOnOpen !== false) {
      const now = this.clock();
      this.reconcileStaleLeases(now);
      this.reconcileFinalizedJobs({ at: now });
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS turn_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        task_id TEXT,
        goal_id TEXT,
        goal_turn_id TEXT,
        client_request_id TEXT,
        request_fingerprint TEXT NOT NULL,
        payload_ref TEXT NOT NULL,
        actor_context_json TEXT,
        state TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        lease_owner TEXT,
        lease_token TEXT,
        lease_until INTEGER,
        worker_pid INTEGER,
        last_heartbeat_at INTEGER,
        last_event_seq INTEGER NOT NULL DEFAULT 0,
        checkpoint_id TEXT,
        checkpoint_ref TEXT,
        final_ref TEXT,
        last_error TEXT,
        interruption_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_jobs_client_request
        ON turn_jobs(session_id, client_request_id)
        WHERE client_request_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_turn_jobs_claim
        ON turn_jobs(state, priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_turn_jobs_session
        ON turn_jobs(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_turn_jobs_payload_ref
        ON turn_jobs(payload_ref);
      CREATE INDEX IF NOT EXISTS idx_turn_jobs_checkpoint_ref
        ON turn_jobs(checkpoint_ref)
        WHERE checkpoint_ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_turn_jobs_final_ref
        ON turn_jobs(final_ref)
        WHERE final_ref IS NOT NULL;

      CREATE TABLE IF NOT EXISTS turn_events (
        job_id TEXT NOT NULL REFERENCES turn_jobs(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        attempt INTEGER NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        at INTEGER NOT NULL,
        payload_json TEXT,
        payload_ref TEXT,
        dedupe_key TEXT,
        PRIMARY KEY (job_id, seq)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_events_dedupe
        ON turn_events(job_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_turn_events_payload_ref
        ON turn_events(payload_ref)
        WHERE payload_ref IS NOT NULL;

      CREATE TABLE IF NOT EXISTS turn_checkpoints (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES turn_jobs(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        event_seq INTEGER NOT NULL,
        phase TEXT NOT NULL,
        model_round INTEGER,
        continuation_ref TEXT NOT NULL,
        continuation_hash TEXT,
        tool_effect_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(job_id, event_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_turn_checkpoints_job
        ON turn_checkpoints(job_id, event_seq DESC);
      CREATE INDEX IF NOT EXISTS idx_turn_checkpoints_continuation_ref
        ON turn_checkpoints(continuation_ref);

      CREATE TABLE IF NOT EXISTS tool_effects (
        effect_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES turn_jobs(id) ON DELETE CASCADE,
        logical_sequence INTEGER NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        args_hash TEXT NOT NULL,
        replay_policy TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        execution_count INTEGER NOT NULL DEFAULT 0,
        result_ref TEXT,
        error TEXT,
        prepared_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(job_id, logical_sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_effects_job
        ON tool_effects(job_id, logical_sequence ASC);
      CREATE INDEX IF NOT EXISTS idx_tool_effects_state
        ON tool_effects(state, updated_at ASC);
      CREATE INDEX IF NOT EXISTS idx_tool_effects_result_ref
        ON tool_effects(result_ref)
        WHERE result_ref IS NOT NULL;

      CREATE TABLE IF NOT EXISTS turn_deliveries (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES turn_jobs(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        destination TEXT,
        dedupe_key TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        lease_owner TEXT,
        lease_token TEXT,
        lease_until INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        delivered_at INTEGER,
        UNIQUE(job_id, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_turn_deliveries_claim
        ON turn_deliveries(status, created_at ASC);

      CREATE TABLE IF NOT EXISTS resource_leases (
        resource_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES turn_jobs(id) ON DELETE CASCADE,
        lease_owner TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        lease_until INTEGER NOT NULL,
        acquired_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resource_leases_job
        ON resource_leases(job_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  checkpointWal(): void {
    this.db.pragma('wal_checkpoint(PASSIVE)');
  }

  /**
   * Delete a bounded batch of old terminal jobs. Every child record is removed
   * by the schema's ON DELETE CASCADE constraints in the same transaction.
   * Waiting, review, final-persisted, interrupted, queued, and active states are
   * intentionally absent from the predicate and can never be selected here.
   */
  pruneTerminalJobs(options: PruneTerminalTurnJobsOptions): PruneTerminalTurnJobsResult {
    const olderThan = timestamp('olderThan', options.olderThan);
    const limit = positiveInteger('limit', options.limit ?? 500, 10_000);
    const prune = this.db.transaction(() => this.db.prepare(`
      DELETE FROM turn_jobs
      WHERE id IN (
        SELECT id
        FROM turn_jobs
        WHERE state IN ('completed', 'failed', 'cancelled')
          AND completed_at IS NOT NULL
          AND completed_at < ?
        ORDER BY completed_at ASC, id ASC
        LIMIT ?
      )
    `).run(olderThan, limit).changes);
    return { deleted: prune.immediate(), olderThan, limit };
  }

  /**
   * Check every explicit blob-reference column without materializing the full
   * reference set. The supporting indexes keep each bounded GC candidate check
   * independent of journal history size.
   */
  isDirectBlobReference(refInput: string): boolean {
    const ref = validateText('blobRef', refInput, 2_048);
    const row = this.db.prepare(`
      SELECT (
        EXISTS(
          SELECT 1 FROM turn_jobs
          WHERE payload_ref = ? OR checkpoint_ref = ? OR final_ref = ?
        )
        OR EXISTS(SELECT 1 FROM turn_events WHERE payload_ref = ?)
        OR EXISTS(SELECT 1 FROM turn_checkpoints WHERE continuation_ref = ?)
        OR EXISTS(SELECT 1 FROM tool_effects WHERE result_ref = ?)
      ) AS referenced
    `).get(ref, ref, ref, ref, ref, ref) as { referenced: number };
    return row.referenced === 1;
  }

  enqueueJob(input: EnqueueTurnJobInput): EnqueueTurnJobResult {
    const now = timestamp('createdAt', input.createdAt ?? this.clock());
    const id = validateText('id', input.id || randomUUID(), 256);
    const sessionId = validateText('sessionId', input.sessionId, 1_024);
    const clientRequestId = optionalText('clientRequestId', input.clientRequestId, 1_024);
    const fingerprint = validateText('requestFingerprint', input.requestFingerprint, 512);
    const payloadRef = validateText('payloadRef', input.payloadRef, 2_048);
    const maxAttempts = positiveInteger('maxAttempts', input.maxAttempts ?? this.defaultMaxAttempts, 100);
    const priority = input.priority ?? 0;
    if (!Number.isSafeInteger(priority) || priority < -1_000_000 || priority > 1_000_000) {
      throw new RangeError('priority must be a safe integer between -1000000 and 1000000');
    }
    const actorContextJson = input.actorContext == null ? null : canonicalJson(input.actorContext);

    const enqueue = this.db.transaction((): EnqueueTurnJobResult => {
      if (clientRequestId) {
        const existing = this.db.prepare(`
          SELECT * FROM turn_jobs WHERE session_id = ? AND client_request_id = ?
        `).get(sessionId, clientRequestId) as TurnJobRow | undefined;
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw new TurnJobIdempotencyConflictError(sessionId, clientRequestId);
          }
          return { job: toJob(existing), created: false };
        }
      }

      this.db.prepare(`
        INSERT INTO turn_jobs(
          id, session_id, kind, task_id, goal_id, goal_turn_id,
          client_request_id, request_fingerprint, payload_ref, actor_context_json,
          state, priority, attempt, max_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?)
      `).run(
        id,
        sessionId,
        input.kind,
        optionalText('taskId', input.taskId, 1_024),
        optionalText('goalId', input.goalId, 1_024),
        optionalText('goalTurnId', input.goalTurnId, 1_024),
        clientRequestId,
        fingerprint,
        payloadRef,
        actorContextJson,
        priority,
        maxAttempts,
        now,
        now,
      );
      const job = this.requireJobRow(id);
      this.insertEvent(job.id, 0, 'gateway', {
        type: 'job_queued',
        at: now,
        dedupeKey: 'job_queued',
        payload: { kind: input.kind, priority },
      });
      return { job: toJob(this.requireJobRow(id)), created: true };
    });

    try {
      return enqueue.immediate();
    } catch (error) {
      // A concurrent connection may win the partial unique index between the
      // initial lookup and INSERT. Resolve it to the same idempotent outcome.
      if (clientRequestId && String((error as Error).message).includes('UNIQUE constraint failed')) {
        const existing = this.db.prepare(`
          SELECT * FROM turn_jobs WHERE session_id = ? AND client_request_id = ?
        `).get(sessionId, clientRequestId) as TurnJobRow | undefined;
        if (existing && existing.request_fingerprint === fingerprint) return { job: toJob(existing), created: false };
        if (existing) throw new TurnJobIdempotencyConflictError(sessionId, clientRequestId);
      }
      throw error;
    }
  }

  getJob(jobId: string): TurnJob | null {
    const row = this.db.prepare('SELECT * FROM turn_jobs WHERE id = ?').get(jobId) as TurnJobRow | undefined;
    return row ? toJob(row) : null;
  }

  getJobByClientRequestId(sessionIdInput: string, clientRequestIdInput: string): TurnJob | null {
    const sessionId = validateText('sessionId', sessionIdInput, 1_024);
    const clientRequestId = validateText('clientRequestId', clientRequestIdInput, 512);
    const row = this.db.prepare(`
      SELECT * FROM turn_jobs WHERE session_id = ? AND client_request_id = ? LIMIT 1
    `).get(sessionId, clientRequestId) as TurnJobRow | undefined;
    return row ? toJob(row) : null;
  }

  /** Remove only a brand-new row that never acquired a worker/session lease. */
  deleteUnclaimedJob(jobId: string): boolean {
    validateText('jobId', jobId, 256);
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM turn_jobs WHERE id = ?').get(jobId) as TurnJobRow | undefined;
      if (!row) return false;
      if (row.state !== 'queued' || row.attempt !== 0 || row.lease_token !== null) return false;
      return this.db.prepare(`
        DELETE FROM turn_jobs
        WHERE id = ? AND state = 'queued' AND attempt = 0 AND lease_token IS NULL
      `).run(jobId).changes === 1;
    });
    return transaction.immediate();
  }

  listJobs(options: ListTurnJobsOptions = {}): TurnJob[] {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.sessionId) {
      conditions.push('session_id = ?');
      parameters.push(options.sessionId);
    }
    if (options.states?.length) {
      conditions.push(`state IN (${options.states.map(() => '?').join(', ')})`);
      parameters.push(...options.states);
    }
    const limit = positiveInteger('limit', options.limit ?? 100, 10_000);
    parameters.push(limit);
    const rows = this.db.prepare(`
      SELECT * FROM turn_jobs
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...parameters) as TurnJobRow[];
    return rows.map(toJob);
  }

  claimNextJob(options: ClaimTurnJobOptions): TurnJobLease | null {
    const now = timestamp('now', options.now ?? this.clock());
    const leaseOwner = validateText('leaseOwner', options.leaseOwner, 512);
    const leaseMs = positiveInteger('leaseMs', options.leaseMs ?? this.defaultLeaseMs, 24 * 60 * 60_000);
    const leaseUntil = now + leaseMs;
    if (!Number.isSafeInteger(leaseUntil)) throw new RangeError('leaseUntil exceeds the safe integer range');
    const workerPid = options.workerPid == null ? null : positiveInteger('workerPid', options.workerPid);
    const kinds = options.kinds?.length ? [...new Set(options.kinds)] : null;

    const claim = this.db.transaction((): TurnJobLease | null => {
      this.db.prepare('DELETE FROM resource_leases WHERE lease_until <= ?').run(now);

      const conditions = [
        `j.state IN (${CLAIMABLE_TURN_JOB_STATES.map(() => '?').join(', ')})`,
        'j.attempt < j.max_attempts',
        `NOT EXISTS (
          SELECT 1 FROM resource_leases r
          WHERE r.resource_key = ('session:' || j.session_id) AND r.lease_until > ?
        )`,
      ];
      const parameters: Array<string | number> = [...CLAIMABLE_TURN_JOB_STATES, now];
      if (options.sessionId) {
        conditions.push('j.session_id = ?');
        parameters.push(validateText('sessionId', options.sessionId, 1_024));
      }
      if (kinds) {
        conditions.push(`j.kind IN (${kinds.map(() => '?').join(', ')})`);
        parameters.push(...kinds);
      }

      const row = this.db.prepare(`
        SELECT j.* FROM turn_jobs j
        WHERE ${conditions.join(' AND ')}
        ORDER BY j.priority DESC, j.created_at ASC, j.id ASC
        LIMIT 1
      `).get(...parameters) as TurnJobRow | undefined;
      if (!row) return null;
      return this.leaseJobRow(row, leaseOwner, workerPid, now, leaseUntil);
    });
    return claim.immediate();
  }

  claimJob(jobId: string, options: ClaimSpecificTurnJobOptions): TurnJobLease | null {
    validateText('jobId', jobId, 256);
    const now = timestamp('now', options.now ?? this.clock());
    const leaseOwner = validateText('leaseOwner', options.leaseOwner, 512);
    const leaseMs = positiveInteger('leaseMs', options.leaseMs ?? this.defaultLeaseMs, 24 * 60 * 60_000);
    const leaseUntil = now + leaseMs;
    if (!Number.isSafeInteger(leaseUntil)) throw new RangeError('leaseUntil exceeds the safe integer range');
    const workerPid = options.workerPid == null ? null : positiveInteger('workerPid', options.workerPid);

    const claim = this.db.transaction((): TurnJobLease | null => {
      this.db.prepare('DELETE FROM resource_leases WHERE lease_until <= ?').run(now);
      const row = this.db.prepare('SELECT * FROM turn_jobs WHERE id = ?').get(jobId) as TurnJobRow | undefined;
      if (
        !row
        || !CLAIMABLE_TURN_JOB_STATES.includes(row.state as TurnJobState)
        || row.attempt >= row.max_attempts
      ) return null;
      return this.leaseJobRow(row, leaseOwner, workerPid, now, leaseUntil);
    });
    return claim.immediate();
  }

  markJobRunning(jobId: string, leaseToken: string, at = this.clock()): TurnJob {
    const now = timestamp('at', at);
    const transaction = this.db.transaction(() => {
      const row = this.requireActiveLease(jobId, leaseToken);
      if (row.state === 'running') return toJob(row);
      if (row.state !== 'leased') throw new TurnJobStateError(jobId, row.state, 'start');
      this.db.prepare(`
        UPDATE turn_jobs SET state = 'running', updated_at = ?
        WHERE id = ? AND lease_token = ? AND state = 'leased'
      `).run(now, jobId, leaseToken);
      this.insertEvent(jobId, row.attempt, 'worker', {
        type: 'job_started',
        at: now,
        dedupeKey: `job_started:${row.attempt}`,
      });
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  heartbeatJob(jobId: string, leaseToken: string, leaseMs = this.defaultLeaseMs, at = this.clock()): TurnJob {
    const now = timestamp('at', at);
    const duration = positiveInteger('leaseMs', leaseMs, 24 * 60 * 60_000);
    const leaseUntil = now + duration;
    const transaction = this.db.transaction(() => {
      this.requireActiveLease(jobId, leaseToken);
      const updated = this.db.prepare(`
        UPDATE turn_jobs
        SET lease_until = ?, last_heartbeat_at = ?, updated_at = ?
        WHERE id = ? AND lease_token = ? AND state IN ('leased', 'running')
      `).run(leaseUntil, now, now, jobId, leaseToken);
      if (updated.changes !== 1) throw new TurnJobLeaseLostError(jobId);
      const resources = this.db.prepare(`
        UPDATE resource_leases SET lease_until = ?, updated_at = ?
        WHERE job_id = ? AND lease_token = ?
      `).run(leaseUntil, now, jobId, leaseToken);
      if (resources.changes < 1) throw new TurnJobLeaseLostError(jobId);
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  appendWorkerEvent(jobId: string, leaseToken: string, input: AppendTurnEventInput): TurnEvent {
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      return this.insertEvent(jobId, job.attempt, 'worker', input);
    });
    return transaction.immediate();
  }

  appendGatewayEvent(jobId: string, input: AppendTurnEventInput): TurnEvent {
    const transaction = this.db.transaction(() => {
      const job = this.requireJobRow(jobId);
      return this.insertEvent(jobId, job.attempt, 'gateway', input);
    });
    return transaction.immediate();
  }

  listEvents(jobId: string, afterSeq = 0, limit = 1_000): TurnEvent[] {
    timestamp('afterSeq', afterSeq);
    positiveInteger('limit', limit, 10_000);
    const rows = this.db.prepare(`
      SELECT * FROM turn_events
      WHERE job_id = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(jobId, afterSeq, limit) as TurnEventRow[];
    return rows.map(toEvent);
  }

  saveCheckpoint(jobId: string, leaseToken: string, input: SaveTurnCheckpointInput): TurnCheckpoint {
    const now = timestamp('at', input.at ?? this.clock());
    const checkpointId = validateText('checkpointId', input.id || randomUUID(), 256);
    const phase = validateText('phase', input.phase, 256);
    const continuationRef = validateText('continuationRef', input.continuationRef, 2_048);
    const continuationHash = optionalText('continuationHash', input.continuationHash, 512);
    const toolEffectId = optionalText('toolEffectId', input.toolEffectId, 512);
    const modelRound = input.modelRound == null ? null : positiveInteger('modelRound', input.modelRound, 1_000_000);
    const metadataJson = input.metadata == null ? null : canonicalJson(input.metadata);

    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      const existing = this.db.prepare('SELECT * FROM turn_checkpoints WHERE id = ?').get(checkpointId) as TurnCheckpointRow | undefined;
      if (existing) {
        if (
          existing.job_id !== jobId
          || existing.phase !== phase
          || existing.model_round !== modelRound
          || existing.continuation_ref !== continuationRef
          || existing.continuation_hash !== continuationHash
          || existing.tool_effect_id !== toolEffectId
          || existing.metadata_json !== metadataJson
        ) throw new TurnJobStoreError(`Checkpoint ${checkpointId} conflicts with its durable record`);
        return toCheckpoint(existing);
      }

      const event = this.insertEvent(jobId, job.attempt, 'worker', {
        type: 'checkpoint_saved',
        at: now,
        dedupeKey: `checkpoint:${checkpointId}`,
        payload: {
          checkpointId,
          phase,
          modelRound,
          continuationRef,
          continuationHash,
          toolEffectId,
        },
      });
      this.db.prepare(`
        INSERT INTO turn_checkpoints(
          id, job_id, attempt, event_seq, phase, model_round, continuation_ref,
          continuation_hash, tool_effect_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpointId,
        jobId,
        job.attempt,
        event.seq,
        phase,
        modelRound,
        continuationRef,
        continuationHash,
        toolEffectId,
        metadataJson,
        now,
      );
      const updated = this.db.prepare(`
        UPDATE turn_jobs SET checkpoint_id = ?, checkpoint_ref = ?, updated_at = ?
        WHERE id = ? AND lease_token = ?
      `).run(checkpointId, continuationRef, now, jobId, leaseToken);
      if (updated.changes !== 1) throw new TurnJobLeaseLostError(jobId);
      return toCheckpoint(this.requireCheckpointRow(checkpointId));
    });
    return transaction.immediate();
  }

  getLatestCheckpoint(jobId: string): TurnCheckpoint | null {
    const row = this.db.prepare(`
      SELECT * FROM turn_checkpoints WHERE job_id = ? ORDER BY event_seq DESC LIMIT 1
    `).get(jobId) as TurnCheckpointRow | undefined;
    return row ? toCheckpoint(row) : null;
  }

  listCheckpoints(jobId: string, limit = 100): TurnCheckpoint[] {
    positiveInteger('limit', limit, 10_000);
    const rows = this.db.prepare(`
      SELECT * FROM turn_checkpoints WHERE job_id = ? ORDER BY event_seq DESC LIMIT ?
    `).all(jobId, limit) as TurnCheckpointRow[];
    return rows.map(toCheckpoint);
  }

  prepareToolEffect(jobId: string, leaseToken: string, input: PrepareToolEffectInput): ToolEffectRecord {
    const now = timestamp('at', input.at ?? this.clock());
    const logicalSequence = positiveInteger('logicalSequence', input.logicalSequence, 10_000_000);
    const effectId = validateText('effectId', input.effectId || `${jobId}:effect:${logicalSequence}`, 512);
    const toolCallId = validateText('toolCallId', input.toolCallId, 512);
    const toolName = validateText('toolName', input.toolName, 512);
    const argsHash = validateText('argsHash', input.argsHash, 512);

    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      const existing = this.findToolEffect(jobId, effectId, logicalSequence);
      if (existing) {
        if (
          existing.job_id !== jobId
          || existing.logical_sequence !== logicalSequence
          || existing.tool_name !== toolName
          || existing.args_hash !== argsHash
          || existing.replay_policy !== input.replayPolicy
        ) throw new ToolEffectConflictError(effectId);
        // Provider tool-call IDs are diagnostic, not the replay identity, and
        // can legitimately change when a checkpoint is submitted again.
        if (existing.tool_call_id !== toolCallId && existing.state !== 'running' && existing.state !== 'succeeded') {
          this.db.prepare(`
            UPDATE tool_effects SET tool_call_id = ?, attempt = ?, updated_at = ?
            WHERE effect_id = ?
          `).run(toolCallId, job.attempt, now, existing.effect_id);
        }
        return toToolEffect(this.requireToolEffectRow(existing.effect_id));
      }

      this.db.prepare(`
        INSERT INTO tool_effects(
          effect_id, job_id, logical_sequence, tool_call_id, tool_name, args_hash,
          replay_policy, state, attempt, execution_count, prepared_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, 0, ?, ?)
      `).run(
        effectId,
        jobId,
        logicalSequence,
        toolCallId,
        toolName,
        argsHash,
        input.replayPolicy,
        job.attempt,
        now,
        now,
      );
      this.insertEvent(jobId, job.attempt, 'worker', {
        type: 'tool_effect_prepared',
        at: now,
        dedupeKey: `tool_effect_prepared:${effectId}`,
        payload: { effectId, logicalSequence, toolCallId, toolName, argsHash, replayPolicy: input.replayPolicy },
      });
      return toToolEffect(this.requireToolEffectRow(effectId));
    });
    return transaction.immediate();
  }

  beginToolEffect(jobId: string, leaseToken: string, effectId: string, at = this.clock()): BeginToolEffectResult {
    const now = timestamp('at', at);
    const transaction = this.db.transaction((): BeginToolEffectResult => {
      const job = this.requireActiveLease(jobId, leaseToken);
      const effect = this.requireToolEffectRow(effectId);
      if (effect.job_id !== jobId) throw new ToolEffectConflictError(effectId);

      if (effect.state === 'succeeded') return { effect: toToolEffect(effect), disposition: 'reuse_result' };
      if (effect.state === 'running') {
        return {
          effect: toToolEffect(effect),
          disposition: effect.attempt === job.attempt ? 'already_running' : 'needs_review',
        };
      }
      if (
        (effect.state === 'unknown' || effect.state === 'failed')
        && effect.replay_policy !== 'safe_retry'
      ) {
        return { effect: toToolEffect(effect), disposition: 'needs_review' };
      }

      const updated = this.db.prepare(`
        UPDATE tool_effects
        SET state = 'running', attempt = ?, execution_count = execution_count + 1,
            result_ref = NULL, error = NULL, started_at = ?, finished_at = NULL, updated_at = ?
        WHERE effect_id = ? AND state IN ('prepared', 'failed', 'unknown')
      `).run(job.attempt, now, now, effectId);
      if (updated.changes !== 1) throw new TurnJobStateError(jobId, effect.state, `begin tool effect ${effectId}`);
      this.insertEvent(jobId, job.attempt, 'worker', {
        type: 'tool_effect_started',
        at: now,
        dedupeKey: `tool_effect_started:${effectId}:${job.attempt}`,
        payload: { effectId, executionCount: effect.execution_count + 1 },
      });
      return { effect: toToolEffect(this.requireToolEffectRow(effectId)), disposition: 'execute' };
    });
    return transaction.immediate();
  }

  completeToolEffect(jobId: string, leaseToken: string, effectId: string, resultRef: string, at = this.clock()): ToolEffectRecord {
    const now = timestamp('at', at);
    const normalizedResultRef = validateText('resultRef', resultRef, 2_048);
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      const effect = this.requireToolEffectRow(effectId);
      if (effect.job_id !== jobId) throw new ToolEffectConflictError(effectId);
      if (effect.state === 'succeeded') {
        if (effect.result_ref !== normalizedResultRef) throw new ToolEffectConflictError(effectId);
        return toToolEffect(effect);
      }
      if (effect.state !== 'running' || effect.attempt !== job.attempt) {
        throw new TurnJobStateError(jobId, effect.state, `complete tool effect ${effectId}`);
      }
      this.db.prepare(`
        UPDATE tool_effects
        SET state = 'succeeded', result_ref = ?, error = NULL, finished_at = ?, updated_at = ?
        WHERE effect_id = ? AND state = 'running' AND attempt = ?
      `).run(normalizedResultRef, now, now, effectId, job.attempt);
      this.insertEvent(jobId, job.attempt, 'worker', {
        type: 'tool_effect_succeeded',
        at: now,
        dedupeKey: `tool_effect_succeeded:${effectId}`,
        payload: { effectId, resultRef: normalizedResultRef },
      });
      return toToolEffect(this.requireToolEffectRow(effectId));
    });
    return transaction.immediate();
  }

  failToolEffect(jobId: string, leaseToken: string, effectId: string, error: string, at = this.clock()): ToolEffectRecord {
    const now = timestamp('at', at);
    const normalizedError = errorText(error);
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      const effect = this.requireToolEffectRow(effectId);
      if (effect.job_id !== jobId) throw new ToolEffectConflictError(effectId);
      if (effect.state === 'failed' && effect.attempt === job.attempt) return toToolEffect(effect);
      if (effect.state !== 'running' || effect.attempt !== job.attempt) {
        throw new TurnJobStateError(jobId, effect.state, `fail tool effect ${effectId}`);
      }
      this.db.prepare(`
        UPDATE tool_effects
        SET state = 'failed', result_ref = NULL, error = ?, finished_at = ?, updated_at = ?
        WHERE effect_id = ? AND state = 'running' AND attempt = ?
      `).run(normalizedError, now, now, effectId, job.attempt);
      this.insertEvent(jobId, job.attempt, 'worker', {
        type: 'tool_effect_failed',
        at: now,
        dedupeKey: `tool_effect_failed:${effectId}:${job.attempt}`,
        payload: { effectId, error: normalizedError },
      });
      return toToolEffect(this.requireToolEffectRow(effectId));
    });
    return transaction.immediate();
  }

  getToolEffect(effectId: string): ToolEffectRecord | null {
    const row = this.db.prepare('SELECT * FROM tool_effects WHERE effect_id = ?').get(effectId) as ToolEffectRow | undefined;
    return row ? toToolEffect(row) : null;
  }

  listToolEffects(jobId: string): ToolEffectRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM tool_effects WHERE job_id = ? ORDER BY logical_sequence ASC
    `).all(jobId) as ToolEffectRow[];
    return rows.map(toToolEffect);
  }

  markJobWaiting(
    jobId: string,
    leaseToken: string,
    state: 'waiting_approval' | 'waiting_user',
    reason: string,
    at = this.clock(),
  ): TurnJob {
    const now = timestamp('at', at);
    const normalizedReason = errorText(reason);
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      this.insertEvent(jobId, job.attempt, 'worker', {
        type: state,
        at: now,
        payload: { reason: normalizedReason },
      });
      this.clearJobLease(jobId, leaseToken);
      this.db.prepare(`
        UPDATE turn_jobs
        SET state = ?, interruption_reason = ?, updated_at = ?
        WHERE id = ?
      `).run(state, normalizedReason, now, jobId);
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  resumeWaitingJob(jobId: string, at = this.clock()): TurnJob {
    const now = timestamp('at', at);
    const transaction = this.db.transaction(() => {
      const job = this.requireJobRow(jobId);
      if (job.state !== 'waiting_approval' && job.state !== 'waiting_user' && job.state !== 'needs_review') {
        throw new TurnJobStateError(jobId, job.state, 'resume');
      }
      const nextState: TurnJobState = job.checkpoint_ref ? 'checkpointed' : 'interrupted';
      this.db.prepare(`
        UPDATE turn_jobs SET state = ?, interruption_reason = NULL, updated_at = ? WHERE id = ?
      `).run(nextState, now, jobId);
      this.insertEvent(jobId, job.attempt, 'gateway', {
        type: 'job_resumed',
        at: now,
        payload: { previousState: job.state, nextState },
      });
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  pauseJobForReview(jobId: string, leaseToken: string, reason: string, at = this.clock()): TurnJob {
    return this.endActiveAttempt(jobId, leaseToken, 'needs_review', reason, 'job_needs_review', at);
  }

  failJob(jobId: string, leaseToken: string, error: string, retryable = false, at = this.clock()): TurnJob {
    const now = timestamp('at', at);
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      const normalizedError = errorText(error);
      const runningEffects = this.db.prepare(`
        SELECT * FROM tool_effects
        WHERE job_id = ? AND state = 'running' AND attempt = ?
        ORDER BY logical_sequence ASC
      `).all(jobId, job.attempt) as ToolEffectRow[];
      if (runningEffects.length) {
        this.db.prepare(`
          UPDATE tool_effects
          SET state = 'unknown', error = ?, updated_at = ?
          WHERE job_id = ? AND state = 'running' AND attempt = ?
        `).run('Turn failed before the running tool outcome was durably recorded', now, jobId, job.attempt);
      }
      const requiresReview = runningEffects.some((effect) => effect.replay_policy !== 'safe_retry');
      const nextState: TurnJobState = requiresReview
        ? 'needs_review'
        : retryable && job.attempt < job.max_attempts
          ? (job.checkpoint_ref ? 'checkpointed' : 'interrupted')
          : 'failed';
      this.insertEvent(jobId, job.attempt, 'worker', {
        type: nextState === 'needs_review'
          ? 'job_needs_review'
          : nextState === 'failed'
            ? 'job_failed'
            : 'job_interrupted',
        at: now,
        payload: {
          error: normalizedError,
          retryable,
          uncertainEffectIds: runningEffects.map((effect) => effect.effect_id),
        },
      });
      this.clearJobLease(jobId, leaseToken);
      this.db.prepare(`
        UPDATE turn_jobs
        SET state = ?, last_error = ?, interruption_reason = ?, updated_at = ?,
            completed_at = CASE WHEN ? = 'failed' THEN ? ELSE NULL END
        WHERE id = ?
      `).run(nextState, normalizedError, normalizedError, now, nextState, now, jobId);
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  /**
   * End an active lease for an orderly gateway restart without applying either
   * operator-cancel or failed-attempt semantics. A tool that was in flight has
   * an uncertain outcome, so normal replay-policy review rules still apply.
   */
  interruptLeasedJob(jobId: string, leaseToken: string, reason = 'gateway restart', at = this.clock()): TurnJob {
    const now = timestamp('at', at);
    const normalizedReason = errorText(reason);
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      const runningEffects = this.db.prepare(`
        SELECT * FROM tool_effects
        WHERE job_id = ? AND state = 'running' AND attempt = ?
        ORDER BY logical_sequence ASC
      `).all(jobId, job.attempt) as ToolEffectRow[];
      if (runningEffects.length) {
        this.db.prepare(`
          UPDATE tool_effects
          SET state = 'unknown', error = ?, updated_at = ?
          WHERE job_id = ? AND state = 'running' AND attempt = ?
        `).run('Gateway restarted before the running tool outcome was durably recorded', now, jobId, job.attempt);
      }
      const requiresReview = runningEffects.some((effect) => effect.replay_policy !== 'safe_retry');
      const nextState: TurnJobState = requiresReview
        ? 'needs_review'
        : job.checkpoint_ref
          ? 'checkpointed'
          : 'interrupted';
      this.insertEvent(jobId, job.attempt, 'gateway', {
        type: requiresReview ? 'job_needs_review' : 'job_interrupted',
        at: now,
        payload: {
          reason: normalizedReason,
          orderlyRestart: true,
          uncertainEffectIds: runningEffects.map((effect) => effect.effect_id),
        },
      });
      this.clearJobLease(jobId, leaseToken);
      this.db.prepare(`
        UPDATE turn_jobs
        SET state = ?, interruption_reason = ?, updated_at = ?, completed_at = NULL
        WHERE id = ?
      `).run(nextState, normalizedReason, now, jobId);
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  cancelJob(jobId: string, reason = 'cancelled', at = this.clock()): TurnJob {
    return this.cancelJobInsideTransaction(jobId, reason, at, null);
  }

  /** Cancel only while the caller still owns the active opaque lease token. */
  cancelLeasedJob(jobId: string, leaseToken: string, reason = 'cancelled', at = this.clock()): TurnJob {
    return this.cancelJobInsideTransaction(jobId, reason, at, validateText('leaseToken', leaseToken, 512));
  }

  private cancelJobInsideTransaction(
    jobId: string,
    reason: string,
    at: number,
    leaseToken: string | null,
  ): TurnJob {
    const now = timestamp('at', at);
    const normalizedReason = errorText(reason);
    const transaction = this.db.transaction(() => {
      const job = leaseToken
        ? this.requireActiveLease(jobId, leaseToken)
        : this.requireJobRow(jobId);
      if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') return toJob(job);
      this.db.prepare(`
        UPDATE tool_effects
        SET state = 'unknown', error = ?, updated_at = ?
        WHERE job_id = ? AND state = 'running'
      `).run('Turn was cancelled before the running tool outcome was durably recorded', now, jobId);
      this.insertEvent(jobId, job.attempt, 'gateway', {
        type: 'job_cancelled',
        at: now,
        payload: { reason: normalizedReason },
      });
      this.db.prepare('DELETE FROM resource_leases WHERE job_id = ?').run(jobId);
      this.db.prepare(`
        UPDATE turn_jobs
        SET state = 'cancelled', lease_owner = NULL, lease_token = NULL, lease_until = NULL,
            worker_pid = NULL, last_heartbeat_at = NULL, interruption_reason = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(normalizedReason, now, now, jobId);
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  persistFinal(jobId: string, leaseToken: string, input: PersistTurnFinalInput): PersistTurnFinalResult {
    const now = timestamp('at', input.at ?? this.clock());
    const finalRef = validateText('finalRef', input.finalRef, 2_048);
    const deliveries = input.deliveries || [];
    const dedupeKeys = new Set<string>();
    for (const delivery of deliveries) {
      const dedupeKey = validateText('delivery.dedupeKey', delivery.dedupeKey, 512);
      if (dedupeKeys.has(dedupeKey)) throw new TypeError(`Duplicate final delivery dedupe key: ${dedupeKey}`);
      dedupeKeys.add(dedupeKey);
      validateText('delivery.channel', delivery.channel, 256);
      optionalText('delivery.destination', delivery.destination, 2_048);
      positiveInteger('delivery.maxAttempts', delivery.maxAttempts ?? DEFAULT_DELIVERY_MAX_ATTEMPTS, 1_000);
    }

    const transaction = this.db.transaction((): PersistTurnFinalResult => {
      const current = this.requireJobRow(jobId);
      if (current.state === 'final_persisted' || current.state === 'completed') {
        if (current.final_ref !== finalRef) throw new TurnJobStateError(jobId, current.state, 'replace its final result');
        const event = this.db.prepare(`
          SELECT * FROM turn_events WHERE job_id = ? AND dedupe_key = 'turn_final' LIMIT 1
        `).get(jobId) as TurnEventRow | undefined;
        if (!event) throw new TurnJobStoreError(`Turn job ${jobId} has a final reference without a final event`);
        return { job: toJob(current), event: toEvent(event), deliveries: this.listDeliveries(jobId) };
      }

      const job = this.requireActiveLease(jobId, leaseToken);
      const unsettledEffect = this.db.prepare(`
        SELECT * FROM tool_effects
        WHERE job_id = ? AND state IN ('prepared', 'running')
        ORDER BY logical_sequence ASC LIMIT 1
      `).get(jobId) as ToolEffectRow | undefined;
      if (unsettledEffect) {
        throw new TurnJobStateError(
          jobId,
          `${unsettledEffect.state} tool effect ${unsettledEffect.effect_id}`,
          'persist its final result',
        );
      }
      const eventPayload: JsonValue = input.payload ?? { finalRef };
      const event = this.insertEvent(jobId, job.attempt, 'worker', {
        type: 'final',
        at: now,
        dedupeKey: 'turn_final',
        payload: eventPayload,
        payloadRef: input.payloadRef ?? finalRef,
      });

      for (const delivery of deliveries) {
        this.db.prepare(`
          INSERT INTO turn_deliveries(
            id, job_id, channel, destination, dedupe_key, status, attempts,
            max_attempts, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
        `).run(
          validateText('delivery.id', delivery.id || randomUUID(), 256),
          jobId,
          validateText('delivery.channel', delivery.channel, 256),
          optionalText('delivery.destination', delivery.destination, 2_048),
          validateText('delivery.dedupeKey', delivery.dedupeKey, 512),
          positiveInteger('delivery.maxAttempts', delivery.maxAttempts ?? DEFAULT_DELIVERY_MAX_ATTEMPTS, 1_000),
          now,
          now,
        );
      }

      this.clearJobLease(jobId, leaseToken);
      this.db.prepare(`
        UPDATE turn_jobs
        SET state = 'final_persisted', final_ref = ?, last_error = NULL,
            interruption_reason = NULL, updated_at = ?
        WHERE id = ?
      `).run(finalRef, now, jobId);
      return {
        job: toJob(this.requireJobRow(jobId)),
        event,
        deliveries: this.listDeliveries(jobId),
      };
    });
    return transaction.immediate();
  }

  completeFinalizedJob(jobId: string, at = this.clock()): TurnJob {
    const now = timestamp('at', at);
    const transaction = this.db.transaction(() => {
      const job = this.requireJobRow(jobId);
      if (job.state === 'completed') return toJob(job);
      if (job.state !== 'final_persisted' || !job.final_ref) {
        throw new TurnJobStateError(jobId, job.state, 'complete final persistence');
      }
      this.db.prepare(`
        UPDATE turn_jobs SET state = 'completed', updated_at = ?, completed_at = ? WHERE id = ?
      `).run(now, now, jobId);
      this.insertEvent(jobId, job.attempt, 'gateway', {
        type: 'job_completed',
        at: now,
        dedupeKey: 'job_completed',
        payload: { finalRef: job.final_ref },
      });
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  /**
   * Finish the narrow crash window after a final blob and authoritative session
   * were committed but before the caller acknowledged terminal publication.
   *
   * This is intentionally not a delivery worker. A row that has even one
   * outbox record is left in `final_persisted` regardless of that delivery's
   * current status, so recovery can never erase explicit delivery intent. The
   * recovered final remains available through the normal idempotent
   * session/client-request replay path after the job becomes `completed`.
   */
  reconcileFinalizedJobs(
    options: ReconcileFinalizedTurnJobsOptions = {},
  ): ReconcileFinalizedTurnJobsResult {
    const now = timestamp('at', options.at ?? this.clock());
    const limit = positiveInteger('limit', options.limit ?? 500, 10_000);
    const transaction = this.db.transaction((): ReconcileFinalizedTurnJobsResult => {
      const rows = this.db.prepare(`
        SELECT j.*
        FROM turn_jobs j
        WHERE j.state = 'final_persisted'
          AND j.final_ref IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM turn_deliveries d WHERE d.job_id = j.id
          )
        ORDER BY j.updated_at ASC, j.id ASC
        LIMIT ?
      `).all(limit) as TurnJobRow[];
      const recoveredJobIds: string[] = [];

      for (const row of rows) {
        const updated = this.db.prepare(`
          UPDATE turn_jobs
          SET state = 'completed', updated_at = ?, completed_at = ?
          WHERE id = ? AND state = 'final_persisted' AND final_ref = ?
            AND NOT EXISTS (
              SELECT 1 FROM turn_deliveries d WHERE d.job_id = turn_jobs.id
            )
        `).run(now, now, row.id, row.final_ref);
        if (updated.changes !== 1) continue;
        this.insertEvent(row.id, row.attempt, 'recovery', {
          type: 'job_completed',
          at: now,
          dedupeKey: 'job_completed',
          payload: { finalRef: row.final_ref, recovered: true },
        });
        recoveredJobIds.push(row.id);
      }

      const remaining = this.db.prepare(`
        SELECT
          SUM(CASE WHEN NOT EXISTS (
            SELECT 1 FROM turn_deliveries d WHERE d.job_id = j.id
          ) THEN 1 ELSE 0 END) AS recoverable,
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM turn_deliveries d WHERE d.job_id = j.id
          ) THEN 1 ELSE 0 END) AS deferred
        FROM turn_jobs j
        WHERE j.state = 'final_persisted'
      `).get() as { recoverable: number | null; deferred: number | null };

      return {
        recovered: recoveredJobIds.length,
        recoveredJobIds,
        remainingRecoverable: Number(remaining.recoverable || 0),
        deferredWithDeliveries: Number(remaining.deferred || 0),
        at: now,
        limit,
      };
    });
    return transaction.immediate();
  }

  getDelivery(deliveryId: string): TurnDelivery | null {
    const row = this.db.prepare('SELECT * FROM turn_deliveries WHERE id = ?').get(deliveryId) as TurnDeliveryRow | undefined;
    return row ? toDelivery(row) : null;
  }

  listDeliveries(jobId: string): TurnDelivery[] {
    const rows = this.db.prepare(`
      SELECT * FROM turn_deliveries WHERE job_id = ? ORDER BY created_at ASC, id ASC
    `).all(jobId) as TurnDeliveryRow[];
    return rows.map(toDelivery);
  }

  claimNextDelivery(options: ClaimTurnDeliveryOptions): TurnDeliveryLease | null {
    const now = timestamp('now', options.now ?? this.clock());
    const leaseOwner = validateText('leaseOwner', options.leaseOwner, 512);
    const leaseMs = positiveInteger('leaseMs', options.leaseMs ?? this.defaultLeaseMs, 24 * 60 * 60_000);
    const leaseUntil = now + leaseMs;
    const channels = options.channels?.length ? [...new Set(options.channels.map((channel) => validateText('channel', channel, 256)))] : null;

    const transaction = this.db.transaction((): TurnDeliveryLease | null => {
      this.reconcileDeliveryLeasesInsideTransaction(now);
      const conditions = [`status = 'pending'`, 'attempts < max_attempts'];
      const parameters: Array<string | number> = [];
      if (channels) {
        conditions.push(`channel IN (${channels.map(() => '?').join(', ')})`);
        parameters.push(...channels);
      }
      const row = this.db.prepare(`
        SELECT * FROM turn_deliveries
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `).get(...parameters) as TurnDeliveryRow | undefined;
      if (!row) return null;
      const token = newToken();
      const updated = this.db.prepare(`
        UPDATE turn_deliveries
        SET status = 'processing', attempts = attempts + 1, lease_owner = ?, lease_token = ?,
            lease_until = ?, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'pending' AND attempts = ? AND attempts < max_attempts
      `).run(leaseOwner, token, leaseUntil, now, row.id, row.attempts);
      if (updated.changes !== 1) return null;
      const delivery = toDelivery(this.requireDeliveryRow(row.id));
      this.insertEvent(row.job_id, this.requireJobRow(row.job_id).attempt, 'gateway', {
        type: 'delivery_claimed',
        at: now,
        payload: { deliveryId: row.id, channel: row.channel, attempt: delivery.attempts },
      });
      return { delivery, token, leaseUntil };
    });
    return transaction.immediate();
  }

  completeDelivery(deliveryId: string, leaseToken: string, at = this.clock()): boolean {
    const now = timestamp('at', at);
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM turn_deliveries WHERE id = ? AND status = 'processing' AND lease_token = ?
      `).get(deliveryId, leaseToken) as TurnDeliveryRow | undefined;
      if (!row) return false;
      const updated = this.db.prepare(`
        UPDATE turn_deliveries
        SET status = 'delivered', lease_owner = NULL, lease_token = NULL, lease_until = NULL,
            last_error = NULL, updated_at = ?, delivered_at = ?
        WHERE id = ? AND status = 'processing' AND lease_token = ?
      `).run(now, now, deliveryId, leaseToken);
      if (updated.changes !== 1) return false;
      this.insertEvent(row.job_id, this.requireJobRow(row.job_id).attempt, 'gateway', {
        type: 'delivery_succeeded',
        at: now,
        dedupeKey: `delivery_succeeded:${deliveryId}`,
        payload: { deliveryId, channel: row.channel, attempt: row.attempts },
      });
      return true;
    });
    return transaction.immediate();
  }

  failDelivery(
    deliveryId: string,
    leaseToken: string,
    error: string,
    retryable = true,
    at = this.clock(),
  ): boolean {
    const now = timestamp('at', at);
    const normalizedError = errorText(error);
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM turn_deliveries WHERE id = ? AND status = 'processing' AND lease_token = ?
      `).get(deliveryId, leaseToken) as TurnDeliveryRow | undefined;
      if (!row) return false;
      const nextStatus: TurnDeliveryStatus = retryable && row.attempts < row.max_attempts ? 'pending' : 'failed';
      const updated = this.db.prepare(`
        UPDATE turn_deliveries
        SET status = ?, lease_owner = NULL, lease_token = NULL, lease_until = NULL,
            last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'processing' AND lease_token = ?
      `).run(nextStatus, normalizedError, now, deliveryId, leaseToken);
      if (updated.changes !== 1) return false;
      this.insertEvent(row.job_id, this.requireJobRow(row.job_id).attempt, 'gateway', {
        type: nextStatus === 'pending' ? 'delivery_retry_scheduled' : 'delivery_failed',
        at: now,
        payload: { deliveryId, channel: row.channel, attempt: row.attempts, error: normalizedError },
      });
      return true;
    });
    return transaction.immediate();
  }

  tryAcquireResourceLease(input: AcquireResourceLeaseInput): ResourceLease | null {
    const now = timestamp('now', input.now ?? this.clock());
    const resourceKey = validateText('resourceKey', input.resourceKey, 2_048);
    const leaseUntil = timestamp('leaseUntil', input.leaseUntil);
    if (leaseUntil <= now) throw new RangeError('leaseUntil must be in the future');
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(input.jobId, input.leaseToken);
      if (job.lease_owner !== input.leaseOwner) {
        throw new TurnJobLeaseLostError(input.jobId);
      }
      // A child resource must never outlive its parent turn. Callers request a
      // rolling duration (`now + leaseMs`), which will normally be a few
      // seconds later than the parent expiry between heartbeats. That timing
      // difference is not lease loss: clamp the child to the current parent
      // expiry, then let the normal heartbeat extend both together.
      const effectiveLeaseUntil = Math.min(leaseUntil, Number(job.lease_until || 0));
      if (effectiveLeaseUntil <= now) throw new TurnJobLeaseLostError(input.jobId);
      const existing = this.db.prepare(`
        SELECT * FROM resource_leases WHERE resource_key = ?
      `).get(resourceKey) as ResourceLeaseRow | undefined;
      if (existing && existing.lease_until > now && (existing.job_id !== input.jobId || existing.lease_token !== input.leaseToken)) {
        return null;
      }
      this.db.prepare('DELETE FROM resource_leases WHERE resource_key = ?').run(resourceKey);
      this.db.prepare(`
        INSERT INTO resource_leases(
          resource_key, job_id, lease_owner, lease_token, lease_until, acquired_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(resourceKey, input.jobId, input.leaseOwner, input.leaseToken, effectiveLeaseUntil, now, now);
      return toResourceLease(this.requireResourceLeaseRow(resourceKey));
    });
    return transaction.immediate();
  }

  getResourceLease(resourceKey: string): ResourceLease | null {
    const row = this.db.prepare('SELECT * FROM resource_leases WHERE resource_key = ?').get(resourceKey) as ResourceLeaseRow | undefined;
    return row ? toResourceLease(row) : null;
  }

  releaseResourceLease(resourceKey: string, jobId: string, leaseToken: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM resource_leases WHERE resource_key = ? AND job_id = ? AND lease_token = ?
    `).run(resourceKey, jobId, leaseToken);
    return result.changes === 1;
  }

  reconcileStaleLeases(at = this.clock(), limitInput = 500): StaleLeaseReconciliation {
    const now = timestamp('at', at);
    const limit = positiveInteger('limit', limitInput, 10_000);
    const transaction = this.db.transaction((): StaleLeaseReconciliation => {
      const staleJobs = this.db.prepare(`
        SELECT * FROM turn_jobs
        WHERE state IN ('leased', 'running') AND COALESCE(lease_until, 0) <= ?
        ORDER BY updated_at ASC, id ASC
        LIMIT ?
      `).all(now, limit) as TurnJobRow[];
      const jobs: StaleLeaseReconciliation['jobs'] = [];

      for (const stale of staleJobs) {
        const newlyUncertain = this.db.prepare(`
          SELECT * FROM tool_effects WHERE job_id = ? AND state = 'running'
          ORDER BY logical_sequence ASC
        `).all(stale.id) as ToolEffectRow[];
        if (newlyUncertain.length) {
          this.db.prepare(`
            UPDATE tool_effects SET state = 'unknown', error = ?, updated_at = ?
            WHERE job_id = ? AND state = 'running'
          `).run('Worker lease expired before the tool outcome was durably recorded', now, stale.id);
        }

        const uncertain = this.db.prepare(`
          SELECT * FROM tool_effects WHERE job_id = ? AND state = 'unknown'
          ORDER BY logical_sequence ASC
        `).all(stale.id) as ToolEffectRow[];
        const requiresReview = uncertain.some((effect) => effect.replay_policy !== 'safe_retry');
        let nextState: TurnJobState;
        if (requiresReview) nextState = 'needs_review';
        else if (stale.attempt >= stale.max_attempts) nextState = 'failed';
        else nextState = stale.checkpoint_ref ? 'checkpointed' : 'interrupted';
        const reason = requiresReview
          ? 'Worker lease expired during a tool effect that cannot be replayed safely'
          : 'Worker lease expired before the turn reached a durable final result';

        this.db.prepare('DELETE FROM resource_leases WHERE job_id = ?').run(stale.id);
        this.db.prepare(`
          UPDATE turn_jobs
          SET state = ?, lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              worker_pid = NULL, last_heartbeat_at = NULL, interruption_reason = ?,
              last_error = CASE WHEN ? = 'failed' THEN ? ELSE last_error END,
              updated_at = ?, completed_at = CASE WHEN ? = 'failed' THEN ? ELSE completed_at END
          WHERE id = ?
        `).run(nextState, reason, nextState, reason, now, nextState, now, stale.id);
        this.insertEvent(stale.id, stale.attempt, 'recovery', {
          type: requiresReview ? 'stale_lease_needs_review' : 'stale_lease_reconciled',
          at: now,
          dedupeKey: `stale_lease:${stale.attempt}`,
          payload: {
            previousState: stale.state,
            nextState,
            uncertainEffectIds: uncertain.map((effect) => effect.effect_id),
          },
        });
        jobs.push({
          jobId: stale.id,
          previousState: stale.state as 'leased' | 'running',
          nextState,
          uncertainEffectIds: uncertain.map((effect) => effect.effect_id),
        });
      }

      const jobsRemaining = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM turn_jobs
        WHERE state IN ('leased', 'running') AND COALESCE(lease_until, 0) <= ?
      `).get(now) as { count: number }).count || 0);
      const deliveriesReset = this.reconcileDeliveryLeasesInsideTransaction(now, limit);
      const deliveriesRemaining = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM turn_deliveries
        WHERE status = 'processing' AND COALESCE(lease_until, 0) <= ?
      `).get(now) as { count: number }).count || 0);
      const orphanResources = this.db.prepare(`
        DELETE FROM resource_leases
        WHERE resource_key IN (
          SELECT r.resource_key FROM resource_leases r
          WHERE r.lease_until <= ?
             OR NOT EXISTS (
               SELECT 1 FROM turn_jobs j
               WHERE j.id = r.job_id
                 AND j.state IN ('leased', 'running')
                 AND j.lease_token = r.lease_token
             )
          ORDER BY r.updated_at ASC, r.resource_key ASC
          LIMIT ?
        )
      `).run(now, limit).changes;
      const orphanResourcesRemaining = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM resource_leases r
        WHERE r.lease_until <= ?
           OR NOT EXISTS (
             SELECT 1 FROM turn_jobs j
             WHERE j.id = r.job_id
               AND j.state IN ('leased', 'running')
               AND j.lease_token = r.lease_token
           )
      `).get(now) as { count: number }).count || 0);
      return {
        jobs,
        jobsRemaining,
        deliveriesReset,
        deliveriesRemaining,
        orphanResourceLeasesRemoved: orphanResources,
        orphanResourceLeasesRemaining: orphanResourcesRemaining,
        limit,
      };
    });
    return transaction.immediate();
  }

  private leaseJobRow(
    row: TurnJobRow,
    leaseOwner: string,
    workerPid: number | null,
    now: number,
    leaseUntil: number,
  ): TurnJobLease | null {
    const sessionResource = `session:${row.session_id}`;
    const resource = this.db.prepare(`
      SELECT * FROM resource_leases WHERE resource_key = ? AND lease_until > ?
    `).get(sessionResource, now) as ResourceLeaseRow | undefined;
    if (resource) return null;
    this.db.prepare('DELETE FROM resource_leases WHERE resource_key = ? AND lease_until <= ?').run(sessionResource, now);

    const token = newToken();
    const nextAttempt = row.attempt + 1;
    const update = this.db.prepare(`
      UPDATE turn_jobs
      SET state = 'leased', attempt = ?, lease_owner = ?, lease_token = ?, lease_until = ?,
          worker_pid = ?, last_heartbeat_at = ?, updated_at = ?,
          started_at = COALESCE(started_at, ?), last_error = NULL, interruption_reason = NULL
      WHERE id = ?
        AND state IN (${CLAIMABLE_TURN_JOB_STATES.map(() => '?').join(', ')})
        AND attempt = ? AND attempt < max_attempts
    `).run(
      nextAttempt,
      leaseOwner,
      token,
      leaseUntil,
      workerPid,
      now,
      now,
      now,
      row.id,
      ...CLAIMABLE_TURN_JOB_STATES,
      row.attempt,
    );
    if (update.changes !== 1) return null;

    this.db.prepare(`
      INSERT INTO resource_leases(
        resource_key, job_id, lease_owner, lease_token, lease_until, acquired_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionResource, row.id, leaseOwner, token, leaseUntil, now, now);
    this.insertEvent(row.id, nextAttempt, 'gateway', {
      type: 'lease_claimed',
      at: now,
      payload: { leaseOwner, leaseUntil, workerPid },
    });

    return {
      job: toJob(this.requireJobRow(row.id)),
      token,
      leaseUntil,
    };
  }

  private reconcileDeliveryLeasesInsideTransaction(now: number, limit = 1_000): number {
    const result = this.db.prepare(`
      UPDATE turn_deliveries
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
          lease_owner = NULL, lease_token = NULL, lease_until = NULL,
          last_error = COALESCE(last_error, 'Delivery lease expired'), updated_at = ?
      WHERE id IN (
        SELECT id FROM turn_deliveries
        WHERE status = 'processing' AND COALESCE(lease_until, 0) <= ?
        ORDER BY updated_at ASC, id ASC
        LIMIT ?
      )
    `).run(now, now, limit);
    return result.changes;
  }

  private endActiveAttempt(
    jobId: string,
    leaseToken: string,
    nextState: TurnJobState,
    reason: string,
    eventType: string,
    at: number,
  ): TurnJob {
    const now = timestamp('at', at);
    const normalizedReason = errorText(reason);
    const transaction = this.db.transaction(() => {
      const job = this.requireActiveLease(jobId, leaseToken);
      this.insertEvent(jobId, job.attempt, 'worker', {
        type: eventType,
        at: now,
        payload: { reason: normalizedReason },
      });
      this.clearJobLease(jobId, leaseToken);
      this.db.prepare(`
        UPDATE turn_jobs SET state = ?, interruption_reason = ?, updated_at = ? WHERE id = ?
      `).run(nextState, normalizedReason, now, jobId);
      return toJob(this.requireJobRow(jobId));
    });
    return transaction.immediate();
  }

  private clearJobLease(jobId: string, leaseToken: string): void {
    const cleared = this.db.prepare(`
      UPDATE turn_jobs
      SET lease_owner = NULL, lease_token = NULL, lease_until = NULL,
          worker_pid = NULL, last_heartbeat_at = NULL
      WHERE id = ? AND lease_token = ? AND state IN ('leased', 'running')
    `).run(jobId, leaseToken);
    if (cleared.changes !== 1) throw new TurnJobLeaseLostError(jobId);
    this.db.prepare('DELETE FROM resource_leases WHERE job_id = ? AND lease_token = ?').run(jobId, leaseToken);
  }

  private insertEvent(
    jobId: string,
    attempt: number,
    source: TurnEventSource,
    input: AppendTurnEventInput,
  ): TurnEvent {
    const type = validateText('event.type', input.type, 256);
    const at = timestamp('event.at', input.at ?? this.clock());
    const dedupeKey = optionalText('event.dedupeKey', input.dedupeKey, 512);
    const payloadJson = input.payload == null ? null : canonicalJson(input.payload);
    const payloadRef = optionalText('event.payloadRef', input.payloadRef, 2_048);

    if (dedupeKey) {
      const existing = this.db.prepare(`
        SELECT * FROM turn_events WHERE job_id = ? AND dedupe_key = ?
      `).get(jobId, dedupeKey) as TurnEventRow | undefined;
      if (existing) {
        if (
          existing.type !== type
          || existing.payload_json !== payloadJson
          || existing.payload_ref !== payloadRef
        ) throw new TurnJobStoreError(`Turn event dedupe key ${dedupeKey} conflicts for job ${jobId}`);
        return toEvent(existing);
      }
    }

    const job = this.requireJobRow(jobId);
    const seq = job.last_event_seq + 1;
    this.db.prepare(`
      INSERT INTO turn_events(job_id, seq, attempt, source, type, at, payload_json, payload_ref, dedupe_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, seq, attempt, source, type, at, payloadJson, payloadRef, dedupeKey);
    const updated = this.db.prepare(`
      UPDATE turn_jobs SET last_event_seq = ?, updated_at = MAX(updated_at, ?) WHERE id = ? AND last_event_seq = ?
    `).run(seq, at, jobId, job.last_event_seq);
    if (updated.changes !== 1) throw new TurnJobStoreError(`Lost the event sequence race for turn job ${jobId}`);
    return toEvent(this.db.prepare(`
      SELECT * FROM turn_events WHERE job_id = ? AND seq = ?
    `).get(jobId, seq) as TurnEventRow);
  }

  private requireJobRow(jobId: string): TurnJobRow {
    const row = this.db.prepare('SELECT * FROM turn_jobs WHERE id = ?').get(jobId) as TurnJobRow | undefined;
    if (!row) throw new TurnJobNotFoundError(jobId);
    return row;
  }

  private requireActiveLease(jobId: string, leaseToken: string): TurnJobRow {
    validateText('leaseToken', leaseToken, 512);
    const row = this.requireJobRow(jobId);
    if (
      row.lease_token !== leaseToken
      || (row.state !== 'leased' && row.state !== 'running')
      || Number(row.lease_until || 0) <= this.clock()
    ) throw new TurnJobLeaseLostError(jobId);
    return row;
  }

  private requireCheckpointRow(checkpointId: string): TurnCheckpointRow {
    const row = this.db.prepare('SELECT * FROM turn_checkpoints WHERE id = ?').get(checkpointId) as TurnCheckpointRow | undefined;
    if (!row) throw new TurnJobStoreError(`Turn checkpoint not found: ${checkpointId}`);
    return row;
  }

  private findToolEffect(jobId: string, effectId: string, logicalSequence: number): ToolEffectRow | undefined {
    return this.db.prepare(`
      SELECT * FROM tool_effects
      WHERE effect_id = ? OR (job_id = ? AND logical_sequence = ?)
      LIMIT 1
    `).get(effectId, jobId, logicalSequence) as ToolEffectRow | undefined;
  }

  private requireToolEffectRow(effectId: string): ToolEffectRow {
    const row = this.db.prepare('SELECT * FROM tool_effects WHERE effect_id = ?').get(effectId) as ToolEffectRow | undefined;
    if (!row) throw new TurnJobStoreError(`Tool effect not found: ${effectId}`);
    return row;
  }

  private requireDeliveryRow(deliveryId: string): TurnDeliveryRow {
    const row = this.db.prepare('SELECT * FROM turn_deliveries WHERE id = ?').get(deliveryId) as TurnDeliveryRow | undefined;
    if (!row) throw new TurnJobStoreError(`Turn delivery not found: ${deliveryId}`);
    return row;
  }

  private requireResourceLeaseRow(resourceKey: string): ResourceLeaseRow {
    const row = this.db.prepare('SELECT * FROM resource_leases WHERE resource_key = ?').get(resourceKey) as ResourceLeaseRow | undefined;
    if (!row) throw new TurnJobStoreError(`Resource lease not found: ${resourceKey}`);
    return row;
  }
}
