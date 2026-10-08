/**
 * Provider account balance preflight.
 *
 * A quote is only useful if the account can pay it. fal locks an account with an
 * exhausted balance ("User is locked. Reason: Exhausted balance") and every job then
 * fails at upload time, after the user already approved the spend. This reads the
 * balance before generating so the user hears "top up first" instead.
 *
 * Unknown balance never blocks: endpoints/permissions vary by key type, so a failed
 * lookup is reported as unknown and generation proceeds as before.
 */
import { getProviderKey } from './providers.js';

export interface ProviderBalance {
  provider: 'fal';
  /** Current balance in USD; undefined when it could not be read. */
  balanceUsd?: number;
  /** Which endpoint answered, or why the lookup failed. */
  source: string;
  checkedAt: number;
}

const FAL_BILLING = 'https://api.fal.ai/v1/account/billing?expand=credits';
const FAL_LEGACY_BALANCE = 'https://rest.alpha.fal.ai/billing/user_balance';
const CACHE_MS = 60_000;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
let cache: ProviderBalance | undefined;

/** Tests: swap the HTTP layer and clear the cache. */
export function setBalanceFetcherForTests(f?: Fetcher): void {
  fetcher = f || ((url, init) => fetch(url, init));
  cache = undefined;
}

export function clearBalanceCache(): void { cache = undefined; }

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Pull a USD balance out of either fal response shape. */
export function parseFalBalance(body: unknown): number | undefined {
  const direct = num(body);
  if (direct !== undefined) return direct;
  const b = body as any;
  if (!b || typeof b !== 'object') return undefined;
  return num(b?.credits?.current_balance) ?? num(b?.current_balance) ?? num(b?.balance) ?? num(b?.user_balance);
}

export async function falBalance(opts: { fresh?: boolean; key?: string } = {}): Promise<ProviderBalance> {
  if (!opts.fresh && cache && Date.now() - cache.checkedAt < CACHE_MS) return cache;
  const key = opts.key ?? getProviderKey('fal');
  if (!key) return { provider: 'fal', source: 'no fal key configured', checkedAt: Date.now() };
  const reasons: string[] = [];
  for (const url of [FAL_BILLING, FAL_LEGACY_BALANCE]) {
    try {
      const res = await fetcher(url, { headers: { Authorization: `Key ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      if (!res.ok) { reasons.push(`${new URL(url).host} ${res.status}`); continue; }
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* plain number */ }
      const usd = parseFalBalance(body);
      if (usd === undefined) { reasons.push(`${new URL(url).host} unparsed`); continue; }
      cache = { provider: 'fal', balanceUsd: Math.round(usd * 100) / 100, source: new URL(url).host, checkedAt: Date.now() };
      return cache;
    } catch (e: any) {
      reasons.push(`${new URL(url).host} ${String(e?.name === 'TimeoutError' ? 'timeout' : e?.message || e).slice(0, 80)}`);
    }
  }
  return { provider: 'fal', source: `unknown (${reasons.join('; ')})`, checkedAt: Date.now() };
}

/** Message when a known balance can't cover the quote; undefined when OK or unknown. */
export function balanceShortfall(balance: ProviderBalance, quoteUsd: number): string | undefined {
  if (balance.balanceUsd === undefined || quoteUsd <= 0) return undefined;
  if (balance.balanceUsd + 1e-9 >= quoteUsd) return undefined;
  return `fal balance is $${balance.balanceUsd.toFixed(2)} but this run is quoted at $${quoteUsd.toFixed(2)}. `
    + 'fal locks the account when the balance is exhausted, so every job would fail. Top up at fal.ai/dashboard/billing, then generate again.';
}
