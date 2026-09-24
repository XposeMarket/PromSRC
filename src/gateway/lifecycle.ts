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
import { DEFAULT_GATEWAY_PORT, getRuntimeGatewayPort } from '../config/gateway-port.js';
import { getConfig } from '../config/config.js';
import { spawn, execFileSync } from 'child_process';
import type { BootAutomatedSession } from './boot';
import { prepareActiveRuntimesForGatewayShutdown, prepareInitiatingRuntimesForGatewayHandoff } from './runtime-recovery';
import { recordActiveMainChatGoalsInterruptedForRestart, recordMainChatGoalInterruptedForRestart } from './main-chat-goals';
import { getLastMainSessionId } from './comms/broadcaster';
import { desktopBackgroundShutdown } from './desktop-background';
import { listLocalRunningRuntimes, type LiveRuntimeSnapshot } from './live-runtime-registry';
import { flushSession } from './session';
import {
  beginGatewayHandoffHost,
  completeGatewayHandoffHost,
  waitForGatewayHandoffDrain,
} from './runtime/gateway-handoff-bridge';
import { GATEWAY_HANDOFF_IPC_MESSAGE_TYPE, type GatewayHandoffLauncherNotice } from './runtime/gateway-handoff-protocol';
import type { DevSourceEditContinuation } from './dev-source-approvals';
import { listCoordinatedRestartBlockers } from './dev-edit-coordinator';
import {
  removeSupervisorRestartRequest,
  writeSupervisorRestartRequest,
} from '../runtime/supervisor-restart-request';

function repoRootForElectron(): string {
  // dist/gateway/lifecycle.js and src/gateway/lifecycle.ts both sit two levels down.
  return path.resolve(__dirname, '..', '..');
}

function electronPidStartMs(pid: number): number {
  if (process.platform !== 'win32' || !Number.isFinite(pid) || pid <= 0) return 0;
  try {
    const { execFileSync } = require('child_process');
    const out = String(execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    ], { timeout: 5000, windowsHide: true }) || '').trim();
    const ms = Date.parse(out);
    return Number.isFinite(ms) ? ms : 0;
  } catch { return 0; }
}

/** True when electron/main.js was modified after the running Electron app started. */
export function electronMainChangedSinceAppStart(): boolean {
  try {
    const pid = Number(process.env.PROMETHEUS_ELECTRON_PID || 0);
    const startedAt = electronPidStartMs(pid);
    if (!startedAt) return false;
    const mainJs = path.join(repoRootForElectron(), 'electron', 'main.js');
    return fs.existsSync(mainJs) && fs.statSync(mainJs).mtimeMs > startedAt + 1000;
  } catch { return false; }
}

/**
 * Relaunch a dev-checkout Electron app that does not understand exit code 43.
 * Spawns a detached helper that waits for the app to exit, then starts
 * `electron.exe .` from the repo root; then terminates the app (which also
 * ends this gateway child). Returns false when it cannot safely do this.
 */
export function relaunchElectronExternally(): boolean {
  if (process.platform !== 'win32') return false;
  const pid = Number(process.env.PROMETHEUS_ELECTRON_PID || 0);
  const root = repoRootForElectron();
  const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!pid || !fs.existsSync(exe)) return false;
  try {
    const { spawn } = require('child_process');
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const script = [
      `$deadline=(Get-Date).AddSeconds(25)`,
      `while ((Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }`,
      `Start-Sleep -Milliseconds 800`,
      `Start-Process -FilePath ${q(exe)} -ArgumentList '.' -WorkingDirectory ${q(root)}`,
    ].join('; ');
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    setTimeout(() => {
      try { process.kill(pid); } catch {}
      setTimeout(() => process.exit(0), 1500);
    }, 400);
    return true;
  } catch (err: any) {
    console.warn('[lifecycle] External Electron relaunch failed:', err?.message || err);
    return false;
  }
}


/** Files loaded by the Electron main process only reload when the app relaunches. */
export function requiresElectronRelaunchForFiles(files: unknown): boolean {
  if (!Array.isArray(files)) return false;
  return files.some((raw) => {
    const file = String(raw || '').trim().replace(/\\/g, '/').toLowerCase();
    return file.startsWith('electron/') || file.includes('/electron/');
  });
}


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
  /** Explicit no-build/manual restart. This bypasses stale-session model continuation. */
  quickRestart?: boolean;
  /**
   * Warm handoff preference. `prefer` (default) keeps this process alive to
   * finish the runtimes it owns while the replacement serves new work;
   * `never` forces the legacy interrupt-and-exit restart.
   */
  handoffPolicy?: 'prefer' | 'never';
  /** Filled in by gracefulRestart when the restart became a warm handoff. */
  handoff?: {
    hostPid: number;
    socketPath: string;
    carriedRuntimeIds: string[];
  };
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
  return getConfig().getConfigDir();
}

function getRestartContextPath(): string {
  const stateRoot = getLifecycleStateRoot();
  if (!fs.existsSync(stateRoot)) fs.mkdirSync(stateRoot, { recursive: true });
  return path.join(stateRoot, 'restart-context.json');
}

function getGatewayHealthUrl(): string {
  const port = getRuntimeGatewayPort() || DEFAULT_GATEWAY_PORT;
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

function isSourceTreeNewerThanCompiled(root: string, compiledMtimeMs: number): boolean {
  const sourceRoot = path.join(root, 'src');
  const pending: string[] = [sourceRoot];
  while (pending.length) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
      try {
        if (fs.statSync(fullPath).mtimeMs > compiledMtimeMs) return true;
      } catch {}
    }
  }
  return false;
}

function resolveDirectGatewayLaunch(root: string): { entry: string; args: string[] } | null {
  const sourceEntry = path.join(root, 'src', 'gateway', 'server-v2.ts');
  const compiledEntry = path.join(root, 'dist', 'gateway', 'server-v2.js');
  const sourceExists = fs.existsSync(sourceEntry);
  const compiledExists = fs.existsSync(compiledEntry);
  const preferSource = process.env.PROMETHEUS_GATEWAY_USE_SOURCE === '1';
  const preferCompiled = process.env.PROMETHEUS_GATEWAY_USE_COMPILED === '1';
  if (compiledExists && !preferSource) {
    try {
      const compiledMtimeMs = fs.statSync(compiledEntry).mtimeMs;
      if (preferCompiled || !isSourceTreeNewerThanCompiled(root, compiledMtimeMs)) {
        return { entry: compiledEntry, args: [compiledEntry] };
      }
    } catch {}
  }
  if (sourceExists) {
    const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (fs.existsSync(tsxCli)) return { entry: sourceEntry, args: [tsxCli, sourceEntry] };
    return { entry: sourceEntry, args: [...process.execArgv, sourceEntry] };
  }
  if (compiledExists) return { entry: compiledEntry, args: [compiledEntry] };
  return null;
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
  stopAutoSettle?: () => void;
  stopTimers?: () => void;
  stopInternalWatches?: () => void;
  stopHeartbeat?: () => void;
  stopBrain?: () => void;
  stopRuntimeWorkers?: () => void | Promise<void>;
  closeHttpServer?: () => Promise<void>;
  closeWebSocket?: () => void;
  flushSessions?: () => void | Promise<void>;
  /** Warm handoff: stop pollers/schedulers but keep in-flight runtimes alive. */
  stopSchedulersForHandoff?: () => void | Promise<void>;
  /** Warm handoff: release the listeners without destroying active SSE responses. */
  closeListenersForHandoff?: () => Promise<void>;
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
  const shutdownStartedAt = Date.now();
  let shutdownPhaseStartedAt = shutdownStartedAt;
  // Always record phase timings (cheap) so restart latency is measurable
  // without env flags; console output stays behind the profile flags.
  const recordedMarks: Array<{ phase: string; atMs: number; deltaMs: number }> = [];
  let lastRecordedAt = shutdownStartedAt;
  const shutdownMark = (phase: string): void => {
    const at = Date.now();
    recordedMarks.push({ phase, atMs: at - shutdownStartedAt, deltaMs: at - lastRecordedAt });
    lastRecordedAt = at;
    if (phase === 'shutdown complete') {
      try {
        fs.appendFileSync(
          path.join(getLifecycleStateRoot(), 'shutdown-timeline.jsonl'),
          `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, trigger: restartTrigger, totalMs: at - shutdownStartedAt, marks: recordedMarks })}\n`,
        );
      } catch {}
    }
    if (process.env.PROMETHEUS_LIFECYCLE_PROFILE !== '1' && process.env.PROMETHEUS_STARTUP_PROFILE !== '1') return;
    const now = Date.now();
    console.error(
      `[lifecycle-profile] +${String(now - shutdownStartedAt).padStart(5)}ms ` +
      `Δ${String(now - shutdownPhaseStartedAt).padStart(5)}ms ${phase}`,
    );
    shutdownPhaseStartedAt = now;
  };
  console.log('[lifecycle] Shutting down gateway subsystems...');
  shutdownMark('shutdown entered');

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
  shutdownMark('main-chat goal checkpoints captured');
  shutdownMark('runtime checkpoints captured');
  try { _shutdownHooks.stopCron?.(); } catch (e: any) {
    console.warn('[lifecycle] Cron stop error:', e.message);
  }
  try { _shutdownHooks.stopAutoSettle?.(); } catch (e: any) {
    console.warn('[lifecycle] Auto-settle stop error:', e.message);
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
  shutdownMark('runtime workers stopped');
  try { await desktopBackgroundShutdown(); } catch (e: any) {
    console.warn('[lifecycle] Desktop target stop error:', e.message);
  }
  shutdownMark('desktop background stopped');

  // 2. Flush sessions to disk
  try { await _shutdownHooks.flushSessions?.(); } catch (e: any) {
    console.warn('[lifecycle] Session flush error:', e.message);
  }
  shutdownMark('sessions flushed');

  // 3. Close network listeners
  try { _shutdownHooks.closeWebSocket?.(); } catch (e: any) {
    console.warn('[lifecycle] WebSocket close error:', e.message);
  }
  shutdownMark('websocket listeners closed');
  try { await _shutdownHooks.closeHttpServer?.(); } catch (e: any) {
    console.warn('[lifecycle] HTTP server close error:', e.message);
  }
  shutdownMark('http listeners closed');

  console.log('[lifecycle] Gateway shutdown complete.');
  shutdownMark('shutdown complete');
}

// ─── Warm Handoff ─────────────────────────────────────────────────────────────
// A planned restart no longer has to kill every running turn. When this
// process can hand its listeners to a replacement, it interrupts only the
// runtime(s) that asked for the restart (they must continue on the new code),
// then keeps running everything else until it finishes on its own.

type HandoffLauncher = 'supervisor_ipc' | 'electron_ipc' | 'self_spawn';

function hasLauncherIpcChannel(): boolean {
  return typeof process.send === 'function' && process.connected === true;
}

let _handoffDraining = false;

export function isGatewayHandoffDraining(): boolean {
  return _handoffDraining;
}

function handoffMaxDrainMs(): number {
  const raw = Number(process.env.PROMETHEUS_GATEWAY_HANDOFF_MAX_DRAIN_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.max(60_000, Math.floor(raw));
  return 12 * 60 * 60 * 1000;
}

/** The runtime that owns the restart request must not keep running on the old code. */
export function isRestartInitiatingRuntime(runtime: LiveRuntimeSnapshot, ctx: RestartContext): boolean {
  const toolName = String(runtime.checkpoint?.toolName || '').trim();
  if (toolName === 'gateway_restart' || toolName === 'prom_apply_dev_changes') return true;
  if (ctx.taskId && runtime.taskId && runtime.taskId === ctx.taskId) return true;
  const ownedSessions = new Set<string>();
  if (ctx.devEditContinuation?.sessionId) ownedSessions.add(String(ctx.devEditContinuation.sessionId));
  for (const sessionId of ctx.devApplyBatch?.memberSessionIds || []) ownedSessions.add(String(sessionId));
  for (const member of ctx.devApplyBatch?.members || []) {
    if (member?.sessionId) ownedSessions.add(String(member.sessionId));
  }
  return !!runtime.sessionId && ownedSessions.has(String(runtime.sessionId));
}

export interface GatewayHandoffPlan {
  eligible: boolean;
  reason: string;
  launcher?: HandoffLauncher;
  carried: LiveRuntimeSnapshot[];
}

export function planGatewayHandoff(ctx: RestartContext): GatewayHandoffPlan {
  const none = (reason: string): GatewayHandoffPlan => ({ eligible: false, reason, carried: [] });
  if (process.env.PROMETHEUS_GATEWAY_HANDOFF === '0') return none('disabled_by_env');
  if (ctx.handoffPolicy === 'never') return none('policy_never');
  if (ctx.restartScope === 'supervisor') return none('supervisor_replacement');
  // A warm handoff keeps the same Electron main process; electron/ edits need a relaunch.
  if ((ctx.electronManaged || ctx.restartLauncher === 'electron') && requiresElectronRelaunchForFiles(ctx.affectedFiles)) {
    return none('electron_main_changed');
  }
  let launcher: HandoffLauncher;
  if (ctx.electronManaged || ctx.restartLauncher === 'electron') {
    // Electron spawns the gateway with an IPC channel and starts the
    // replacement itself; an older Electron main without the channel falls
    // back to the code-42 restart it already understands.
    if (!hasLauncherIpcChannel()) return none('electron_without_ipc');
    launcher = 'electron_ipc';
  } else if (ctx.restartLauncher === 'external_supervisor') {
    if (!hasLauncherIpcChannel()) return none('supervisor_without_ipc');
    launcher = 'supervisor_ipc';
  } else {
    launcher = 'self_spawn';
  }
  const carried = listLocalRunningRuntimes().filter((runtime) => !isRestartInitiatingRuntime(runtime, ctx));
  if (!carried.length) return none('no_runtimes_to_carry');
  return { eligible: true, reason: 'carrying_live_runtimes', launcher, carried };
}

function spawnDetachedReplacementGateway(root: string): { entry?: string } {
  const replacementEnv = { ...process.env, PROMETHEUS_HOT_RESTART: '1' } as NodeJS.ProcessEnv;
  delete replacementEnv.PROMETHEUS_SUPERVISED_GATEWAY_CHILD;
  // A restart is a replacement of this exact instance, never a request for
  // the auto-instance allocator. Pin the replacement to the current port so
  // a stale inherited launcher flag cannot move it to the next free port and
  // leave the original gateway tree running beside it.
  delete replacementEnv.PROMETHEUS_AUTO_INSTANCE;
  delete replacementEnv.PROMETHEUS_NEW_INSTANCE;
  replacementEnv.PROMETHEUS_GATEWAY_PORT = String(
    getRuntimeGatewayPort() || DEFAULT_GATEWAY_PORT,
  );
  const launch = resolveDirectGatewayLaunch(root);
  const child = launch
    ? spawn(process.execPath, launch.args, {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: replacementEnv,
    })
    : spawn('prom', ['gateway', 'start'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      shell: true,
      env: replacementEnv,
    });
  child.unref();
  return { entry: launch?.entry };
}

async function beginGatewayHandoff(restartCtx: RestartContext, plan: GatewayHandoffPlan): Promise<void> {
  _handoffDraining = true;
  const trigger = (
    restartCtx.devEditContinuation
    || restartCtx.devApplyBatch
    || restartCtx.devReload
    || restartCtx.reason === 'build_deploy'
  )
    ? 'prom_apply_dev_changes'
    : 'gateway_restart';
  const label = restartCtx.summary || restartCtx.title || restartCtx.reason;
  console.log(`[lifecycle] ═══ Warm handoff: ${plan.carried.length} runtime(s) keep running here while the replacement starts (${plan.launcher}) ═══`);

  // 1. The restart-owning turn(s) checkpoint exactly like a legacy restart so
  //    BOOT on the replacement resumes them on the new code.
  let initiating: LiveRuntimeSnapshot[] = [];
  try {
    initiating = prepareInitiatingRuntimesForGatewayHandoff(trigger, (runtime) => isRestartInitiatingRuntime(runtime, restartCtx));
  } catch (e: any) {
    console.warn('[lifecycle] Handoff initiating-runtime checkpoint error:', e.message);
  }
  const initiatingSessions = new Set<string>();
  for (const runtime of initiating) {
    if (runtime.sessionId) initiatingSessions.add(String(runtime.sessionId));
  }
  if (restartCtx.devEditContinuation?.sessionId) initiatingSessions.add(String(restartCtx.devEditContinuation.sessionId));
  for (const sessionId of restartCtx.devApplyBatch?.memberSessionIds || []) initiatingSessions.add(String(sessionId));
  for (const sessionId of initiatingSessions) {
    try {
      const goal = recordMainChatGoalInterruptedForRestart(sessionId, trigger);
      if (goal?.status === 'restarting') console.log(`[lifecycle] Preserved main-chat goal for ${sessionId} across handoff.`);
    } catch (e: any) {
      console.warn('[lifecycle] Handoff goal checkpoint error:', e.message);
    }
    try { flushSession(sessionId); } catch {}
  }
  if (initiating.length) console.log(`[lifecycle] Checkpointed ${initiating.length} restart-initiating runtime(s) for the replacement.`);

  // 2. Open the handoff channel; from here on the replacement owns the
  //    ledger, the status/lease files, and the WebSocket clients.
  const host = await beginGatewayHandoffHost({ reason: label, restartTimestamp: restartCtx.timestamp });
  const carriedRuntimeIds = plan.carried.map((runtime) => runtime.id);
  writeRestartContext({
    ...restartCtx,
    handoff: { hostPid: process.pid, socketPath: host.socketPath, carriedRuntimeIds },
  });

  // 3. Stop everything that would start *new* work here.
  try { await _shutdownHooks.stopSchedulersForHandoff?.(); } catch (e: any) {
    console.warn('[lifecycle] Handoff scheduler stop error:', e.message);
  }
  // 4. Release the port. Active SSE responses stay open on their sockets.
  try { await _shutdownHooks.closeListenersForHandoff?.(); } catch (e: any) {
    console.warn('[lifecycle] Handoff listener close error:', e.message);
  }

  // 5. Start the replacement.
  const notice: GatewayHandoffLauncherNotice = {
    type: GATEWAY_HANDOFF_IPC_MESSAGE_TYPE,
    hostPid: process.pid,
    socketPath: host.socketPath,
    reason: label,
    runtimeCount: carriedRuntimeIds.length,
  };
  if (plan.launcher === 'supervisor_ipc' || plan.launcher === 'electron_ipc') {
    const launcherName = plan.launcher === 'electron_ipc' ? 'Electron' : 'the supervisor';
    process.send!(notice, (error: Error | null) => {
      if (error) console.error(`[lifecycle] Handoff notice to ${launcherName} failed: ${error.message}`);
    });
    console.log(`[lifecycle] Handoff notice sent to ${launcherName}; it will launch the replacement.`);
  } else {
    try {
      const spawned = spawnDetachedReplacementGateway(getProjectRoot());
      console.log(`[lifecycle] Replacement gateway spawned${spawned.entry ? ` (${spawned.entry})` : ''}; draining ${carriedRuntimeIds.length} runtime(s).`);
    } catch (err: any) {
      console.error(`[lifecycle] Failed to spawn the replacement gateway: ${err.message}`);
    }
  }

  // 6. Drain in the background. Callers (the restart tool, /restart routes)
  //    must return promptly; the process exits on its own when done.
  void runGatewayHandoffDrain(host, carriedRuntimeIds.length);
}

async function runGatewayHandoffDrain(host: { waitForClient(ms: number): Promise<boolean>; status(): { connected: boolean } }, carriedCount: number): Promise<void> {
  const maxMs = handoffMaxDrainMs();
  const connected = await host.waitForClient(90_000);
  if (!connected) console.warn('[lifecycle] Replacement gateway has not connected to the handoff channel yet; continuing to drain.');
  let lastLogAt = 0;
  const drain = await waitForGatewayHandoffDrain({
    maxMs,
    onTick: (running, waitedMs) => {
      if (Date.now() - lastLogAt < 60_000) return;
      lastLogAt = Date.now();
      console.log(`[lifecycle] Handoff drain: ${running} runtime(s) still running after ${Math.round(waitedMs / 1000)}s${host.status().connected ? '' : ' (replacement not connected)'}.`);
    },
  });
  let interruptedIds: string[] = [];
  if (drain.timedOut) {
    console.warn(`[lifecycle] Handoff drain deadline (${Math.round(maxMs / 60_000)} min) reached; checkpointing remaining runtimes for recovery.`);
    try {
      interruptedIds = prepareActiveRuntimesForGatewayShutdown('handoff_drain_timeout').map((runtime) => runtime.id);
    } catch (e: any) {
      console.warn('[lifecycle] Handoff timeout checkpoint error:', e.message);
    }
  } else {
    console.log(`[lifecycle] Handoff drain complete: all ${carriedCount} carried runtime(s) finished in ${Math.round(drain.waitedMs / 1000)}s.`);
  }
  try { await _shutdownHooks.stopRuntimeWorkers?.(); } catch (e: any) {
    console.warn('[lifecycle] Handoff worker stop error:', e.message);
  }
  try { await desktopBackgroundShutdown(); } catch (e: any) {
    console.warn('[lifecycle] Handoff desktop stop error:', e.message);
  }
  try { await _shutdownHooks.flushSessions?.(); } catch (e: any) {
    console.warn('[lifecycle] Handoff session flush error:', e.message);
  }
  try { await completeGatewayHandoffHost(interruptedIds); } catch (e: any) {
    console.warn('[lifecycle] Handoff completion error:', e.message);
  }
  console.log('[lifecycle] Drained gateway exiting.');
  setTimeout(() => process.exit(0), 250);
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
  if (_handoffDraining) {
    throw new Error(
      'This gateway is already handing off to a replacement and only finishing the work it owns. '
      + 'Further restarts must be requested from the replacement gateway once it is online.',
    );
  }
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

  const handoffPlan = planGatewayHandoff(restartCtx);
  if (handoffPlan.eligible) {
    await beginGatewayHandoff(restartCtx, handoffPlan);
    return;
  }
  console.log(`[lifecycle] Warm handoff not used (${handoffPlan.reason}); performing a full restart.`);

  console.log(`[lifecycle] ═══ Graceful restart initiated: ${ctx.reason} ═══`);
  console.log(`[lifecycle] Title: ${ctx.title || '(none)'}`);

  // Step 1: Write context for the next boot. Session persistence is flushed by
  // shutdownGateway below; flushing the previous session here duplicated the
  // same synchronous writes on every restart.
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
  const shutdownTimeoutMs = Math.max(5_000, Number(process.env.PROMETHEUS_RESTART_SHUTDOWN_TIMEOUT_MS || 12_000));
  let shutdownTimer: NodeJS.Timeout | null = null;
  await Promise.race([
    shutdownGateway(restartTrigger),
    new Promise<void>((resolve) => {
      shutdownTimer = setTimeout(() => {
        console.warn(`[lifecycle] Gateway shutdown exceeded ${shutdownTimeoutMs}ms; continuing with owned restart handoff.`);
        resolve();
      }, shutdownTimeoutMs);
    }),
  ]);
  if (shutdownTimer) clearTimeout(shutdownTimer);

  // If Electron spawned this gateway, let Electron own the replacement process.
  // That keeps packaged apps on the correct executable, env, data dir, and UI reload path.
  if (electronManaged) {
    // Exit 42 only respawns this gateway child, so electron/main.js changes
    // never loaded. Exit 43 asks Electron to relaunch the whole app.
    // Older Electron mains treat unknown exit codes as a crash, so only ask
    // for a relaunch when this Electron advertises support for it.
    const wantsRelaunch = restartCtx.restartScope === 'supervisor'
      || requiresElectronRelaunchForFiles(restartCtx.affectedFiles)
      || electronMainChangedSinceAppStart();
    const relaunchApp = wantsRelaunch && process.env.PROMETHEUS_ELECTRON_SUPPORTS_RELAUNCH === '1';
    // An Electron main that predates exit-43 support would treat 43 as a crash.
    // Relaunch it from outside instead: a detached helper waits for the app to
    // exit and starts it again, so nobody has to quit from the tray by hand.
    if (wantsRelaunch && !relaunchApp && relaunchElectronExternally()) {
      console.log('[lifecycle] Old Electron main without relaunch support: relaunching the app externally...');
      return;
    }
    console.log(relaunchApp
      ? '[lifecycle] Electron-managed gateway: electron/ changed or full restart requested. Asking Electron to relaunch the app...'
      : '[lifecycle] Electron-managed gateway detected. Handing restart to Electron...');
    setTimeout(() => {
      process.exit(relaunchApp ? 43 : 42);
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

  // Step 3: Spawn a detached gateway process directly. The previous shell ->
  // global `prom` -> CLI -> gateway chain paid several process handoffs and
  // could re-enter the supervisor. Prefer a compiled entry when it is newer
  // than the source tree; otherwise preserve source-mode TSX execution.
  try {
    const spawned = spawnDetachedReplacementGateway(root);
    console.log(`[lifecycle] New gateway process spawned${spawned.entry ? ` (${spawned.entry})` : ''}. Exiting old process...`);
  } catch (err: any) {
    console.error(`[lifecycle] Failed to spawn new process: ${err.message}`);
    console.error('[lifecycle] The gateway will NOT restart automatically. Manual restart required.');
    return; // Don't exit if spawn failed
  }

  // Step 4: Exit current process.
  // The child is fully detached and does not depend on the old process.
  setTimeout(() => {
    process.exit(0);
  }, Math.max(100, Number(process.env.PROMETHEUS_RESTART_EXIT_DELAY_MS || 250)));
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
