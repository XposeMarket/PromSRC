'use strict';

// Stage the Node runtime that the packaged gateway runs on.
//
// The desktop app used to run the gateway on Electron's embedded Node
// (ELECTRON_RUN_AS_NODE). That Node differs from the one that installs and
// builds node_modules, so native addons (better-sqlite3, node-pty, onnxruntime)
// loaded on one and failed on the other, and the gateway's Node version floor
// rejected it. Shipping the exact Node that built node_modules makes the
// installed app run the gateway the same way `prom gateway start` does.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build-resources', 'node');
const MIN = { major: 20, minor: 20 };

function main() {
  const source = String(process.env.PROMETHEUS_BUNDLED_NODE || process.execPath);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!process.env.PROMETHEUS_BUNDLED_NODE && (major < MIN.major || (major === MIN.major && minor < MIN.minor))) {
    throw new Error(`Bundled gateway Node must be >= ${MIN.major}.${MIN.minor}; build is running on ${process.versions.node}.`);
  }
  if (!fs.existsSync(source)) throw new Error(`Node runtime not found: ${source}`);
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, name);
  fs.copyFileSync(source, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  fs.writeFileSync(path.join(OUT_DIR, 'runtime.json'), `${JSON.stringify({
    node: process.versions.node,
    modules: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    source,
  }, null, 2)}\n`);
  console.log(`[prepare-bundled-node] Staged Node ${process.versions.node} (ABI ${process.versions.modules}) -> ${path.relative(ROOT, target)}`);
}

main();
