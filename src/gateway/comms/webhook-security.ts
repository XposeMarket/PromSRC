import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export type WebhookProvider = 'github' | 'stripe' | 'slack';
export type WebhookProviderAction = 'audit' | 'wake' | 'agent' | 'ignore';

export interface ProviderWebhookConfig {
  enabled: boolean;
  secret: string;
  events: Record<string, WebhookProviderAction>;
  deliver?: boolean;
}

export interface WebhookDeliveryLedger {
  reserve(provider: WebhookProvider, deliveryId: string, eventType: string, receivedAt: number): WebhookReservation | null;
  complete?(provider: WebhookProvider, deliveryId: string, completedAt: number, reservationToken: string): boolean;
  fail?(provider: WebhookProvider, deliveryId: string, failedAt: number, error: string | undefined, reservationToken: string): boolean;
}

export interface WebhookReservation { token: string; attempt: number }

export interface ProviderVerificationResult {
  ok: boolean;
  reason?: string;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function hmac(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyProviderSignature(options: {
  provider: WebhookProvider;
  secret: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  now?: number;
  toleranceSeconds?: number;
}): ProviderVerificationResult {
  const { provider, secret, rawBody, headers } = options;
  if (!secret) return { ok: false, reason: 'provider secret is not configured' };
  if (!rawBody.length) return { ok: false, reason: 'raw request body is unavailable' };

  if (provider === 'github') {
    const provided = String(headers['x-hub-signature-256'] || '').trim().toLowerCase();
    const expected = `sha256=${hmac(secret, rawBody)}`;
    return safeEqual(provided, expected)
      ? { ok: true }
      : { ok: false, reason: 'invalid GitHub signature' };
  }

  const toleranceSeconds = Math.max(1, options.toleranceSeconds || 300);
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

  if (provider === 'stripe') {
    const signature = String(headers['stripe-signature'] || '');
    const parts = signature.split(',').map((part) => part.trim()).filter(Boolean);
    const timestamp = Number(parts.find((part) => part.startsWith('t='))?.slice(2));
    const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
    if (!Number.isFinite(timestamp) || signatures.length === 0) {
      return { ok: false, reason: 'malformed Stripe signature' };
    }
    if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
      return { ok: false, reason: 'stale Stripe signature' };
    }
    const expected = hmac(secret, `${timestamp}.${rawBody.toString('utf8')}`);
    return signatures.some((candidate) => safeEqual(candidate, expected))
      ? { ok: true }
      : { ok: false, reason: 'invalid Stripe signature' };
  }

  const timestampRaw = String(headers['x-slack-request-timestamp'] || '').trim();
  const signature = String(headers['x-slack-signature'] || '').trim().toLowerCase();
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || !signature) {
    return { ok: false, reason: 'malformed Slack signature' };
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'stale Slack signature' };
  }
  const expected = `v0=${hmac(secret, `v0:${timestampRaw}:${rawBody.toString('utf8')}`)}`;
  return safeEqual(signature, expected)
    ? { ok: true }
    : { ok: false, reason: 'invalid Slack signature' };
}

export class SqliteWebhookDeliveryLedger implements WebhookDeliveryLedger {
  private readonly db: Database.Database;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;

  constructor(filePath: string, options: { leaseMs?: number; maxAttempts?: number; retentionMs?: number; now?: number } = {}) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.leaseMs = Math.max(1_000, Number(options.leaseMs || 5 * 60_000));
    this.maxAttempts = Math.max(1, Math.min(10, Number(options.maxAttempts || 3)));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        provider TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        attempts INTEGER NOT NULL DEFAULT 1,
        lease_until INTEGER,
        reservation_token TEXT,
        last_error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, delivery_id)
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_received_at
        ON webhook_deliveries(received_at);
    `);
    const columns = new Set((this.db.prepare('PRAGMA table_info(webhook_deliveries)').all() as Array<{ name: string }>).map((row) => row.name));
    // Existing one-state ledgers represented accepted deliveries. Preserve them
    // as completed during the in-place migration so an upgrade cannot replay old work.
    if (!columns.has('status')) this.db.exec("ALTER TABLE webhook_deliveries ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'");
    if (!columns.has('attempts')) this.db.exec('ALTER TABLE webhook_deliveries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1');
    if (!columns.has('lease_until')) this.db.exec('ALTER TABLE webhook_deliveries ADD COLUMN lease_until INTEGER');
    if (!columns.has('reservation_token')) this.db.exec('ALTER TABLE webhook_deliveries ADD COLUMN reservation_token TEXT');
    if (!columns.has('last_error')) this.db.exec('ALTER TABLE webhook_deliveries ADD COLUMN last_error TEXT');
    if (!columns.has('updated_at')) {
      this.db.exec('ALTER TABLE webhook_deliveries ADD COLUMN updated_at INTEGER');
      this.db.exec('UPDATE webhook_deliveries SET updated_at = received_at WHERE updated_at IS NULL');
    }
    const retentionMs = Math.max(24 * 60 * 60_000, Number(options.retentionMs || 30 * 24 * 60 * 60_000));
    const cutoff = Number(options.now ?? Date.now()) - retentionMs;
    this.db.prepare("DELETE FROM webhook_deliveries WHERE status IN ('completed', 'failed') AND COALESCE(updated_at, received_at) < ?").run(cutoff);
  }

  reserve(provider: WebhookProvider, deliveryId: string, eventType: string, receivedAt: number): WebhookReservation | null {
    const reserve = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT status, attempts, lease_until FROM webhook_deliveries
        WHERE provider = ? AND delivery_id = ?
      `).get(provider, deliveryId) as { status: string; attempts: number; lease_until?: number } | undefined;
      if (!existing) {
        const token = randomBytes(16).toString('hex');
        this.db.prepare(`
          INSERT INTO webhook_deliveries(provider, delivery_id, event_type, received_at, status, attempts, lease_until, reservation_token, updated_at)
          VALUES (?, ?, ?, ?, 'processing', 1, ?, ?, ?)
        `).run(provider, deliveryId, eventType, receivedAt, receivedAt + this.leaseMs, token, receivedAt);
        return { token, attempt: 1 };
      }
      if (existing.status === 'completed') return null;
      if (existing.status === 'processing' && Number(existing.lease_until || 0) > receivedAt) return null;
      if (Number(existing.attempts || 0) >= this.maxAttempts) return null;
      const token = randomBytes(16).toString('hex');
      const attempt = Number(existing.attempts || 0) + 1;
      this.db.prepare(`
        UPDATE webhook_deliveries
        SET event_type = ?, received_at = ?, status = 'processing', attempts = attempts + 1,
            lease_until = ?, reservation_token = ?, last_error = NULL, updated_at = ?
        WHERE provider = ? AND delivery_id = ?
      `).run(eventType, receivedAt, receivedAt + this.leaseMs, token, receivedAt, provider, deliveryId);
      return { token, attempt };
    });
    return reserve.immediate();
  }

  complete(provider: WebhookProvider, deliveryId: string, completedAt: number, reservationToken: string): boolean {
    const result = this.db.prepare(`
      UPDATE webhook_deliveries SET status = 'completed', lease_until = NULL, reservation_token = NULL, last_error = NULL, updated_at = ?
      WHERE provider = ? AND delivery_id = ? AND status = 'processing' AND reservation_token = ?
    `).run(completedAt, provider, deliveryId, reservationToken);
    return result.changes === 1;
  }

  fail(provider: WebhookProvider, deliveryId: string, failedAt: number, error = 'dispatch failed', reservationToken: string): boolean {
    const result = this.db.prepare(`
      UPDATE webhook_deliveries SET status = 'failed', lease_until = NULL, reservation_token = NULL, last_error = ?, updated_at = ?
      WHERE provider = ? AND delivery_id = ? AND status = 'processing' AND reservation_token = ?
    `).run(String(error).slice(0, 500), failedAt, provider, deliveryId, reservationToken);
    return result.changes === 1;
  }

  getState(provider: WebhookProvider, deliveryId: string): { status: string; attempts: number; leaseUntil: number | null } | null {
    const row = this.db.prepare(`
      SELECT status, attempts, lease_until AS leaseUntil FROM webhook_deliveries
      WHERE provider = ? AND delivery_id = ?
    `).get(provider, deliveryId) as { status: string; attempts: number; leaseUntil: number | null } | undefined;
    return row || null;
  }

  close(): void {
    this.db.close();
  }
}

export function appendWebhookAudit(filePath: string, record: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}
