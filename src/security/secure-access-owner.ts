/**
 * Owner-boundary secrets for the gateway process (PR821 F3).
 *
 * Electron hands three per-launch secrets to the gateway through env:
 *   - PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN  (owner cookie value, held only by the
 *     owner window's Electron session as an HttpOnly cookie)
 *   - PROMETHEUS_PAIRING_ADMIN_TOKEN        (desktop pairing-admin authority)
 *   - PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN (in-house browser RPC bearer)
 * Tool/terminal/MCP children are spawned with a copy of process.env, so these
 * must be captured into module memory and deleted from process.env before any
 * child is spawned. `captureGatewayOwnerSecrets()` runs as the first import of
 * server-v2 (see secure-access-owner-boot.ts).
 *
 * Out of scope (per SPEC): same-user tools that read another process's memory or
 * environment block, or decrypt the Chromium cookie store.
 */
const OWNER_ENV = 'PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN';
const PAIRING_ENV = 'PROMETHEUS_PAIRING_ADMIN_TOKEN';
const RPC_ENV = 'PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN';
export const SECURE_ACCESS_OWNER_COOKIE = 'prom_sa_owner';
/** Shared via globalThis so lazy readers (pairing-admin-auth, chrome) need no import. */
export const CAPTURED_GATEWAY_SECRETS_KEY = Symbol.for('prometheus.capturedGatewaySecrets');

export type CapturedGatewaySecrets = { owner: string; pairingAdmin: string; browserRpc: string };

export function capturedGatewaySecrets(): CapturedGatewaySecrets | null {
  return ((globalThis as any)[CAPTURED_GATEWAY_SECRETS_KEY] as CapturedGatewaySecrets | undefined) || null;
}

export function captureGatewayOwnerSecrets(env: NodeJS.ProcessEnv = process.env): CapturedGatewaySecrets {
  const owner = String(env[OWNER_ENV] || '').trim();
  const captured: CapturedGatewaySecrets = {
    owner: /^[a-f0-9]{64}$/.test(owner) ? owner : '',
    pairingAdmin: String(env[PAIRING_ENV] || '').trim(),
    browserRpc: String(env[RPC_ENV] || '').trim(),
  };
  delete env[OWNER_ENV];
  delete env[PAIRING_ENV];
  delete env[RPC_ENV];
  (globalThis as any)[CAPTURED_GATEWAY_SECRETS_KEY] = Object.freeze(captured);
  return captured;
}

export function secureAccessOwnerToken(): string {
  return capturedGatewaySecrets()?.owner || '';
}

/** Re-pass captured secrets only to a replacement *gateway* process, never to tool children. */
export function gatewayRespawnSecrets(): Record<string, string> {
  const c = capturedGatewaySecrets();
  if (!c) return {};
  const out: Record<string, string> = {};
  if (c.owner) out[OWNER_ENV] = c.owner;
  if (c.pairingAdmin) out[PAIRING_ENV] = c.pairingAdmin;
  if (c.browserRpc) out[RPC_ENV] = c.browserRpc;
  return out;
}

/**
 * A paired-device token is accepted as owner proof only when device minting is
 * not reachable by ordinary model tools:
 *  - Electron-managed gateway (pairing admin never falls back to loopback trust,
 *    pairing-admin-auth.ts electronManaged branch),
 *  - the desktop pairing-admin token was captured from env (not inheritable), and
 *  - no gateway.auth.token is configured (that value lives in config.json or an
 *    env/vault reference a model tool could read and use as pairing-admin authority).
 * Standalone CLI installs persist the pairing-admin token in a plaintext file and
 * allow loopback pairing admin, so paired devices fail closed there.
 */
export function pairedDeviceOwnerProofTrusted(): boolean {
  if (String(process.env.PROMETHEUS_ELECTRON_MANAGED || '').trim() !== '1') return false;
  const c = capturedGatewaySecrets();
  if (!c || !c.pairingAdmin || !c.owner) return false;
  try {
    return require('../gateway/gateway-auth').resolveGatewayAuthToken() === '';
  } catch {
    return false;
  }
}
