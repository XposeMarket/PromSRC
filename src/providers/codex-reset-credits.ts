/**
 * codex-reset-credits.ts
 *
 * Banked Codex rate-limit resets ("Reset for free"), same private ChatGPT
 * endpoints the Codex app and T3 Code use:
 *   GET  https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
 *   POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume
 *        { credit_id, redeem_request_id }
 *
 * redeem_request_id is a UUIDv5 of account+credit, so a retried consume can
 * never spend two credits. Consuming is irreversible; callers must confirm
 * with the user first (the UI shows a confirmation modal).
 */
import crypto from 'node:crypto';

const CREDIT_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
// Same namespace T3 Code uses, so a redeem started in either app dedupes.
const REDEEM_NAMESPACE_HEX = '6f1c2a9e2d4b4c1e9a7f3b8d5e0c1a42';

export interface CodexResetCredit {
  id: string;
  status: string;
  resetType: string;
  expiresAt: string;
}

export interface CodexResetCreditsSummary {
  provider: 'openai_codex';
  available: number;
  next: { id: string; expiresAt: string } | null;
  error: string | null;
  checkedAt: number;
}

export type CodexConsumeOutcome = 'reset' | 'nothing_to_reset' | 'no_credit' | 'already_redeemed';

export function creditRedeemRequestId(accountId: string, creditId: string): string {
  const bytes = crypto.createHash('sha1')
    .update(Buffer.from(REDEEM_NAMESPACE_HEX, 'hex'))
    .update(`${accountId}:${creditId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Filter + sort the raw list the same way the Codex app does (soonest expiry first). */
export function selectAvailableCredits(body: any, now = Date.now()): CodexResetCredit[] {
  const list = Array.isArray(body?.credits) ? body.credits : [];
  return list
    .map((c: any) => ({
      id: String(c?.id || ''),
      status: String(c?.status || ''),
      resetType: String(c?.reset_type || ''),
      expiresAt: String(c?.expires_at || ''),
    }))
    .filter((c: CodexResetCredit) => c.id
      && c.resetType === 'codex_rate_limits'
      && c.status === 'available'
      && Date.parse(c.expiresAt) > now)
    .sort((a: CodexResetCredit, b: CodexResetCredit) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

async function codexAuth(configDir: string, accountId?: string): Promise<{ headers: Record<string, string>; accountKey: string } | null> {
  const oauth = require('../auth/openai-oauth');
  const tokens = oauth.loadTokens(configDir, accountId);
  if (!tokens?.access_token) return null;
  let accessToken: string = tokens.access_token;
  try { accessToken = await oauth.getValidToken(configDir, accountId); } catch { /* stored token */ }
  const cf = oauth.buildCodexCloudflareHeaders(accessToken, tokens.account_id);
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...cf,
    },
    accountKey: String(cf['ChatGPT-Account-ID'] || tokens.account_id || accountId || 'default'),
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

let cached: { at: number; key: string; value: CodexResetCreditsSummary } | null = null;
const CACHE_MS = 60_000;

export async function getCodexResetCredits(configDir: string, accountId?: string, force = false): Promise<CodexResetCreditsSummary> {
  const key = `${configDir}|${accountId || ''}`;
  if (!force && cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.value;
  const base: CodexResetCreditsSummary = { provider: 'openai_codex', available: 0, next: null, error: null, checkedAt: Date.now() };
  let value: CodexResetCreditsSummary;
  try {
    const auth = await codexAuth(configDir, accountId);
    if (!auth) {
      value = { ...base, error: 'Codex is not signed in.' };
    } else {
      const res = await withTimeout(fetch(CREDIT_URL, { headers: auth.headers }), 12_000);
      if (!res.ok) {
        value = { ...base, error: `ChatGPT reset credits ${res.status}` };
      } else {
        const credits = selectAvailableCredits(await res.json().catch(() => ({})));
        value = { ...base, available: credits.length, next: credits[0] ? { id: credits[0].id, expiresAt: credits[0].expiresAt } : null };
      }
    }
  } catch (err: any) {
    value = { ...base, error: String(err?.message || err) };
  }
  cached = { at: Date.now(), key, value };
  return value;
}

export async function consumeCodexResetCredit(configDir: string, creditId: string, accountId?: string): Promise<{ outcome: CodexConsumeOutcome; credits: CodexResetCreditsSummary }> {
  const id = String(creditId || '').trim();
  if (!id) throw new Error('credit_id is required');
  const auth = await codexAuth(configDir, accountId);
  if (!auth) throw new Error('Codex is not signed in.');
  const res = await withTimeout(fetch(`${CREDIT_URL}/consume`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({ credit_id: id, redeem_request_id: creditRedeemRequestId(auth.accountKey, id) }),
  }), 20_000);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ChatGPT consume ${res.status}${body?.detail ? `: ${String(body.detail).slice(0, 200)}` : ''}`);
  const code = String(body?.code || '');
  if (!['reset', 'nothing_to_reset', 'no_credit', 'already_redeemed'].includes(code)) {
    throw new Error(`Unexpected consume response: ${JSON.stringify(body).slice(0, 200)}`);
  }
  cached = null;
  const credits = await getCodexResetCredits(configDir, accountId, true);
  return { outcome: code as CodexConsumeOutcome, credits };
}
