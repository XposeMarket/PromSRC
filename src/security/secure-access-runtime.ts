import { getConfig } from '../config/config';
import { getVault } from './vault';
import { getInjectedMasterKey } from './vault-key-bootstrap';
import { SecureAccessBroker, AccessError } from './secure-access';
import { callInHouseBrowser, isInHouseBrowserAvailable } from '../gateway/browser/inhouse';

let broker: SecureAccessBroker | undefined;
const pending = new Map<string, { sessionId: string; origin: string; expiresAt: number }>();
function prunePending() { for (const [id, item] of pending) if (item.expiresAt <= Date.now()) pending.delete(id); }
export function getSecureAccess(): SecureAccessBroker {
  if (!broker) {
    const directory = getConfig().getConfigDir();
    broker = new SecureAccessBroker({ directory,
      persistentAllowed: () => process.env.PROMETHEUS_VAULT_OS_PROTECTED === '1' && Boolean(getInjectedMasterKey()),
      store: { set: (k, v) => getVault(directory).set(k, v, 'secure-access'), get: k => getVault(directory).get(k, 'secure-access')?.expose(), delete: k => getVault(directory).delete(k, 'secure-access') } });
  }
  return broker;
}
export async function secureAccessStatus() {
  let browserSupported = false;
  if (isInHouseBrowserAvailable()) try { browserSupported = (await callInHouseBrowser('protected-status')).supported === true; } catch {}
  return { ...getSecureAccess().status(), browserSupported, message: 'Passwords stay out of supported model flows. Same-OS-user processes are not isolated. Sign-in is not permission to post, send, or spend.' };
}
export function secureAccessCredentials() { prunePending(); return getSecureAccess().list().map(c => ({ ...c, pendingLogin: pending.has(c.id), loginOrigin: pending.get(c.id)?.origin, loginSessionId: pending.get(c.id)?.sessionId, loginExpiresAt: pending.has(c.id) ? new Date(pending.get(c.id)!.expiresAt).toISOString() : undefined, loginPreparedAt: pending.get(c.id)?.expiresAt })); }
export async function prepareProtectedLogin(id: string, url: string, sessionId: string, actor: string) {
  const status = await secureAccessStatus();
  if (!status.browserSupported) throw new AccessError('PROTECTED_BROWSER_UNAVAILABLE_USE_TAKEOVER');
  prunePending();
  if (pending.has(id)) throw new AccessError('LOGIN_ALREADY_PREPARED');
  let origin: string;
  try { const target = new URL(url); if (target.username || target.password || target.hash) throw 0; origin = target.origin; } catch { throw new AccessError('INVALID_LOGIN_URL'); }
  const result = await getSecureAccess().use(id, actor, origin, async (secret, credential, check) => {
    if (credential.kind !== 'login') throw new AccessError('LOGIN_REQUIRED');
    check();
    try { await callInHouseBrowser('protected-prepare', { credentialId: id, origin, url, identifier: credential.identifier, secret, sessionId }); }
    catch { await callInHouseBrowser('protected-cancel', { credentialId: id }).catch(() => undefined); throw new AccessError('PREPARE_FAILED'); }
    try { check(); } catch { await callInHouseBrowser('protected-cancel', { credentialId: id }); throw new AccessError('USE_DENIED'); }
  });
  pending.set(id, { sessionId, origin, expiresAt: Date.now() + 120_000 });
  return { ...result, phase: 'ready', origin, filled: ['identifier', 'password'], next: 'Owner must approve sign-in in Saved access. No form was submitted.' };
}
export async function submitProtectedLogin(id: string) {
  prunePending();
  if (!pending.has(id)) throw new AccessError('LOGIN_NOT_PREPARED');
  const credential = getSecureAccess().list().find(c => c.id === id);
  if (!credential || !credential.grants.includes('main')) { await cancelProtectedLogin(id); throw new AccessError('USE_DENIED'); }
  // Durable uncertainty before any network dispatch. No automatic retry on errors.
  getSecureAccess().markDispatched(id); pending.delete(id);
  try { return await callInHouseBrowser('protected-submit', { credentialId: id }); }
  catch { return { phase: 'submitted_outcome_unknown', transferred: false }; }
}
export async function cancelProtectedLogin(id: string) {
  pending.delete(id);
  if (isInHouseBrowserAvailable()) await callInHouseBrowser('protected-cancel', { credentialId: id }).catch(() => undefined);
}
