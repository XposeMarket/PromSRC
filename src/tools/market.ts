// src/tools/market.ts
// CoinGecko-backed market data for the `stocks` rich artifact (crypto + memecoins).
// Free, no API key. Equities are not covered by CoinGecko — see show_market guidance.

import type { MarketItem } from '../gateway/rich-artifacts';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Common ticker → CoinGecko id aliases so the model can pass tickers directly.
const TICKER_ALIASES: Record<string, string> = {
  btc: 'bitcoin', xbt: 'bitcoin', eth: 'ethereum', sol: 'solana', doge: 'dogecoin',
  ada: 'cardano', xrp: 'ripple', bnb: 'binancecoin', dot: 'polkadot', matic: 'matic-network',
  avax: 'avalanche-2', shib: 'shiba-inu', ltc: 'litecoin', link: 'chainlink', trx: 'tron',
  uni: 'uniswap', atom: 'cosmos', pepe: 'pepe', wif: 'dogwifcoin', bonk: 'bonk',
  usdt: 'tether', usdc: 'usd-coin', ton: 'the-open-network', near: 'near', apt: 'aptos',
};

interface MarketLookupArgs {
  coins?: string[] | string;
  vs_currency?: string;
  sparkline?: boolean;
}

interface MarketLookupResult {
  success: boolean;
  stdout?: string;
  error?: string;
  data?: any;
  extra?: { richArtifacts: any[] };
}

async function cgFetch(pathAndQuery: string): Promise<any> {
  const res = await fetch(`${COINGECKO_BASE}${pathAndQuery}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

/** Resolve a list of user inputs (ids, tickers, or names) into CoinGecko coin ids. */
async function resolveCoinIds(inputs: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of inputs) {
    const input = String(raw || '').trim().toLowerCase();
    if (!input) continue;
    if (TICKER_ALIASES[input]) { ids.push(TICKER_ALIASES[input]); continue; }
    // Heuristic: treat hyphenated/longer tokens as likely-valid ids; otherwise search.
    if (input.includes('-') || input.length > 5) { ids.push(input); continue; }
    try {
      const search = await cgFetch(`/search?query=${encodeURIComponent(input)}`);
      const first = Array.isArray(search?.coins) ? search.coins[0] : null;
      if (first?.id) ids.push(String(first.id));
      else ids.push(input);
    } catch {
      ids.push(input);
    }
  }
  // De-dup, cap to a sane number.
  return Array.from(new Set(ids)).slice(0, 12);
}

export async function executeMarketLookup(args: MarketLookupArgs): Promise<MarketLookupResult> {
  const rawCoins = Array.isArray(args.coins)
    ? args.coins
    : String(args.coins || '').split(/[,\s]+/).filter(Boolean);
  if (!rawCoins.length) {
    return { success: false, error: 'show_market requires at least one coin id/ticker (e.g. ["bitcoin","eth","pepe"]).' };
  }
  const vs = String(args.vs_currency || 'usd').toLowerCase();
  const wantSparkline = args.sparkline !== false;

  let ids: string[];
  try {
    ids = await resolveCoinIds(rawCoins);
  } catch (err: any) {
    return { success: false, error: `Could not resolve coins: ${err?.message || err}` };
  }
  if (!ids.length) return { success: false, error: 'No valid coins resolved.' };

  let markets: any[];
  try {
    const q = `/coins/markets?vs_currency=${encodeURIComponent(vs)}&ids=${encodeURIComponent(ids.join(','))}`
      + `&sparkline=${wantSparkline ? 'true' : 'false'}&price_change_percentage=24h`;
    markets = await cgFetch(q);
  } catch (err: any) {
    return { success: false, error: `CoinGecko request failed: ${err?.message || err}` };
  }
  if (!Array.isArray(markets) || !markets.length) {
    return { success: false, error: `No market data found for: ${ids.join(', ')}. Pass CoinGecko ids (e.g. "dogwifcoin") for obscure tokens.` };
  }

  const asOf = new Date().toISOString();
  const items: MarketItem[] = markets.map((m: any) => {
    const spark = wantSparkline && Array.isArray(m?.sparkline_in_7d?.price)
      ? m.sparkline_in_7d.price.filter((n: any) => Number.isFinite(n)).slice(-48)
      : undefined;
    return {
      symbol: String(m.symbol || '').toUpperCase(),
      name: m.name || undefined,
      kind: 'crypto',
      price: typeof m.current_price === 'number' ? m.current_price : undefined,
      currency: vs.toUpperCase(),
      changeAbs: typeof m.price_change_24h === 'number' ? m.price_change_24h : undefined,
      changePct: typeof m.price_change_percentage_24h === 'number' ? m.price_change_percentage_24h : undefined,
      marketCap: typeof m.market_cap === 'number' ? m.market_cap : undefined,
      sparkline: spark && spark.length ? spark : undefined,
      logoUrl: m.image || undefined,
      source: 'CoinGecko',
      asOf,
    };
  });

  const artifact = {
    id: `stocks-${Date.now()}`,
    type: 'stocks' as const,
    title: items.length === 1 ? `${items[0].name || items[0].symbol}` : 'Market snapshot',
    source: 'CoinGecko',
    items,
  };
  const stdout = items
    .map((i) => `${i.symbol} ${i.price != null ? i.price : '?'} ${i.currency}${i.changePct != null ? ` (${i.changePct >= 0 ? '+' : ''}${i.changePct.toFixed(2)}%)` : ''}`)
    .join('\n');

  return {
    success: true,
    stdout: `Market snapshot (CoinGecko):\n${stdout}`,
    data: { coins: ids, vs_currency: vs, items },
    extra: { richArtifacts: [artifact] },
  };
}
