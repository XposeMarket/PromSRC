'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release-public');
const RESOURCES_DIR = path.join(ROOT, 'release-public', 'win-unpacked', 'resources');
const ASAR_PATH = path.join(RESOURCES_DIR, 'app.asar');
const MANIFEST_PATH = path.join(ROOT, 'runtime-dependencies.public.json');
const PACKAGE_PATH = path.join(ROOT, 'package.json');

const BANNED_PATTERNS = [
  /^workspace(?:\/|$)/,
  /^\.prometheus(?:\/|$)/,
  /^teams(?:\/|$)/,
  /^src(?:\/|$)/,
  /^web-ui(?:\/|$)/,
  /^scripts(?:\/|$)/,
  /^bin(?:\/|$)/,
  /^\.git(?:\/|$)/,
  /^\.claude(?:\/|$)/,
  /^\.cursor(?:\/|$)/,
  /^\.vscode(?:\/|$)/,
  /^\.pip-cache(?:\/|$)/,
  /^\.pip-tmp(?:\/|$)/,
  /^\.tmp-py(?:\/|$)/,
  /^release(?:\/|$)/,
  /^release-public(?:\/|$)/,
  /^output(?:\/|$)/,
  /^tmp(?:\/|$)/,
  /(?:^|\/)downloads(?:\/|$)/,
  /(?:^|\/)uploads(?:\/|$)/,
  /^node_modules\/(?:electron|electron-builder|eslint|tsx)(?:\/|$)/,
  /^node_modules\/(?:@electron|@electron-builder|@types|@typescript-eslint)(?:\/|$)/,
  /^node_modules\/(?:app-builder-bin|app-builder-lib|builder-util|builder-util-runtime)(?:\/|$)/,
  /\.(?:log|docx|zip|mp4)$/i,
  /(?:^|\/)eng\.traineddata$/i,
  /^(?:CIS|Context|PROPOSALS_ANALYSIS|Prometheus_CIS_Plan|Prometheus_Teams_CIS_Master_Plan|prometheus_browser_intelligence)(?:\.md|\.docx)?$/i,
  /(?:^|\/)(?:apply-local-llm-patch|b5-server-v2|write-chat-helpers|patch-server-v2|rebrand-html|rebrand-src|test-ollama|check-build|start-gateway)\.(?:js|mjs|bat)$/i,
];

function normalizeEntry(entry) {
  return String(entry).replace(/\\/g, '/').replace(/^\/+/, '');
}

function walk(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(fullPath, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function isBanned(entry) {
  const normalized = normalizeEntry(entry);
  return BANNED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasEntry(entries, relPath) {
  const normalized = normalizeEntry(relPath);
  return entries.includes(normalized) || entries.includes(`/${normalized}`);
}

function assertAsarEntry(appEntries, relPath) {
  if (!hasEntry(appEntries, relPath)) {
    throw new Error(`Missing required app.asar entry: ${relPath}`);
  }
}

function assertResourcePath(relPath) {
  const fullPath = path.join(RESOURCES_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required resource path: ${relPath}`);
  }
  return fullPath;
}

function findFirstExisting(root, names) {
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (names.includes(entry.name)) return full;
    }
  }
  return null;
}

function runVersionCheck(binaryPath, label) {
  const childProcess = require('child_process');
  const result = childProcess.spawnSync(binaryPath, ['-version'], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed version check: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
}

function readLatestYml() {
  const latestPath = path.join(RELEASE_DIR, 'latest.yml');
  if (!fs.existsSync(latestPath)) {
    throw new Error('Missing release-public/latest.yml. The updater feed was not generated.');
  }

  const latest = {};
  for (const line of fs.readFileSync(latestPath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) latest[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return latest;
}

function fileSha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function verifyUpdaterMetadata() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf-8'));
  const latest = readLatestYml();
  const expectedInstaller = `Prometheus-Setup-${pkg.version}.exe`;
  const installerPath = path.join(RELEASE_DIR, expectedInstaller);
  const blockmapPath = `${installerPath}.blockmap`;

  if (!fs.existsSync(installerPath)) {
    throw new Error(`Missing installer artifact: release-public/${expectedInstaller}`);
  }
  if (!fs.existsSync(blockmapPath)) {
    throw new Error(`Missing installer blockmap: release-public/${expectedInstaller}.blockmap`);
  }
  if (latest.version !== pkg.version) {
    throw new Error(`latest.yml version ${latest.version || '(missing)'} does not match package.json version ${pkg.version}.`);
  }
  if (latest.path !== expectedInstaller) {
    throw new Error(`latest.yml path ${latest.path || '(missing)'} does not match expected installer ${expectedInstaller}.`);
  }
  if (latest.sha512 !== fileSha512Base64(installerPath)) {
    throw new Error(`latest.yml sha512 does not match release-public/${expectedInstaller}.`);
  }

  const actualSize = fs.statSync(installerPath).size;
  const metadataSize = Number(latest.size);
  if (!Number.isFinite(metadataSize) || metadataSize !== actualSize) {
    throw new Error(`latest.yml size ${latest.size || '(missing)'} does not match installer size ${actualSize}.`);
  }
}

function verifyRuntimeDependencies(appEntries) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  for (const packageName of manifest.requiredNpmPackages || []) {
    assertAsarEntry(appEntries, `node_modules/${packageName}/package.json`);
  }
  for (const assetPath of manifest.requiredPublicWebAssets || []) {
    assertAsarEntry(appEntries, `generated/public-web-ui/${assetPath}`);
  }
  assertAsarEntry(appEntries, 'runtime-dependencies.public.json');

  const unpackedNodeModules = path.join(RESOURCES_DIR, 'app.asar.unpacked', 'node_modules');
  const ffmpegRoot = assertResourcePath(path.join('app.asar.unpacked', 'node_modules', '@ffmpeg-installer'));
  const ffprobeRoot = assertResourcePath(path.join('app.asar.unpacked', 'node_modules', '@ffprobe-installer'));
  const playwrightBrowsers = assertResourcePath('playwright-browsers');

  const ffmpeg = findFirstExisting(ffmpegRoot, process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg']);
  const ffprobe = findFirstExisting(ffprobeRoot, process.platform === 'win32' ? ['ffprobe.exe'] : ['ffprobe']);
  const chromium = findFirstExisting(playwrightBrowsers, process.platform === 'win32'
    ? ['chrome.exe', 'chrome-headless-shell.exe']
    : process.platform === 'darwin'
      ? ['Chromium']
      : ['chrome', 'chrome-headless-shell']);
  if (!ffmpeg) throw new Error('Bundled ffmpeg executable was not found in app.asar.unpacked.');
  if (!ffprobe) throw new Error('Bundled ffprobe executable was not found in app.asar.unpacked.');
  if (!chromium) throw new Error('Bundled Playwright Chromium executable was not found in app.asar.unpacked.');
  runVersionCheck(ffmpeg, 'ffmpeg');
  runVersionCheck(ffprobe, 'ffprobe');

  for (const rel of [
    path.join('better-sqlite3'),
    path.join('node-pty'),
    path.join('onnxruntime-node'),
  ]) {
    assertResourcePath(path.join('app.asar.unpacked', 'node_modules', rel));
  }

  if (!fs.existsSync(unpackedNodeModules)) {
    throw new Error('app.asar.unpacked/node_modules is missing.');
  }
}

function main() {
  if (!fs.existsSync(ASAR_PATH)) {
    throw new Error(`Public release app.asar not found: ${ASAR_PATH}`);
  }

  const appEntries = asar.listPackage(ASAR_PATH).map(normalizeEntry);
  const resourceEntries = walk(RESOURCES_DIR)
    .map(normalizeEntry)
    .filter((entry) => entry !== 'app.asar');

  const bannedAppEntries = appEntries.filter(isBanned);
  const bannedResourceEntries = resourceEntries.filter(isBanned);
  const banned = [
    ...bannedAppEntries.map((entry) => `app.asar:${entry}`),
    ...bannedResourceEntries.map((entry) => `resources:${entry}`),
  ];

  if (banned.length) {
    console.error('[verify-public-release] Found banned release contents:');
    for (const entry of banned.slice(0, 120)) console.error(`- ${entry}`);
    if (banned.length > 120) console.error(`...and ${banned.length - 120} more`);
    process.exit(1);
  }

  verifyRuntimeDependencies(appEntries);
  verifyUpdaterMetadata();

  console.log(`[verify-public-release] OK: scanned ${appEntries.length} app.asar entries and ${resourceEntries.length} resource entries`);
}

main();
