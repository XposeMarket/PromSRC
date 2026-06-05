// src/tools/polymarket.ts
// Read-only Polymarket data for the `prediction_market` rich artifact.
// Keyless: Gamma API (gamma-api.polymarket.com). No trading here — that would
// route through the credential vault + approval gate as a separate concern.

const GAMMA = 'https://gamma-api.polymarket.com';

interface PolymarketArgs {
  query?: string;
  slug?: string;
  limit?: number;
}

interface PolymarketResult {
  success: boolean;
  stdout?: string;
  error?: string;
  data?: any;
  extra?: { richArtifacts: any[] };
}

async function jsonFetch(url: string): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function parseJsonArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function yesPrice(m: any): number | undefined {
  const labels = parseJsonArray(m?.outcomes).map((x) => String(x).toLowerCase());
  const prices = parseJsonArray(m?.outcomePrices).map((x) => Number(x));
  const yesIdx = labels.findIndex((l) => l === 'yes');
  const idx = yesIdx >= 0 ? yesIdx : 0;
  return Number.isFinite(prices[idx]) ? prices[idx] : undefined;
}

// Build a card item from a Polymarket EVENT. Binary events show their Yes/No
// outcomes; multi-candidate events show each sub-market's Yes price as a
// candidate row. The URL always uses the EVENT slug so it never 404s.
function eventToItem(ev: any): any | null {
  if (!ev || typeof ev !== 'object') return null;
  const evSlug = String(ev.slug || '').trim();
  const markets = (Array.isArray(ev.markets) ? ev.markets : []).filter((m: any) => m && m.active !== false && m.closed !== true);
  if (!markets.length) return null;
  const title = String(ev.title || markets[0]?.question || '').trim();
  if (!title) return null;

  let outcomes: Array<{ label: string; price?: number }>;
  if (markets.length === 1) {
    const m = markets[0];
    const labels = parseJsonArray(m.outcomes).map((x: any) => String(x));
    const prices = parseJsonArray(m.outcomePrices).map((x: any) => Number(x));
    outcomes = labels.map((label, i) => ({ label, price: Number.isFinite(prices[i]) ? prices[i] : undefined })).filter((o) => o.label);
  } else {
    outcomes = markets
      .map((m: any) => ({ label: String(m.groupItemTitle || m.question || '').trim(), price: yesPrice(m) }))
      .filter((o: any) => o.label && Number.isFinite(o.price))
      .sort((a: any, b: any) => (b.price || 0) - (a.price || 0))
      .slice(0, 6);
  }
  if (!outcomes.length) return null;

  return {
    question: title,
    slug: evSlug,
    url: evSlug ? `https://polymarket.com/event/${evSlug}` : undefined,
    icon: ev.icon || ev.image || markets[0]?.icon || undefined,
    volume: Number(ev.volume) || undefined,
    endDate: ev.endDate || markets[0]?.endDate || undefined,
    outcomes,
  };
}

export async function executePolymarketLookup(args: PolymarketArgs): Promise<PolymarketResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 12);
  const query = String(args.query || '').trim();
  const slug = String(args.slug || '').trim();
  const items: any[] = [];

  try {
    let events: any[] = [];
    if (slug) {
      events = await jsonFetch(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
      if (!Array.isArray(events) || !events.length) {
        // Fall back: treat slug as a market slug, resolve its event.
        const arr = await jsonFetch(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`);
        const m = Array.isArray(arr) ? arr[0] : null;
        if (m) events = [{ slug, title: m.question, icon: m.icon, volume: m.volume, endDate: m.endDate, markets: [m] }];
      }
    } else if (query) {
      const search = await jsonFetch(`${GAMMA}/public-search?q=${encodeURIComponent(query)}`);
      events = Array.isArray(search?.events) ? search.events : [];
    } else {
      events = await jsonFetch(`${GAMMA}/events?active=true&closed=false&order=volume&ascending=false&limit=${limit}`);
    }
    for (const ev of (Array.isArray(events) ? events : [])) {
      const item = eventToItem(ev);
      if (item) items.push(item);
      if (items.length >= limit) break;
    }
  } catch (err: any) {
    return { success: false, error: `Polymarket request failed: ${err?.message || err}` };
  }

  if (!items.length) {
    return { success: false, error: query ? `No Polymarket markets found for "${query}".` : 'No Polymarket markets found.' };
  }
  const trimmed = items.slice(0, limit);

  const artifact = {
    id: `prediction_market-${Date.now()}`,
    type: 'prediction_market' as const,
    title: query ? `Polymarket — ${query}` : (slug ? trimmed[0].question : 'Polymarket — trending'),
    source: 'Polymarket',
    items: trimmed,
  };

  const stdout = trimmed.map((it) => {
    const top = it.outcomes.slice().sort((a: any, b: any) => (b.price || 0) - (a.price || 0))[0];
    return `${it.question} — ${top ? `${top.label} ${(top.price != null ? (top.price * 100).toFixed(0) + '%' : '?')}` : ''}`;
  }).join('\n');

  return {
    success: true,
    stdout: `Polymarket markets:\n${stdout}`,
    data: { query: query || null, slug: slug || null, items: trimmed },
    extra: { richArtifacts: [artifact] },
  };
}
