/**
 * Stable identity and safe, non-secret descriptor for one Prometheus gateway.
 *
 * The identity is local to this installation/config directory. It is not an
 * account-wide node id and it does not create a federation or shared store.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../config/config';

const FILE_NAME = 'gateway-identity.json';
const PROTOCOL = 'prometheus-mobile-gateway';
const PROTOCOL_VERSION = 1;
const MOBILE_GATEWAY_CATALOG_ENABLED = process.env.PROMETHEUS_MOBILE_GATEWAY_CATALOG !== '0';

interface StoredIdentity {
  version: 1;
  gatewayId: string;
  createdAt: number;
}

let cached: StoredIdentity | null = null;

function identityPath(): string {
  const dir = getConfig().getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, FILE_NAME);
}

function randomId(): string {
  return `gw_${crypto.randomBytes(16).toString('base64url')}`;
}

function loadIdentity(): StoredIdentity {
  if (cached) return cached;
  const file = identityPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StoredIdentity>;
    if (parsed.version === 1 && typeof parsed.gatewayId === 'string' && /^gw_[A-Za-z0-9_-]{16,80}$/.test(parsed.gatewayId)) {
      cached = {
        version: 1,
        gatewayId: parsed.gatewayId,
        createdAt: Number(parsed.createdAt) || Date.now(),
      };
      return cached;
    }
  } catch {}

  const next: StoredIdentity = { version: 1, gatewayId: randomId(), createdAt: Date.now() };
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }
  cached = next;
  return cached;
}

function appVersion(): string {
  try {
    const packagePath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string };
    return String(pkg.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

export function getGatewayIdentity(): StoredIdentity {
  return { ...loadIdentity() };
}

export function getGatewayDescriptor(origin = ''): Record<string, unknown> {
  const cfg = getConfig().getConfig() as any;
  const workspacePath = String(cfg?.workspace?.path || getConfig().getWorkspacePath() || '').trim();
  return {
    gatewayId: loadIdentity().gatewayId,
    name: String(cfg?.gateway?.name || os.hostname() || 'Prometheus gateway').trim().slice(0, 120),
    hostname: String(os.hostname() || '').trim().slice(0, 120),
    platform: process.platform,
    architecture: process.arch,
    version: appVersion(),
    origin: String(origin || '').trim(),
    workspaceName: workspacePath ? path.basename(workspacePath) : '',
    protocol: PROTOCOL,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: [
      ...(MOBILE_GATEWAY_CATALOG_ENABLED ? ['catalog.read'] : []),
      'status.read',
      'pairing',
      'target-selection',
    ],
    // Explicitly advertise the first-slice boundary so a client cannot infer
    // that this catalog endpoint is permission to execute remote work.
    execution: { enabled: false, reason: 'first_slice_read_only' },
  };
}
