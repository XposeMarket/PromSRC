import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { getConfig } from '../../config/config';
import {
  getGatewayRequestIp,
  isLoopbackAddress,
  resolveGatewayAuthToken,
} from '../gateway-auth';

type PairingAdminRequestLike = {
  headers?: Record<string, any>;
  ip?: string;
  socket?: { remoteAddress?: string | null };
  connection?: { remoteAddress?: string | null };
};

export type PairingAdminPolicy = {
  desktopToken: string;
  gatewayToken: string;
  electronManaged: boolean;
  gatewayHost: string;
  gatewayPort: number;
  httpsEnabled: boolean;
  httpsPort: number;
};

export type PairingAdminEvaluation =
  | { ok: true; authority: 'electron' | 'gateway-token' | 'local-standalone' }
  | { ok: false; status: 403; message: string };

function headerValue(headers: PairingAdminRequestLike['headers'], key: string): string {
  if (!headers) return '';
  const wanted = key.toLowerCase();
  const entry = Object.entries(headers).find(([name]) => String(name).toLowerCase() === wanted);
  const value = entry?.[1];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function gatewayCredential(req: PairingAdminRequestLike): string {
  const authorization = headerValue(req.headers, 'authorization');
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return headerValue(req.headers, 'x-gateway-token');
}

function isLoopbackHost(host: string): boolean {
  return isLoopbackAddress(String(host || '').trim().replace(/^\[/, '').replace(/\]$/, ''));
}

function isExactStandaloneOrigin(origin: string, policy: PairingAdminPolicy): boolean {
  if (!origin || origin === 'null' || origin.toLowerCase().startsWith('file:')) return false;
  try {
    const parsed = new URL(origin);
    if (!isLoopbackHost(parsed.hostname)) return false;
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    if (parsed.protocol === 'http:') return port === policy.gatewayPort;
    if (parsed.protocol === 'https:') return policy.httpsEnabled && port === policy.httpsPort;
    return false;
  } catch {
    return false;
  }
}

export function evaluatePairingAdminRequestWithPolicy(
  req: PairingAdminRequestLike,
  policy: PairingAdminPolicy,
): PairingAdminEvaluation {
  const suppliedDesktopToken = headerValue(req.headers, 'x-prometheus-pairing-admin');
  if (policy.desktopToken && safeEqual(suppliedDesktopToken, policy.desktopToken)) {
    return { ok: true, authority: 'electron' };
  }

  const suppliedGatewayToken = gatewayCredential(req);
  if (policy.gatewayToken && safeEqual(suppliedGatewayToken, policy.gatewayToken)) {
    return { ok: true, authority: 'gateway-token' };
  }

  // A configured credential must never fall through to ambient loopback trust.
  if (policy.desktopToken || policy.gatewayToken || policy.electronManaged) {
    return { ok: false, status: 403, message: 'Trusted desktop pairing authority required.' };
  }

  // Standalone development remains usable only when the gateway itself is
  // loopback-bound and the request is either a non-browser local client or an
  // exact same-origin browser request. Origin:null and alternate localhost
  // ports are deliberately rejected.
  if (!isLoopbackHost(policy.gatewayHost) || !isLoopbackAddress(getGatewayRequestIp(req))) {
    return { ok: false, status: 403, message: 'Trusted desktop pairing authority required.' };
  }

  const fetchSite = headerValue(req.headers, 'sec-fetch-site').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return { ok: false, status: 403, message: 'Trusted desktop pairing authority required.' };
  }

  const origin = headerValue(req.headers, 'origin');
  if (origin && !isExactStandaloneOrigin(origin, policy)) {
    return { ok: false, status: 403, message: 'Trusted desktop pairing authority required.' };
  }

  return { ok: true, authority: 'local-standalone' };
}

export function getPairingAdminPolicy(): PairingAdminPolicy {
  const gateway = (getConfig().getConfig() as any)?.gateway || {};
  const https = gateway.https || {};
  return {
    desktopToken: String(process.env.PROMETHEUS_PAIRING_ADMIN_TOKEN || '').trim(),
    gatewayToken: resolveGatewayAuthToken(),
    electronManaged: String(process.env.PROMETHEUS_ELECTRON_MANAGED || '').trim() === '1',
    gatewayHost: String(gateway.host || '127.0.0.1').trim(),
    gatewayPort: Number(gateway.port || process.env.GATEWAY_PORT || 18789),
    httpsEnabled: !!https.enabled,
    httpsPort: Number(https.port || 0),
  };
}

export function evaluatePairingAdminRequest(req: PairingAdminRequestLike): PairingAdminEvaluation {
  return evaluatePairingAdminRequestWithPolicy(req, getPairingAdminPolicy());
}

export function requirePairingAdmin(req: Request, res: Response, next: NextFunction): void {
  const evaluation = evaluatePairingAdminRequest(req);
  if (!evaluation.ok) {
    res.status(evaluation.status).json({ success: false, error: evaluation.message });
    return;
  }
  next();
}
