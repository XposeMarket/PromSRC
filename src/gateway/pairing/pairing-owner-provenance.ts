/**
 * Paired-device owner provenance (PR821 I2 / review "history-sensitive" case).
 *
 * A paired device may approve protected access only when the owner explicitly
 * allowed it through the native desktop approval window (single-use consent
 * header minted by Electron main). The grant is stored in the vault's reserved
 * `secure.access.*` namespace, which generic config/MCP/model callers cannot
 * read or write (vault.ts reserved-key guard), and is bound to the device id and
 * the device token hash at grant time. Consequences:
 *  - devices minted through any other authority (gateway token, standalone
 *    loopback admin, older builds) carry no provenance and fail closed, even if
 *    configuration later changes;
 *  - a token rotation, disable or removal invalidates the grant;
 *  - "Stop owner approvals" (or removing the device) is the reverse path.
 */
import { getConfig } from '../../config/config';
import { getVault } from '../../security/vault';
import { listPairedDevices, verifyDeviceToken } from './pairing-store';

const PREFIX = 'secure.access.device-owner.';
const CALLER = 'secure-access';
type Store = { get(key: string): string | null; set(key: string, value: string): void; delete(key: string): void };
function defaultStore(): Store {
  const dir = getConfig().getConfigDir();
  return {
    get: key => getVault(dir).get(key, CALLER)?.expose() ?? null,
    set: (key, value) => getVault(dir).set(key, value, CALLER),
    delete: key => getVault(dir).delete(key, CALLER),
  };
}
type Devices = { list: () => Array<{ id: string; enabled: boolean; tokenHash: string }>; verify: (token: string) => { id: string; enabled: boolean } | null };
const defaultDevices: Devices = { list: () => listPairedDevices(), verify: token => verifyDeviceToken(token) as any };
let storeFactory: () => Store = defaultStore;
let devices: Devices = defaultDevices;
/** Test seams only. */
export function setProvenanceStoreForTests(factory: (() => Store) | null, devs: Devices | null = null): void { storeFactory = factory || defaultStore; devices = devs || defaultDevices; }

function keyFor(deviceId: string): string { return PREFIX + String(deviceId).replace(/[^a-zA-Z0-9_-]/g, ''); }

export function grantDeviceOwnerProvenance(deviceId: string, consentedAt = Date.now()): boolean {
  const device = devices.list().find(d => d.id === deviceId);
  if (!device || !device.enabled || !device.tokenHash) return false;
  storeFactory().set(keyFor(device.id), JSON.stringify({ v: 1, deviceId: device.id, tokenHash: device.tokenHash, consentedAt }));
  return true;
}
export function revokeDeviceOwnerProvenance(deviceId: string): void {
  try { storeFactory().delete(keyFor(deviceId)); } catch { /* absent */ }
}
export function deviceOwnerProvenance(deviceId: string): { consentedAt: number } | null {
  const device = devices.list().find(d => d.id === deviceId);
  if (!device) return null;
  try {
    const raw = storeFactory().get(keyFor(device.id));
    const rec = raw ? JSON.parse(raw) : null;
    if (!rec || rec.v !== 1 || rec.deviceId !== device.id || rec.tokenHash !== device.tokenHash) return null;
    return { consentedAt: Number(rec.consentedAt) || 0 };
  } catch { return null; }
}
/** Valid, enabled device token with native-consent owner provenance. */
export function deviceHasOwnerProvenance(token: string): boolean {
  const device = devices.verify(token);
  return !!device && device.enabled && !!deviceOwnerProvenance(device.id);
}
