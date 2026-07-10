#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { execSync, spawn, type ChildProcess } from 'child_process';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getConfig } from '../config/config';
import { getDatabase } from '../db/database';
import { getOllamaClient } from '../agents/ollama-client';
import * as ui from './ui.js';
// AgentOrchestrator removed — legacy pipeline superseded by reactor + multi-agent orchestration

const program = new Command();

program
  .name('prometheus')
  .description('Local AI agent powered by your choice of LLM provider')
  .version('1.0.2');

type InstallMode = 'git' | 'npm' | 'unknown';
type UpdateSource = 'git' | 'npm' | 'none';

interface UpdateContext {
  rootDir: string;
  packageName: string;
  currentVersion: string;
  mode: InstallMode;
}

interface UpdateCheckResult {
  mode: InstallMode;
  source: UpdateSource;
  available: boolean;
  message: string;
  currentVersion: string;
  latestVersion?: string;
  packageName?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
}

interface UpdateCacheState {
  checkedAt: number;
  mode: InstallMode;
  packageName: string;
  currentVersion: string;
  result: UpdateCheckResult;
}

const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function runCapture(command: string, cwd: string, timeoutMs: number = 10000): { ok: boolean; stdout: string; stderr: string } {
  try {
    const out = execSync(command, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
    return { ok: true, stdout: String(out || ''), stderr: '' };
  } catch (err: any) {
    const stdout = err?.stdout ? String(err.stdout) : '';
    const stderr = err?.stderr ? String(err.stderr) : String(err?.message || '');
    return { ok: false, stdout, stderr };
  }
}

function runStep(label: string, command: string, cwd: string): boolean {
  ui.stepRunning(label);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
    ui.step(label, true);
    return true;
  } catch (err: any) {
    ui.step(label, false);
    if (err?.message) ui.error(err.message);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const GATEWAY_STARTUP_TIMEOUT_MS = parsePositiveInt(process.env.PROMETHEUS_GATEWAY_STARTUP_TIMEOUT_MS, 180_000);
const GATEWAY_START_ATTEMPTS = parsePositiveInt(process.env.PROMETHEUS_GATEWAY_START_ATTEMPTS, 3);
const GATEWAY_BUSY_RESTART_GRACE_MS = parsePositiveInt(process.env.PROMETHEUS_SUPERVISOR_BUSY_GRACE_MS, 45_000);

function gatewaySupervisorEnabled(): boolean {
  return process.env.PROMETHEUS_SUPERVISOR === '1'
    && process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD !== '1'
    && process.env.PROMETHEUS_DISABLE_GATEWAY_SUPERVISOR !== '1';
}

function gatewaySupervisorRestartEnabled(): boolean {
  return process.env.PROMETHEUS_SUPERVISOR_RESTART === '1';
}

function gatewayChildArgs(): string[] {
  const entry = process.argv[1];
  const passthroughArgs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['gateway', 'start'];
  return [...process.execArgv, entry, ...passthroughArgs];
}

function killGatewayChild(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
      return;
    } catch {}
  }
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {}
  }, 2500).unref?.();
}

async function checkGatewayHealth(timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const req = http.request({
      host: '127.0.0.1',
      port: 18789,
      path: '/api/health',
      method: 'GET',
      agent: false,
      headers: { Connection: 'close' },
      timeout: timeoutMs,
    }, (res) => {
      const ok = Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300;
      res.resume();
      res.once('end', () => done(ok));
      res.once('close', () => done(ok));
    });
    req.once('timeout', () => {
      req.destroy();
      done(false);
    });
    req.once('error', () => done(false));
    req.end();
  });
}

interface GatewayRuntimeStatus {
  pid?: number;
  timestamp?: number;
  reason?: string;
  modelBusy?: boolean;
  modelBusyAgeMs?: number;
  lastMainSessionId?: string;
}

function readGatewayRuntimeStatus(): GatewayRuntimeStatus | null {
  try {
    const p = path.join(resolveInstallRoot(), '.prometheus', 'gateway-runtime-status.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as GatewayRuntimeStatus;
  } catch {
    return null;
  }
}

function shouldDeferGatewayRestart(status: GatewayRuntimeStatus | null): boolean {
  if (!status || !Number.isFinite(Number(status.timestamp))) return false;
  const ageMs = Date.now() - Number(status.timestamp);
  if (ageMs < 20_000) return true;
  const busyAgeMs = Number.isFinite(Number(status.modelBusyAgeMs))
    ? Number(status.modelBusyAgeMs)
    : ageMs;
  if (status.modelBusy && busyAgeMs < GATEWAY_BUSY_RESTART_GRACE_MS) return true;
  return false;
}

function hasLiveGatewayHeartbeat(status: GatewayRuntimeStatus | null, maxAgeMs = 20_000): boolean {
  if (!status || !Number.isFinite(Number(status.timestamp))) return false;
  if (Date.now() - Number(status.timestamp) > maxAgeMs) return false;
  const owners = getGatewayPortOwnerPids();
  const statusPid = Number(status.pid);
  return owners.length > 0 && (!Number.isFinite(statusPid) || owners.includes(statusPid));
}

function getGatewayPortOwnerPids(port = 18789): number[] {
  if (process.platform === 'win32') {
    const parseNetstatOwners = (out: string): number[] => Array.from(new Set(
      out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes(`:${port}`) && /\sLISTENING\s/i.test(line))
        .map((line) => Number(line.split(/\s+/).pop()))
        .filter(pid => Number.isFinite(pid) && pid > 0),
    ));
    try {
      const out = execSync('netstat -ano -p tcp', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      });
      const pids = parseNetstatOwners(out);
      if (pids.length > 0) return pids;
    } catch {}
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 },
      );
      return Array.from(new Set(
        out
          .split(/\r?\n/)
          .map(line => Number(line.trim()))
          .filter(pid => Number.isFinite(pid) && pid > 0),
      ));
    } catch {
      return [];
    }
  }

  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return Array.from(new Set(
      out
        .split(/\r?\n/)
        .map(line => Number(line.trim()))
        .filter(pid => Number.isFinite(pid) && pid > 0),
    ));
  } catch {
    return [];
  }
}

function killPidTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
      return;
    } catch {}
  }
  try { process.kill(pid, 'SIGTERM'); } catch {}
  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }, 2500).unref?.();
}

async function clearUnhealthyGatewayPort(exemptPids: number[] = []): Promise<void> {
  if (await checkGatewayHealth(1200)) return;
  const runtimeStatus = readGatewayRuntimeStatus();
  if (hasLiveGatewayHeartbeat(runtimeStatus)) return;
  const exempt = new Set([process.pid, ...exemptPids.filter(pid => Number.isFinite(pid))]);
  const owners = getGatewayPortOwnerPids().filter(pid => !exempt.has(pid));
  if (owners.length === 0) return;
  console.error(`[GatewaySupervisor] Port 18789 is held by an unhealthy gateway process (${owners.join(', ')}). Terminating it before restart...`);
  for (const pid of owners) killPidTree(pid);
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const remaining = getGatewayPortOwnerPids().filter(pid => !exempt.has(pid));
    if (remaining.length === 0) return;
  }
}

async function ensureGatewayForCli(): Promise<boolean> {
  if (await checkGatewayHealth(1000)) return true;
  if (hasLiveGatewayHeartbeat(readGatewayRuntimeStatus())) return true;
  const entry = process.argv[1];
  const child = spawn(process.execPath, [...process.execArgv, entry, 'gateway', 'start'], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await checkGatewayHealth(1000)) return true;
  }
  return false;
}

function resolveGatewayEntryForTerminal(): string {
  const jsEntry = path.join(__dirname, '..', 'gateway', 'server-v2.js');
  if (fs.existsSync(jsEntry)) return jsEntry;
  const tsEntry = path.join(__dirname, '..', 'gateway', 'server-v2.ts');
  if (fs.existsSync(tsEntry)) return tsEntry;
  return jsEntry;
}

function appendStreamToStartupLog(stream: NodeJS.ReadableStream | null, capture: (line: string) => void): void {
  if (!stream) return;
  let buffer = '';
  stream.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) capture(line);
  });
  stream.on('end', () => {
    if (buffer.trim()) capture(buffer);
    buffer = '';
  });
}

function buildTerminalStatusBoard(): any {
  const cfg = getConfig();
  const liveConfig = cfg.getConfig() as any;
  const activeProvider = liveConfig?.llm?.provider || 'ollama';
  const model =
    liveConfig?.llm?.providers?.[activeProvider]?.model ||
    liveConfig?.models?.primary ||
    'unknown';
  return {
    host: liveConfig?.gateway?.host || '127.0.0.1',
    port: liveConfig?.gateway?.port || 18789,
    model,
    workspace: cfg.getWorkspacePath(),
    skillsTotal: 0,
    skillsEnabled: 0,
    searchStatus: 'Checking...',
    memoryFiles: 'SOUL.md + USER.md + MEMORY.md',
    gpuInfo: 'Detecting GPU...',
    cronJobCount: 0,
  };
}

async function waitForGatewayHealthAndNotify(
  child: ChildProcess,
  notifyServerReady: (opts: any) => void,
  capture: (line: string) => void,
  readCapturedLogs?: () => string[],
): Promise<void> {
  const startedAt = Date.now();
  let spawnError: Error | null = null;
  child.once('error', (err) => {
    spawnError = err;
    capture(`[Gateway] Child process error: ${err.message}`);
  });
  const printFailureLogs = (reason: string) => {
    const logs = readCapturedLogs?.() || [];
    const recent = logs.slice(-80);
    if (recent.length > 0) {
      process.stderr.write(`\n[Gateway] Startup failed: ${reason}\n`);
      process.stderr.write('[Gateway] Recent startup logs:\n');
      for (const line of recent) process.stderr.write(`  ${line}\n`);
      process.stderr.write('\n');
    }
  };
  while (Date.now() - startedAt < GATEWAY_STARTUP_TIMEOUT_MS) {
    if (spawnError) {
      printFailureLogs((spawnError as Error).message);
      throw spawnError;
    }
    if (child.exitCode !== null) {
      capture(`[Gateway] Child exited before becoming ready (code=${child.exitCode}).`);
      printFailureLogs(`child exited with code ${child.exitCode}`);
      throw new Error('Gateway child exited before becoming ready');
    }
    if (await checkGatewayHealth(10_000)) {
      notifyServerReady(buildTerminalStatusBoard());
      return;
    }
    await sleep(500);
  }
  const seconds = Math.round(GATEWAY_STARTUP_TIMEOUT_MS / 1000);
  capture(`[Gateway] Still waiting for /api/health after ${seconds}s.`);
  printFailureLogs(`health timed out after ${seconds}s`);
  throw new Error(`Gateway did not become healthy within ${seconds}s`);
}

async function runMissionThroughGateway(mission: string): Promise<void> {
  const ready = await ensureGatewayForCli();
  if (!ready) {
    ui.error('Gateway did not become ready at http://127.0.0.1:18789');
    process.exitCode = 1;
    return;
  }

  const sessionId = `cli_${Date.now()}`;
  ui.header('Prometheus Agent');
  ui.label('Mission', mission);
  ui.label('Session', sessionId);
  ui.label('UI', 'http://127.0.0.1:18789');
  ui.blank();

  const res = await fetch('http://127.0.0.1:18789/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      message: mission,
      callerContext: '[CLI MISSION] Started from `prometheus agent`; treat this as a real coding/workspace task and use tools as needed.',
      origin: {
        channel: 'terminal',
        surface: 'terminal',
        device: 'computer',
        label: 'CLI',
        source: 'prometheus_agent_cli',
      },
    }),
  } as any);

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    ui.error(`Gateway request failed (${res.status}): ${text}`);
    process.exitCode = 1;
    return;
  }

  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n/);
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const event = (chunk.match(/^event:\s*(.+)$/m)?.[1] || '').trim();
      const dataRaw = (chunk.match(/^data:\s*([\s\S]*)$/m)?.[1] || '').trim();
      if (!dataRaw) continue;
      let data: any = null;
      try { data = JSON.parse(dataRaw); } catch { continue; }
      if (event === 'final' && data?.text) {
        finalText = String(data.text || '');
      } else if (event === 'progress_state' && Array.isArray(data?.items)) {
        const active = data.items.find((item: any) => item?.status === 'in_progress');
        if (active?.text) ui.info(active.text);
      } else if (event === 'error') {
        ui.error(data?.message || 'Unknown error');
      }
    }
  }
  if (finalText) {
    ui.blank();
    ui.divider();
    process.stdout.write(finalText + '\n');
  }
}

async function runSupervisedGateway(): Promise<void> {
  let stopping = false;
  let restartCount = 0;
  let child: ChildProcess | null = null;

  const launch = async () => {
    await clearUnhealthyGatewayPort(child?.pid ? [child.pid] : []);
    child = spawn(process.execPath, gatewayChildArgs(), {
      cwd: process.cwd(),
      env: { ...process.env, PROMETHEUS_SUPERVISED_GATEWAY_CHILD: '1' },
      stdio: 'inherit',
      windowsHide: false,
    });
    child.on('exit', (code, signal) => {
      if (stopping) return;
      restartCount++;
      const delayMs = Math.min(10_000, 1000 + restartCount * 1000);
      console.error(`[GatewaySupervisor] Gateway exited (${signal || (code ?? 'unknown')}). Restarting in ${delayMs}ms...`);
      setTimeout(() => {
        launch().catch((err: any) => {
          console.error(`[GatewaySupervisor] Restart failed: ${err?.message || err}`);
        });
      }, delayMs);
    });
  };

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (child) killGatewayChild(child);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await launch();
  await sleep(20_000);

  let consecutiveFailures = 0;
  while (!stopping) {
    await sleep(15_000);
    if (stopping) break;
    const healthy = await checkGatewayHealth();
    if (healthy) {
      consecutiveFailures = 0;
      continue;
    }
    const runtimeStatus = readGatewayRuntimeStatus();
    if (shouldDeferGatewayRestart(runtimeStatus)) {
      consecutiveFailures = 0;
      const ageMs = runtimeStatus?.timestamp ? Date.now() - Number(runtimeStatus.timestamp) : -1;
      const state = runtimeStatus?.modelBusy ? 'active model turn' : 'fresh runtime heartbeat';
      console.error(`[GatewaySupervisor] Health check timed out, but gateway has ${state} (${Math.max(0, Math.round(ageMs / 1000))}s ago). Waiting instead of restarting.`);
      continue;
    }
    consecutiveFailures++;
    if (consecutiveFailures < 3) continue;

    consecutiveFailures = 0;
    if (!gatewaySupervisorRestartEnabled()) {
      console.error('[GatewaySupervisor] Gateway health checks timed out. Auto-restart is disabled; leaving the gateway process running. Set PROMETHEUS_SUPERVISOR_RESTART=1 to enable restart-on-failed-health.');
      continue;
    }
    restartCount++;
    console.error('[GatewaySupervisor] Gateway health checks timed out. Restarting frozen gateway process...');
    if (child) killGatewayChild(child);
  }
}

function resolveInstallRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function readPackageMeta(rootDir: string): { name: string; version: string } {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as any;
    return {
      name: String(pkg?.name || process.env.PROMETHEUS_NPM_PACKAGE || 'prometheus'),
      version: String(pkg?.version || '0.0.0'),
    };
  } catch {
    return {
      name: String(process.env.PROMETHEUS_NPM_PACKAGE || 'prometheus'),
      version: '0.0.0',
    };
  }
}

function detectInstallMode(rootDir: string): InstallMode {
  const gitPath = path.join(rootDir, '.git');
  if (fs.existsSync(gitPath)) return 'git';
  const gitProbe = runCapture('git rev-parse --is-inside-work-tree', rootDir, 4000);
  if (gitProbe.ok && gitProbe.stdout.trim() === 'true') return 'git';
  if (fs.existsSync(path.join(rootDir, 'package.json'))) return 'npm';
  return 'unknown';
}

function resolveUpdateContext(): UpdateContext {
  const rootDir = resolveInstallRoot();
  const pkg = readPackageMeta(rootDir);
  const mode = detectInstallMode(rootDir);
  return {
    rootDir,
    packageName: pkg.name,
    currentVersion: pkg.version,
    mode,
  };
}

function parseNpmVersion(raw: string): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    if (Array.isArray(parsed) && parsed.length > 0) {
      const last = parsed[parsed.length - 1];
      if (typeof last === 'string' && last.trim()) return last.trim();
    }
  } catch {
    // ignore
  }
  const cleaned = text.replace(/^"|"$/g, '').trim();
  return cleaned || null;
}

function checkGitUpdate(ctx: UpdateContext, fetchRemote: boolean): UpdateCheckResult {
  const branchRes = runCapture('git rev-parse --abbrev-ref HEAD', ctx.rootDir, 4000);
  if (!branchRes.ok) {
    return {
      mode: 'git',
      source: 'git',
      available: false,
      message: 'Git repository detected, but current branch could not be resolved.',
      currentVersion: ctx.currentVersion,
    };
  }
  const branch = branchRes.stdout.trim() || 'HEAD';
  const upstreamRes = runCapture('git rev-parse --abbrev-ref --symbolic-full-name @{u}', ctx.rootDir, 4000);
  if (!upstreamRes.ok) {
    return {
      mode: 'git',
      source: 'git',
      available: false,
      message: `No upstream tracking branch configured for "${branch}".`,
      currentVersion: ctx.currentVersion,
      branch,
    };
  }

  if (fetchRemote) {
    runCapture('git fetch --quiet', ctx.rootDir, 12000);
  }

  const countsRes = runCapture('git rev-list --left-right --count HEAD...@{u}', ctx.rootDir, 4000);
  if (!countsRes.ok) {
    return {
      mode: 'git',
      source: 'git',
      available: false,
      message: `Unable to compare local branch "${branch}" with upstream.`,
      currentVersion: ctx.currentVersion,
      branch,
    };
  }

  const parts = countsRes.stdout.trim().split(/\s+/).filter(Boolean);
  const ahead = Number(parts[0] || 0);
  const behind = Number(parts[1] || 0);

  let message = `No updates available on branch "${branch}".`;
  if (behind > 0 && ahead > 0) {
    message = `Update available: "${branch}" is behind by ${behind} commit(s) and ahead by ${ahead}.`;
  } else if (behind > 0) {
    message = `Update available: "${branch}" is behind by ${behind} commit(s).`;
  } else if (ahead > 0) {
    message = `Local branch "${branch}" is ahead of upstream by ${ahead} commit(s).`;
  }

  const latestHash = runCapture('git rev-parse --short @{u}', ctx.rootDir, 3000);

  return {
    mode: 'git',
    source: 'git',
    available: behind > 0,
    message,
    currentVersion: ctx.currentVersion,
    latestVersion: latestHash.ok ? latestHash.stdout.trim() : undefined,
    branch,
    ahead,
    behind,
  };
}

function checkNpmUpdate(ctx: UpdateContext): UpdateCheckResult {
  const candidates = Array.from(
    new Set(
      [
        process.env.PROMETHEUS_NPM_PACKAGE,
        ctx.packageName,
        'prometheus',
      ].filter(Boolean).map(v => String(v)),
    ),
  );

  for (const packageName of candidates) {
    const latestRes = runCapture(`npm view ${packageName} version --json`, ctx.rootDir, 12000);
    if (!latestRes.ok) continue;

    const latestVersion = parseNpmVersion(latestRes.stdout);
    if (!latestVersion) continue;

    const available = latestVersion !== ctx.currentVersion;
    return {
      mode: 'npm',
      source: 'npm',
      available,
      message: available
        ? `Update available: ${ctx.currentVersion} -> ${latestVersion} (${packageName}).`
        : `No npm updates available (${packageName}@${ctx.currentVersion}).`,
      currentVersion: ctx.currentVersion,
      latestVersion,
      packageName,
    };
  }

  return {
    mode: 'npm',
    source: 'npm',
    available: false,
    message: 'Could not resolve latest version from npm registry.',
    currentVersion: ctx.currentVersion,
  };
}

function checkForUpdates(ctx: UpdateContext, fetchRemote: boolean = true): UpdateCheckResult {
  if (ctx.mode === 'git') return checkGitUpdate(ctx, fetchRemote);
  if (ctx.mode === 'npm') return checkNpmUpdate(ctx);
  return {
    mode: 'unknown',
    source: 'none',
    available: false,
    message: 'Install type is unknown. Run manual update steps from your repository.',
    currentVersion: ctx.currentVersion,
  };
}

function getUpdateCachePath(): string {
  return path.join(getConfig().getConfigDir(), 'update_state.json');
}

function readUpdateCache(): UpdateCacheState | null {
  try {
    const cachePath = getUpdateCachePath();
    if (!fs.existsSync(cachePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as UpdateCacheState;
    if (!parsed || typeof parsed.checkedAt !== 'number' || !parsed.result) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeUpdateCache(ctx: UpdateContext, result: UpdateCheckResult): void {
  try {
    const cachePath = getUpdateCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const payload: UpdateCacheState = {
      checkedAt: Date.now(),
      mode: ctx.mode,
      packageName: ctx.packageName,
      currentVersion: ctx.currentVersion,
      result,
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // best effort only
  }
}

function printUpdateCheck(result: UpdateCheckResult): void {
  if (result.available) {
    ui.warn(result.message);
    ui.label('Current', result.currentVersion);
    if (result.latestVersion) ui.label('Latest', result.latestVersion);
  } else {
    ui.success(result.message);
    ui.label('Version', result.currentVersion);
  }
}

async function confirmUpdate(assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('Proceed with update now? [y/N] ');
    return /^y(?:es)?$/i.test(String(answer || '').trim());
  } finally {
    rl.close();
  }
}

function hasDirtyGitChanges(rootDir: string): boolean {
  const status = runCapture('git status --porcelain', rootDir, 4000);
  if (!status.ok) return false;
  return status.stdout.trim().length > 0;
}

function applyGitUpdate(ctx: UpdateContext, force: boolean): boolean {
  if (!force && hasDirtyGitChanges(ctx.rootDir)) {
    console.error('[update] Local git changes detected. Commit/stash first or use --force.');
    return false;
  }

  const steps: Array<[string, string]> = [
    ['Pull latest changes', 'git pull --ff-only'],
    ['Install dependencies', 'npm install'],
    ['Build project', 'npm run build'],
    ['Refresh global link', 'npm link'],
  ];

  for (const [label, cmd] of steps) {
    if (!runStep(label, cmd, ctx.rootDir)) return false;
  }
  return true;
}

function applyNpmUpdate(ctx: UpdateContext, check: UpdateCheckResult): boolean {
  const packageName = check.packageName || ctx.packageName;
  return runStep(
    `Install latest npm package (${packageName}@latest)`,
    `npm install -g ${packageName}@latest`,
    ctx.rootDir,
  );
}

function maybeNotifyUpdate(): void {
  if (process.env.PROMETHEUS_DISABLE_UPDATE_CHECK === '1') return;
  const ctx = resolveUpdateContext();
  const cache = readUpdateCache();
  const isFresh = cache
    && (Date.now() - cache.checkedAt) < UPDATE_CACHE_TTL_MS
    && cache.mode === ctx.mode
    && cache.packageName === ctx.packageName
    && cache.currentVersion === ctx.currentVersion;

  const result = isFresh ? cache.result : checkForUpdates(ctx, true);
  if (!isFresh) {
    writeUpdateCache(ctx, result);
  }

  if (result.available) {
    ui.warn(result.message);
    ui.hint('Run `prometheus update` to install.');
  }
}

// ---- ONBOARD ----
program
  .command('onboard')
  .description('Setup Prometheus for first-time use')
  .action(async () => {
    ui.header('Prometheus Setup');
    const config = getConfig();
    config.ensureDirectories();
    config.saveConfig();
    ui.success('Configuration directories created');
    ui.label('Config', config.getConfigDir());
    ui.label('Workspace', config.getWorkspacePath());
    getDatabase();
    ui.success('Job database initialized');
    ui.header('Next Steps');
    ui.info('1. Start the gateway:  prom');
    ui.info('2. Open browser:       http://localhost:18789');
    ui.info('3. Go to Settings → Models to configure your LLM provider');
    ui.blank();
  });

// ---- GATEWAY ----
const gateway = program.command('gateway').description('Control the gateway server');

gateway
  .command('start')
  .description('Start the gateway + web UI server')
  .action(async () => {
    // ── Check if already running (skip during hot restart — old server is shutting down) ──
    if (!process.env.PROMETHEUS_HOT_RESTART) {
      try {
        if (await checkGatewayHealth(1200)) {
          console.log('Gateway is already running at http://127.0.0.1:18789');
          return;
        }
        const res = await fetch('http://127.0.0.1:18789/api/status', {
          signal: AbortSignal.timeout(1200),
        });
        if (res.ok) {
          const data = await res.json() as any;
          console.log('Gateway is already running at http://127.0.0.1:18789');
          if (data?.currentModel) console.log(`Model: ${data.currentModel}`);
          return;
        }
      } catch {}
      const runtimeStatus = readGatewayRuntimeStatus();
      if (hasLiveGatewayHeartbeat(runtimeStatus, 30_000)) {
        const ageMs = runtimeStatus?.timestamp ? Date.now() - Number(runtimeStatus.timestamp) : -1;
        console.log(`Gateway is already running at http://127.0.0.1:18789 (runtime heartbeat ${Math.max(0, Math.round(ageMs / 1000))}s ago)`);
        return;
      }
    }

    // ── Collect any cached update notice ─────────────────────────────────────
    if (gatewaySupervisorEnabled()) {
      await runSupervisedGateway();
      return;
    }

    // ── Phase 1: suppress logs + start animated loading screen ───────────────
    const { suppressStartupLogs, runLoadingScreen, notifyServerReady, captureStartupLog, getStartupLogs } = require('../gateway/terminal-ui');
    suppressStartupLogs();

    const loading = runLoadingScreen();

    const gatewayEntry = resolveGatewayEntryForTerminal();
    let lastStartupError: unknown = null;
    for (let attempt = 1; attempt <= GATEWAY_START_ATTEMPTS; attempt++) {
      await clearUnhealthyGatewayPort();
      const suffix = GATEWAY_START_ATTEMPTS > 1 ? ` (attempt ${attempt}/${GATEWAY_START_ATTEMPTS})` : '';
      captureStartupLog(`[Gateway] Starting child process${suffix}: ${gatewayEntry}`);
      const child = spawn(process.execPath, [...process.execArgv, gatewayEntry], {
        cwd: resolveInstallRoot(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      appendStreamToStartupLog(child.stdout, captureStartupLog);
      appendStreamToStartupLog(child.stderr, captureStartupLog);
      child.on('exit', (code, signal) => {
        captureStartupLog(`[Gateway] Child exited: ${signal || code}`);
      });

      try {
        await waitForGatewayHealthAndNotify(child, notifyServerReady, captureStartupLog, getStartupLogs);
        lastStartupError = null;
        break;
      } catch (err: any) {
        lastStartupError = err;
        if (await checkGatewayHealth(1500)) {
          captureStartupLog('[Gateway] Health became available after startup error; continuing with the healthy gateway.');
          notifyServerReady(buildTerminalStatusBoard());
          lastStartupError = null;
          break;
        }
        captureStartupLog(`[Gateway] Startup attempt ${attempt} failed: ${err?.message || err}`);
        killGatewayChild(child);
        await clearUnhealthyGatewayPort(child.pid ? [child.pid] : []);
        if (attempt < GATEWAY_START_ATTEMPTS) {
          await sleep(Math.min(5_000, 1000 + attempt * 750));
        }
      }
    }

    if (lastStartupError) throw lastStartupError;

    // Run the loading screen — it blocks until server is ready, then shows
    // Phase 2 (status board) and Phase 3 (interactive menu) automatically.
    await loading;
  });

gateway
  .command('status')
  .description('Check gateway status')
  .action(async () => {
    ui.header('Gateway Status');
    try {
      const res  = await fetch('http://localhost:18789/api/status');
      const data = await res.json() as any;
      ui.statusRow('Gateway', 'Online  http://localhost:18789', 'ok');
      ui.statusRow('Model',   data.currentModel || 'unknown',  'ok');
      if (data.provider) ui.statusRow('Provider', data.provider, 'ok');
    } catch {
      ui.statusRow('Gateway', 'Offline', 'error');
      ui.hint('Run: prom gateway start');
    }
    ui.blank();
  });

// ---- AGENT ----
program
  .command('agent <mission>')
  .description('Run a mission via the gateway (starts gateway if needed)')
  .option('-p, --priority <number>', 'Job priority', '0')
  .action(async (mission: string) => {
    await runMissionThroughGateway(mission);
  });

// ---- JOBS ----
const jobs = program.command('jobs').description('Manage jobs');

jobs
  .command('list')
  .description('List all jobs')
  .action(() => {
    const db   = getDatabase();
    const list = db.listJobs();
    if (list.length === 0) { ui.info('No jobs found'); return; }

    // Color-code status
    const C_S: Record<string, string> = {
      completed: '\x1b[38;2;107;203;119m',
      running:   '\x1b[38;2;255;180;50m',
      failed:    '\x1b[91m',
      pending:   '\x1b[90m',
    };
    const colorStatus = (s: string) => {
      const color = C_S[s.toLowerCase()] ?? '\x1b[90m';
      return `${color}${s}\x1b[0m`;
    };

    ui.header(`Jobs  (${list.length})`);
    ui.table(
      list.map(j => [
        j.id.slice(0, 8),
        colorStatus(j.status),
        j.title || '(untitled)',
      ]),
      ['ID', 'Status', 'Title'],
    );
    ui.blank();
  });

jobs
  .command('show <id>')
  .description('Show job details')
  .action((id: string) => {
    const db  = getDatabase();
    const job = db.getJob(id);
    if (!job) { ui.error('Job not found'); return; }

    ui.header('Job Details');
    ui.label('ID',     job.id);
    ui.label('Title',  job.title || '(untitled)');
    ui.label('Status', job.status);

    const tasks = db.listTasksForJob(id);
    if (tasks.length) {
      ui.header(`Tasks  (${tasks.length})`);
      ui.table(
        (tasks as any[]).map((t: any) => [t.status || '?', t.title || '(untitled)']),
        ['Status', 'Title'],
      );
    }
    ui.blank();
  });

// ---- MODEL ----
const model = program.command('model').description('Manage models');

model.command('list').action(async () => {
  ui.header('Available Models');
  const models = await getOllamaClient().listModels();
  if (models.length === 0) {
    ui.warn('No models found — check your provider is running');
    return;
  }
  models.forEach(m => ui.info(m));
  ui.blank();
});

model.command('set <n>').action((name: string) => {
  const cfg = getConfig();
  const c   = cfg.getConfig();
  cfg.updateConfig({ ...c, models: { ...c.models, primary: name, roles: { manager: name, executor: name, verifier: name } } });
  ui.success(`Model set to: ${name}`);
  ui.hint('Restart the gateway to apply the change.');
  ui.blank();
});

// ---- DOCTOR ----
program.command('doctor').action(async () => {
  ui.header('Prometheus Health Check');

  const cfg      = getConfig().getConfig() as any;
  const provider = cfg.llm?.provider || 'ollama';
  ui.statusRow('Provider', provider, 'ok');

  // Backend / model connectivity
  const ollama    = getOllamaClient();
  const connected = await ollama.testConnection();
  ui.statusRow('Backend', connected ? 'Online' : 'Offline', connected ? 'ok' : 'error');
  if (connected) {
    const models = await ollama.listModels();
    ui.statusRow('Models', `${models.length} available`, models.length > 0 ? 'ok' : 'warn');
  }

  // Database
  const db       = getDatabase();
  const jobCount = db.listJobs().length;
  ui.statusRow('Database', `${jobCount} job${jobCount === 1 ? '' : 's'} stored`, 'ok');

  // Workspace
  ui.statusRow('Workspace', getConfig().getWorkspacePath(), 'ok');

  // Gateway
  let gatewayModel = '';
  try {
    const res  = await fetch('http://localhost:18789/api/status', { signal: AbortSignal.timeout(2000) } as any);
    const data = await res.json() as any;
    gatewayModel = data?.currentModel ? `  (${data.currentModel})` : '';
    ui.statusRow('Gateway', `Online  http://localhost:18789${gatewayModel}`, 'ok');
  } catch {
    ui.statusRow('Gateway', 'Offline', 'error');
    ui.hint('Run: prom gateway start');
  }

  // Update check
  try {
    const ctx   = resolveUpdateContext();
    const cache = readUpdateCache();
    const fresh = cache
      && (Date.now() - cache.checkedAt) < UPDATE_CACHE_TTL_MS
      && cache.mode === ctx.mode;
    const result = fresh ? cache.result : checkForUpdates(ctx, false);
    if (result.available) {
      ui.statusRow('Updates', result.message, 'update');
      ui.hint('Run: prometheus update');
    } else {
      ui.statusRow('Updates', `Up to date  (v${ctx.currentVersion})`, 'ok');
    }
  } catch {
    ui.statusRow('Updates', 'Could not check', 'warn');
  }

  ui.blank();
});

// ---- UPDATE ----
program
  .command('update [mode]')
  .description('Check for updates and install them (mode: check|apply)')
  .option('-y, --yes', 'Skip confirmation prompt when applying updates', false)
  .option('--force', 'Allow git update even with local changes', false)
  .action(async (mode: string | undefined, options: { yes?: boolean; force?: boolean }) => {
    const actionMode = String(mode || 'apply').toLowerCase();
    if (actionMode !== 'check' && actionMode !== 'apply') {
      ui.error(`Unknown mode "${actionMode}". Use "check" or "apply".`);
      process.exitCode = 1;
      return;
    }

    const ctx = resolveUpdateContext();
    const check = checkForUpdates(ctx, true);
    writeUpdateCache(ctx, check);
    printUpdateCheck(check);

    if (actionMode === 'check') {
      return;
    }

    if (!check.available) {
      ui.success('Prometheus is already up to date.');
      ui.blank();
      return;
    }

    const confirmed = await confirmUpdate(Boolean(options.yes));
    if (!confirmed) {
      ui.info('Update canceled.');
      return;
    }

    let ok = false;
    if (ctx.mode === 'git') {
      ok = applyGitUpdate(ctx, Boolean(options.force));
    } else if (ctx.mode === 'npm') {
      ok = applyNpmUpdate(ctx, check);
    } else {
      ui.error('Unknown install mode. Run manual repo update commands.');
      process.exitCode = 1;
      return;
    }

    if (!ok) {
      process.exitCode = 1;
      return;
    }

    ui.success('Update complete.');
    ui.hint('Restart any running Prometheus gateway process.');
    ui.blank();
  });

// Default: calling `prom` with no arguments starts the gateway (like `prom gateway start`)
if (process.argv.slice(2).length === 0) {
  process.argv.push('gateway', 'start');
}

program.parse();
