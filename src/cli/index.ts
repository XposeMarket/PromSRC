#!/usr/bin/env node

import { Command } from 'commander';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import net from 'net';
import { execSync, spawn, type ChildProcess } from 'child_process';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getConfig } from '../config/config';
import {
  buildGatewayUrl,
  DEFAULT_GATEWAY_PORT,
  parseGatewayPort,
  resolveGatewayPort,
} from '../config/gateway-port';
import { resolveGatewayDataDir } from './gateway-instance-mode';
import { getDatabase } from '../db/database';
import { getOllamaClient } from '../agents/ollama-client';
import * as ui from './ui.js';
import {
  appendGatewaySupervisorEvidence,
  buildGatewaySupervisorEvidence,
  classifyGatewaySupervisorObservation,
  readGatewayProgressLease,
  type GatewayRuntimeStatusSnapshot,
} from './gateway-supervisor-policy.js';
import {
  takeSupervisorRestartRequest,
  type SupervisorRestartRequest,
} from '../runtime/supervisor-restart-request.js';
import {
  readCanonicalUpdateStatus,
} from '../update/canonical-updater';
// AgentOrchestrator removed — legacy pipeline superseded by reactor + multi-agent orchestration

const program = new Command();

program
  .name('prometheus')
  .description('Local AI agent powered by your choice of LLM provider')
  .version('1.0.2');

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
const GATEWAY_HEALTH_TIMEOUT_MS = parsePositiveInt(process.env.PROMETHEUS_SUPERVISOR_HEALTH_TIMEOUT_MS, 5_000);
const GATEWAY_HEALTH_FAILURE_LIMIT = parsePositiveInt(process.env.PROMETHEUS_SUPERVISOR_HEALTH_FAILURE_LIMIT, 2);

let gatewayPortOverride: number | undefined;

function getGatewayPort(): number {
  if (gatewayPortOverride) return gatewayPortOverride;
  return resolveGatewayPort(getConfig().getConfig());
}

function getGatewayUrl(host = '127.0.0.1'): string {
  return buildGatewayUrl(getGatewayPort(), host);
}

function getGatewayStateRoot(): string {
  return process.env.PROMETHEUS_DATA_DIR || resolveInstallRoot();
}

function getPairingAdminTokenPath(): string {
  return path.join(getGatewayStateRoot(), '.prometheus', 'pairing-admin-token');
}

function ensureManualPairingAdminCredential(): { token: string; path: string; generated: boolean; persisted: boolean } | null {
  if (process.env.PROMETHEUS_ELECTRON_MANAGED === '1') return null;

  const configured = String(process.env.PROMETHEUS_PAIRING_ADMIN_TOKEN || '').trim();
  if (configured) return { token: configured, path: getPairingAdminTokenPath(), generated: false, persisted: false };

  const tokenPath = getPairingAdminTokenPath();
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) {
      process.env.PROMETHEUS_PAIRING_ADMIN_TOKEN = existing;
      return { token: existing, path: tokenPath, generated: false, persisted: true };
    }
  } catch {}

  const token = crypto.randomBytes(32).toString('hex');
  let persisted = false;
  try {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    persisted = true;
  } catch {
    // If another instance won a simultaneous first-start race, reuse its token.
    try {
      const existing = fs.readFileSync(tokenPath, 'utf8').trim();
      if (existing) {
        process.env.PROMETHEUS_PAIRING_ADMIN_TOKEN = existing;
        return { token: existing, path: tokenPath, generated: false, persisted: true };
      }
    } catch {}
  }

  process.env.PROMETHEUS_PAIRING_ADMIN_TOKEN = token;
  return { token, path: tokenPath, generated: true, persisted };
}

function isGatewayPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    let settled = false;
    const done = (available: boolean) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    probe.once('error', () => done(false));
    probe.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
      probe.close(() => done(true));
    });
  });
}

function getConfiguredGatewayHttpsPort(): number | undefined {
  const config = getConfig().getConfig() as any;
  const https = config?.gateway?.https;
  const enabled = ['1', 'true'].includes(String(process.env.GATEWAY_HTTPS_ENABLED || '').toLowerCase())
    || https?.enabled === true;
  if (!enabled) return undefined;
  return parseGatewayPort(https?.port)
    || parseGatewayPort(process.env.GATEWAY_HTTPS_PORT)
    || 18790;
}

async function findAvailableGatewayPort(startPort: number): Promise<number> {
  const httpsPort = getConfiguredGatewayHttpsPort();
  for (let offset = 0; offset < 1000 && startPort + offset <= 65535; offset += 1) {
    const candidate = startPort + offset;
    if (httpsPort && candidate === httpsPort) continue;
    if (await isGatewayPortAvailable(candidate)) return candidate;
  }
  throw new Error(`Prometheus could not find an available gateway port starting at ${startPort}.`);
}

const DEV_GATEWAY_INSTANCE_FILE = path.join(resolveInstallRoot(), '.prometheus', 'dev-gateway-instance.json');

function readCanonicalDevGatewayPort(): number {
  try {
    const saved = JSON.parse(fs.readFileSync(DEV_GATEWAY_INSTANCE_FILE, 'utf8'));
    return parseGatewayPort(saved?.port) || (DEFAULT_GATEWAY_PORT + 1);
  } catch {
    return DEFAULT_GATEWAY_PORT + 1;
  }
}

function persistCanonicalDevGatewayPort(port: number): void {
  fs.mkdirSync(path.dirname(DEV_GATEWAY_INSTANCE_FILE), { recursive: true });
  fs.writeFileSync(DEV_GATEWAY_INSTANCE_FILE, JSON.stringify({ version: 1, port }, null, 2) + '\n');
}

async function configureGatewayInstance(options: { port?: string; dataDir?: string; primaryInstance?: boolean; newInstance?: boolean; autoInstance?: boolean; canonicalDevInstance?: boolean }): Promise<void> {
  let selectedPort: number | undefined;
  let preferredPort: number | undefined;
  const autoInstance = options.autoInstance || process.env.PROMETHEUS_AUTO_INSTANCE === '1';
  if (options.port !== undefined) {
    selectedPort = parseGatewayPort(options.port);
    if (!selectedPort) throw new Error(`Invalid gateway port: ${options.port}`);
  } else if (options.primaryInstance) {
    selectedPort = gatewayPortOverride || resolveGatewayPort(getConfig().getConfig()) || DEFAULT_GATEWAY_PORT;
  } else if (options.canonicalDevInstance) {
    selectedPort = readCanonicalDevGatewayPort();
    persistCanonicalDevGatewayPort(selectedPort);
  } else if (options.newInstance || process.env.PROMETHEUS_NEW_INSTANCE === '1') {
    selectedPort = await findAvailableGatewayPort(
      gatewayPortOverride || resolveGatewayPort(getConfig().getConfig()) || DEFAULT_GATEWAY_PORT,
    );
  } else if (autoInstance) {
    preferredPort = gatewayPortOverride || resolveGatewayPort(getConfig().getConfig()) || DEFAULT_GATEWAY_PORT;
    selectedPort = preferredPort;
    if (!(await isGatewayPortAvailable(preferredPort))) {
      selectedPort = await findAvailableGatewayPort(preferredPort + 1);
    }
  }
  if (selectedPort) {
    gatewayPortOverride = selectedPort;
    process.env.PROMETHEUS_GATEWAY_PORT = String(selectedPort);
  }
  const dataDir = resolveGatewayDataDir({
    installRoot: resolveInstallRoot(),
    requestedDataDir: options.dataDir || process.env.PROMETHEUS_DATA_DIR,
    selectedPort,
    primaryInstance: options.primaryInstance,
    canonicalDevInstance: options.canonicalDevInstance,
    newInstance: options.newInstance || process.env.PROMETHEUS_NEW_INSTANCE === '1',
    autoInstance,
    preferredPort,
  });
  if (dataDir) process.env.PROMETHEUS_DATA_DIR = dataDir;
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
  // Supervise the gateway server itself. Recursively spawning another CLI
  // created a CLI -> server grandchild tree, so killing a frozen server left
  // the watched CLI alive and forced recovery to wait for health timeouts.
  const entry = resolveGatewayEntryForTerminal();
  return entry.endsWith('.ts') ? [...process.execArgv, entry] : [entry];
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

interface GatewayHealthProbe {
  healthy: boolean;
  durationMs: number;
  outcome: 'ok' | 'http_error' | 'timeout' | 'request_error';
  statusCode?: number;
}

async function probeGatewayHealth(timeoutMs = GATEWAY_HEALTH_TIMEOUT_MS): Promise<GatewayHealthProbe> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const done = (result: Omit<GatewayHealthProbe, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };
    const req = http.request({
      host: '127.0.0.1',
      port: getGatewayPort(),
      path: '/api/health',
      method: 'GET',
      agent: false,
      headers: { Connection: 'close' },
      timeout: timeoutMs,
    }, (res) => {
      const ok = Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300;
      res.resume();
      const result = { healthy: ok, outcome: ok ? 'ok' : 'http_error', statusCode: res.statusCode } as const;
      res.once('end', () => done(result));
      res.once('close', () => done(result));
    });
    req.once('timeout', () => {
      req.destroy();
      done({ healthy: false, outcome: 'timeout' });
    });
    req.once('error', () => done({ healthy: false, outcome: 'request_error' }));
    req.end();
  });
}

async function checkGatewayHealth(timeoutMs = GATEWAY_HEALTH_TIMEOUT_MS): Promise<boolean> {
  return (await probeGatewayHealth(timeoutMs)).healthy;
}

interface GatewayRuntimeStatus extends GatewayRuntimeStatusSnapshot {
  lastMainSessionId?: string;
}

function readGatewayRuntimeStatus(): GatewayRuntimeStatus | null {
  try {
    const p = path.join(getGatewayStateRoot(), '.prometheus', 'gateway-runtime-status.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as GatewayRuntimeStatus;
  } catch {
    return null;
  }
}

function hasLiveGatewayHeartbeat(status: GatewayRuntimeStatus | null, maxAgeMs = 20_000): boolean {
  if (!status || !Number.isFinite(Number(status.timestamp))) return false;
  if (Date.now() - Number(status.timestamp) > maxAgeMs) return false;
  const owners = getGatewayPortOwnerPids();
  const statusPid = Number(status.pid);
  return owners.length > 0 && (!Number.isFinite(statusPid) || owners.includes(statusPid));
}

function getGatewayPortOwnerPids(port = getGatewayPort()): number[] {
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
  console.error(`[GatewaySupervisor] Port ${getGatewayPort()} is held by an unhealthy gateway process (${owners.join(', ')}). Terminating it before restart...`);
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

function sourceTreeNewerThanCompiled(rootDir: string, compiledMtimeMs: number): boolean {
  const pending: string[] = [path.join(rootDir, 'src')];
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

function resolveGatewayEntryForTerminal(): string {
  const rootDir = resolveInstallRoot();
  const compiledEntry = path.join(rootDir, 'dist', 'gateway', 'server-v2.js');
  const sourceEntry = path.join(rootDir, 'src', 'gateway', 'server-v2.ts');
  const preferSource = process.env.PROMETHEUS_GATEWAY_USE_SOURCE === '1';
  const preferCompiled = process.env.PROMETHEUS_GATEWAY_USE_COMPILED === '1';
  if (fs.existsSync(compiledEntry) && !preferSource) {
    try {
      const compiledMtimeMs = fs.statSync(compiledEntry).mtimeMs;
      if (preferCompiled || !sourceTreeNewerThanCompiled(rootDir, compiledMtimeMs)) return compiledEntry;
    } catch {}
  }
  if (fs.existsSync(sourceEntry)) return sourceEntry;
  return compiledEntry;
}

function hasExplicitQuickRestartContext(stateDir: string): boolean {
  const candidates = [
    path.join(stateDir, 'restart-context.json'),
    process.env.PROMETHEUS_DATA_DIR ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus', 'restart-context.json') : '',
  ].filter(Boolean);
  for (const filePath of candidates) {
    try {
      const context = JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;
      const timestamp = Number(context?.timestamp || 0);
      if (context?.quickRestart === true
        && (!timestamp || Math.abs(Date.now() - timestamp) < 60_000)
        && !context?.taskId
        && (!Array.isArray(context?.affectedFiles) || context.affectedFiles.length === 0)) {
        return true;
      }
    } catch {}
  }
  return false;
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
    port: getGatewayPort(),
    model,
    workspace: process.env.PROMETHEUS_WORKSPACE_DIR
      || (process.env.PROMETHEUS_DATA_DIR ? path.join(getGatewayStateRoot(), 'workspace') : cfg.getWorkspacePath()),
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
  const gatewayUrl = getGatewayUrl();
  const ready = await ensureGatewayForCli();
  if (!ready) {
    ui.error(`Gateway did not become ready at ${gatewayUrl}`);
    process.exitCode = 1;
    return;
  }

  const sessionId = `cli_${Date.now()}`;
  ui.header('Prometheus Agent');
  ui.label('Mission', mission);
  ui.label('Session', sessionId);
  ui.label('UI', gatewayUrl);
  ui.blank();

  const res = await fetch(`${gatewayUrl}/api/chat`, {
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
  let launchInFlight = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let fastLaunchPending = false;
  const supervisorStateDir = process.env.PROMETHEUS_SUPERVISOR_STATE_DIR
    || path.join(getGatewayStateRoot(), '.prometheus');

  const launchReplacementSupervisor = async (request: SupervisorRestartRequest): Promise<boolean> => {
    try {
      const replacementEnv = {
        ...process.env,
        PROMETHEUS_SUPERVISOR: '1',
        PROMETHEUS_SUPERVISOR_RESTART: '1',
        PROMETHEUS_DISABLE_GATEWAY_SUPERVISOR: '0',
        PROMETHEUS_HOT_RESTART: '1',
        PROMETHEUS_SUPERVISOR_STATE_DIR: supervisorStateDir,
      } as NodeJS.ProcessEnv;
      delete replacementEnv.PROMETHEUS_SUPERVISED_GATEWAY_CHILD;
      const replacement = spawn(
        process.execPath,
        [...process.execArgv, ...process.argv.slice(1)],
        {
          cwd: process.cwd(),
          env: replacementEnv,
          detached: true,
          stdio: 'inherit',
          windowsHide: true,
        },
      );
      const started = await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };
        replacement.once('spawn', () => done(true));
        replacement.once('error', () => done(false));
        setTimeout(() => done(!!replacement.pid), 5_000).unref?.();
      });
      if (!started) return false;
      replacement.unref();
      console.error(`[GatewaySupervisor] Replacement supervisor started for request ${request.id} (pid=${replacement.pid || 'unknown'}).`);
      return true;
    } catch (error: any) {
      console.error(`[GatewaySupervisor] Could not replace supervisor: ${error?.message || error}`);
      return false;
    }
  };

  const scheduleLaunch = (explicitQuickRestart = false) => {
    if (stopping || restartTimer || launchInFlight) return;
    restartCount++;
    const delayMs = explicitQuickRestart ? 100 : Math.min(10_000, 1000 + restartCount * 1000);
    console.error(`[GatewaySupervisor] Scheduling gateway restart in ${delayMs}ms${explicitQuickRestart ? ' (explicit quick restart)' : ''}...`);
    fastLaunchPending = explicitQuickRestart;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      const launchFast = fastLaunchPending;
      fastLaunchPending = false;
      launch(launchFast).catch((err: any) => {
        console.error(`[GatewaySupervisor] Restart failed: ${err?.message || err}`);
        scheduleLaunch();
      });
    }, delayMs);
  };

  const launch = async (explicitQuickRestart = false) => {
    if (stopping || launchInFlight || (child && child.exitCode === null && child.signalCode === null)) return;
    launchInFlight = true;
    try {
    // The gateway process has already emitted its exit event for an explicit
    // quick restart, so the supervisor can spawn immediately. The health/port
    // ownership probe remains on crash-recovery and manual relaunch paths.
    if (!explicitQuickRestart) await clearUnhealthyGatewayPort(child?.pid ? [child.pid] : []);
    if (stopping) return;
    const launched = spawn(process.execPath, gatewayChildArgs(), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROMETHEUS_SUPERVISED_GATEWAY_CHILD: '1',
        PROMETHEUS_SUPERVISOR_STATE_DIR: supervisorStateDir,
        ...(explicitQuickRestart ? { PROMETHEUS_HOT_RESTART: '1' } : {}),
      },
      stdio: 'inherit',
      // A failed child may be relaunched several times while the supervisor
      // resolves ownership. Never surface each attempt as a new console on Windows.
      windowsHide: true,
    });
    child = launched;
    launched.once('exit', (code, signal) => {
      void (async () => {
      if (stopping) return;
      if (child === launched) child = null;
      console.error(`[GatewaySupervisor] Gateway exited (${signal || (code ?? 'unknown')}).`);
      const now = Date.now();
      const probe = await probeGatewayHealth(1200);
      const portOwnerPids = getGatewayPortOwnerPids();
      const runtimeStatus = readGatewayRuntimeStatus();
      const progressLease = readGatewayProgressLease(path.join(resolveInstallRoot(), '.prometheus'));
      const decision = classifyGatewaySupervisorObservation({
        now,
        healthOk: probe.healthy,
        childPid: launched.pid,
        childExited: true,
        portOwnerPids,
        consecutiveFailures: 0,
        failureLimit: GATEWAY_HEALTH_FAILURE_LIMIT,
        restartEnabled: gatewaySupervisorRestartEnabled(),
        heartbeatFreshMs: 20_000,
        legacyBusyGraceMs: GATEWAY_BUSY_RESTART_GRACE_MS,
        runtimeStatus,
        progressLease,
      });
      appendGatewaySupervisorEvidence(
        path.join(resolveInstallRoot(), '.prometheus'),
        buildGatewaySupervisorEvidence({
          now,
          supervisorPid: process.pid,
          childPid: launched.pid,
          childExit: { code, signal },
          portOwnerPids,
          probe: {
            healthy: probe.healthy,
            durationMs: probe.durationMs,
            outcome: probe.healthy ? 'healthy_after_child_exit' : signal ? 'child_signal_exit' : 'child_exit',
            statusCode: probe.statusCode,
          },
          consecutiveFailures: 0,
          decision,
          runtimeStatus,
          progressLease,
        }),
      );
      const supervisorRequest = takeSupervisorRestartRequest(
        supervisorStateDir,
        Number(launched.pid || 0),
      );
      if (supervisorRequest.request) {
        console.error(`[GatewaySupervisor] Gateway requested full supervisor replacement (${supervisorRequest.request.reason}).`);
        if (await launchReplacementSupervisor(supervisorRequest.request)) {
          stopping = true;
          if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
          }
          setTimeout(() => process.exit(0), 250).unref?.();
          return;
        }
        console.error('[GatewaySupervisor] Full replacement failed; falling back to relaunching the gateway child under the current supervisor.');
      } else if (supervisorRequest.status !== 'none') {
        console.error(`[GatewaySupervisor] Ignored supervisor replacement request (${supervisorRequest.status}).`);
      }
      if (probe.healthy) {
        console.error(`[GatewaySupervisor] Child exited, but a healthy gateway is already serving port ${getGatewayPort()}. Stopping this supervisor instead of relaunching a duplicate.`);
        stopping = true;
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        return;
      }
      scheduleLaunch(hasExplicitQuickRestartContext(supervisorStateDir));
      })().catch((error: any) => {
        console.error(`[GatewaySupervisor] Child-exit handling failed: ${error?.message || error}`);
        scheduleLaunch();
      });
    });
    } finally {
      launchInFlight = false;
      if (!stopping && !child) scheduleLaunch();
    }
  };

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
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
    const now = Date.now();
    const probe = await probeGatewayHealth();
    consecutiveFailures = probe.healthy ? 0 : consecutiveFailures + 1;
    const runtimeStatus = readGatewayRuntimeStatus();
    const progressLease = readGatewayProgressLease(path.join(resolveInstallRoot(), '.prometheus'));
    // PID inspection shells out on supported platforms. Keep the healthy path
    // cheap; ownership is required only before a failed probe may cause a kill.
    const portOwnerPids = probe.healthy ? [] : getGatewayPortOwnerPids();
    // launch() assigns through a nested closure, which TypeScript's control-flow
    // analysis does not model after the initial null assignment.
    const observedChild = child as ChildProcess | null;
    const childPid = observedChild?.pid;
    const childExited = !observedChild || observedChild.exitCode !== null || observedChild.signalCode !== null;
    const decision = classifyGatewaySupervisorObservation({
      now,
      healthOk: probe.healthy,
      childPid,
      childExited,
      portOwnerPids,
      consecutiveFailures,
      failureLimit: GATEWAY_HEALTH_FAILURE_LIMIT,
      restartEnabled: gatewaySupervisorRestartEnabled(),
      heartbeatFreshMs: 20_000,
      legacyBusyGraceMs: GATEWAY_BUSY_RESTART_GRACE_MS,
      runtimeStatus,
      progressLease,
    });

    appendGatewaySupervisorEvidence(
      path.join(resolveInstallRoot(), '.prometheus'),
      buildGatewaySupervisorEvidence({
        now,
        supervisorPid: process.pid,
        childPid,
        portOwnerPids,
        probe,
        consecutiveFailures,
        decision,
        runtimeStatus,
        progressLease,
      }),
    );

    if (decision.resetFailures) consecutiveFailures = 0;
    if (decision.state === 'healthy') {
      restartCount = 0;
      continue;
    }
    if (decision.state === 'busy_progressing' || decision.state === 'degraded_progressing') {
      const progressSeconds = Math.round(Math.max(0, decision.progressAgeMs ?? decision.heartbeatAgeMs ?? 0) / 1000);
      console.error(`[GatewaySupervisor] Health check failed, but gateway progress is fresh (${progressSeconds}s ago; ${decision.reasonCode}). Waiting instead of restarting.`);
      continue;
    }
    if (decision.state === 'identity_mismatch') {
      console.error(`[GatewaySupervisor] Gateway identity mismatch (child=${childPid || 'none'}, listeners=${portOwnerPids.join(',') || 'none'}). Refusing to kill a process until ownership agrees.`);
      continue;
    }
    if (decision.action === 'relaunch') {
      scheduleLaunch();
      continue;
    }
    if (decision.state === 'waiting') continue;
    if (decision.action !== 'restart') {
      console.error('[GatewaySupervisor] Gateway appears stalled, but auto-restart is disabled. Leaving the process running. Set PROMETHEUS_SUPERVISOR_RESTART=1 to enable confirmed-stall recovery.');
      continue;
    }
    console.error(`[GatewaySupervisor] Confirmed gateway stall (${decision.reasonCode}). Restarting gateway process...`);
    if (child) killGatewayChild(child);
    else scheduleLaunch();
  }
}

function resolveInstallRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function resolveElectronDevExecutable(): string {
  const rootDir = resolveInstallRoot();
  const candidates = process.platform === 'win32'
    ? [
      path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe'),
      path.join(rootDir, 'node_modules', '.bin', 'electron.cmd'),
    ]
    : [
      path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron'),
      path.join(rootDir, 'node_modules', '.bin', 'electron'),
    ];
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) {
    throw new Error('The local Electron runtime is not installed. Run npm install in PromSRC first.');
  }
  return executable;
}

function launchElectronDev(options: { port?: string; dataDir?: string }): void {
  const rootDir = resolveInstallRoot();
  const executable = resolveElectronDevExecutable();
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.PROMETHEUS_ELECTRON_DEV = '1';
  const requestedPort = options.port || process.env.PROMETHEUS_GATEWAY_PORT;
  if (requestedPort) {
    const port = parseGatewayPort(requestedPort);
    if (!port) throw new Error(`Invalid gateway port: ${requestedPort}`);
    env.PROMETHEUS_GATEWAY_PORT = String(port);
  }
  if (options.dataDir) {
    env.PROMETHEUS_ELECTRON_DATA_DIR = path.resolve(options.dataDir);
  }

  const child = spawn(executable, ['.'], {
    cwd: rootDir,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  // Electron's main process uses its explicit env override or its desktop
  // default; the terminal gateway config's port is not consulted here.
  const port = env.PROMETHEUS_GATEWAY_PORT || String(DEFAULT_GATEWAY_PORT);
  console.log(`[prom] Electron dev app launched from ${rootDir} (gateway port ${port}).`);
  console.log('[prom] This uses the local source runtime; no installer or package build is involved.');
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

function maybeNotifyUpdate(): void {
  if (process.env.PROMETHEUS_DISABLE_UPDATE_CHECK === '1') return;
  const status = readCanonicalUpdateStatus(getConfig().getConfigDir(), {
    currentVersion: readPackageMeta(resolveInstallRoot()).version,
    supported: process.env.PROMETHEUS_ELECTRON_MANAGED === '1'
      && process.env.PROMETHEUS_PUBLIC_BUILD === '1',
  });
  if (status.phase === 'available' || status.phase === 'ready') {
    ui.warn(status.message || 'A Prometheus update is ready.');
    ui.hint('Run `prometheus update` to request the safe packaged update flow.');
  }
}

async function runCanonicalCliUpdate(actionMode: 'check' | 'apply', assumeYes: boolean): Promise<void> {
  const requestRunningGatewayUpdate = (action: 'check' | 'apply', confirmed = false): Promise<any> => new Promise((resolve) => {
    const payload = JSON.stringify({ action, confirm: confirmed === true, source: 'cli' });
    const gatewayConfig = (getConfig().getConfig() as any)?.gateway || {};
    const rawToken = String(gatewayConfig?.auth?.token || gatewayConfig?.auth_token || '').trim();
    const token = String(getConfig().resolveSecret(rawToken) || rawToken).trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
      Connection: 'close',
    };
    if (token) headers['X-Gateway-Token'] = token;
    const req = http.request({
      hostname: '127.0.0.1',
      port: getGatewayPort(),
      path: '/api/lifecycle/update',
      method: 'POST',
      headers,
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 100_000) body += chunk; });
      res.on('end', () => {
        let parsed: any = null;
        try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = {}; }
        if (Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300) {
          resolve(parsed || { ok: true });
          return;
        }
        resolve({ ...(parsed || {}), ok: false, error: parsed?.error || `Gateway update request failed (${res.statusCode || 0}).` });
      });
    });
    req.on('timeout', () => req.destroy(new Error('The running Prometheus gateway did not respond.')));
    req.on('error', (error) => resolve({ ok: false, error: 'No running packaged Prometheus gateway is available. Start the packaged app first; no Git/npm changes were made.' }));
    req.end(payload);
  });

  const checkResult = await requestRunningGatewayUpdate('check');
  if (!checkResult?.ok) {
    ui.error(String(checkResult?.error || 'Prometheus update check failed.'));
    process.exitCode = 1;
    return;
  }
  const check = checkResult.status || {};
  if (!check.supported) {
    ui.error(check.message || 'Safe updates require a packaged public Prometheus build.');
    process.exitCode = 1;
    return;
  }
  if (actionMode === 'check') {
    ui.label('Version', check.currentVersion);
    if (['available', 'ready'].includes(check.phase)) ui.warn(check.message || 'A Prometheus update is available.');
    else ui.info(check.message || 'Prometheus update status unavailable.');
    return;
  }
  if (!['available', 'ready'].includes(check.phase)) {
    ui.info(check.message || 'Prometheus is already up to date.');
    return;
  }
  const confirmed = await confirmUpdate(assumeYes);
  if (!confirmed) {
    ui.info('Update canceled.');
    return;
  }
  const applied = await requestRunningGatewayUpdate('apply', true);
  if (!applied?.ok) {
    ui.error(String(applied?.error || 'Prometheus could not start the safe update flow.'));
    process.exitCode = 1;
    return;
  }
  ui.success('Safe update accepted. Electron will verify, back up, drain, install, relaunch, and validate it.');
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
    ui.info('1. Start the desktop app:  prom');
    ui.info('2. Start terminal/web mode: prom gateway start');
    ui.info('3. Go to Settings → Models to configure your LLM provider');
    ui.blank();
  });

// ---- GATEWAY ----
program
  .command('electron')
  .alias('desktop')
  .description('Launch the local Electron desktop app from source (no installer/build)')
  .option('--port <port>', 'Use a specific local gateway port')
  .option('--data-dir <path>', 'Use a separate Electron user-data directory')
  .action((options: { port?: string; dataDir?: string }) => {
    try {
      launchElectronDev(options);
    } catch (error: any) {
      ui.error(error?.message || String(error));
      process.exitCode = 1;
    }
  });

const gateway = program.command('gateway').description('Control the gateway server');

gateway
  .command('start')
  .description('Start the gateway + web UI server')
  .option('--port <port>', 'Use a dedicated gateway port for this instance')
  .option('--data-dir <path>', 'Use a dedicated data directory for this instance')
  .option('--primary-instance', 'Use the configured gateway port and primary workspace data')
  .option('--new-instance', 'Choose the next free port and an isolated instance data directory')
  .option('--auto-instance', 'Use the default instance when free, otherwise choose the next free isolated instance')
  .option('--canonical-dev-instance', 'Use the one persistent gateway assigned to this dev checkout')
  .action(async (options: { port?: string; dataDir?: string; primaryInstance?: boolean; newInstance?: boolean; autoInstance?: boolean; canonicalDevInstance?: boolean }) => {
    await configureGatewayInstance(options);
    const pairingAdmin = ensureManualPairingAdminCredential();
    if (pairingAdmin?.generated) {
      console.log(`[Pairing] Browser admin credential: ${pairingAdmin.token}`);
      console.log(pairingAdmin.persisted
        ? `[Pairing] Credential saved to: ${pairingAdmin.path}`
        : '[Pairing] Credential could not be saved; keep this terminal open or set PROMETHEUS_PAIRING_ADMIN_TOKEN explicitly.');
    }
    const gatewayUrl = getGatewayUrl();
    // ── Check if already running (skip during hot restart — old server is shutting down) ──
    if (!process.env.PROMETHEUS_HOT_RESTART) {
      try {
        if (await checkGatewayHealth(1200)) {
          console.log(`Gateway is already running at ${gatewayUrl}`);
          return;
        }
        const res = await fetch(`${gatewayUrl}/api/status`, {
          signal: AbortSignal.timeout(1200),
        });
        if (res.ok) {
          const data = await res.json() as any;
          console.log(`Gateway is already running at ${gatewayUrl}`);
          if (data?.currentModel) console.log(`Model: ${data.currentModel}`);
          return;
        }
      } catch {}
      const runtimeStatus = readGatewayRuntimeStatus();
      if (hasLiveGatewayHeartbeat(runtimeStatus, 30_000)) {
        const ageMs = runtimeStatus?.timestamp ? Date.now() - Number(runtimeStatus.timestamp) : -1;
        console.log(`Gateway is already running at ${gatewayUrl} (runtime heartbeat ${Math.max(0, Math.round(ageMs / 1000))}s ago)`);
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

    const gatewayArgs = gatewayChildArgs();
    const gatewayEntry = gatewayArgs[gatewayArgs.length - 1];
    let lastStartupError: unknown = null;
    for (let attempt = 1; attempt <= GATEWAY_START_ATTEMPTS; attempt++) {
      await clearUnhealthyGatewayPort();
      const suffix = GATEWAY_START_ATTEMPTS > 1 ? ` (attempt ${attempt}/${GATEWAY_START_ATTEMPTS})` : '';
      captureStartupLog(`[Gateway] Starting child process${suffix}: ${gatewayEntry}`);
      const child = spawn(process.execPath, gatewayArgs, {
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
    const gatewayUrl = getGatewayUrl('localhost');
    ui.header('Gateway Status');
    try {
      const res  = await fetch(`${gatewayUrl}/api/status`);
      const data = await res.json() as any;
      ui.statusRow('Gateway', `Online  ${gatewayUrl}`, 'ok');
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
  .command('agent <mission...>')
  .description('Run a mission via the gateway (starts gateway if needed)')
  .option('-p, --priority <number>', 'Job priority', '0')
  .action(async (mission: string[]) => {
    await runMissionThroughGateway(mission.join(' '));
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
  const gatewayUrl = getGatewayUrl('localhost');
  try {
    const res  = await fetch(`${gatewayUrl}/api/status`, { signal: AbortSignal.timeout(2000) } as any);
    const data = await res.json() as any;
    gatewayModel = data?.currentModel ? `  (${data.currentModel})` : '';
    ui.statusRow('Gateway', `Online  ${gatewayUrl}${gatewayModel}`, 'ok');
  } catch {
    ui.statusRow('Gateway', 'Offline', 'error');
    ui.hint('Run: prom gateway start');
  }

  // Update check
  try {
    const status = readCanonicalUpdateStatus(getConfig().getConfigDir(), {
      currentVersion: readPackageMeta(resolveInstallRoot()).version,
      supported: process.env.PROMETHEUS_ELECTRON_MANAGED === '1'
        && process.env.PROMETHEUS_PUBLIC_BUILD === '1',
    });
    if (status.phase === 'available' || status.phase === 'ready') {
      ui.statusRow('Updates', status.message, 'update');
      ui.hint('Run: prometheus update');
    } else {
      ui.statusRow('Updates', status.supported ? `Up to date  (v${status.currentVersion})` : 'Packaged public build required', status.supported ? 'ok' : 'warn');
    }
  } catch {
    ui.statusRow('Updates', 'Could not check', 'warn');
  }

  ui.blank();
});

// ---- UPDATE ----
program
  .command('update [mode]')
  .description('Request the safe packaged Prometheus update flow (mode: check|apply)')
  .option('-y, --yes', 'Skip confirmation prompt when applying updates', false)
  .action(async (mode: string | undefined, options: { yes?: boolean }) => {
    const actionMode = String(mode || 'apply').toLowerCase();
    if (actionMode !== 'check' && actionMode !== 'apply') {
      ui.error(`Unknown mode "${actionMode}". Use "check" or "apply".`);
      process.exitCode = 1;
      return;
    }
    await runCanonicalCliUpdate(actionMode as 'check' | 'apply', Boolean(options.yes));
  });

// Default: calling `prom` with no arguments launches the local Electron app
// from source for fast desktop testing. The regular terminal/web gateway stays
// available explicitly through `prom gateway start`.
if (process.argv.slice(2).length === 0) {
  process.argv.push('electron');
}

program.parse();
