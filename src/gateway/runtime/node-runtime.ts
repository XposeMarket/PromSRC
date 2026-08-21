export interface NodeRuntimeSnapshot {
  nodeVersion: string;
  major: number;
  minor: number;
  patch: number;
  execPath: string;
  pid: number;
  processStartedAt: number;
  platform: string;
  arch: string;
  electronRunAsNode: boolean;
}

const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 20;
const MAX_NODE_MAJOR_EXCLUSIVE = 23;

export function parseNodeVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = String(version || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isSupportedNodeVersion(version: string): boolean {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  if (parsed.major < MIN_NODE_MAJOR || parsed.major >= MAX_NODE_MAJOR_EXCLUSIVE) return false;
  return parsed.major > MIN_NODE_MAJOR || parsed.minor >= MIN_NODE_MINOR;
}

function resolveProcessStartedAt(): number {
  const configured = Number(process.env.PROMETHEUS_GATEWAY_PROCESS_STARTED_AT);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return Date.now() - Math.floor(process.uptime() * 1000);
}

export function getNodeRuntimeSnapshot(): NodeRuntimeSnapshot {
  const parsed = parseNodeVersion(process.versions.node) || { major: 0, minor: 0, patch: 0 };
  return {
    nodeVersion: process.versions.node,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    execPath: process.execPath,
    pid: process.pid,
    processStartedAt: resolveProcessStartedAt(),
    platform: process.platform,
    arch: process.arch,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
  };
}

export function assertSupportedNodeRuntime(context = 'gateway'): NodeRuntimeSnapshot {
  const snapshot = getNodeRuntimeSnapshot();
  if (!isSupportedNodeVersion(snapshot.nodeVersion)) {
    const message = [
      'Unsupported Node.js runtime for ' + context + ': ' + snapshot.nodeVersion + '.',
      'Prometheus requires Node.js >= ' + MIN_NODE_MAJOR + '.' + MIN_NODE_MINOR + '.0 and < ' + MAX_NODE_MAJOR_EXCLUSIVE + '.0.0.',
      'Executable: ' + snapshot.execPath,
    ].join(' ');
    console.error('[NodeRuntime] ' + message);
    throw new Error(message);
  }
  return snapshot;
}
