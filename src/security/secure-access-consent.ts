/**
 * Per-action human consent for owner-only secure-access and pairing actions (PR821 I1).
 *
 * The owner cookie proves *which window* sent a request, not that a human acted.
 * Supported desktop automation (desktop_* tools, scripted input) can click inside
 * that window. Owner-only actions therefore also need a consent header that only
 * the Electron main process mints, and only after the human completes the native
 * owner-approval window:
 *   - the window uses setContentProtection(true), so screenshots/screen capture
 *     (desktop_screenshot, PrintWindow, BitBlt, DXGI) do not see its content;
 *   - it shows a random code drawn on a canvas (no DOM/accessibility text) that the
 *     human must type back; three wrong codes deny;
 *   - while it is open the gateway refuses every desktop_* tool (consent lock).
 * The header binds METHOD, path and SHA-256 of the exact JSON body, is single use
 * and expires after 120 s. The HMAC key is derived from the per-launch owner token,
 * which only Electron main and gateway memory hold (scrubbed from env at boot).
 *
 * Out of scope (SPEC): same-OS-user code that reads process memory, injects into
 * Electron, or reads the screen through a capture path that ignores display
 * affinity. Content protection is a no-op on Linux; the lock and code still apply.
 */
import crypto from 'crypto';
import { secureAccessOwnerToken } from './secure-access-owner';

export const OWNER_CONSENT_HEADER = 'x-prom-owner-consent';
export const CONSENT_TTL_MS = 120_000;
const LOCK_MAX_MS = 150_000;

type KeySource = () => string;
let keySource: KeySource = secureAccessOwnerToken;
/** Test seam only. */
export function setConsentKeySourceForTests(fn: KeySource | null): void { keySource = fn || secureAccessOwnerToken; usedNonces.clear(); lockUntil = 0; lastLockTs = 0; }

export function deriveConsentKey(ownerToken: string): Buffer | null {
  if (!/^[a-f0-9]{64}$/.test(String(ownerToken || ''))) return null;
  return crypto.createHmac('sha256', ownerToken).update('prometheus-owner-consent-v1').digest();
}
export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
export function consentCanonical(ts: number, nonce: string, method: string, path: string, bodySha256: string): string {
  return `v1|${ts}|${nonce}|${String(method).toUpperCase()}|${path}|${bodySha256}`;
}
/** Mint a header value (Electron main uses an identical JS implementation). */
export function mintConsent(ownerToken: string, method: string, path: string, bodySha256: string, now = Date.now()): string {
  const key = deriveConsentKey(ownerToken); if (!key) throw new Error('No consent key.');
  const nonce = crypto.randomBytes(16).toString('hex');
  const mac = crypto.createHmac('sha256', key).update(consentCanonical(now, nonce, method, path, bodySha256)).digest('hex');
  return `v1.${now}.${nonce}.${mac}`;
}

const usedNonces = new Map<string, number>();
function safeHexEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'); const y = Buffer.from(b, 'hex');
  return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
}
export type ConsentCheck = { ok: true } | { ok: false; reason: 'missing' | 'unavailable' | 'malformed' | 'expired' | 'replayed' | 'mismatch' };
/** Verify and consume a consent header for this exact request. */
export function verifyConsent(header: unknown, method: string, path: string, rawBody: Buffer | string | undefined, now = Date.now()): ConsentCheck {
  if (typeof header !== 'string' || !header) return { ok: false, reason: 'missing' };
  const key = deriveConsentKey(keySource());
  if (!key) return { ok: false, reason: 'unavailable' };
  const m = /^v1\.(\d{10,16})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(header);
  if (!m) return { ok: false, reason: 'malformed' };
  const ts = Number(m[1]); const nonce = m[2];
  if (!(ts <= now + 5_000 && now - ts <= CONSENT_TTL_MS)) return { ok: false, reason: 'expired' };
  for (const [n, exp] of usedNonces) if (exp <= now) usedNonces.delete(n);
  if (usedNonces.has(nonce)) return { ok: false, reason: 'replayed' };
  const bodyHash = sha256Hex(rawBody === undefined ? '' : rawBody);
  const want = crypto.createHmac('sha256', key).update(consentCanonical(ts, nonce, method, path, bodyHash)).digest('hex');
  if (!safeHexEqual(want, m[3])) return { ok: false, reason: 'mismatch' };
  usedNonces.set(nonce, ts + CONSENT_TTL_MS + 5_000);
  return { ok: true };
}

/* ---- consent lock: desktop automation is refused while a consent window is open ---- */
let lockUntil = 0;
let lastLockTs = 0;
export function lockCanonical(active: boolean, ts: number): string { return `lock|${active ? 1 : 0}|${ts}`; }
/** Electron main reports open/close of the native consent window. HMAC-authenticated, monotonic. */
export function applyConsentLock(body: { active?: unknown; ts?: unknown; mac?: unknown }, now = Date.now()): boolean {
  const key = deriveConsentKey(keySource()); if (!key) return false;
  const active = body?.active === true; const ts = Number(body?.ts); const mac = String(body?.mac || '');
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 30_000 || ts <= lastLockTs || !/^[a-f0-9]{64}$/.test(mac)) return false;
  const want = crypto.createHmac('sha256', key).update(lockCanonical(active, ts)).digest('hex');
  if (!safeHexEqual(want, mac)) return false;
  lastLockTs = ts;
  lockUntil = active ? now + LOCK_MAX_MS : 0;
  return true;
}
export function ownerConsentActive(now = Date.now()): boolean { return lockUntil > now; }
/** Title of the native window; desktop tools must never target it. */
export const OWNER_CONSENT_WINDOW_TITLE = 'Prometheus owner approval';
