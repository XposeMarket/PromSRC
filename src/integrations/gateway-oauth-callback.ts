// src/integrations/gateway-oauth-callback.ts
// Public-HTTPS OAuth redirect support for connectors whose provider rejects
// http://localhost redirect URIs (Instagram Business Login requires https).
//
// The redirect lands on GET /oauth/connector/callback/<id> on the gateway's
// public origin (gateway.remoteAccess.publicUrl, normally the Tailscale Funnel
// URL). That route is unauthenticated by design: the single-use OAuth `state`
// minted in OAuthConnector.startFlow is the authorization boundary, exactly
// like /mcp-oauth/callback. Only connectors with a pending flow are accepted.
import { getConfig } from '../config/config.js';
import type { OAuthCallbackResult } from './oauth-base.js';

export const GATEWAY_OAUTH_CALLBACK_PREFIX = '/oauth/connector/callback/';

type Handler = (code: string, state: string, error: string) => Promise<OAuthCallbackResult>;

interface PendingGatewayFlow {
  handler: Handler;
  expectedState?: string;
  inFlight?: boolean;
  serviceId: string;
  resolve: (result: OAuthCallbackResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingGatewayFlow>();
let originOverride: string | null | undefined;

/** Test hook. Pass undefined to restore config lookup. */
export function setGatewayPublicOriginOverride(origin: string | null | undefined): void {
  originOverride = origin;
}

/** https origin the gateway is publicly reachable on, or '' when none is configured. */
export function gatewayPublicOrigin(): string {
  if (originOverride !== undefined) return originOverride || '';
  try {
    const remote = (getConfig().getConfig() as any)?.gateway?.remoteAccess;
    if (!remote?.enabled) return '';
    const url = new URL(String(remote.publicUrl || '').trim());
    if (url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function awaitGatewayOAuthCallback(id: string, ttlMs: number, handler: Handler, options?: { serviceId: string; expectedState: string }): Promise<OAuthCallbackResult> {
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve({ success: false, error: 'Superseded by a newer authorization attempt.' });
    pending.delete(id);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.get(id)?.timer !== timer) return;
      pending.delete(id);
      resolve({ success: false, error: 'Timed out waiting for OAuth callback.' });
    }, ttlMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
    pending.set(id, { handler, resolve, timer, serviceId: options?.serviceId || id, expectedState: options?.expectedState });
  });
}

export function hasPendingGatewayOAuth(id: string): boolean {
  return pending.has(id) || [...pending.values()].some(flow => flow.serviceId === id);
}
export function cancelGatewayOAuthCallback(id: string): void {
  const flow = pending.get(id);
  if (!flow) return;
  pending.delete(id); clearTimeout(flow.timer);
  flow.resolve({ success: false, error: 'Authorization cancelled.' });
}

/**
 * Called by the public callback route. Returns null when no flow is pending
 * for this connector (the route answers 404 without touching any connector).
 */
export async function completeGatewayOAuthCallback(
  id: string,
  query: { code?: string; state?: string; error?: string; error_description?: string },
): Promise<OAuthCallbackResult | null> {
  const stateValue = String(query.state || '');
  const candidates = [...pending.entries()].filter(([, flow]) => flow.serviceId === id && flow.expectedState === stateValue);
  const match = candidates.length === 1 ? candidates[0] : undefined;
  const key = match?.[0] || id;
  const flow = match?.[1] || pending.get(id);
  if (!flow) return null;
  if (flow.expectedState !== undefined && flow.expectedState !== stateValue) return { success: false, error: 'OAuth state mismatch.' };
  const code = String(query.code || '').replace(/#_$/, '');
  const state = String(query.state || '');
  const error = String(query.error_description || query.error || '');
  if (flow.inFlight) return { success: false, error: 'OAuth callback already processing.' };
  flow.inFlight = true;
  let result: OAuthCallbackResult;
  try {
    result = await flow.handler(code, state, error);
  } catch (err: any) {
    result = { success: false, error: err?.message || String(err) };
  }
  // A forged request with the wrong state must not consume the real flow.
  if (!result.success && /state mismatch/i.test(result.error || '')) { flow.inFlight = false; return result; }
  clearTimeout(flow.timer);
  if (pending.get(key) === flow) pending.delete(key);
  flow.resolve(result);
  return result;
}
