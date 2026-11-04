import { Router, type Request } from 'express';
import { AccessError } from '../../security/secure-access';
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
export function createSecureAccessRouter(runtime: typeof defaultRuntime = defaultRuntime) {
const { getSecureAccess, secureAccessCredentials, secureAccessStatus, prepareProtectedLogin, submitProtectedLogin, cancelProtectedLogin } = runtime;
const router = Router();
const mutationTimes = new Map<string, number[]>();
router.use('/api/secure-access', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && !secureInputTransportAllowed(req)) { res.status(403).json({ error: 'SECURE_ORIGIN_REQUIRED' }); return; }
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
router.get('/api/secure-access/status', safe(() => secureAccessStatus()));
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
