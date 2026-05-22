import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type RuntimeBinary = 'ffmpeg' | 'ffprobe';

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore invalid platform paths
    }
  }
  return null;
}

export function toAsarUnpackedPath(candidate: string): string {
  const normalized = String(candidate || '');
  if (!normalized.includes('app.asar')) return normalized;
  const unpacked = normalized.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : normalized;
}

function resolvePackageBinary(packageName: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(packageName);
    if (mod?.path) return toAsarUnpackedPath(String(mod.path));
  } catch {
    // package may be absent in dev or on unsupported platform
  }
  return null;
}

export function resolveRuntimeBinary(binary: RuntimeBinary, options: { allowPathFallback?: boolean } = {}): string {
  const envName = binary === 'ffmpeg' ? 'PROMETHEUS_FFMPEG_PATH' : 'PROMETHEUS_FFPROBE_PATH';
  const envPath = String(process.env[envName] || '').trim();
  const bundled = binary === 'ffmpeg'
    ? resolvePackageBinary('@ffmpeg-installer/ffmpeg')
    : resolvePackageBinary('@ffprobe-installer/ffprobe');
  const resolved = firstExisting([envPath, bundled || '']);
  if (resolved) return resolved;
  if (options.allowPathFallback || process.env.NODE_ENV !== 'production') return binary;
  throw new Error(`Prometheus runtime dependency missing: bundled ${binary} executable was not found.`);
}

export async function canRunRuntimeBinary(binary: RuntimeBinary): Promise<boolean> {
  try {
    await execFileAsync(resolveRuntimeBinary(binary, { allowPathFallback: true }), ['-version'], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveNodeModulePath(packageName: string): string | null {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
}

function playwrightBrowserRoots(): string[] {
  const roots: string[] = [];
  const explicit = String(process.env.PLAYWRIGHT_BROWSERS_PATH || '').trim();
  if (explicit && explicit !== '0') roots.push(explicit);

  const playwrightCore = resolveNodeModulePath('playwright-core');
  const playwright = resolveNodeModulePath('playwright');
  if (playwrightCore) roots.push(toAsarUnpackedPath(path.join(playwrightCore, '.local-browsers')));
  if (playwright) roots.push(toAsarUnpackedPath(path.join(playwright, '.local-browsers')));

  const resourcesPath = (process as any).resourcesPath ? String((process as any).resourcesPath) : '';
  if (resourcesPath) {
    roots.push(path.join(resourcesPath, 'ms-playwright'));
    roots.push(path.join(resourcesPath, 'playwright-browsers'));
  }

  const home = os.homedir();
  roots.push(
    path.join(home, '.playwright-browsers'),
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? path.join(home, 'AppData', 'Local', 'ms-playwright')
        : path.join(home, '.cache', 'ms-playwright'),
  );

  return Array.from(new Set(roots.filter(Boolean)));
}

export function resolveBundledPlaywrightChromium(): string | null {
  const rels = process.platform === 'darwin'
    ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? ['chrome-win/chrome.exe', 'chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell.exe']
      : ['chrome-linux/chrome', 'chrome-headless-shell-linux/chrome-headless-shell', 'chrome-headless-shell'];

  for (const root of playwrightBrowserRoots()) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /chromium/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
    for (const dir of dirs) {
      for (const rel of rels) {
        const candidate = path.join(root, dir, rel);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function resolveBundledCliEntry(packageName: string): string | null {
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(pkgPath);
    const bin = typeof pkg?.bin === 'string'
      ? pkg.bin
      : pkg?.bin?.[packageName] || pkg?.bin?.[Object.keys(pkg?.bin || {})[0]];
    if (!bin) return null;
    const entry = toAsarUnpackedPath(path.resolve(path.dirname(pkgPath), String(bin)));
    return fs.existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}
