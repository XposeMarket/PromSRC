'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release-public');
const PACKAGE = require(path.join(ROOT, 'package.json'));
const EXPECTED_ARCH = process.argv.find((arg) => arg.startsWith('--arch='))?.split('=')[1]
  || (process.arch === 'arm64' ? 'arm64' : 'x64');
const MACH_ARCH = EXPECTED_ARCH === 'x64' ? 'x86_64' : 'arm64';

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function requirePath(target, label) {
  if (!fs.existsSync(target)) throw new Error(`Missing ${label}: ${target}`);
  return target;
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function assertMachArchitecture(target, label) {
  const output = run('/usr/bin/file', [target]);
  if (!output.includes(MACH_ARCH)) {
    throw new Error(`${label} is not ${MACH_ARCH}: ${output.trim()}`);
  }
}

function findApp() {
  const apps = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === 'Prometheus.app') apps.push(full);
      else if (entry.isDirectory() && !entry.name.endsWith('.app')) visit(full);
    }
  };
  visit(RELEASE_DIR);
  const archNamed = apps.find((appPath) => EXPECTED_ARCH === 'arm64'
    ? appPath.toLowerCase().includes('arm64')
    : !appPath.toLowerCase().includes('arm64'));
  return archNamed || apps[0];
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Mac release verification must run on macOS.');
  }

  const appPath = requirePath(findApp() || '', 'unpacked Prometheus.app');
  const resources = path.join(appPath, 'Contents', 'Resources');
  const appAsar = requirePath(path.join(resources, 'app.asar'), 'app.asar');
  const helper = requirePath(path.join(resources, 'prometheus-desktop-helper'), 'macOS desktop helper');
  const browsers = requirePath(path.join(resources, 'playwright-browsers'), 'bundled Playwright browsers');
  requirePath(path.join(resources, 'bundled-skills'), 'bundled skills');

  requirePath(
    path.join(RELEASE_DIR, `Prometheus-${PACKAGE.version}-mac-${EXPECTED_ARCH}.dmg`),
    'DMG artifact',
  );
  requirePath(
    path.join(RELEASE_DIR, `Prometheus-${PACKAGE.version}-mac-${EXPECTED_ARCH}.zip`),
    'ZIP updater artifact',
  );
  requirePath(path.join(RELEASE_DIR, 'latest-mac.yml'), 'Mac updater metadata');

  assertMachArchitecture(path.join(appPath, 'Contents', 'MacOS', 'Prometheus'), 'Electron executable');
  assertMachArchitecture(helper, 'desktop helper');

  const ping = run(helper, [], {
    input: '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}\n',
  });
  const response = JSON.parse(ping.trim().split(/\r?\n/).find((line) => line.trim().startsWith('{')) || '{}');
  if (response?.result?.pong !== true) throw new Error(`Desktop helper ping failed: ${ping.trim()}`);

  const unpackedModules = path.join(resources, 'app.asar.unpacked', 'node_modules');
  for (const moduleName of ['better-sqlite3', 'node-pty', 'onnxruntime-node']) {
    const moduleRoot = requirePath(path.join(unpackedModules, moduleName), `${moduleName} unpacked module`);
    const binaries = walk(moduleRoot).filter((file) => /\.(?:node|dylib)$/i.test(file));
    if (!binaries.length) throw new Error(`${moduleName} has no unpacked native binaries.`);
    for (const binary of binaries) assertMachArchitecture(binary, `${moduleName} native binary`);
  }

  const chromium = walk(browsers).find((file) => file.endsWith('/Chromium.app/Contents/MacOS/Chromium'));
  if (!chromium) throw new Error('Bundled Playwright Chromium executable was not found.');
  assertMachArchitecture(chromium, 'Playwright Chromium');

  const mediaRoots = [
    path.join(unpackedModules, '@ffmpeg-installer'),
    path.join(unpackedModules, '@ffprobe-installer'),
  ];
  for (const [index, root] of mediaRoots.entries()) {
    const binaryName = index === 0 ? 'ffmpeg' : 'ffprobe';
    const binary = walk(requirePath(root, `${binaryName} package`)).find((file) => path.basename(file) === binaryName);
    if (!binary) throw new Error(`Bundled ${binaryName} executable was not found.`);
    assertMachArchitecture(binary, binaryName);
    run(binary, ['-version']);
  }

  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  if (process.env.PROMETHEUS_REQUIRE_MAC_SIGNING === '1') {
    const details = run('/usr/bin/codesign', ['-dv', '--verbose=4', appPath]);
    if (!/Authority=Developer ID Application:/m.test(details)) {
      throw new Error('Prometheus.app is not signed with a Developer ID Application certificate.');
    }
    run('/usr/sbin/spctl', ['--assess', '--verbose=2', '--type', 'execute', appPath]);
    run('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
  }

  console.log(`[verify-macos-release] OK: ${EXPECTED_ARCH} app, native dependencies, helper, updater ZIP, and DMG`);
  console.log(`[verify-macos-release] app.asar: ${appAsar}`);
}

main();
