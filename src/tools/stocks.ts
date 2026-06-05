// src/tools/stocks.ts
// Live equity quotes for the `stocks` rich artifact. Keyless: primary source is
// Yahoo Finance's public chart API (price + prev close + sparkline in one call),
// with Stooq CSV as a price-only fallback.

import type { MarketItem } from '../gateway/rich-artifacts';

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const STOOQ = 'https://stooq.com/q/l/';

interface StockArgs {
  symbols?: string[] | string;
  range?: string;
}

interface StockResult {
  success: boolean;
  stdout?: string;
  error?: string;
  data?: any;
  extra?: { richArtifacts: any[] };
}

async function yahooQuote(symbol: string, range: string): Promise<MarketItem | null> {
  try {
    const res = await fetch(`${YAHOO}/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const r = json?.chart?.result?.[0];
    if (!r?.meta) return null;
    const m = r.meta;
    const price = Number(m.regularMarketPrice);
    if (!Number.isFinite(price)) return null;
    const prev = Number(m.chartPreviousClose ?? m.previousClose);
    const closes: number[] = Array.isArray(r?.indicators?.quote?.[0]?.close)
      ? r.indicators.quote[0].close.filter((n: any) => Number.isFinite(n))
      : [];
    const changeAbs = Number.isFinite(prev) ? price - prev : undefined;
    const changePct = Number.isFinite(prev) && prev !== 0 ? ((price - prev) / prev) * 100 : undefined;
    return {
      symbol: String(m.symbol || symbol).toUpperCase(),
      name: m.shortName || m.longName || undefined,
      kind: 'equity',
      price,
      currency: String(m.currency || 'USD').toUpperCase(),
      changeAbs,
      changePct,
      sparkline: closes.length >= 2 ? closes.slice(-48) : undefined,
      source: 'Yahoo Finance',
      asOf: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function stooqQuote(symbol: string): Promise<MarketItem | null> {
  try {
    const res = await fetch(`${STOOQ}?s=${encodeURIComponent(symbol.toLowerCase())}.us&f=sd2t2ohlcv&h&e=csv`, {
      headers: { accept: 'text/csv' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[1].split(',');
    const close = Number(cols[6]);
    const open = Number(cols[3]);
    if (!Number.isFinite(close)) return null;
    const changeAbs = Number.isFinite(open) ? close - open : undefined;
    const changePct = Number.isFinite(open) && open !== 0 ? ((close - open) / open) * 100 : undefined;
    return {
      symbol: symbol.toUpperCase(),
      kind: 'equity',
      price: close,
      currency: 'USD',
      changeAbs,
      changePct,
      source: 'Stooq',
      asOf: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function executeStockLookup(args: StockArgs): Promise<StockResult> {
  const list = Array.isArray(args.symbols)
    ? args.symbols
    : String(args.symbols || '').split(/[,\s]+/).filter(Boolean);
  const symbols = Array.from(new Set(list.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))).slice(0, 12);
  if (!symbols.length) {
    return { success: false, error: 'show_stocks requires at least one ticker, e.g. ["AAPL","TSLA","SPY"].' };
  }
  const range = String(args.range || '1mo');

  const items: MarketItem[] = [];
  const failed: string[] = [];
  await Promise.all(symbols.map(async (sym) => {
    let item = await yahooQuote(sym, range);
    if (!item) item = await stooqQuote(sym);
    if (item) items.push(item); else failed.push(sym);
  }));

  if (!items.length) {
    return { success: false, error: `Could not fetch quotes for: ${symbols.join(', ')}. Check the ticker symbols.` };
  }
  // Preserve requested order.
  items.sort((a, b) => symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol));

  const artifact = {
    id: `stocks-${Date.now()}`,
    type: 'stocks' as const,
    title: items.length === 1 ? `${items[0].name || items[0].symbol}` : 'Stocks',
    source: items[0].source || 'Yahoo Finance',
    items,
  };
  const stdout = items
    .map((i) => `${i.symbol} ${i.price} ${i.currency}${i.changePct != null ? ` (${i.changePct >= 0 ? '+' : ''}${i.changePct.toFixed(2)}%)` : ''}`)
    .join('\n') + (failed.length ? `\n(failed: ${failed.join(', ')})` : '');

  return {
    success: true,
    stdout: `Stock quotes:\n${stdout}`,
    data: { symbols, items, failed },
    extra: { richArtifacts: [artifact] },
  };
}
