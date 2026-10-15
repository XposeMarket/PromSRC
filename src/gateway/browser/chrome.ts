
/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

import { BrowserPerformanceObserver, markBrowserPerformance, BrowserProfileKind } from './types.js';


export let playwrightModule: any = null;
export let playwrightChecked = false;

export function ensurePlaywrightBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  try {
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.homedir(), '.playwright-browsers');
  } catch {
    // Best-effort only; Playwright has its own defaults.
  }
}

export async function findBundledChromiumExecutable(): Promise<string | null> {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const home = os.homedir();
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, '.playwright-browsers'),
    path.join(home, '.playwright-browsers'),
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? path.join(home, 'AppData', 'Local', 'ms-playwright')
        : path.join(home, '.cache', 'ms-playwright'),
  ];

  const exeCandidates = process.platform === 'darwin'
    ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? ['chrome-win/chrome.exe']
      : ['chrome-linux/chrome'];

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const dirs = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith('chromium-'))
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a));
      for (const dir of dirs) {
        for (const rel of exeCandidates) {
          const candidate = path.join(root, dir, rel);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // Continue scanning other roots.
    }
  }
  return null;
}

export async function findBrowserExecutableForPlaywright(): Promise<string | null> {
  const fs = await import('fs');
  const chromePaths = [
    process.env.CHROME_PATH,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : '',
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
    process.platform === 'linux' ? '/usr/bin/chromium' : '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    await findBundledChromiumExecutable(),
  ].filter(Boolean) as string[];
  return chromePaths.find((candidate) => fs.existsSync(candidate)) || null;
}

export async function getPW(): Promise<any | null> {
  if (playwrightChecked) return playwrightModule;
  playwrightChecked = true;
  ensurePlaywrightBrowsersPath();
  try {
    playwrightModule = await (Function('return import("playwright")')() as Promise<any>);
    return playwrightModule;
  } catch {
    console.warn('[Browser] Playwright not installed. Run: npm install playwright && npx playwright install chromium');
    return null;
  }
}

export async function isPortOpen(port: number, timeoutMs: number = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
      cache: 'no-store',
    } as any);
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function escapePowerShellSingleQuoted(value: string): string {
  return String(value || '').replace(/'/g, "''");
}

export function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function readCommandLineOption(commandLine: string, option: string): string {
  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(option)}(?:=|\\s+)("[^"]*"|'[^']*'|[^\\s]+)`,
    'i',
  );
  const match = String(commandLine || '').match(pattern);
  return String(match?.[1] || '').replace(/^["']|["']$/g, '').trim();
}

export function normalizeCommandLinePath(value: string): string {
  return path.resolve(String(value || '').trim().replace(/^["']|["']$/g, ''))
    .replace(/[\\/]+/g, '\\')
    .replace(/[\\]+$/, '')
    .toLowerCase();
}

export function isPrometheusDebugProcess(commandLine: string, debugPort: number, profileDir: string): boolean {
  const port = readCommandLineOption(commandLine, '--remote-debugging-port');
  const profile = readCommandLineOption(commandLine, '--user-data-dir');
  return port === String(debugPort)
    && !!profile
    && normalizeCommandLinePath(profile) === normalizeCommandLinePath(profileDir);
}

export async function execFileCapture(command: string, args: string[], options: Record<string, any> = {}): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import('child_process');
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, windowsHide: true }, (error: any, stdout: any, stderr: any) => {
      if (error) {
        error.stdout = String(stdout || '');
        error.stderr = String(stderr || '');
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** Find only the browser process that owns Prometheus' exact debugger port and profile. */
export async function findPrometheusDebugProcesses(debugPort: number, profileDir: string): Promise<Array<{ pid: number; commandLine: string }>> {
  const portToken = `--remote-debugging-port=${debugPort}`;
  const profileToken = path.resolve(profileDir);
  try {
    if (process.platform === 'win32') {
      const script = `$port='${escapePowerShellSingleQuoted(portToken)}'; $targetProfile='${escapePowerShellSingleQuoted(profileToken)}'; ` +
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like ('*' + $port + '*') -and $_.CommandLine -like ('*' + $targetProfile + '*') } | ` +
        `Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
      const result = await execFileCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
      if (!result.stdout.trim()) return [];
      const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((row: any) => ({ pid: Number(row?.ProcessId || 0), commandLine: String(row?.CommandLine || '') }))
        .filter((row) => row.pid > 0 && row.pid !== process.pid && isPrometheusDebugProcess(row.commandLine, debugPort, profileDir));
    }
    const result = await execFileCapture('ps', ['-eo', 'pid=,args='], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
    return result.stdout.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!match || !isPrometheusDebugProcess(match[2], debugPort, profileToken)) return [];
      const pid = Number(match[1]);
      return pid > 0 && pid !== process.pid ? [{ pid, commandLine: match[2] }] : [];
    });
  } catch {
    return [];
  }
}

export function isPrometheusManagedChromeProfile(profileDir: string): boolean {
  const resolved = path.resolve(profileDir);
  const root = path.resolve(os.homedir(), '.prometheus');
  const relative = path.relative(root, resolved);
  // The default and background profiles live below .prometheus. An explicit
  // opt-in is required before recovery can ever target a custom profile path.
  return (
    !!relative
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
  ) || process.env.PROMETHEUS_ALLOW_CDP_RECOVERY === '1';
}

export async function recoverStuckPrometheusChrome(debugPort: number, profileDir: string): Promise<boolean> {
  if (!isPrometheusManagedChromeProfile(profileDir)) return false;
  const processes = await findPrometheusDebugProcesses(debugPort, profileDir);
  if (!processes.length) return false;
  let terminated = false;
  for (const processInfo of processes) {
    try {
      if (process.platform === 'win32') {
        await execFileCapture('taskkill.exe', ['/PID', String(processInfo.pid), '/T', '/F'], { timeout: 8000 });
      } else {
        process.kill(processInfo.pid, 'SIGTERM');
      }
      terminated = true;
    } catch {}
  }
  if (!terminated) return false;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!(await isPortOpen(debugPort, 500))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !(await isPortOpen(debugPort, 500));
}

export async function connectOverCDPWithTimeout(pw: any, debugPort: number, timeoutMs: number = 5000): Promise<any> {
  return await pw.chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: timeoutMs });
}

export async function connectOverCDPWithRetry(
  pw: any,
  debugPort: number,
  onPerformanceStage?: BrowserPerformanceObserver,
): Promise<any> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 250 * (attempt - 1))));
    markBrowserPerformance(onPerformanceStage, 'cdp_attach_attempt', { attempt, debugPort });
    try {
      const browser = await connectOverCDPWithTimeout(pw, debugPort);
      markBrowserPerformance(onPerformanceStage, 'cdp_attach_done', {
        attempt,
        attempts: attempt,
        durationMs: Math.max(0, Date.now() - startedAt),
        debugPort,
      });
      return browser;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        markBrowserPerformance(onPerformanceStage, 'cdp_attach_retry', { attempt, debugPort, errorCode: 'cdp_attach' });
      }
    }
  }
  markBrowserPerformance(onPerformanceStage, 'cdp_attach_error', {
    attempts,
    durationMs: Math.max(0, Date.now() - startedAt),
    debugPort,
    errorCode: 'cdp_attach',
  });
  throw lastError instanceof Error ? lastError : new Error('CDP attach failed.');
}

export function getMainChromeDebugPort(): number {
  return Number(process.env.CHROME_DEBUG_PORT || '9222');
}

export function getUserChromeDebugPort(): number {
  return Number(process.env.USER_CHROME_DEBUG_PORT || process.env.CHROME_USER_DEBUG_PORT || '9223');
}

export function normalizeBrowserProfileKind(value: unknown): BrowserProfileKind {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (['inhouse', 'in_house', 'in_app', 'electron', 'electron_browser', 'prometheus_inhouse', 'prometheus_in_house'].includes(raw)) return 'inhouse';
  if (['user', 'user_chrome', 'current', 'current_chrome', 'real', 'real_profile'].includes(raw)) return 'user';
  return 'prometheus';
}

export function getBrowserProfileLabel(kind: BrowserProfileKind): string {
  if (kind === 'inhouse') return 'Prometheus in-house browser';
  return kind === 'user' ? 'user Chrome profile' : 'Prometheus browser profile';
}

export function getInHouseBrowserRpcConfig(): { url: string; token: string } | null {
  const url = String(process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_URL || '').trim();
  const token = String(process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN || '').trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}
