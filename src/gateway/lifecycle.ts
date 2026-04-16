/**
 * lifecycle.ts — Gateway Lifecycle Manager
 *
 * Handles graceful shutdown + self-restart for Prometheus.
 * Used by: proposal execution, self-repair, self-update, manual restart commands.
 *
 * Flow:
 *   1. Something calls gracefulRestart(reason, context)
 *   2. We write a restart-context.json with the reason, what changed, etc.
 *   3. We shut down HTTP server, WebSocket, Telegram polling, cron scheduler
 *   4. We spawn a new detached process (node dist/cli/index.js)
 *   5. Current process exits cleanly
 *
 * On next boot:
 *   boot.ts checks for restart-context.json
 *   If found, it injects the context into the first turn instead of full BOOT.md
 *   Then deletes the file so subsequent boots are normal
 */

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import type { BootAutomatedSession } from './boot';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RestartContext {
  reason: 'proposal' | 'repair' | 'self_update' | 'manual' | 'build_deploy';
  timestamp: number;
  proposalId?: string;
  repairId?: string;
  title?: string;
  summary?: string;
  affectedFiles?: string[];
  buildOutput?: string;
  testInstructions?: string;
  previousSessionId?: string;
  originChannel?: 'web' | 'telegram' | 'discord' | 'whatsapp' | 'unknown';
  respondToTelegram?: boolean;
  previousTelegramChatId?: string;
  previousTelegramUserId?: number;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getProjectRoot(): string {
  // In packaged Electron, __dirname resolves to inside app.asar (a file, not a dir).
  // PROMETHEUS_DATA_DIR is set by main.js to %APPDATA%\Prometheus — use that so
  // all .prometheus/ paths land in the correct user data directory.
  if (process.env.PROMETHEUS_DATA_DIR) {
    return process.env.PROMETHEUS_DATA_DIR;
  }
  return path.resolve(__dirname, '..', '..');
}

function getRestartContextPath(): string {
  // Use .prometheus dir so it persists across restarts
  const prometheusDir = path.join(getProjectRoot(), '.prometheus');
  if (!fs.existsSync(prometheusDir)) fs.mkdirSync(prometheusDir, { recursive: true });
  return path.join(prometheusDir, 'restart-context.json');
}

// ─── Restart Context Read/Write ───────────────────────────────────────────────

export function writeRestartContext(ctx: RestartContext): void {
  const filePath = getRestartContextPath();
  fs.writeFileSync(filePath, JSON.stringify(ctx, null, 2), 'utf-8');
  console.log(`[lifecycle] Restart context written: ${ctx.reason} (${ctx.title || 'no title'})`);
}

export function readRestartContext(): RestartContext | null {
  const filePath = getRestartContextPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as RestartContext;
  } catch {
    return null;
  }
}

export function clearRestartContext(): void {
  const filePath = getRestartContextPath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function buildRestartCompletionMessage(ctx: RestartContext): string {
  const lines: string[] = [
    `✅ Gateway restart complete (${ctx.reason}).`,
  ];

  if (ctx.title) lines.push(`Change: ${ctx.title}`);
  if (ctx.summary) lines.push(`Summary: ${ctx.summary}`);
  if (ctx.proposalId) lines.push(`Proposal ID: ${ctx.proposalId}`);
  if (ctx.repairId) lines.push(`Repair ID: ${ctx.repairId}`);

  if (ctx.affectedFiles && ctx.affectedFiles.length > 0) {
    lines.push('Files changed:');
    for (const f of ctx.affectedFiles.slice(0, 10)) {
      lines.push(`- ${f}`);
    }
  }

  if (ctx.testInstructions) {
    lines.push(`Verify: ${ctx.testInstructions}`);
  }

  return lines.join('\n').trim();
}

export function consumePendingRestartNotification(): {
  sessionId: string;
  text: string;
  context: RestartContext;
  title: string;
  source: 'hot_restart';
  automatedSession: {
    id: string;
    title: string;
    history: Array<{ role: 'assistant' | 'user'; content: string }>;
    automated: true;
    unread: true;
    createdAt: number;
    source: 'hot_restart';
    previousSessionId?: string;
  };
} | null {
  const ctx = readRestartContext();
  if (!ctx) return null;

  const createdAt = Date.now();
  const reasonPart = String(ctx.reason || 'manual')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'manual';
  const sessionId = `auto_restart_${reasonPart}_${createdAt}`;
  const title = `🔁 Restart (${ctx.reason || 'manual'}) — ${new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  const text = buildRestartCompletionMessage(ctx);
  clearRestartContext();

  return {
    sessionId,
    text,
    context: ctx,
    title,
    source: 'hot_restart',
    automatedSession: {
      id: sessionId,
      title,
      history: [{ role: 'assistant', content: text }],
      automated: true,
      unread: true,
      createdAt,
      source: 'hot_restart',
      previousSessionId: ctx.previousSessionId,
    },
  };
}


// ─── Build ────────────────────────────────────────────────────────────────────

export interface BuildResult {
  success: boolean;
  output: string;
  durationMs: number;
}

/**
 * Run `npm run build` in-process (captured, same terminal).
 * Returns the build output and success status.
 */
export function runBuild(): BuildResult {
  const root = getProjectRoot();
  const start = Date.now();
  try {
    const output = execSync('npm run build', {
      cwd: root,
      encoding: 'utf-8',
      timeout: 180_000, // 3 min build timeout
      stdio: 'pipe',
    });
    return {
      success: true,
      output: output.slice(-2000), // last 2KB of build output
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const output = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n');
    return {
      success: false,
      output: output.slice(-2000),
      durationMs: Date.now() - start,
    };
  }
}

// ─── Shutdown Hooks ───────────────────────────────────────────────────────────

// These are set by server-v2.ts / startup.ts at boot time so lifecycle
// can cleanly shut down all subsystems without importing them directly.

interface ShutdownHooks {
  stopTelegram?: () => void;
  stopCron?: () => void;
  stopHeartbeat?: () => void;
  stopBrain?: () => void;
  closeHttpServer?: () => Promise<void>;
  closeWebSocket?: () => void;
  flushSessions?: () => void;
}

let _shutdownHooks: ShutdownHooks = {};

export function setShutdownHooks(hooks: ShutdownHooks): void {
  _shutdownHooks = { ..._shutdownHooks, ...hooks };
}

// ─── Startup/Restart Notification Queue (durable across reconnects) ───────────

export interface PendingStartupNotification {
  id: string;
  createdAt: number;
  sessionId: string;
  title: string;
  text: string;
  source: 'boot_startup' | 'hot_restart';
  automatedSession: BootAutomatedSession;
  previousSessionId?: string;
  telegram?: {
    enabled: boolean;
    chatId?: number;
    userId?: number;
  };
  delivered: {
    web: boolean;
    telegram: boolean;
  };
}

interface PendingStartupNotificationStore {
  notifications: PendingStartupNotification[];
}

function getStartupNotificationsPath(): string {
  const prometheusDir = path.join(getProjectRoot(), '.prometheus');
  if (!fs.existsSync(prometheusDir)) fs.mkdirSync(prometheusDir, { recursive: true });
  return path.join(prometheusDir, 'startup-notifications.json');
}

function readStartupNotificationStore(): PendingStartupNotificationStore {
  const p = getStartupNotificationsPath();
  if (!fs.existsSync(p)) return { notifications: [] };
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    const notifications = Array.isArray(parsed?.notifications) ? parsed.notifications : [];
    return { notifications };
  } catch {
    return { notifications: [] };
  }
}

function writeStartupNotificationStore(store: PendingStartupNotificationStore): void {
  const p = getStartupNotificationsPath();
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export function queueStartupNotification(notification: Omit<PendingStartupNotification, 'id' | 'createdAt' | 'delivered'>): PendingStartupNotification {
  const store = readStartupNotificationStore();
  const item: PendingStartupNotification = {
    ...notification,
    id: `start_note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    delivered: {
      web: false,
      telegram: !notification.telegram?.enabled,
    },
  };
  store.notifications.push(item);
  // Keep queue bounded.
  store.notifications = store.notifications.slice(-100);
  writeStartupNotificationStore(store);
  return item;
}

export function listPendingStartupNotifications(): PendingStartupNotification[] {
  return readStartupNotificationStore().notifications;
}

export function markStartupNotificationDelivered(
  id: string,
  channel: 'web' | 'telegram',
): void {
  const store = readStartupNotificationStore();
  const idx = store.notifications.findIndex((n) => n.id === id);
  if (idx < 0) return;
  const next = { ...store.notifications[idx] };
  next.delivered = { ...(next.delivered || { web: false, telegram: false }), [channel]: true };
  store.notifications[idx] = next;
  // Drop fully delivered notifications.
  store.notifications = store.notifications.filter((n) => !(n.delivered?.web && n.delivered?.telegram));
  writeStartupNotificationStore(store);
}

/**
 * Gracefully shut down all gateway subsystems.
 * Does NOT exit the process — caller decides what to do next.
 */
async function shutdownGateway(): Promise<void> {
  console.log('[lifecycle] Shutting down gateway subsystems...');

  // 1. Stop accepting new work
  try { _shutdownHooks.stopCron?.(); } catch (e: any) {
    console.warn('[lifecycle] Cron stop error:', e.message);
  }
  try { _shutdownHooks.stopHeartbeat?.(); } catch (e: any) {
    console.warn('[lifecycle] Heartbeat stop error:', e.message);
  }
  try { _shutdownHooks.stopBrain?.(); } catch (e: any) {
    console.warn('[lifecycle] Brain stop error:', e.message);
  }
  try { _shutdownHooks.stopTelegram?.(); } catch (e: any) {
    console.warn('[lifecycle] Telegram stop error:', e.message);
  }

  // 2. Flush sessions to disk
  try { _shutdownHooks.flushSessions?.(); } catch (e: any) {
    console.warn('[lifecycle] Session flush error:', e.message);
  }

  // 3. Close network listeners
  try { _shutdownHooks.closeWebSocket?.(); } catch (e: any) {
    console.warn('[lifecycle] WebSocket close error:', e.message);
  }
  try { await _shutdownHooks.closeHttpServer?.(); } catch (e: any) {
    console.warn('[lifecycle] HTTP server close error:', e.message);
  }

  console.log('[lifecycle] Gateway shutdown complete.');
}

// ─── Graceful Restart ─────────────────────────────────────────────────────────

/**
 * The main entry point for self-restart.
 * 
 * 1. Writes restart context
 * 2. Shuts down all subsystems gracefully
 * 3. Spawns a new detached gateway process
 * 4. Exits the current process
 *
 * The new process will pick up the restart-context.json on boot.
 */
export async function gracefulRestart(ctx: RestartContext): Promise<void> {
  const root = getProjectRoot();

  console.log(`[lifecycle] ═══ Graceful restart initiated: ${ctx.reason} ═══`);
  console.log(`[lifecycle] Title: ${ctx.title || '(none)'}`);

  // Step 1: Write context for the next boot
  writeRestartContext(ctx);

  // Step 2: Shut down current gateway
  await shutdownGateway();

  // Step 3: Spawn new gateway process.
  //
  // Use `prom gateway start` via shell so the global prom command is resolved
  // from PATH — same as a user would run it manually. This is the most reliable
  // cross-platform approach and reuses the exact same boot path.
  //
  // detached: true + stdio: 'ignore' + unref() = fully independent child that
  // survives the parent exiting on both Windows and Unix.
  try {
    const child = spawn('prom', ['gateway', 'start'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      shell: true,
      env: { ...process.env, PROMETHEUS_HOT_RESTART: '1' },
    });
    child.unref();
    console.log('[lifecycle] New gateway process spawned. Exiting old process...');
  } catch (err: any) {
    console.error(`[lifecycle] Failed to spawn new process: ${err.message}`);
    console.error('[lifecycle] The gateway will NOT restart automatically. Manual restart required.');
    return; // Don't exit if spawn failed
  }

  // Step 4: Exit current process.
  // 1s is enough — child is fully detached and doesn't depend on parent.
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

// ─── Build + Restart Combo ────────────────────────────────────────────────────

/**
 * Convenience: build, then restart if successful.
 * Used by proposal executor and self-repair after applying code changes.
 */
export async function buildAndRestart(
  ctx: Omit<RestartContext, 'buildOutput'>,
  onProgress?: (message: string) => void,
): Promise<BuildResult> {
  const emit = (message: string): void => {
    console.log(`[lifecycle] ${message}`);
    try { onProgress?.(message); } catch {}
  };

  emit('Running build before restart...');
  const buildResult = runBuild();

  if (!buildResult.success) {
    emit(`Build FAILED (${buildResult.durationMs}ms). Gateway will stay online.`);
    return buildResult;
  }

  emit(`Build succeeded (${buildResult.durationMs}ms). Initiating restart...`);
  await gracefulRestart({
    ...ctx,
    buildOutput: buildResult.output,
    timestamp: ctx.timestamp || Date.now(),
  });

  return buildResult;
}

// ─── Proposal-Specific Helper ─────────────────────────────────────────────────

/**
 * Called after a proposal's code changes have been applied.
 * Builds, and if successful, restarts with full proposal context.
 */
export async function buildAndRestartForProposal(
  proposal: {
    id: string;
    title: string;
    summary: string;
    affectedFiles?: Array<{ path: string; action: string }>;
    requiresBuild?: boolean;
  },
  previousSessionId?: string,
  options?: {
    originChannel?: RestartContext['originChannel'];
    respondToTelegram?: boolean;
  }
): Promise<BuildResult> {
  return buildAndRestart({
    reason: 'proposal',
    timestamp: Date.now(),
    proposalId: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    affectedFiles: proposal.affectedFiles?.map(f => f.path),
    previousSessionId,
    originChannel: options?.originChannel,
    respondToTelegram: options?.respondToTelegram,
    testInstructions: `Proposal "${proposal.title}" was just applied. Verify the changes work correctly.`,
  });
}
