// Account management for multi-account plugins (see connector-accounts.ts for storage rules).
import { getConfig } from '../config/config';
import { getVault } from '../security/vault';
import { getConnector } from '../integrations/connector-registry';
import { getXApiOAuthStatus } from '../auth/x-api-oauth';
import {
  armAddAccount, addAccountArmed, disarmAddAccount, isAccountSlug, lastAddedAccount, listConnectorAccounts,
  removeAccountRecord, replaceAccountRecord, slotSuffix, type ConnectorAccount, type ConnectorAccountKind,
} from './connector-accounts';
import { deleteAccountPluginCredential, hasBoundPluginCredential, swapAccountPluginCredential } from './plugin-credential-binding';
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
  armAddAccount(dir(), id, opts);
  return getConnectorAccountsView(id);
}
export function cancelAddAccount(id: string): void { disarmAddAccount(dir(), id); }

/** Resolve a model/user supplied account reference (slug, label, email or @username) to a slug; '' = default. */
export function resolveAccountRef(id: string, ref: unknown): { slug: string } | { error: string } {
  const raw = String(ref ?? '').trim();
  if (!raw || /^(default|primary|main)$/i.test(raw)) return { slug: '' };
  const norm = raw.toLowerCase().replace(/^@/, '');
  const accounts = listConnectorAccounts(dir(), id);
  const def = defaultAccountSummary(id);
  if ([def.email, def.username, def.label].some((v) => v && v.toLowerCase().replace(/^@/, '') === norm)) return { slug: '' };
  const hit = accounts.find((a) => [a.slug, a.label, a.email, a.username].some((v) => v && v.toLowerCase().replace(/^@/, '') === norm));
  if (hit) return { slug: hit.slug };
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

/** Make an extra account the default; the previous default becomes an extra account. */
export function makeDefaultConnectorAccount(id: string, slug: string): ConnectorAccountsView {
  if (!isAccountSlug(slug)) throw new Error('INVALID_ACCOUNT');
  const target = listConnectorAccounts(dir(), id).find((a) => a.slug === slug);
  if (!target) throw new Error('ACCOUNT_NOT_FOUND');
  const kind = accountKindFor(id);
  const previous = defaultAccountSummary(id);
  if (kind === 'oauth') swapVault(oauthKey(id, ''), oauthKey(id, slug), `accounts:default:${id}`);
  else if (kind === 'x') {
    swapVault(X_TOKENS, `${X_TOKENS}${slotSuffix(slug)}`, 'accounts:default:x');
    try {
      const tokens = JSON.parse(getVault(dir()).get(X_TOKENS, 'accounts:default:x')?.expose() || '{}');
      if (tokens.access_token) getVault(dir()).set(X_LEGACY, tokens.access_token, 'accounts:default:x');
    } catch { /* legacy mirror is best effort */ }
  } else swapAccountPluginCredential(dir(), id, slug);
  const newSlug = replaceAccountRecord(dir(), id, slug, previous.connected
    ? { label: previous.label, kind, email: previous.email, username: previous.username }
    : null);
  // The swapped-in default was stored under `slug`; the previous default now lives under `newSlug`.
  if (newSlug && newSlug !== slug) {
    if (kind === 'oauth') swapVault(oauthKey(id, newSlug), oauthKey(id, slug), `accounts:default:${id}`);
    else if (kind === 'x') swapVault(`${X_TOKENS}${slotSuffix(newSlug)}`, `${X_TOKENS}${slotSuffix(slug)}`, 'accounts:default:x');
    else swapAccountSlot(id, slug, newSlug);
  }
  invalidateConnectionToolSurfaceCache();
  return getConnectorAccountsView(id);
}

/** Move a credential binding from `from` slot to `to` slot (credential plugins). */
function swapAccountSlot(id: string, from: string, to: string): void {
  // swapAccountPluginCredential swaps default<->slug; emulate a move with two swaps through the default.
  swapAccountPluginCredential(dir(), id, from); // default <-> from
  swapAccountPluginCredential(dir(), id, to);   // default <-> to (empty: moves default to `to`)
  swapAccountPluginCredential(dir(), id, from); // restore default
}
