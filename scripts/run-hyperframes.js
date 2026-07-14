#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function prependPathDir(env, dir) {
  const resolved = path.resolve(dir);
  const pathKey = process.platform === 'win32'
    ? (Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path')
    : 'PATH';
  const parts = String(env[pathKey] || '').split(path.delimiter).filter(Boolean);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const exists = parts.some((part) => {
    const candidate = path.resolve(part);
    return (process.platform === 'win32' ? candidate.toLowerCase() : candidate) === normalized;
  });
  if (!exists) env[pathKey] = [resolved, ...parts].join(path.delimiter);
}

function exposeBinary(env, packageName, envName) {
  try {
    const mod = require(packageName);
    const binaryPath = String(mod && mod.path || '').trim();
    if (!binaryPath || !fs.existsSync(binaryPath)) return;
    prependPathDir(env, path.dirname(binaryPath));
    if (!String(env[envName] || '').trim()) env[envName] = binaryPath;
  } catch {
    // Leave ambient PATH in place. The CLI will print its own dependency error.
  }
}

function exposeCachedWhisper(env) {
  const configured = String(env.HYPERFRAMES_WHISPER_PATH || '').trim();
  if (configured && fs.existsSync(configured)) {
    prependPathDir(env, path.dirname(configured));
    return;
  }

  const buildRoot = path.join(
    os.homedir(),
    '.cache',
    'hyperframes',
    'whisper',
    'whisper.cpp',
    'build',
  );
  const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const candidates = process.platform === 'win32'
    ? [
        path.join(buildRoot, 'bin', 'Release', executable),
        path.join(buildRoot, 'Release', executable),
        path.join(buildRoot, 'bin', executable),
        path.join(buildRoot, executable),
      ]
    : [path.join(buildRoot, 'bin', executable), path.join(buildRoot, executable)];
  const discovered = candidates.find((candidate) => fs.existsSync(candidate));
  if (!discovered) return;
  env.HYPERFRAMES_WHISPER_PATH = discovered;
  prependPathDir(env, path.dirname(discovered));
}

function resolveHyperframesCli() {
  const pkgPath = require.resolve('hyperframes/package.json');
  const pkg = require(pkgPath);
  const bin = typeof pkg.bin === 'string'
    ? pkg.bin
    : pkg.bin && (pkg.bin.hyperframes || pkg.bin[Object.keys(pkg.bin)[0]]);
  if (!bin) throw new Error('Could not find hyperframes CLI bin in package.json.');
  const cliPath = path.resolve(path.dirname(pkgPath), bin);
  if (!fs.existsSync(cliPath)) throw new Error(`HyperFrames CLI entry does not exist: ${cliPath}`);
  return cliPath;
}

const env = { ...process.env };
exposeBinary(env, '@ffmpeg-installer/ffmpeg', 'FFMPEG_PATH');
exposeBinary(env, '@ffprobe-installer/ffprobe', 'FFPROBE_PATH');
exposeCachedWhisper(env);

const cliPath = resolveHyperframesCli();
const child = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: true,
});

if (child.error) {
  console.error(child.error.message || child.error);
  process.exit(1);
}
process.exit(typeof child.status === 'number' ? child.status : 1);
