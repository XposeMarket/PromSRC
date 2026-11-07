/**
 * PR821 I1: Electron main reports when the native owner-approval window opens and
 * closes. While it is open, every desktop_* tool is refused (tool-deny-policy.ts).
 * Mounted before gateway auth because Electron main holds no gateway credential;
 * the body is HMAC-authenticated with the per-launch owner key and accepted only
 * from a direct loopback peer. Forged/replayed/stale reports are ignored.
 */
import { Router } from 'express';
import { isDirectLoopbackRequest } from '../gateway-auth';
import { applyConsentLock } from '../../security/secure-access-consent';

export const router = Router();
router.post('/api/owner-consent/lock', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isDirectLoopbackRequest(req as any) || req.headers.origin) { res.status(403).json({ ok: false }); return; }
  if (!applyConsentLock(req.body || {})) { res.status(403).json({ ok: false }); return; }
  res.json({ ok: true });
});
