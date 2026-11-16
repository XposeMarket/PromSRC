// Multi-account support for plugins/connectors (2026-11-12).
//
// The DEFAULT account keeps the original storage slot of every connector
// (integration.<id>.oauth_tokens, x.api.oauth_tokens, plugin-credential-bindings[serviceId]),
// so existing installs are untouched. Extra accounts live in suffixed slots and are
// listed in <configDir>/connector-accounts.json (metadata only, never secrets).
//
// Account selection is ambient: a tool call runs inside runWithConnectorAccounts(), and
// the storage helpers read activeConnectorAccount() so load/refresh/save hit that slot
// without per-connector changes.
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

export type ConnectorAccountKind = 'oauth' | 'x' | 'credential';
export interface ConnectorAccount {
  slug: string; label: string; kind: ConnectorAccountKind;
  email?: string; username?: string; accountId?: string; addedAt: string;
}
export interface AccountIdentity { email?: string; username?: string; accountId?: string }
interface Entry {
  accounts: ConnectorAccount[];
  adding?: { at: number; label?: string; hint?: string };
  lastAdded?: { slug: string; label: string; at: number };
}
type IndexFile = Record<string, Entry>;

export const ADD_ACCOUNT_TTL_MS = 15 * 60_000;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const als = new AsyncLocalStorage<ReadonlyMap<string, string>>();

const indexFile = (dir: string) => path.join(dir, 'connector-accounts.json');
const clean = (value: unknown, max = 120) => (typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '') || undefined;

export function readAccountIndex(dir: string): IndexFile {
  try {
    const data = JSON.parse(fs.readFileSync(indexFile(dir), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
function writeAccountIndex(dir: string, data: IndexFile): void {
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${indexFile(dir)}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, indexFile(dir));
}
function entry(data: IndexFile, id: string): Entry {
  const current = data[id];
  if (current && Array.isArray(current.accounts)) return current;
  return (data[id] = { accounts: [] });
}

export function isAccountSlug(value: unknown): value is string { return typeof value === 'string' && SLUG.test(value); }
export function slugify(value: unknown): string {
  return String(value || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'account';
}
function uniqueSlug(accounts: ConnectorAccount[], base: string): string {
  const taken = new Set(accounts.map((a) => a.slug).concat(['default', 'primary', 'main']));
  let slug = slugify(base); let n = 2;
  while (taken.has(slug)) slug = `${slugify(base).slice(0, 28)}-${n++}`;
  return slug;
}

export function listConnectorAccounts(dir: string, id: string): ConnectorAccount[] {
  return [...(readAccountIndex(dir)[id]?.accounts || [])];
}
export function lastAddedAccount(dir: string, id: string) { return readAccountIndex(dir)[id]?.lastAdded; }

// ── ambient selection ────────────────────────────────────────────────────────
export function activeConnectorAccount(id: string): string | undefined { return als.getStore()?.get(id); }
/** Vault key suffix for the active account of `id`, or '' for the default slot. */
export function accountKeySuffix(id: string): string { const slug = activeConnectorAccount(id); return slug ? `.acct_${slug}` : ''; }
export const slotSuffix = (slug: string) => (slug ? `.acct_${slug}` : '');
export const bindingKeyForSlug = (serviceId: string, slug: string) => (slug ? `${serviceId}::acct::${slug}` : serviceId);
export function bindingKeyFor(serviceId: string): string { return bindingKeyForSlug(serviceId, activeConnectorAccount(serviceId) || ''); }

export function runWithConnectorAccounts<T>(ids: string[], slug: string | undefined, fn: () => T): T {
  if (!slug) return fn();
  const next = new Map(als.getStore() || []);
  for (const id of ids) if (id) next.set(id, slug);
  return als.run(next, fn);
}

// ── add-account mode ─────────────────────────────────────────────────────────
export function armAddAccount(dir: string, id: string, opts: { label?: unknown; hint?: unknown } = {}): void {
  const data = readAccountIndex(dir);
  entry(data, id).adding = { at: Date.now(), label: clean(opts.label, 60), hint: clean(opts.hint, 254) };
  writeAccountIndex(dir, data);
}
export function addAccountArmed(dir: string, id: string): Entry['adding'] | undefined {
  const adding = readAccountIndex(dir)[id]?.adding;
  return adding && Date.now() - Number(adding.at || 0) < ADD_ACCOUNT_TTL_MS ? adding : undefined;
}
export function disarmAddAccount(dir: string, id: string): void {
  const data = readAccountIndex(dir);
  if (!data[id]?.adding) return;
  delete data[id].adding; writeAccountIndex(dir, data);
}

function sameIdentity(a: AccountIdentity | null | undefined, b: AccountIdentity | null | undefined): boolean {
  if (!a || !b) return false;
  const eq = (x?: string, y?: string) => !!x && !!y && x.toLowerCase().replace(/^@/, '') === y.toLowerCase().replace(/^@/, '');
  return eq(a.accountId, b.accountId) || eq(a.email, b.email) || eq(a.username, b.username);
}

/**
 * Decide which slot an incoming grant/credential is written to. Returns '' for the
 * default slot or the slug of an extra account (creating its record when in add mode).
 *  - inside an explicit account scope: that account (token refresh)
 *  - same identity as an existing extra account: that account (re-auth)
 *  - add mode armed and a different default exists: a NEW extra account
 *  - otherwise: the default slot (first connect, re-auth of the default, no add mode)
 */
export function routeIncomingAccount(
  dir: string, id: string, kind: ConnectorAccountKind, identity: AccountIdentity,
  defaultIdentity: () => AccountIdentity | null,
): string {
  const active = activeConnectorAccount(id);
  if (active) return active;
  const data = readAccountIndex(dir);
  const current = data[id];
  const existing = current?.accounts?.find((a) => sameIdentity(a, identity));
  const adding = addAccountArmed(dir, id);
  if (!adding) return existing?.slug || '';
  const target = entry(data, id);
  delete target.adding;
  const def = defaultIdentity();
  if (!def || sameIdentity(def, identity)) { writeAccountIndex(dir, data); return ''; }
  if (existing) { target.lastAdded = { slug: existing.slug, label: existing.label, at: Date.now() }; writeAccountIndex(dir, data); return existing.slug; }
  const n = target.accounts.length + 2;
  const label = adding.label || identity.email || (identity.username ? `@${identity.username.replace(/^@/, '')}` : `Account ${n}`);
  const slug = uniqueSlug(target.accounts, identity.username || identity.email?.split('@')[0] || adding.label || `account-${n}`);
  target.accounts.push({ slug, label, kind, email: identity.email, username: identity.username, accountId: identity.accountId, addedAt: new Date().toISOString() });
  target.lastAdded = { slug, label, at: Date.now() };
  writeAccountIndex(dir, data);
  return slug;
}

export function removeAccountRecord(dir: string, id: string, slug: string): ConnectorAccount | undefined {
  const data = readAccountIndex(dir);
  const list = data[id]?.accounts || [];
  const found = list.find((a) => a.slug === slug);
  if (!found) return undefined;
  data[id].accounts = list.filter((a) => a.slug !== slug);
  if (data[id].lastAdded?.slug === slug) delete data[id].lastAdded;
  writeAccountIndex(dir, data);
  return found;
}

/** Replace the record of `slug` (now the default) with the previous default under `newSlug`. */
export function replaceAccountRecord(dir: string, id: string, slug: string, previousDefault: Omit<ConnectorAccount, 'slug' | 'addedAt'> | null): string | undefined {
  const data = readAccountIndex(dir);
  const target = entry(data, id);
  const rest = target.accounts.filter((a) => a.slug !== slug);
  let newSlug: string | undefined;
  if (previousDefault) {
    newSlug = uniqueSlug(rest, previousDefault.username || previousDefault.email?.split('@')[0] || previousDefault.label || 'account');
    rest.push({ ...previousDefault, slug: newSlug, addedAt: new Date().toISOString() });
  }
  target.accounts = rest;
  writeAccountIndex(dir, data);
  return newSlug;
}
