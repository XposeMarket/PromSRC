/**
 * chrome-signin-sync.ts - "Always use my Chrome sign-ins" grant.
 *
 * When the user turns the grant on (Settings toggle or mobile "Always do this"),
 * opening a site in the in-house browser copies that site's Chrome sign-in
 * (site + siblings + auth providers) through the paired Personal Chrome
 * extension. Cookie values never leave the Electron/extension path; logs carry
 * counts and domains only.
 *
 * Dependencies are injected (deps) so the regression test runs without Electron
 * or a live relay.
 */
import fs from 'fs';
import path from 'path';

import { getConfig } from '../../config/config';
import { getUserChromeRelay } from '../user-chrome-relay.js';
import { callInHouseBrowser } from './inhouse.js';
import { LOGIN_IMPORT_PROVIDER_DOMAINS, LOGIN_IMPORT_SIBLING_DOMAINS, registrableDomain } from './inhouse-actions.js';

export interface ChromeSigninGrant { enabled: boolean; grantedAt?: string }

export interface GoogleAccount { email: string; name?: string; signedIn: boolean }

export interface ChromeSiteSummary { site: string; cookies: number }

export interface ChromeSigninSyncResult {
  synced: boolean;
  imported: number;
  domain: string;
  reason?: string;
}

export interface ChromeSigninSyncDeps {
  getGrant(): ChromeSigninGrant;
  isPaired(): boolean;
  waitForPeer(ms: number): Promise<boolean>;
  requestRelay(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any>;
  requestCookies(domains: string[]): Promise<any[]>;
  importCookies(sessionId: string, cookies: any[]): Promise<number>;
  reload(sessionId: string): Promise<void>;
  now(): number;
}

const SYNC_TTL_MS = 20 * 60 * 1000;
const MAX_SYNC_DOMAINS = 20;
const SITE_LIMIT = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RELOAD_EXTENSION_MESSAGE = 'Your Chrome is still running the old Prometheus extension. In Chrome open chrome://extensions and press the reload icon on "Prometheus Personal Chrome", then try again.';

export function chromeSigninGrantFile(): string {
  return path.join(getConfig().getConfigDir(), 'chrome-signin-sync.json');
}

/** Missing or broken file means the grant is off. */
export function readChromeSigninGrant(file: string = chromeSigninGrantFile()): ChromeSigninGrant {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.enabled !== true) return { enabled: false };
    return { enabled: true, grantedAt: typeof value.grantedAt === 'string' ? value.grantedAt : undefined };
  } catch {
    return { enabled: false };
  }
}

/** Turning the grant off clears the sync cache so auto-sync stops immediately. */
export function setChromeSigninGrant(enabled: boolean, file: string = chromeSigninGrantFile(), now: number = Date.now()): ChromeSigninGrant {
  const grant: ChromeSigninGrant = enabled
    ? { enabled: true, grantedAt: new Date(now).toISOString() }
    : { enabled: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(grant, null, 2), { encoding: 'utf8', mode: 0o600 });
  if (!enabled) clearChromeSigninSyncCache();
  return grant;
}

/** Google ListAccounts returns an XSSI-prefixed JSON array; walk it defensively. */
export function parseGoogleListAccounts(raw: string): GoogleAccount[] {
  try {
    const text = String(raw || '').trim().replace(/^\)\]\}'\s*/, '');
    if (!text) return [];
    const data = JSON.parse(text);
    const out: GoogleAccount[] = [];
    const seen = new Set<string>();
    const walk = (node: any, depth: number) => {
      if (!Array.isArray(node) || depth > 8) return;
      const emailIndex = node.findIndex(v => typeof v === 'string' && EMAIL_RE.test(v));
      if (emailIndex >= 0) {
        const email = String(node[emailIndex]).trim();
        const key = email.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          const before = emailIndex > 0 ? node[emailIndex - 1] : undefined;
          const name = typeof before === 'string' && before.trim() && !EMAIL_RE.test(before) ? before.trim() : undefined;
          out.push({ email, ...(name ? { name } : {}), signedIn: node[5] !== 0 });
        }
        return;
      }
      for (const child of node) walk(child, depth + 1);
    };
    walk(data, 0);
    return out;
  } catch {
    return [];
  }
}

/** Normalizes the email list from Google's account switcher page (deduped, lowercased). */
export function googleAccountsFromEmails(emails: unknown): GoogleAccount[] {
  const out: GoogleAccount[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(emails) ? emails : []) {
    const email = String(value || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, signedIn: true });
  }
  return out;
}

/** Groups cookie counts by registrable domain. Names and values never appear. */
export function summarizeChromeSites(sites: Array<{ domain?: unknown; count?: unknown }>): ChromeSiteSummary[] {
  const totals = new Map<string, number>();
  for (const entry of Array.isArray(sites) ? sites : []) {
    const host = String(entry?.domain || '').trim().toLowerCase().replace(/^\.+/, '');
    if (!host) continue;
    const site = registrableDomain(host);
    totals.set(site, (totals.get(site) || 0) + Math.max(0, Number(entry?.count) || 0));
  }
  return [...totals.entries()]
    .map(([site, cookies]) => ({ site, cookies }))
    .sort((a, b) => b.cookies - a.cookies || a.site.localeCompare(b.site))
    .slice(0, SITE_LIMIT);
}

function isIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** Registrable domain first, then siblings and auth providers. [] when not syncable. */
export function syncDomainsFor(url: string): string[] {
  let parsed: URL;
  try { parsed = new URL(String(url || '')); } catch { return []; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || isIpHost(host)) return [];
  const site = registrableDomain(host);
  if (!site || !site.includes('.')) return [];
  const list = [site, ...(LOGIN_IMPORT_SIBLING_DOMAINS[site] || []), ...LOGIN_IMPORT_PROVIDER_DOMAINS];
  return [...new Set(list)].slice(0, MAX_SYNC_DOMAINS);
}

const syncCache = new Map<string, number>();
const UNPAIRED_BACKOFF_MS = 2 * 60 * 1000;
let unpairedRetryAt = 0;

export function shouldSync(profileId: string, domain: string, now: number): boolean {
  const at = syncCache.get(`${profileId}|${domain}`);
  return at === undefined || now - at >= SYNC_TTL_MS;
}

export function markSynced(profileId: string, domain: string, now: number): void {
  syncCache.set(`${profileId}|${domain}`, now);
}

export function clearChromeSigninSyncCache(): void {
  syncCache.clear();
  unpairedRetryAt = 0;
}

export async function maybeAutoSyncChromeSignins(
  deps: ChromeSigninSyncDeps,
  input: { sessionId: string; profileId: string; url: string },
): Promise<ChromeSigninSyncResult> {
  let domain = '';
  try {
    if (!deps.getGrant().enabled) return { synced: false, imported: 0, domain, reason: 'disabled' };
    const domains = syncDomainsFor(input.url);
    if (!domains.length) return { synced: false, imported: 0, domain, reason: 'not-syncable' };
    domain = domains[0];
    if (!shouldSync(input.profileId, domain, deps.now())) return { synced: false, imported: 0, domain, reason: 'cached' };
    if (!deps.isPaired()) {
      // Back off after a failed wait so an unpaired Chrome doesn't add 3s to every open.
      if (deps.now() < unpairedRetryAt) return { synced: false, imported: 0, domain, reason: 'chrome-not-paired' };
      const paired = await deps.waitForPeer(3000);
      if (!paired) {
        unpairedRetryAt = deps.now() + UNPAIRED_BACKOFF_MS;
        return { synced: false, imported: 0, domain, reason: 'chrome-not-paired' };
      }
    }
    unpairedRetryAt = 0;
    const cookies = await deps.requestCookies(domains);
    const imported = await deps.importCookies(input.sessionId, cookies);
    markSynced(input.profileId, domain, deps.now());
    if (imported > 0) await deps.reload(input.sessionId);
    console.log(`[chrome-signin-sync] domain=${domain} imported=${imported}`);
    return { synced: true, imported, domain };
  } catch (err: any) {
    return { synced: false, imported: 0, domain, reason: String(err?.message || err || 'sync-failed').slice(0, 200) };
  }
}

export function defaultChromeSigninDeps(): ChromeSigninSyncDeps {
  const relay = () => getUserChromeRelay();
  return {
    getGrant: () => readChromeSigninGrant(),
    isPaired: () => { try { return !!relay().getStatus().authenticated; } catch { return false; } },
    waitForPeer: async (ms: number) => { try { return !!(await relay().waitForPeer(ms)); } catch { return false; } },
    requestRelay: (method, params, timeoutMs) => relay().request(method, params, timeoutMs),
    requestCookies: async (domains: string[]) => {
      const got: any = await relay().request('cookies.forDomains', { domains }, 20_000);
      return Array.isArray(got?.cookies) ? got.cookies : [];
    },
    importCookies: async (sessionId: string, cookies: any[]) => {
      const res: any = await callInHouseBrowser('import-cookies', { sessionId, cookies });
      return Number(res?.imported || 0);
    },
    reload: async (sessionId: string) => {
      try { await callInHouseBrowser('navigate', { sessionId, action: 'reload' }); } catch {}
    },
    now: () => Date.now(),
  };
}


export interface ChromeAccountsInventory {
  paired: boolean;
  accounts: GoogleAccount[];
  sites: ChromeSiteSummary[];
  reason?: string;
}

/** Read-only inventory for agents: Google account names and site counts. No cookie names or values. */
export async function listChromeAccounts(deps: ChromeSigninSyncDeps): Promise<ChromeAccountsInventory> {
  try {
    if (!deps.isPaired()) {
      const paired = await deps.waitForPeer(3000);
      if (!paired) return { paired: false, accounts: [], sites: [], reason: 'chrome-not-paired' };
    }
    const errors: string[] = [];
    const call = (method: string, timeoutMs: number) => deps.requestRelay(method, {}, timeoutMs)
      .catch((err: any) => { errors.push(String(err?.message || err)); return null; });
    const [google, sites] = await Promise.all([call('google.accounts', 15_000), call('cookies.sites', 20_000)]);
    // An unpacked extension keeps running old code until reloaded; say so instead of "none detected".
    if (errors.some(e => /Unsupported Personal Chrome relay method/i.test(e))) {
      return { paired: true, accounts: [], sites: [], reason: RELOAD_EXTENSION_MESSAGE };
    }
    const siteRows = Array.isArray(sites) ? sites : [];
    // 1.4.1+ returns { emails } from Google's account switcher. 1.4.0 returned the
    // ListAccounts body, which Google now rejects, so treat it as a stale extension.
    if (google && !Array.isArray(google.emails)) {
      const legacy = parseGoogleListAccounts(String(google.raw || ''));
      if (!legacy.length) return { paired: true, accounts: [], sites: summarizeChromeSites(siteRows), reason: RELOAD_EXTENSION_MESSAGE };
      return { paired: true, accounts: legacy, sites: summarizeChromeSites(siteRows) };
    }
    return { paired: true, accounts: googleAccountsFromEmails(google?.emails), sites: summarizeChromeSites(siteRows) };
  } catch (err: any) {
    return { paired: false, accounts: [], sites: [], reason: String(err?.message || err || 'inventory-failed').slice(0, 200) };
  }
}
