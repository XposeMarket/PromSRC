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
import { spawn, execFileSync } from 'child_process';
import type { BootAutomatedSession } from './boot';
import { flushSession } from './session';
import { prepareActiveRuntimesForGatewayShutdown } from './runtime-recovery';
import { recordActiveMainChatGoalsInterruptedForRestart } from './main-chat-goals';
import { getLastMainSessionId } from './comms/broadcaster';
import type { DevSourceEditContinuation } from './dev-source-approvals';
import { listCoordinatedRestartBlockers } from './dev-edit-coordinator';
import {
  removeSupervisorRestartRequest,
  writeSupervisorRestartRequest,
} from '../runtime/supervisor-restart-request';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RestartContext {
  reason: 'proposal' | 'repair' | 'self_update' | 'manual' | 'build_deploy';
  timestamp: number;
  restartLauncher?: 'electron' | 'external_supervisor' | 'prom_gateway_start';
  restartScope?: 'gateway' | 'supervisor';
  electronManaged?: boolean;
  proposalId?: string;
  repairId?: string;
  title?: string;
  summary?: string;
  affectedFiles?: string[];
  buildOutput?: string;
  testInstructions?: string;
  previousSessionId?: string;
  /** Present when the restart was initiated from a durable background task. */
  taskId?: string;
  taskOriginatingSessionId?: string;
  taskInitiatedTool?: 'gateway_restart' | 'prom_apply_dev_changes';
  suppressStandaloneRestartMessage?: boolean;
  originChannel?: 'web' | 'mobile' | 'telegram' | 'discord' | 'whatsapp' | 'unknown';
  respondToTelegram?: boolean;
  previousTelegramChatId?: string;
  previousTelegramUserId?: number;
  devReload?: {
    enabled: boolean;
    batchId?: string;
    reason?: string;
    surfaces?: string[];
    delayMs?: number;
  };
  devEditContinuation?: DevSourceEditContinuation;
  devApplyBatch?: {
    id: string;
    memberIds: string[];
    memberSessionIds: string[];
    files: string[];
    members: DevSourceEditContinuation[];
  };
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getProjectRoot(): string {
  // In packaged Electron, __dirname resolves to inside app.asar (a file, not a dir).
  // PROMETHEUS_DATA_DIR is set by main.js to %APPDATA%\Prometheus — use that so
  // all .prometheus/ paths land in the correct user data directory.
  if (process.env.PROMETHEUS_APP_ROOT) return process.env.PROMETHEUS_APP_ROOT;
  return path.resolve(__dirname, '..', '..');
}

function getLifecycleStateRoot(): string {
  if (process.env.PROMETHEUS_DATA_DIR) return process.env.PROMETHEUS_DATA_DIR;
  return getProjectRoot();
}

function getRestartContextPath(): string {
  // Use .prometheus dir so it persists across restarts
  const prometheusDir = path.join(getLifecycleStateRoot(), '.prometheus');
  if (!fs.existsSync(prometheusDir)) fs.mkdirSync(prometheusDir, { recursive: true });
  return path.join(prometheusDir, 'restart-context.json');
}

function getGatewayHealthUrl(): string {
  const port = Number(process.env.GATEWAY_PORT || 18789) || 18789;
  return `http://127.0.0.1:${port}/api/health`;
}

export function shouldClosePreviousTerminalAfterRestart(ctx: RestartContext): boolean {
  if (process.env.PROMETHEUS_CLOSE_OLD_TERMINAL_ON_RESTART === '0') return false;
  if (process.env.PROMETHEUS_RESTART_CLOSE_OLD_TERMINAL === '0') return false;
  if (ctx.electronManaged || ctx.restartLauncher === 'electron') return false;
  // The shell/terminal that launched a supervised gateway also owns the
  // supervisor and every replacement child it creates. Killing that process
  // tree after the replacement becomes healthy would take the new gateway
  // down with it and leave nothing available to restart it again.
  if (
    ctx.restartLauncher === 'external_supervisor'
    || process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD === '1'
  ) return false;
  return true;
}

function findWindowsShellLauncherPid(gatewayPid: number, launcherPid: number): number | undefined {
  if (process.platform !== 'win32') return undefined;

  try {
    const script = [
      `$procId = ${Number(gatewayPid)}`,
      '$items = @()',
      'while ($procId -gt 0) {',
      '  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue',
      '  if (-not $p) { break }',
      '  $items += [pscustomobject]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = [string]$p.Name }',
      '  $procId = [int]$p.ParentProcessId',
      '}',
      '$items | ConvertTo-Json -Compress',
    ].join('; ');
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5_000,
    }).trim();
    const parsed = raw ? JSON.parse(raw) : [];
    const ancestors = Array.isArray(parsed) ? parsed : [parsed];
    const shell = ancestors.find((item: any) => {
      const pid = Number(item?.pid || 0);
      const name = String(item?.name || '').toLowerCase();
      return pid > 0
        && pid !== gatewayPid
        && /^(pwsh|powershell|powershell_ise|cmd)\.exe$/.test(name);
    });
    return Number.isFinite(Number(shell?.pid)) ? Number(shell.pid) : undefined;
  } catch (err: any) {
    console.warn(`[lifecycle] Could not resolve shell launcher process: ${String(err?.message || err)}`);
    return Number.isFinite(launcherPid) && launcherPid > 0 ? launcherPid : undefined;
  }
}

function startPreviousTerminalCleanupWatcher(ctx: RestartContext): void {
  if (!shouldClosePreviousTerminalAfterRestart(ctx)) return;

  const oldGatewayPid = process.pid;
  const launcherPid = process.ppid;
  const targetPid = process.platform === 'win32'
    ? (findWindowsShellLauncherPid(oldGatewayPid, launcherPid) || launcherPid)
    : launcherPid;

  if (!Number.isFinite(targetPid) || targetPid <= 0 || targetPid === oldGatewayPid) return;

  const helper = `
const cp = require('child_process');
const http = require('http');
const opts = JSON.parse(process.argv[1] || '{}');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function healthOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
(async () => {
  const deadline = Date.now() + Number(opts.timeoutMs || 120000);
  while (Date.now() < deadline && pidAlive(Number(opts.oldGatewayPid))) await sleep(500);
  while (Date.now() < deadline) {
    if (await healthOk(String(opts.healthUrl))) break;
    await sleep(750);
  }
  if (Date.now() >= deadline) return;
  const targetPid = Number(opts.targetPid || 0);
  if (!targetPid || targetPid === process.pid) return;
  if (process.platform === 'win32') {
    cp.spawn('taskkill.exe', ['/PID', String(targetPid), '/T', '/F'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }
  try { process.kill(targetPid, 'SIGTERM'); } catch {}
  await sleep(1500);
  if (pidAlive(targetPid)) {
    try { process.kill(targetPid, 'SIGKILL'); } catch {}
  }
})().catch(() => {});
`;

  try {
    const child = spawn(process.execPath, ['-e', helper, JSON.stringify({
      oldGatewayPid,
      targetPid,
      healthUrl: getGatewayHealthUrl(),
      timeoutMs: 120_000,
    })], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    console.log(`[lifecycle] Previous terminal cleanup watcher started (target pid ${targetPid}).`);
  } catch (err: any) {
    console.warn(`[lifecycle] Could not start previous terminal cleanup watcher: ${String(err?.message || err)}`);
  }
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

  if (ctx.restartLauncher === 'electron') {
    lines.push('Launcher: Electron app');
  } else if (ctx.restartLauncher === 'external_supervisor') {
    lines.push('Launcher: external gateway supervisor');
  } else if (ctx.restartLauncher === 'prom_gateway_start') {
    lines.push('Launcher: prom gateway start');
  }

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
export function runBuild(): Promise<BuildResult> {
  const root = getProjectRoot();
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: root,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    let timer: NodeJS.Timeout;
    const append = (chunk: any) => {
      output = `${output}${String(chunk || '')}`.slice(-16_000);
    };
    const finish = (success: boolean, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (extra) append(`\n${extra}`);
      resolve({ success, output: output.slice(-2000), durationMs: Date.now() - start });
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', (err) => finish(false, err.message));
    child.once('exit', (code, signal) => finish(code === 0, code === 0 ? '' : `Build exited with ${signal || code}.`));
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(false, 'Build timed out after 180000ms.');
    }, 180_000);
    timer.unref?.();
  });
}

// ─── Shutdown Hooks ───────────────────────────────────────────────────────────

// These are set by server-v2.ts / startup.ts at boot time so lifecycle
// can cleanly shut down all subsystems without importing them directly.

interface ShutdownHooks {
  stopTelegram?: () => void;
  stopCron?: () => void;
  stopTimers?: () => void;
  stopInternalWatches?: () => void;
  stopHeartbeat?: () => void;
  stopBrain?: () => void;
  stopRuntimeWorkers?: () => void | Promise<void>;
  closeHttpServer?: () => Promise<void>;
  closeWebSocket?: () => void;
  flushSessions?: () => void | Promise<void>;
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
  automatedSession?: BootAutomatedSession | null;
  previousSessionId?: string;
  telegram?: {
    enabled: boolean;
    chatId?: number;
    userId?: number;
  };
  devReload?: RestartContext['devReload'];
  delivered: {
    web: boolean;
    telegram: boolean;
  };
}

interface PendingStartupNotificationStore {
  notifications: PendingStartupNotification[];
}

function getStartupNotificationsPath(): string {
  const prometheusDir = path.join(getLifecycleStateRoot(), '.prometheus');
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
async function shutdownGateway(restartTrigger = 'gateway_restart'): Promise<void> {
  console.log('[lifecycle] Shutting down gateway subsystems...');

  // 1. Stop accepting new work
  try {
    // A goal runner has brief idle gaps between turns. Those gaps have no live
    // runtime for runtime-recovery to discover, but the goal still owns the
    // restart and must resume on the replacement gateway.
    const checkpointedGoals = recordActiveMainChatGoalsInterruptedForRestart(restartTrigger);
    if (checkpointedGoals.length) {
      console.log(`[lifecycle] Preserved ${checkpointedGoals.length} active main-chat goal(s) across restart.`);
    }
  } catch (e: any) {
    console.warn('[lifecycle] Main-chat goal restart checkpoint error:', e.message);
  }
  try {
    const interrupted = prepareActiveRuntimesForGatewayShutdown(restartTrigger);
    if (interrupted.length) {
      console.log(`[lifecycle] Preserved ${interrupted.length} active runtime(s) for restart recovery.`);
    }
  } catch (e: any) {
    console.warn('[lifecycle] Runtime recovery snapshot error:', e.message);
  }
  try { _shutdownHooks.stopCron?.(); } catch (e: any) {
    console.warn('[lifecycle] Cron stop error:', e.message);
  }
  try { _shutdownHooks.stopTimers?.(); } catch (e: any) {
    console.warn('[lifecycle] Timer stop error:', e.message);
  }
  try { _shutdownHooks.stopInternalWatches?.(); } catch (e: any) {
    console.warn('[lifecycle] Internal watch stop error:', e.message);
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
  try { await _shutdownHooks.stopRuntimeWorkers?.(); } catch (e: any) {
    console.warn('[lifecycle] Runtime worker stop error:', e.message);
  }

  // 2. Flush sessions to disk
  try { await _shutdownHooks.flushSessions?.(); } catch (e: any) {
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
  if (!ctx.devApplyBatch) {
    const blockers = listCoordinatedRestartBlockers();
    if (blockers.length) {
      const summary = blockers.slice(0, 5).map((edit) => `${edit.id} (${edit.phase})`).join(', ');
      throw new Error(
        `Gateway restart deferred because ${blockers.length} coordinated Prometheus dev edit(s) are active: ${summary}. ` +
        'Let them reach the shared apply barrier, or explicitly resolve/abandon the blocked edits before restarting.',
      );
    }
  }
  const root = getProjectRoot();
  const electronManaged = process.env.PROMETHEUS_ELECTRON_MANAGED === '1';
  const externallySupervised = process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD === '1';
  const fallbackPreviousSessionId = String(ctx.previousSessionId || getLastMainSessionId?.() || '').trim();
  const restartCtx: RestartContext = {
    ...ctx,
    previousSessionId: fallbackPreviousSessionId || ctx.previousSessionId,
    restartLauncher: electronManaged ? 'electron' : externallySupervised ? 'external_supervisor' : 'prom_gateway_start',
    electronManaged,
  };
  console.log(`[lifecycle] Launcher: ${restartCtx.restartLauncher}`);

  console.log(`[lifecycle] ═══ Graceful restart initiated: ${ctx.reason} ═══`);
  console.log(`[lifecycle] Title: ${ctx.title || '(none)'}`);

  // Step 1: Write context for the next boot
  if (restartCtx.previousSessionId) {
    try {
      flushSession(restartCtx.previousSessionId);
    } catch (err: any) {
      console.warn(`[lifecycle] Could not flush previous session before restart: ${String(err?.message || err)}`);
    }
  }
  writeRestartContext(restartCtx);
  if (externallySupervised && restartCtx.restartScope === 'supervisor') {
    const supervisorStateDir = process.env.PROMETHEUS_SUPERVISOR_STATE_DIR
      || path.dirname(getRestartContextPath());
    try {
      const request = writeSupervisorRestartRequest(supervisorStateDir, {
        gatewayPid: process.pid,
        reason: restartCtx.summary || restartCtx.title || restartCtx.reason,
        affectedFiles: restartCtx.affectedFiles,
      });
      console.log(`[lifecycle] Full supervisor replacement requested (${request.id}).`);
    } catch (error) {
      removeSupervisorRestartRequest(supervisorStateDir);
      clearRestartContext();
      throw error;
    }
  }
  startPreviousTerminalCleanupWatcher(restartCtx);

  // Step 2: Shut down current gateway
  const restartTrigger = (
    restartCtx.devEditContinuation
    || restartCtx.devApplyBatch
    || restartCtx.devReload
    || restartCtx.reason === 'build_deploy'
  )
    ? 'prom_apply_dev_changes'
    : 'gateway_restart';
  await shutdownGateway(restartTrigger);

  // If Electron spawned this gateway, let Electron own the replacement process.
  // That keeps packaged apps on the correct executable, env, data dir, and UI reload path.
  if (electronManaged) {
    console.log('[lifecycle] Electron-managed gateway detected. Handing restart to Electron...');
    setTimeout(() => {
      process.exit(42);
    }, 250);
    return;
  }

  // A supervised gateway must never spawn a second detached `prom` tree. Exit
  // back to the parent that already owns health checks and restart backoff.
  // This also prevents the child-only environment flag from leaking into a
  // replacement and silently disabling supervision.
  if (externallySupervised) {
    console.log('[lifecycle] Externally supervised gateway detected. Handing restart to the supervisor...');
    setTimeout(() => {
      process.exit(42);
    }, 250);
    return;
  }

  // Step 3: Spawn new gateway process.
  //
  // Use `prom gateway start` via shell so the global prom command is resolved
  // from PATH — same as a user would run it manually. This is the most reliable
  // cross-platform approach and reuses the exact same boot path.
  //
  // detached: true + stdio: 'ignore' + unref() = fully independent child that
  // survives the parent exiting on both Windows and Unix.
  try {
    const replacementEnv = { ...process.env, PROMETHEUS_HOT_RESTART: '1' } as NodeJS.ProcessEnv;
    delete replacementEnv.PROMETHEUS_SUPERVISED_GATEWAY_CHILD;
    const child = spawn('prom', ['gateway', 'start'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      shell: true,
      env: replacementEnv,
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
  const buildResult = await runBuild();

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
