#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { execSync, spawn, type ChildProcess } from 'child_process';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getConfig } from '../config/config';
import { getDatabase } from '../db/database';
import { getOllamaClient } from '../agents/ollama-client';
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
  console.log(`[update] ${label}`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
    return true;
  } catch (err: any) {
    console.error(`[update] Step failed: ${label}`);
    if (err?.message) console.error(`[update] ${err.message}`);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function checkGatewayHealth(timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:18789/api/health', {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    } as any);
    return res.ok;
  } catch {
    return false;
  }
}

interface GatewayRuntimeStatus {
  pid?: number;
  timestamp?: number;
  reason?: string;
  modelBusy?: boolean;
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
  if (status.modelBusy && ageMs < 15 * 60_000) return true;
  return false;
}

function getGatewayPortOwnerPids(port = 18789): number[] {
  if (process.platform === 'win32') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
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
  const exempt = new Set([process.pid, ...exemptPids.filter(pid => Number.isFinite(pid))]);
  const owners = getGatewayPortOwnerPids().filter(pid => !exempt.has(pid));
  if (owners.length === 0) return;
  console.error(`[GatewaySupervisor] Port 18789 is held by an unhealthy gateway process (${owners.join(', ')}). Terminating it before restart...`);
  for (const pid of owners) killPidTree(pid);
  await sleep(1500);
}

async function ensureGatewayForCli(): Promise<boolean> {
  if (await checkGatewayHealth(1000)) return true;
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
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 180_000) {
    if (child.exitCode !== null) {
      capture(`[Gateway] Child exited before becoming ready (code=${child.exitCode}).`);
      throw new Error('Gateway child exited before becoming ready');
    }
    if (await checkGatewayHealth(10_000)) {
      notifyServerReady(buildTerminalStatusBoard());
      return;
    }
    await sleep(500);
  }
  capture('[Gateway] Still waiting for /api/health after 180s.');
  throw new Error('Gateway did not become healthy within 180s');
}

async function runMissionThroughGateway(mission: string): Promise<void> {
  const ready = await ensureGatewayForCli();
  if (!ready) {
    console.error('Gateway did not become ready at http://127.0.0.1:18789');
    process.exitCode = 1;
    return;
  }

  const sessionId = `cli_${Date.now()}`;
  console.log(`Prometheus Agent`);
  console.log(`Mission: ${mission}`);
  console.log(`Session: ${sessionId}`);
  console.log(`UI: http://127.0.0.1:18789\n`);

  const res = await fetch('http://127.0.0.1:18789/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      message: mission,
      callerContext: '[CLI MISSION] Started from `prometheus agent`; treat this as a real coding/workspace task and use tools as needed.',
    }),
  } as any);

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    console.error(`Gateway request failed (${res.status}): ${text}`);
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
        if (active?.text) console.log(`[progress] ${active.text}`);
      } else if (event === 'error') {
        console.error(`[error] ${data?.message || 'Unknown error'}`);
      }
    }
  }
  if (finalText) {
    console.log('\nFinal:\n');
    console.log(finalText);
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
  console.log(`[update] ${result.message}`);
  if (result.latestVersion) {
    console.log(`[update] Current: ${result.currentVersion} | Latest: ${result.latestVersion}`);
  } else {
    console.log(`[update] Current: ${result.currentVersion}`);
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
    console.log(`[Update] ${result.message}`);
    console.log('[Update] Run `prometheus update` to install.');
  }
}

// ---- ONBOARD ----
program
  .command('onboard')
  .description('Setup Prometheus for first-time use')
  .action(async () => {
    console.log('Welcome to Prometheus!\n');
    const config = getConfig();
    config.ensureDirectories();
    config.saveConfig();
    console.log('Created configuration directories');
    console.log(`  Config:    ${config.getConfigDir()}`);
    console.log(`  Workspace: ${config.getWorkspacePath()}`);
    getDatabase();
    console.log('Initialized job database\n');
    console.log('Prometheus is ready!');
    console.log('\nNext steps:');
    console.log('  1. Start the gateway:  prom');
    console.log('  2. Open browser:       http://localhost:18789');
    console.log('  3. Go to Settings -> Models to configure your LLM provider');
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
    }

    // ── Collect any cached update notice ─────────────────────────────────────
    if (gatewaySupervisorEnabled()) {
      await runSupervisedGateway();
      return;
    }

    // ── Phase 1: suppress logs + start animated loading screen ───────────────
    const { suppressStartupLogs, runLoadingScreen, notifyServerReady, captureStartupLog } = require('../gateway/terminal-ui');
    suppressStartupLogs();

    const loading = runLoadingScreen();

    await clearUnhealthyGatewayPort();
    const gatewayEntry = resolveGatewayEntryForTerminal();
    captureStartupLog(`[Gateway] Starting child process: ${gatewayEntry}`);
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

    await waitForGatewayHealthAndNotify(child, notifyServerReady, captureStartupLog);

    // Run the loading screen — it blocks until server is ready, then shows
    // Phase 2 (status board) and Phase 3 (interactive menu) automatically.
    await loading;
  });

gateway
  .command('status')
  .description('Check gateway status')
  .action(async () => {
    try {
      const res = await fetch('http://localhost:18789/api/status');
      const data = await res.json() as any;
      console.log('Gateway: Online');
      console.log(`Model:   ${data.currentModel || 'unknown'}`);
    } catch {
      console.log('Gateway: Offline (run: prom gateway start)');
    }
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
    const db = getDatabase();
    const list = db.listJobs();
    if (list.length === 0) { console.log('No jobs found'); return; }
    list.forEach(j => {
      console.log(`[${j.status.padEnd(12)}] ${j.id.slice(0, 8)}  ${j.title}`);
    });
  });

jobs
  .command('show <id>')
  .description('Show job details')
  .action((id: string) => {
    const db = getDatabase();
    const job = db.getJob(id);
    if (!job) { console.log('Job not found'); return; }
    console.log(`ID:     ${job.id}`);
    console.log(`Title:  ${job.title}`);
    console.log(`Status: ${job.status}`);
    const tasks = db.listTasksForJob(id);
    console.log(`\nTasks (${tasks.length}):`);
    tasks.forEach((t: any) => console.log(`  [${t.status}] ${t.title}`));
  });

// ---- MODEL ----
const model = program.command('model').description('Manage models');

model.command('list').action(async () => {
  const models = await getOllamaClient().listModels();
  if (models.length === 0) {
    console.log('No models found (check your provider is running)');
    return;
  }
  console.log('Available models:');
  models.forEach(m => console.log(`  - ${m}`));
});

model.command('set <n>').action((name: string) => {
  const cfg = getConfig();
  const c = cfg.getConfig();
  cfg.updateConfig({ ...c, models: { ...c.models, primary: name, roles: { manager: name, executor: name, verifier: name } } });
  console.log(`Model set to: ${name}`);
});

// ---- DOCTOR ----
program.command('doctor').action(async () => {
  console.log('Prometheus Health Check\n');
  const cfg = getConfig().getConfig() as any;
  const provider = cfg.llm?.provider || 'ollama';
  console.log(`Provider:  ${provider}`);
  const ollama = getOllamaClient();
  const connected = await ollama.testConnection();
  console.log(`Backend:   ${connected ? 'Online' : 'Offline'}`);
  if (connected) {
    const models = await ollama.listModels();
    console.log(`Models:    ${models.length} available`);
  }
  const db = getDatabase();
  const jobCount = db.listJobs().length;
  console.log(`Database:  ${jobCount} jobs stored`);
  console.log(`Workspace: ${getConfig().getWorkspacePath()}`);
  try {
    await fetch('http://localhost:18789/api/status');
    console.log(`Gateway:   Online -> http://localhost:18789`);
  } catch {
    console.log(`Gateway:   Offline (run: prom gateway start)`);
  }
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
      console.error(`[update] Unknown mode "${actionMode}". Use "check" or "apply".`);
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
      console.log('[update] Prometheus is already up to date.');
      return;
    }

    const confirmed = await confirmUpdate(Boolean(options.yes));
    if (!confirmed) {
      console.log('[update] Update canceled.');
      return;
    }

    let ok = false;
    if (ctx.mode === 'git') {
      ok = applyGitUpdate(ctx, Boolean(options.force));
    } else if (ctx.mode === 'npm') {
      ok = applyNpmUpdate(ctx, check);
    } else {
      console.error('[update] Unknown install mode. Run manual repo update commands.');
      process.exitCode = 1;
      return;
    }

    if (!ok) {
      process.exitCode = 1;
      return;
    }

    console.log('[update] Update complete.');
    console.log('[update] Restart any running Prometheus gateway process.');
  });

// Default: calling `prom` with no arguments starts the gateway (like `prom gateway start`)
if (process.argv.slice(2).length === 0) {
  process.argv.push('gateway', 'start');
}

program.parse();
