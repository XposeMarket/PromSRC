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

/** The three checks behind plugin setup. Injectable so regressions can drive the real guards over HTTP. */
export type PluginSetupGates = {
  storageAvailable: () => boolean;
  pairedDevice: (req: Pick<Request, 'headers'>) => boolean;
  ownerGate: (req: any, res: any, next: () => void) => void;
};
const defaultGates: PluginSetupGates = {
  storageAvailable: () => protectedPluginStorageAvailable(),
  pairedDevice: pairedPluginDevice,
  ownerGate: (req, res, next) => requireProtectedOwner(req, res, next),
};

export function pluginSetupSurfaceState(req: Pick<Request, 'headers'>) {
  const owner = ownerSurfaceState(req);
  const paired = pairedPluginDevice(req);
  return { canConfigure: owner.canApprove || paired, surface: paired ? 'paired_device' : owner.surface };
}
export function requirePluginSetup(req: any, res: any, next: () => void, gates: PluginSetupGates = defaultGates): void {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (!secureInputTransportAllowed(req)) { res.status(403).json({ success: false, error: 'SECURE_ORIGIN_REQUIRED' }); return; }
  if (!gates.storageAvailable()) { res.status(409).json({ success: false, error: 'PROTECTED_STORAGE_REQUIRED' }); return; }
  if (gates.pairedDevice(req)) { next(); return; }
  // Desktop retains exact-request native consent. General secure-access routes do not use this guard.
  gates.ownerGate(req, res, next);
}

/**
 * Disconnect is the reverse of plugin setup: anything a paired phone may connect, it must be able to
 * disconnect (no one-way doors). Disconnect clears that plugin's own local credential, which a paired
 * phone can already overwrite through setup, so it grants no new power over secrets.
 * The caller passes `pairedAllowed` only for teardown limited to plugin types a phone can set up
 * (PAIRED_PLUGIN_SETUP_ADAPTERS); model endpoints, local executables and destructive teardown such as
 * Obsidian index removal fall through to the owner gate. Secure transport and per-request pairing
 * revalidation always apply. No protected-storage check: it only removes access.
 */
export function requirePluginDisconnect(req: any, res: any, next: () => void, gates: PluginSetupGates = defaultGates, pairedAllowed = true): void {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (!secureInputTransportAllowed(req)) { res.status(403).json({ success: false, error: 'SECURE_ORIGIN_REQUIRED' }); return; }
  if (pairedAllowed && gates.pairedDevice(req)) { next(); return; }
  gates.ownerGate(req, res, next);
}

/**
 * Legacy typed-credential save (`/api/connections/credentials`). The body picks the connector id and
 * accepts keys, tokens and OAuth app fields, so a paired device may use it only to complete a pending
 * connection attempt: the handler then validates that attempt and limits the fields. Without an
 * attempt id the request needs owner proof, exactly like other protected changes.
 */
export function requireAttemptBoundPluginSetup(req: any, res: any, next: () => void, gates: PluginSetupGates = defaultGates): void {
  const attemptId = req?.body?.attemptId;
  if (typeof attemptId === 'string' && attemptId) requirePluginSetup(req, res, next, gates);
  else gates.ownerGate(req, res, next);
}

/**
 * Credential/sign-in flows only. Installing or launching local code still requires owner approval.
 * `openai-compatible-model` is deliberately absent: it writes a model provider base URL, and every
 * prompt sent to that provider goes to that endpoint.
 */
export const PAIRED_PLUGIN_SETUP_ADAPTERS = new Set(['api-key', 'setup-token', 'connector-oauth', 'mcp-oauth']);

export function requirePluginSetupAdapter(req: any, res: any, next: () => void, adapter?: string, gates: PluginSetupGates = defaultGates): void {
  if (adapter && PAIRED_PLUGIN_SETUP_ADAPTERS.has(adapter)) requirePluginSetup(req, res, next, gates);
  else gates.ownerGate(req, res, next);
}
