import fs from 'fs';
import os from 'os';
import path from 'path';

export function describePlaywrightBrowserRemediation(err?: any): string {
  const detail = err?.message ? ` Original error: ${String(err.message).split(/\r?\n/)[0]}` : '';
  return [
    'Playwright is installed, but no usable Chromium/Chrome browser executable was found.',
    'Run the Prometheus app/bootstrap dependency setup or install the browser once with: npx playwright install chromium',
    'If Chrome is already installed, set CHROME_PATH to its chrome.exe path.',
  ].join(' ') + detail;
}

function playwrightBrowserRoots(): string[] {
  const home = os.homedir();
  return [
    process.env.PLAYWRIGHT_BROWSERS_PATH || '',
    path.join(home, '.playwright-browsers'),
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? path.join(home, 'AppData', 'Local', 'ms-playwright')
        : path.join(home, '.cache', 'ms-playwright'),
  ].filter(Boolean);
}

function findPlaywrightChromiumExecutable(): string | null {
  const rels = process.platform === 'darwin'
    ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? ['chrome-win/chrome.exe', 'chrome-headless-shell.exe']
      : ['chrome-linux/chrome', 'chrome-headless-shell'];

  for (const root of playwrightBrowserRoots()) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith('chromium'))
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

function findSystemChromeExecutable(): string | null {
  const candidates = [
    process.env.CHROME_PATH || '',
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : '',
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
    process.platform === 'linux' ? '/usr/bin/chromium' : '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function getFallbackBrowserExecutable(): string | null {
  return findPlaywrightChromiumExecutable() || findSystemChromeExecutable();
}

export async function launchCreativeChromium(playwright: any, options: any = {}): Promise<any> {
  try {
    return await playwright.chromium.launch({ headless: true, ...options });
  } catch (err: any) {
    const executablePath = getFallbackBrowserExecutable();
    if (executablePath) {
      return playwright.chromium.launch({ headless: true, ...options, executablePath });
    }
    throw new Error(describePlaywrightBrowserRemediation(err));
  }
}
