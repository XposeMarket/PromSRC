import type { Request } from 'express';
import { verifyDeviceToken } from '../pairing/pairing-store';
import { protectedPluginStorageAvailable } from '../../security/plugin-credential-state';
import { ownerSurfaceState, requireProtectedOwner, secureInputTransportAllowed } from './secure-access.router';

/** Direct plugin configuration is not a grant of general owner/agent approval rights.
 * Pairing is already explicitly approved by the user; revalidate it on every request.
 * Never infer this permission from Origin, loopback, gateway auth, or a body field.
 */
function pairedPluginDevice(req: Pick<Request, 'headers'>): boolean {
  const token = req.headers['x-pairing-token'];
  if (typeof token !== 'string' || !token) return false;
  try { return !!verifyDeviceToken(token); } catch { return false; }
}
export function pluginSetupSurfaceState(req: Pick<Request, 'headers'>) {
  const owner = ownerSurfaceState(req);
  const paired = pairedPluginDevice(req);
  return { canConfigure: owner.canApprove || paired, surface: paired ? 'paired_device' : owner.surface };
}
export function requirePluginSetup(req: any, res: any, next: () => void): void {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (!secureInputTransportAllowed(req)) { res.status(403).json({ success: false, error: 'SECURE_ORIGIN_REQUIRED' }); return; }
  if (!protectedPluginStorageAvailable()) { res.status(409).json({ success: false, error: 'PROTECTED_STORAGE_REQUIRED' }); return; }
  if (pairedPluginDevice(req)) { next(); return; }
  // Desktop retains exact-request native consent. General secure-access routes do not use this guard.
  requireProtectedOwner(req, res, next);
}

/** Credential/sign-in flows only. Installing or launching local code still requires owner approval. */
export const PAIRED_PLUGIN_SETUP_ADAPTERS = new Set(['api-key', 'setup-token', 'connector-oauth', 'mcp-oauth', 'openai-compatible-model']);
