import crypto from 'crypto';
import { Router, type Request } from 'express';
import { SECURE_ACCESS_OWNER_COOKIE, secureAccessOwnerToken, pairedDeviceOwnerProofTrusted } from '../../security/secure-access-owner';
import { OWNER_CONSENT_HEADER, verifyConsent } from '../../security/secure-access-consent';
import { AccessError } from '../../security/secure-access';
import { protectedPluginStorageAvailable } from '../../security/plugin-credential-state';
import { getSecureAccess, secureAccessCredentials, secureAccessStatus, prepareProtectedLogin, submitProtectedLogin, cancelProtectedLogin } from '../../security/secure-access-runtime';
const defaultRuntime = { getSecureAccess, secureAccessCredentials, secureAccessStatus, prepareProtectedLogin, submitProtectedLogin, cancelProtectedLogin };
/** Gateway authentication/account access are mounted by server-v2. No secret bodies logged here. */
export function secureInputTransportAllowed(req: Pick<Request, 'headers' | 'socket' | 'is'>): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !req.is('application/json')) return false;
  try {
    const url = new URL(origin);
    if (url.host !== req.headers.host || url.username || url.password || url.origin !== origin) return false;
    const peer = req.socket.remoteAddress;
    const directLocal = (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1') && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
    return url.protocol === 'https:' || (directLocal && url.protocol === 'http:');
  } catch { return false; }
}
/**
 * Owner proof (F3) + per-action human consent (I1). Origin, loopback and gateway
 * auth are NOT owner proof: a model terminal curl satisfies all three.
 *  - Owner-proof routes accept the Electron owner window's HttpOnly `prom_sa_owner`
 *    cookie, or a paired-device token whose owner provenance was recorded through
 *    native desktop consent (see pairing-owner-provenance.ts).
 *  - Consent routes (secret entry, regrant, replace, delete, sign-in approval)
 *    additionally need, from the desktop window, a single-use X-Prom-Owner-Consent
 *    header that only Electron main mints after the human completes the native,
 *    capture-protected approval window. The cookie authenticates a window; the
 *    header proves a human approved this exact request (method, path, body hash).
 *    A paired phone with provenance is accepted on its own: desktop automation
 *    tools cannot operate a separate physical device.
 */
export type OwnerProof = {
  ownerToken: () => string;
  /** Paired-device owner proof is possible on this install (Electron-managed, consent key present). */
  deviceTrusted: () => boolean;
  /** Token is valid, enabled AND carries native-consent owner provenance. */
  verifyDevice: (token: string) => boolean;
  /** Consumes a single-use consent header bound to this exact request. */
  verifyConsent?: (req: any) => boolean;
};
const defaultOwnerProof: OwnerProof = {
  ownerToken: secureAccessOwnerToken,
  deviceTrusted: pairedDeviceOwnerProofTrusted,
  verifyDevice: token => { try { return require('../pairing/pairing-owner-provenance').deviceHasOwnerProvenance(token); } catch { return false; } },
  verifyConsent: req => verifyConsent(req.headers[OWNER_CONSENT_HEADER], req.method, String(req.originalUrl || '').split('?')[0], req.rawBody).ok,
};
function readCookie(header: unknown, name: string): string {
  for (const part of String(Array.isArray(header) ? header.join(';') : header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
export function ownerCookieOk(req: Pick<Request, 'headers'>, proof: OwnerProof): boolean {
  const want = Buffer.from(proof.ownerToken() || '');
  const got = Buffer.from(readCookie(req.headers.cookie, SECURE_ACCESS_OWNER_COOKIE));
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}
export function ownerDeviceOk(req: Pick<Request, 'headers'>, proof: OwnerProof): boolean {
  const device = req.headers['x-pairing-token'];
  return typeof device === 'string' && device.length > 0 && proof.deviceTrusted() && proof.verifyDevice(device);
}
export function ownerProofOk(req: Pick<Request, 'headers'>, proof: OwnerProof): boolean {
  return ownerCookieOk(req, proof) || ownerDeviceOk(req, proof);
}
/** Safe-direction actions only (abort, revoke): never need proof, so every surface has a visible reverse path. */
const OWNER_EXEMPT = /^\/api\/secure-access\/(requests\/[^/]+\/cancel|credentials\/[^/]+\/login\/cancel|credentials\/[^/]+\/revoke)\/?$/;
/** Human-consent actions: secret entry, regrant, replace, delete, sign-in approval. */
const CONSENT_REQUIRED = /^\/api\/secure-access\/(requests\/[^/]+\/submit|credentials\/[^/]+\/(grants|replace|delete|login\/submit))\/?$/;
export function ownerSurfaceState(req: Pick<Request, 'headers'>, proof: OwnerProof = defaultOwnerProof) {
  const desktop = ownerCookieOk(req, proof);
  const device = !desktop && ownerDeviceOk(req, proof);
  return {
    canApprove: desktop || device,
    surface: desktop ? 'desktop' : device ? 'paired_device' : 'none',
    message: desktop || device ? '' : 'Saving or changing protected access only works in the Prometheus desktop app or on a phone paired from it. You can still revoke access here.',
  };
}

/** Reused by typed plugin input. Gateway auth/Origin alone never authorizes secret entry. */
export function requireProtectedOwner(req: any, res: any, next: () => void, proof: OwnerProof = defaultOwnerProof, storageAvailable: () => boolean = protectedPluginStorageAvailable): void {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (!secureInputTransportAllowed(req)) { res.status(403).json({ success: false, error: 'SECURE_ORIGIN_REQUIRED' }); return; }
  if (!storageAvailable() && !String(req.path).endsWith('/delete')) { res.status(409).json({ success: false, error: 'PROTECTED_STORAGE_REQUIRED' }); return; }
  if (ownerDeviceOk(req, proof)) { next(); return; }
  if (!ownerCookieOk(req, proof)) { res.status(403).json({ success: false, error: 'OWNER_SURFACE_REQUIRED' }); return; }
  if (!proof.verifyConsent?.(req)) { res.status(403).json({ success: false, error: 'OWNER_CONSENT_REQUIRED' }); return; }
  next();
}

export function createSecureAccessRouter(runtime: typeof defaultRuntime = defaultRuntime, proof: OwnerProof = defaultOwnerProof) {
const { getSecureAccess, secureAccessCredentials, secureAccessStatus, prepareProtectedLogin, submitProtectedLogin, cancelProtectedLogin } = runtime;
const router = Router();
const mutationTimes = new Map<string, number[]>();
router.use('/api/secure-access', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  const routePath = String(req.originalUrl || '').split('?')[0];
  if (req.method !== 'GET' && !secureInputTransportAllowed(req)) { res.status(403).json({ error: 'SECURE_ORIGIN_REQUIRED' }); return; }
  if (req.method !== 'GET' && !OWNER_EXEMPT.test(routePath)) {
    const device = ownerDeviceOk(req, proof);
    const cookie = !device && ownerCookieOk(req, proof);
    if (!device && !cookie) { res.status(403).json({ error: 'OWNER_SURFACE_REQUIRED', message: 'Approve this in the Prometheus desktop app or on a phone paired with it.' }); return; }
    if (cookie && CONSENT_REQUIRED.test(routePath) && !(proof.verifyConsent ? proof.verifyConsent(req) : false)) {
      res.status(403).json({ error: 'OWNER_CONSENT_REQUIRED', message: 'Confirm this in the Prometheus owner approval window.' }); return;
    }
  }
  if (req.method !== 'GET') {
    const key = req.socket.remoteAddress || 'unknown'; const now = Date.now();
    for (const [peer, times] of mutationTimes) if (!times.some(at => at > now - 60_000)) mutationTimes.delete(peer);
    const times = (mutationTimes.get(key) || []).filter(at => at > now - 60_000);
    if (times.length >= 60) { res.status(429).json({ error: 'RATE_LIMITED' }); return; }
    times.push(now); mutationTimes.set(key, times);
  }
  next();
});
const safe = (fn: (req: any) => any) => async (req: any, res: any) => {
  try { res.json(await fn(req)); } catch (error) { res.status(error instanceof AccessError ? 400 : 503).json({ error: error instanceof AccessError ? error.code : 'SECURE_ACCESS_UNAVAILABLE' }); }
};
// `owner` tells each surface whether it can approve here; surfaces without proof render a fail-closed state.
router.get('/api/secure-access/status', safe(async req => ({ ...(await secureAccessStatus()), owner: ownerSurfaceState(req, proof) })));

router.get('/api/secure-access/requests', safe(req => ({ requests: getSecureAccess().listRequests(typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined) })));
router.get('/api/secure-access/credentials', safe(() => ({ credentials: secureAccessCredentials() })));
router.post('/api/secure-access/requests', safe(req => ({ request: getSecureAccess().create({ sessionId: req.body.sessionId, label: req.body.label, purpose: req.body.purpose, origin: req.body.origin, mode: req.body.mode, identifier: req.body.identifier }) })));
router.post('/api/secure-access/requests/:id/submit', safe(req => ({ credential: getSecureAccess().submit(req.params.id, { identifier: req.body.identifier, secret: req.body.secret, remember: req.body.remember === true, generated: req.body.generated === true, recoveryConfirmed: req.body.recoveryConfirmed === true }) })));
router.post('/api/secure-access/requests/:id/cancel', safe(req => { getSecureAccess().cancel(req.params.id); return { ok: true }; }));
router.post('/api/secure-access/credentials/:id/revoke', safe(async req => { const credential = getSecureAccess().revoke(req.params.id); await cancelProtectedLogin(req.params.id); return { credential }; }));
router.post('/api/secure-access/credentials/:id/grants', safe(req => ({ credential: getSecureAccess().grants(req.params.id, req.body.grants) })));
router.post('/api/secure-access/credentials/:id/delete', safe(async req => { if (req.body.confirm !== true) throw new AccessError('DELETE_CONFIRMATION_REQUIRED'); await cancelProtectedLogin(req.params.id); getSecureAccess().delete(req.params.id, true); return { ok: true }; }));
router.post('/api/secure-access/credentials/:id/replace', safe(req => ({ request: getSecureAccess().replace(req.params.id, req.body.sessionId) })));
router.get('/api/secure-access/credentials/:id/audit', safe(req => ({ events: getSecureAccess().events(req.params.id) })));
router.post('/api/secure-access/credentials/:id/login/prepare', safe(req => prepareProtectedLogin(req.params.id, String(req.body.url || ''), String(req.body.sessionId || 'main'), 'main')));
router.post('/api/secure-access/credentials/:id/login/submit', safe(req => { if (req.body.confirm !== true) throw new AccessError('SIGNIN_APPROVAL_REQUIRED'); return submitProtectedLogin(req.params.id); }));
router.post('/api/secure-access/credentials/:id/login/cancel', safe(async req => { await cancelProtectedLogin(req.params.id); return { ok: true }; }));
router.post('/api/secure-access/credentials/:id/outcome', safe(req => { if (typeof req.body.verified !== 'boolean') throw new AccessError('CONFIRMATION_REQUIRED'); return { credential: getSecureAccess().confirmOutcome(req.params.id, req.body.verified) }; }));
return router;
}
export const router = createSecureAccessRouter();
