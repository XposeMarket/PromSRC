import type { CorsOptions } from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { getConfig } from '../config/config';

type GatewayRequestLike = {
  headers?: Record<string, any>;
  ip?: string;
  socket?: { remoteAddress?: string | null };
  connection?: { remoteAddress?: string | null };
  query?: Record<string, any>;
  url?: string;
};

function getHeaderValue(headers: GatewayRequestLike['headers'], key: string): string {
  if (!headers) return '';
  const value = headers[key];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

export function isLoopbackAddress(rawAddress: string | undefined | null): boolean {
  const address = String(rawAddress || '').trim().toLowerCase();
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address === 'localhost'
  );
}

export function getGatewayRequestIp(req: GatewayRequestLike): string {
  return String(
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    ''
  ).trim();
}

function getGatewayRequestOrigin(req: GatewayRequestLike): string {
  return getHeaderValue(req.headers, 'origin');
}

function getQueryToken(req: GatewayRequestLike): string {
  if (req.query && typeof req.query === 'object') {
    return String((req.query as any).token || '').trim();
  }
  try {
    const parsed = new URL(String(req.url || ''), 'http://127.0.0.1');
    return String(parsed.searchParams.get('token') || '').trim();
  } catch {
    return '';
  }
}

export function resolveGatewayAuthToken(): string {
  const cm = getConfig();
  const cfg = cm.getConfig() as any;
  const rawToken = String(cfg?.gateway?.auth?.token || cfg?.gateway?.auth_token || '').trim();
  if (!rawToken) return '';
  return String(cm.resolveSecret(rawToken) || rawToken).trim();
}

export function isGatewayAuthEnabled(): boolean {
  const cfg = getConfig().getConfig() as any;
  return cfg?.gateway?.auth?.enabled !== false;
}

export function isTrustedGatewayOrigin(origin: string | undefined | null): boolean {
  const normalizedOrigin = String(origin || '').trim();
  if (!normalizedOrigin) return true;
  try {
    const url = new URL(normalizedOrigin);
    const host = String(url.hostname || '').trim().toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

    const cfg = getConfig().getConfig() as any;
    const configuredHost = String(cfg?.gateway?.host || '').trim().toLowerCase();
    if (
      configuredHost &&
      configuredHost !== '0.0.0.0' &&
      configuredHost !== '::' &&
      host === configuredHost
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function extractGatewayToken(req: GatewayRequestLike, allowQueryToken = false): string {
  const authHeader = getHeaderValue(req.headers, 'authorization');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const xGatewayToken = getHeaderValue(req.headers, 'x-gateway-token');
  if (xGatewayToken) return xGatewayToken;

  if (allowQueryToken) return getQueryToken(req);
  return '';
}

export function evaluateGatewayRequest(
  req: GatewayRequestLike,
  opts?: { allowQueryToken?: boolean },
): { ok: true } | { ok: false; status: number; message: string } {
  if (!isGatewayAuthEnabled()) return { ok: true };

  const configuredToken = resolveGatewayAuthToken();
  if (configuredToken) {
    const providedToken = extractGatewayToken(req, opts?.allowQueryToken === true);
    if (providedToken && providedToken === configuredToken) return { ok: true };
    return { ok: false, status: 401, message: 'Unauthorized' };
  }

  const remoteIp = getGatewayRequestIp(req);
  if (!isLoopbackAddress(remoteIp)) {
    return {
      ok: false,
      status: 401,
      message: 'Unauthorized: configure gateway.auth.token to enable remote access.',
    };
  }

  const origin = getGatewayRequestOrigin(req);
  if (origin && !isTrustedGatewayOrigin(origin)) {
    return { ok: false, status: 403, message: 'Forbidden origin' };
  }

  return { ok: true };
}

export function requireGatewayAuth(req: Request, res: Response, next: NextFunction): void {
  const evaluation = evaluateGatewayRequest(req);
  if (!evaluation.ok) {
    res.status(evaluation.status).json({ error: evaluation.message });
    return;
  }
  next();
}

export function buildGatewayCorsOptions(): CorsOptions {
  return {
    origin(origin, callback) {
      callback(null, isTrustedGatewayOrigin(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Gateway-Token'],
    optionsSuccessStatus: 204,
  };
}
