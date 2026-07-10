import crypto from 'crypto';
import type { CorsOptions } from 'cors';
import type { NextFunction, Request, Response } from 'express';
import type { PrometheusConfig } from '../types';
import { getConfig } from '../config/config';
import { evaluateCreativeRenderGrant } from './security/scoped-render-auth';

/** Typed accessor for the gateway config block — avoids untyped `as any` reads. */
function getGatewayConfig(): PrometheusConfig['gateway'] {
  return getConfig().getConfig().gateway;
}

/** Constant-time string comparison to avoid leaking token contents via timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

type GatewayRequestLike = {
  method?: string;
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
  const gateway = cm.getConfig().gateway;
  const rawToken = String(gateway?.auth?.token || gateway?.auth_token || '').trim();
  if (!rawToken) return '';
  return String(cm.resolveSecret(rawToken) || rawToken).trim();
}

export function isGatewayAuthEnabled(): boolean {
  return getGatewayConfig()?.auth?.enabled !== false;
}

export function isTrustedGatewayOrigin(origin: string | undefined | null): boolean {
  const normalizedOrigin = String(origin || '').trim();
  if (!normalizedOrigin) return true;
  if (normalizedOrigin === 'null' || normalizedOrigin.toLowerCase().startsWith('file://')) return true;
  try {
    const url = new URL(normalizedOrigin);
    const host = String(url.hostname || '').trim().toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

    const configuredHost = String(getGatewayConfig()?.host || '').trim().toLowerCase();
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

function isPublicAccountAuthRoute(req: GatewayRequestLike): boolean {
  const method = String((req as any).method || '').trim().toUpperCase();
  let pathname = '';
  try {
    const host = getHeaderValue(req.headers, 'host') || 'localhost';
    pathname = new URL(String(req.url || ''), `http://${host}`).pathname;
  } catch {
    pathname = String(req.url || '').split('?', 1)[0];
  }
  if (method === 'GET') {
    return pathname === '/api/account/config' || pathname === '/api/account/status';
  }
  if (method === 'POST') {
    return pathname === '/api/account/login' || pathname === '/api/account/login/password';
  }
  return false;
}

export function evaluateGatewayRequest(
  req: GatewayRequestLike,
  opts?: { allowQueryToken?: boolean },
): { ok: true } | { ok: false; status: number; message: string } {
  if (!isGatewayAuthEnabled()) return { ok: true };
  if (isPublicAccountAuthRoute(req)) return { ok: true };

  const renderGrant = evaluateCreativeRenderGrant(req);
  if (renderGrant.present) {
    return renderGrant.ok
      ? { ok: true }
      : { ok: false, status: 401, message: 'Unauthorized: render credential is invalid, expired, or outside its job scope.' };
  }

  // A paired mobile device counts as authenticated — its token is opaque,
  // single-tenant, and revocable from the desktop pairing panel. Verified
  // BEFORE the configured gateway token so paired devices work over LAN
  // regardless of whether gateway.auth.token is set.
  const pairingHeader = getHeaderValue(req.headers, 'x-pairing-token');
  const pairingQuery  = (() => {
    if (opts?.allowQueryToken === false) return '';
    try {
      const url = (req as any).url || '';
      const host = getHeaderValue(req.headers, 'host') || 'localhost';
      const parsed = new URL(url, `http://${host}`);
      return String(parsed.searchParams.get('pt') || '').trim();
    } catch { return ''; }
  })();
  const pairingToken = pairingHeader || pairingQuery;
  if (pairingToken) {
    try {
      // Lazy require to avoid a circular import (pairing-store → config).
      const { verifyDeviceToken } = require('./pairing/pairing-store');
      const device = verifyDeviceToken(pairingToken);
      if (device) return { ok: true };
      return { ok: false, status: 401, message: 'Unauthorized: paired device token invalid or revoked.' };
    } catch (err) {
      // Fall through to other auth methods if the pairing store isn't loaded.
    }
  }

  const configuredToken = resolveGatewayAuthToken();
  if (configuredToken) {
    const providedToken = extractGatewayToken(req, opts?.allowQueryToken === true);
    if (providedToken && safeEqual(providedToken, configuredToken)) return { ok: true };
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Gateway-Token', 'X-Pairing-Token', 'X-Prometheus-Render-Token'],
    optionsSuccessStatus: 204,
  };
}
