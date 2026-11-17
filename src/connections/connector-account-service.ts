// Account management for multi-account plugins (see connector-accounts.ts for storage rules).
import { getConfig } from '../config/config';
import { getVault } from '../security/vault';
import { getConnector } from '../integrations/connector-registry';
import { cancelXApiOAuthFlow, getXApiOAuthStatus } from '../auth/x-api-oauth';
import {
  armAddAccount, addAccountArmed, disarmAddAccount, isAccountSlug, lastAddedAccount, listConnectorAccounts,
  planReplacementSlug, removeAccountRecord, replaceAccountRecord, slotSuffix, type ConnectorAccount, type ConnectorAccountKind,
} from './connector-accounts';
import { deleteAccountPluginCredential, hasBoundPluginCredential, moveAccountPluginCredential, swapAccountPluginCredential } from './plugin-credential-binding';
import { invalidateConnectionToolSurfaceCache } from './tool-surface';

const dir = () => getConfig().getConfigDir();
const X_TOKENS = 'x.api.oauth_tokens';
const X_LEGACY = 'social_x_token';

export function accountKindFor(id: string): ConnectorAccountKind {
  if (id === 'x') return 'x';
  return getConnector(id) ? 'oauth' : 'credential';
}

function oauthKey(id: string, slug: string) { return `integration.${id}.oauth_tokens${slotSuffix(slug)}`; }

export function defaultAccountSummary(id: string): { label: string; email?: string; username?: string; connected: boolean } {
  const kind = accountKindFor(id);
  if (kind === 'x') {
    const s = getXApiOAuthStatus(dir());
    return { label: s.username ? `@${s.username}` : 'Primary account', username: s.username, connected: !!s.connected };
  }
  if (kind === 'oauth') {
    const identity = getConnector(id)!.defaultAccountIdentity();
    return { label: identity?.email || identity?.accountId || 'Primary account', email: identity?.email, connected: !!identity };
  }
  return { label: 'Primary credential', connected: hasBoundPluginCredential(dir(), id) };
}

export interface ConnectorAccountsView {
  connectorId: string; kind: ConnectorAccountKind;
  default: ReturnType<typeof defaultAccountSummary>;
  accounts: ConnectorAccount[];
  adding: boolean; lastAdded?: { slug: string; label: string; at: number };
}

export function getConnectorAccountsView(id: string): ConnectorAccountsView {
  return {
    connectorId: id, kind: accountKindFor(id), default: defaultAccountSummary(id),
    accounts: listConnectorAccounts(dir(), id), adding: !!addAccountArmed(dir(), id), lastAdded: lastAddedAccount(dir(), id),
  };
}

export function beginAddAccount(id: string, opts: { label?: unknown; hint?: unknown } = {}): ConnectorAccountsView {
  if (!/^[a-z0-9_.-]{1,64}$/i.test(id)) throw new Error('INVALID_CONNECTOR');
  // A sign-in already in flight must never be retargeted into the new account slot.
  cancelPendingSignIn(id);
  armAddAccount(dir(), id, opts);
  return getConnectorAccountsView(id);
}
/** Cancelling also kills the in-flight sign-in, so its grant can never land in the default slot. */
export function cancelAddAccount(id: string): void { cancelPendingSignIn(id); disarmAddAccount(dir(), id); }

function cancelPendingSignIn(id: string): void {
  try { if (id === 'x') cancelXApiOAuthFlow(); else getConnector(id)?.cancelFlow(); } catch { /* best effort */ }
}

/** Resolve a model/user supplied account reference (slug, label, email or @username) to a slug; '' = default. */
export function resolveAccountRef(id: string, ref: unknown): { slug: string } | { error: string } {
  const raw = String(ref ?? '').trim();
  if (!raw || /^(default|primary|main)$/i.test(raw)) return { slug: '' };
  const norm = raw.toLowerCase().replace(/^@/, '');
  const accounts = listConnectorAccounts(dir(), id);
  const def = defaultAccountSummary(id);
  const exact = accounts.find((a) => a.slug === raw.toLowerCase());
  if (exact) return { slug: exact.slug };
  const matches = [{ ...def, slug: '' }, ...accounts].filter((a) =>
    [a.label, a.email, a.username].some((v) => v && v.toLowerCase().replace(/^@/, '') === norm));
  if (matches.length === 1) return { slug: matches[0].slug };
  if (matches.length > 1) return { error: `Ambiguous ${id} account "${raw}". Use an exact account ID: ${matches.map(a => a.slug || 'default').join(', ')}.` };
  const options = [`default (${def.label})`, ...accounts.map((a) => `${a.slug} (${a.label})`)].join(', ');
  return { error: `Unknown ${id} account "${raw}". Available accounts: ${options}. Omit "account" to use the default.` };
}

export function removeConnectorAccount(id: string, slug: string): ConnectorAccount {
  if (!isAccountSlug(slug)) throw new Error('INVALID_ACCOUNT');
  const kind = accountKindFor(id);
  const vault = getVault(dir());
  if (kind === 'oauth') vault.delete(oauthKey(id, slug), `accounts:remove:${id}`);
  else if (kind === 'x') vault.delete(`${X_TOKENS}${slotSuffix(slug)}`, 'accounts:remove:x');
  else deleteAccountPluginCredential(dir(), id, slug);
  const removed = removeAccountRecord(dir(), id, slug);
  if (!removed) throw new Error('ACCOUNT_NOT_FOUND');
  invalidateConnectionToolSurfaceCache();
  return removed;
}

function swapVault(a: string, b: string, caller: string): void {
  const vault = getVault(dir());
  const va = vault.get(a, caller)?.expose();
  const vb = vault.get(b, caller)?.expose();
  if (!vb) throw new Error('ACCOUNT_CREDENTIAL_MISSING');
  vault.set(a, vb, caller);
  if (va) vault.set(b, va, caller); else vault.delete(b, caller);
}

/**
 * Make an extra account the default; the previous default becomes an extra account.
 * The previous default's new slug is chosen BEFORE storage moves, so storage and the index
 * always agree; a failed second move rolls the first one back.
 */
export function makeDefaultConnectorAccount(id: string, slug: string): ConnectorAccountsView {
  if (!isAccountSlug(slug)) throw new Error('INVALID_ACCOUNT');
  const target = listConnectorAccounts(dir(), id).find((a) => a.slug === slug);
  if (!target) throw new Error('ACCOUNT_NOT_FOUND');
  const kind = accountKindFor(id);
  const previous = defaultAccountSummary(id);
  const prevRecord = previous.connected
    ? { label: previous.label, kind, email: previous.email, username: previous.username }
    : null;
  const newSlug = prevRecord ? planReplacementSlug(dir(), id, slug, prevRecord) : undefined;
  const move = newSlug && newSlug !== slug ? newSlug : undefined;
  const caller = `accounts:default:${id}`;
  if (kind === 'credential') {
    swapAccountPluginCredential(dir(), id, slug); // target -> default, old default -> `slug`
    if (move) {
      try { moveAccountPluginCredential(dir(), id, slug, move); }
      catch (error) { try { swapAccountPluginCredential(dir(), id, slug); } catch { /* original error reported */ } throw error; }
    }
  } else {
    const key = (s: string) => (kind === 'x' ? `${X_TOKENS}${slotSuffix(s)}` : oauthKey(id, s));
    swapVault(key(''), key(slug), caller);
    if (move) {
      try { swapVault(key(move), key(slug), caller); } // empty `move` slot: a plain move
      catch (error) { try { swapVault(key(''), key(slug), caller); } catch { /* original error reported */ } throw error; }
    }
    if (kind === 'x') {
      try {
        const tokens = JSON.parse(getVault(dir()).get(X_TOKENS, caller)?.expose() || '{}');
        if (tokens.access_token) getVault(dir()).set(X_LEGACY, tokens.access_token, caller);
      } catch { /* legacy mirror is best effort */ }
    }
  }
  replaceAccountRecord(dir(), id, slug, prevRecord, newSlug);
  invalidateConnectionToolSurfaceCache();
  return getConnectorAccountsView(id);
}
