'use strict';

const { execFileSync } = require('node:child_process');

function parsePidList(output) {
  return [...new Set(
    String(output || '')
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  )];
}

function getPosixListeningPids(port, execFile = execFileSync) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) return [];
  try {
    const output = execFile(
      'lsof',
      ['-ti', `tcp:${numericPort}`, '-sTCP:LISTEN'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 },
    );
    return parsePidList(output);
  } catch {
    return [];
  }
}

function killGatewayProcessTree(child, {
  platform = process.platform,
  execFile = execFileSync,
  kill = process.kill,
} = {}) {
  if (!child || !child.pid) return false;

  if (platform === 'win32') {
    try {
      execFile(
        'taskkill',
        ['/PID', String(child.pid), '/F', '/T'],
        { stdio: 'pipe', timeout: 8_000 },
      );
      return true;
    } catch {}
  }

  // POSIX detached children become their own process-group leaders. Killing
  // the negative PID terminates the Electron wrapper and the actual gateway
  // descendants that inherit its group, rather than leaving the listener
  // behind on macOS/Linux.
  if (platform !== 'win32') {
    try {
      kill(-Number(child.pid), 'SIGKILL');
      return true;
    } catch {}
  }

  try {
    child.kill('SIGKILL');
    return true;
  } catch {
    return false;
  }
}

function killGatewayPortOwner(pid, {
  platform = process.platform,
  execFile = execFileSync,
  kill = process.kill,
} = {}) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;

  if (platform === 'win32') {
    try {
      execFile(
        'taskkill',
        ['/PID', String(numericPid), '/F', '/T'],
        { stdio: 'pipe', timeout: 8_000 },
      );
      return true;
    } catch {
      return false;
    }
  }

  try {
    kill(numericPid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getPosixListeningPids,
  killGatewayPortOwner,
  killGatewayProcessTree,
  parsePidList,
};
