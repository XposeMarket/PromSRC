// src/tools/ui-cards.ts
// Gateway builders for the live-data show_ui_card types. Every source is
// keyless or already configured (Brave for images/news/videos), every fetch is
// bounded, and identical lookups inside a short TTL are served from memory so
// re-asking or voice + chat both rendering the same card stays instant.

const UA = 'Prometheus/1.0 (ui-cards)';
const DEFAULT_TIMEOUT_MS = 6000;

export interface CardResult {
  success: boolean;
  stdout?: string;
  error?: string;
  data?: any;
  extra?: { richArtifacts: any[] };
}

// ── tiny TTL cache + bounded fetch ──────────────────────────────────────────
const cache = new Map<string, { at: number; value: any }>();
const CACHE_MAX = 200;

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return value;
}

export function __clearUiCardCache(): void { cache.clear(); }

async function getJson(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': UA, ...(init.headers as any || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} HTTP ${res.status}`);
  return res.json();
}

const id = (type: string) => `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const ok = (stdout: string, artifact: any, data?: any): CardResult => ({ success: true, stdout, data, extra: { richArtifacts: [artifact] } });
const fail = (error: string): CardResult => ({ success: false, error });
const str = (v: unknown) => (v == null ? '' : String(v).trim());

// ── currency (Frankfurter / ECB) ───────────────────────────────────────────
const CURRENCY_ALIASES: Record<string, string> = {
  DOLLAR: 'USD', DOLLARS: 'USD', '$': 'USD', EURO: 'EUR', EUROS: 'EUR', '€': 'EUR', POUND: 'GBP', POUNDS: 'GBP', '£': 'GBP',
  YEN: 'JPY', '¥': 'JPY', YUAN: 'CNY', RMB: 'CNY', RUPEE: 'INR', RUPEES: 'INR', PESO: 'MXN', PESOS: 'MXN', FRANC: 'CHF', WON: 'KRW',
};

export function normalizeCurrencyCode(value: unknown): string {
  const raw = str(value).toUpperCase();
  return CURRENCY_ALIASES[raw] || raw.replace(/[^A-Z]/g, '').slice(0, 3);
}

export async function buildCurrencyCard(args: any): Promise<CardResult> {
  const from = normalizeCurrencyCode(args?.from ?? args?.base ?? 'USD') || 'USD';
  const to = normalizeCurrencyCode(args?.to ?? args?.target ?? (from === 'EUR' ? 'USD' : 'EUR'));
  const amount = Number(args?.amount ?? 1) || 1;
  try {
    const [latest, names] = await Promise.all([
      cached(`fx:${from}`, 30 * 60_000, () => getJson(`https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}`)),
      cached('fx:names', 24 * 3600_000, () => getJson('https://api.frankfurter.app/currencies')).catch(() => ({})),
    ]);
    const rates = { ...(latest?.rates || {}) };
    if (!Object.keys(rates).length) return fail(`No exchange rates available for ${from}.`);
    const finalTo = rates[to] ? to : Object.keys(rates)[0];
    const converted = amount * Number(rates[finalTo]);
    const artifact = { id: id('currency'), type: 'currency', base: from, from, to: finalTo, amount, date: latest?.date, rates, names, source: 'European Central Bank via Frankfurter' };
    return ok(`${amount} ${from} = ${converted.toFixed(converted < 1 ? 4 : 2)} ${finalTo} (rate ${Number(rates[finalTo]).toFixed(4)}, ${latest?.date || 'latest'}). Live converter card shown.`, artifact);
  } catch (error: any) {
    return fail(`Currency rates unavailable: ${error?.message || error}`);
  }
}

// ── clock (Open-Meteo geocoder for city -> IANA zone) ──────────────────────
function isIanaZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return /\//.test(value) || value === 'UTC'; } catch { return false; }
}

export async function buildClockCard(args: any): Promise<CardResult> {
  const raw = Array.isArray(args?.locations) ? args.locations : Array.isArray(args?.zones) ? args.zones : [args?.location ?? args?.city ?? args?.timezone].filter(Boolean);
  const list = raw.map((x: any) => str(typeof x === 'string' ? x : x?.label || x?.timeZone || x?.city)).filter(Boolean).slice(0, 8);
  if (!list.length) return fail('clock needs locations: ["Tokyo","London"] or IANA zones.');
  const zones = await Promise.all(list.map(async (label: string) => {
    if (isIanaZone(label)) return { label: label.split('/').pop()!.replace(/_/g, ' '), timeZone: label };
    try {
      const geo = await cached(`geo:${label.toLowerCase()}`, 24 * 3600_000, () => getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(label)}&count=1`, {}, 4000));
      const hit = geo?.results?.[0];
      return hit?.timezone ? { label: [hit.name, hit.country_code].filter(Boolean).join(', '), timeZone: hit.timezone } : null;
    } catch { return null; }
  }));
  const resolved = zones.filter(Boolean) as Array<{ label: string; timeZone: string }>;
  if (!resolved.length) return fail(`Could not resolve a time zone for: ${list.join(', ')}.`);
  const now = new Date();
  const text = resolved.map((z) => `${z.label}: ${now.toLocaleTimeString('en-US', { timeZone: z.timeZone, hour: 'numeric', minute: '2-digit' })}`).join('; ');
  return ok(`${text}. Live clock card shown.`, { id: id('clock'), type: 'clock', title: str(args?.title), zones: resolved });
}

// ── Brave media (images / news / videos) ───────────────────────────────────
type BraveKind = 'images' | 'news' | 'videos';
async function braveSearch(kind: BraveKind, query: string, count: number): Promise<any[]> {
  const { getConfig } = require('../config/config') as typeof import('../config/config');
  const cfg = getConfig();
  const key = cfg.resolveSecret((cfg.getConfig() as any)?.search?.brave_api_key);
  if (!key) throw new Error('Brave Search API key is not configured (Settings > Search).');
  const extra = kind === 'images' ? '&safesearch=strict' : '';
  const data = await cached(`brave:${kind}:${count}:${query.toLowerCase()}`, 10 * 60_000, () => getJson(
    `https://api.search.brave.com/res/v1/${kind}/search?q=${encodeURIComponent(query)}&count=${count}${extra}`,
    { headers: { 'X-Subscription-Token': key } as any },
  ));
  return Array.isArray(data?.results) ? data.results : [];
}

function itemsFromArgs(args: any): any[] | null {
  return Array.isArray(args?.items) && args.items.length ? args.items : null;
}

export async function buildGalleryCard(args: any): Promise<CardResult> {
  const query = str(args?.query);
  let items = itemsFromArgs(args)?.map((g: any) => ({ url: str(g.url || g.src || g.imageUrl), thumbnail: str(g.thumbnail || g.thumb || g.url || g.imageUrl), title: str(g.title || g.alt), pageUrl: str(g.pageUrl || g.source) }));
  try {
    if (!items) {
      if (!query) return fail('gallery needs query or items[].');
      const rows = await braveSearch('images', query, Math.min(20, Number(args?.limit) || 12));
      items = rows.map((r: any) => ({ url: str(r.properties?.url || r.thumbnail?.src), thumbnail: str(r.thumbnail?.src), title: str(r.title), pageUrl: str(r.url), source: str(r.source || r.meta_url?.hostname) }));
    }
    items = items.filter((g) => /^https?:\/\//.test(g.thumbnail || g.url));
    if (!items.length) return fail(`No images found for "${query}".`);
    return ok(`Image gallery shown: ${items.length} images for "${query || args?.title || 'images'}".`, { id: id('gallery'), type: 'gallery', title: str(args?.title) || query, items });
  } catch (error: any) { return fail(`Image search failed: ${error?.message || error}`); }
}

export async function buildNewsCard(args: any): Promise<CardResult> {
  const query = str(args?.query);
  let items = itemsFromArgs(args)?.map((n: any) => ({ url: str(n.url), title: str(n.title), snippet: str(n.snippet || n.description), imageUrl: str(n.imageUrl || n.image), publisher: str(n.publisher || n.source), age: str(n.age || n.publishedAt) }));
  try {
    if (!items) {
      if (!query) return fail('news needs query or items[].');
      const rows = await braveSearch('news', query, Math.min(12, Number(args?.limit) || 8));
      items = rows.map((r: any) => ({ url: str(r.url), title: str(r.title), snippet: str(r.description).replace(/<[^>]+>/g, ''), imageUrl: str(r.thumbnail?.src), publisher: str(r.meta_url?.hostname).replace(/^www\./, ''), age: str(r.age) }));
    }
    items = items.filter((n) => /^https?:\/\//.test(n.url));
    if (!items.length) return fail(`No news found for "${query}".`);
    const lines = items.slice(0, 5).map((n, i) => `${i + 1}. ${n.title} (${n.publisher}${n.age ? `, ${n.age}` : ''}) ${n.url}`).join('\n');
    return ok(`News carousel shown:\n${lines}`, { id: id('news'), type: 'news', title: str(args?.title) || query, items });
  } catch (error: any) { return fail(`News search failed: ${error?.message || error}`); }
}

export async function buildVideoCard(args: any): Promise<CardResult> {
  const query = str(args?.query);
  const direct = str(args?.url);
  let items = itemsFromArgs(args)?.map((v: any) => ({ url: str(v.url), title: str(v.title), thumbnail: str(v.thumbnail), creator: str(v.creator || v.channel), duration: str(v.duration) }))
    || (direct ? [{ url: direct, title: str(args?.title), thumbnail: '', creator: '', duration: '' }] : null);
  try {
    if (!items) {
      if (!query) return fail('video needs query, url, or items[].');
      const rows = await braveSearch('videos', query, Math.min(8, Number(args?.limit) || 5));
      items = rows.map((r: any) => ({ url: str(r.url), title: str(r.title), thumbnail: str(r.thumbnail?.src), creator: str(r.video?.creator || r.meta_url?.hostname), duration: str(r.video?.duration), age: str(r.age) }));
    }
    items = items.filter((v) => /^https?:\/\//.test(v.url));
    if (!items.length) return fail(`No videos found for "${query}".`);
    const lines = items.slice(0, 4).map((v, i) => `${i + 1}. ${v.title || v.url} ${v.url}`).join('\n');
    return ok(`Video card shown (YouTube plays inline):\n${lines}`, { id: id('video'), type: 'video', title: str(args?.title), items });
  } catch (error: any) { return fail(`Video search failed: ${error?.message || error}`); }
}

// ── sports (ESPN public site API, no key) ──────────────────────────────────
const LEAGUES: Record<string, [string, string]> = {
  nba: ['basketball', 'nba'], wnba: ['basketball', 'wnba'], ncaab: ['basketball', 'mens-college-basketball'], 'college-basketball': ['basketball', 'mens-college-basketball'],
  nfl: ['football', 'nfl'], ncaaf: ['football', 'college-football'], 'college-football': ['football', 'college-football'],
  mlb: ['baseball', 'mlb'], nhl: ['hockey', 'nhl'], mls: ['soccer', 'usa.1'], epl: ['soccer', 'eng.1'], 'premier-league': ['soccer', 'eng.1'],
  laliga: ['soccer', 'esp.1'], 'la-liga': ['soccer', 'esp.1'], seriea: ['soccer', 'ita.1'], bundesliga: ['soccer', 'ger.1'], ligue1: ['soccer', 'fra.1'], ucl: ['soccer', 'uefa.champions'],
};

export function resolveLeague(value: unknown): { sport: string; league: string; label: string } | null {
  const key = str(value).toLowerCase().replace(/\s+/g, '-');
  const hit = LEAGUES[key] || LEAGUES[key.replace(/-/g, '')];
  return hit ? { sport: hit[0], league: hit[1], label: key.toUpperCase() } : null;
}

const site = (sport: string, league: string, rest: string) => `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/${rest}`;

export function mapEspnEvent(e: any, sport = ''): any {
  const comp = e?.competitions?.[0] || {};
  const team = (side: string) => {
    const c = (comp.competitors || []).find((x: any) => x.homeAway === side) || {};
    return { name: str(c.team?.shortDisplayName || c.team?.displayName), abbr: str(c.team?.abbreviation), logo: str(c.team?.logo), score: c.score ?? '', record: str(c.records?.[0]?.summary), linescores: (c.linescores || []).map((l: any) => l.value ?? l.displayValue) };
  };
  return {
    id: str(e?.id), name: str(e?.name), date: str(e?.date), state: str(e?.status?.type?.state) || 'pre',
    statusText: str(e?.status?.type?.shortDetail || e?.status?.type?.detail),
    venue: [comp.venue?.fullName, comp.venue?.address?.city].filter(Boolean).join(' • '),
    away: team('away'), home: team('home'), periodLabel: sport === 'baseball' ? 'inning' : 'quarter',
    link: str((e?.links || []).find((l: any) => (l.rel || []).includes('summary'))?.href || e?.links?.[0]?.href),
  };
}

async function buildScores(args: any, lg: { sport: string; league: string; label: string }): Promise<CardResult> {
  const date = str(args?.date).replace(/-/g, '');
  const sb = await cached(`espn:sb:${lg.league}:${date}`, 30_000, () => getJson(site(lg.sport, lg.league, `scoreboard${/^\d{8}$/.test(date) ? `?dates=${date}` : ''}`)));
  let games = (sb?.events || []).map((e: any) => mapEspnEvent(e, lg.sport));
  const team = str(args?.team || args?.query).toLowerCase();
  if (team) {
    const words = team.split(/\s+(?:vs\.?|v\.?|at|and|@)\s+|,\s*/).filter(Boolean);
    const matching = games.filter((g: any) => words.some((w) => [g.name, g.home.name, g.away.name, g.home.abbr, g.away.abbr].join(' ').toLowerCase().includes(w)));
    if (matching.length) games = matching;
  }
  if (!games.length) return fail(`No ${lg.label} games on the board${date ? ` for ${date}` : ' today'}.`);
  const text = games.slice(0, 6).map((g: any) => `${g.away.abbr} ${g.away.score} @ ${g.home.abbr} ${g.home.score} (${g.statusText})`).join('; ');
  return ok(`${lg.label}: ${text}. Scoreboard card shown.`, { id: id('sports_game'), type: 'sports_game', league: lg.label, title: str(args?.title), games: games.slice(0, 12) });
}

const STANDING_COLS: Record<string, string[]> = {
  basketball: ['W', 'L', 'PCT', 'GB', 'L10', 'STRK'], football: ['W', 'L', 'T', 'PCT', 'PF', 'PA', 'STRK'],
  baseball: ['W', 'L', 'PCT', 'GB', 'L10', 'STRK'], hockey: ['GP', 'W', 'L', 'OTL', 'PTS', 'STRK'], soccer: ['GP', 'W', 'D', 'L', 'GD', 'P'],
};
const STAT_ALIASES: Record<string, string[]> = { L10: ['L10', 'Last Ten', 'LAST TEN'], STRK: ['STRK', 'streak'], D: ['D', 'T', 'ties'], P: ['P', 'PTS', 'points'], GD: ['GD', 'DIFF', 'pointDifferential'], OTL: ['OTL', 'OT'] };

function statValue(stats: any[], col: string): string {
  const names = STAT_ALIASES[col] || [col];
  const hit = stats.find((s: any) => names.includes(s.abbreviation) || names.includes(s.name) || names.includes(s.shortDisplayName) || names.includes(s.displayName));
  return str(hit?.displayValue ?? hit?.value);
}

async function buildStandings(args: any, lg: { sport: string; league: string; label: string }): Promise<CardResult> {
  const data = await cached(`espn:st:${lg.league}`, 10 * 60_000, () => getJson(`https://site.api.espn.com/apis/v2/sports/${lg.sport}/${lg.league}/standings`));
  const columns = STANDING_COLS[lg.sport] || STANDING_COLS.basketball;
  const groupsRaw = data?.children?.length ? data.children : [data];
  const groups = groupsRaw.map((g: any) => ({
    name: str(g?.name || g?.abbreviation || lg.label),
    rows: (g?.standings?.entries || []).map((en: any) => ({
      team: str(en.team?.displayName), logo: str(en.team?.logos?.[0]?.href), seed: statValue(en.stats || [], 'SEED') || statValue(en.stats || [], 'rank'),
      stats: Object.fromEntries(columns.map((c) => [c, statValue(en.stats || [], c)])),
    })).sort((a: any, b: any) => (Number(a.seed) || 99) - (Number(b.seed) || 99)),
  })).filter((g: any) => g.rows.length);
  if (!groups.length) return fail(`${lg.label} standings unavailable.`);
  const top = groups.map((g: any) => `${g.name}: ${g.rows.slice(0, 3).map((r: any) => `${r.team} ${r.stats.W ?? ''}-${r.stats.L ?? ''}`).join(', ')}`).join(' | ');
  return ok(`${lg.label} standings shown. Leaders: ${top}`, { id: id('sports_standings'), type: 'sports_standings', league: lg.label, title: str(args?.title), columns, groups });
}

async function buildPlayer(args: any): Promise<CardResult> {
  const name = str(args?.player || args?.query);
  if (!name) return fail('sports player view needs player.');
  const search = await cached(`espn:search:${name.toLowerCase()}`, 24 * 3600_000, () => getJson(`https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=5`));
  const players = (search?.results || []).find((r: any) => r.type === 'player')?.contents || [];
  const pick = players[0];
  const m = String(pick?.uid || '').match(/a:(\d+)/);
  const lg = resolveLeague(pick?.defaultLeagueSlug) || (pick?.sport && pick?.defaultLeagueSlug ? { sport: pick.sport, league: pick.defaultLeagueSlug, label: String(pick.defaultLeagueSlug).toUpperCase() } : null);
  if (!m || !lg) return fail(`No player found for "${name}".`);
  const data = await cached(`espn:ath:${m[1]}`, 60 * 60_000, () => getJson(`https://site.web.api.espn.com/apis/common/v3/sports/${lg.sport}/${lg.league}/athletes/${m[1]}`));
  const a = data?.athlete || {};
  const stats = (a.statsSummary?.statistics || []).map((s: any) => ({ label: str(s.abbreviation || s.shortDisplayName), value: str(s.displayValue), rank: str(s.rankDisplayValue) }));
  const player = {
    name: str(a.displayName || pick.displayName), team: str(a.team?.displayName || pick.subtitle), teamLogo: str(a.team?.logos?.[0]?.href), jersey: str(a.jersey), position: str(a.position?.abbreviation),
    headshot: str(a.headshot?.href || pick.image?.default), statsLabel: str(a.statsSummary?.displayName), stats,
    bio: [a.displayHeight, a.displayWeight, a.age ? `Age ${a.age}` : ''].filter(Boolean).join(' • '), link: str(pick.link?.web),
  };
  return ok(`${player.name} (${player.team}${player.position ? `, ${player.position}` : ''}): ${stats.map((s: any) => `${s.label} ${s.value}`).join(', ')}. Player card shown.`, { id: id('sports_player'), type: 'sports_player', player });
}

export async function buildSportsCard(args: any): Promise<CardResult> {
  const view = str(args?.view || (args?.player ? 'player' : 'scores')).toLowerCase();
  try {
    if (view === 'player') return await buildPlayer(args);
    const lg = resolveLeague(args?.league);
    if (!lg) return fail(`sports needs league (one of: ${Object.keys(LEAGUES).join(', ')}).`);
    return view === 'standings' ? await buildStandings(args, lg) : await buildScores(args, lg);
  } catch (error: any) {
    return fail(`Sports data unavailable: ${error?.message || error}`);
  }
}

// ── places (model-supplied places + OSM geocoding, or Overpass discovery) ──
async function geocodeOnce(q: string): Promise<{ lat: number; lng: number } | null> {
  return cached(`nom:${q.toLowerCase()}`, 7 * 24 * 3600_000, async () => {
    try {
      const arr = await getJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`, {}, 4000);
      const hit = Array.isArray(arr) ? arr[0] : null;
      return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
    } catch { return null; }
  });
}

const OSM_AMENITY: Record<string, string> = {
  restaurant: 'amenity~"restaurant|fast_food"', restaurants: 'amenity~"restaurant|fast_food"', food: 'amenity~"restaurant|fast_food|cafe"',
  cafe: 'amenity="cafe"', coffee: 'amenity="cafe"', bar: 'amenity~"bar|pub"', bars: 'amenity~"bar|pub"', pizza: 'cuisine~"pizza"',
  hotel: 'tourism~"hotel|motel|guest_house"', hotels: 'tourism~"hotel|motel|guest_house"', gym: 'leisure="fitness_centre"', park: 'leisure="park"',
  pharmacy: 'amenity="pharmacy"', gas: 'amenity="fuel"', museum: 'tourism="museum"', grocery: 'shop~"supermarket|grocery"',
};

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function osmPlace(t: any, lat: any, lng: any, fallbackAddr = ''): any {
  const addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', ') || fallbackAddr;
  return { name: t.name, category: str(t.cuisine || t.amenity || t.tourism || t.shop || t.leisure).replace(/_/g, ' ').replace(/;/g, ', '), address: addr, phone: t.phone || t['contact:phone'], website: t.website || t['contact:website'], hours: t.opening_hours, lat: Number(lat), lng: Number(lng) };
}

// Fast path (~200 ms): Nominatim free-text search bounded to a box around `near`.
async function nominatimPlaces(query: string, center: { lat: number; lng: number }, limit: number): Promise<any[]> {
  const d = 0.08;
  const box = [center.lng - d, center.lat + d, center.lng + d, center.lat - d].join(',');
  const rows = await cached(`nomp:${query.toLowerCase()}:${box}`, 30 * 60_000, () => getJson(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&viewbox=${box}&bounded=1&format=jsonv2&extratags=1&addressdetails=1&limit=${Math.min(20, limit * 2)}`, {}, 5000));
  return (Array.isArray(rows) ? rows : []).map((r: any) => {
    const a = r.address || {};
    const street = [[a.house_number, a.road].filter(Boolean).join(' '), a.city || a.town || a.village].filter(Boolean).join(', ');
    return osmPlace({ ...(r.extratags || {}), name: r.name, amenity: r.type }, r.lat, r.lon, street);
  }).filter((p: any) => p.name);
}

async function discoverPlaces(query: string, near: string, limit: number): Promise<any[]> {
  const center = await geocodeOnce(near);
  if (!center) return [];
  const word = query.toLowerCase().split(/\s+/).find((w) => OSM_AMENITY[w]);
  // Nominatim special phrases understand OSM nouns ("cafe", "restaurant"), not "coffee".
  const phrase = NOMINATIM_PHRASE[word || ''] || query;
  const fastPromise = nominatimPlaces(phrase, center, limit).catch(() => [] as any[]);
  // Start Overpass in parallel so a thin Nominatim answer does not cost a second round trip.
  const slowPromise = overpassPlaces(query, word, center, limit);
  const fast = await fastPromise;
  if (fast.length >= Math.min(3, limit)) {
    slowPromise.catch(() => {});
    return fast.sort((a: any, b: any) => Number(!!b.website) + Number(!!b.hours) - Number(!!a.website) - Number(!!a.hours)).slice(0, limit);
  }
  const slow = await slowPromise.catch(() => [] as any[]);
  const seen = new Set(fast.map((p: any) => p.name.toLowerCase()));
  return [...fast, ...slow.filter((p: any) => !seen.has(p.name.toLowerCase()))]
    .sort((a: any, b: any) => Number(!!b.website) + Number(!!b.hours) - Number(!!a.website) - Number(!!a.hours))
    .slice(0, limit);
}

const NOMINATIM_PHRASE: Record<string, string> = {
  coffee: 'cafe', cafe: 'cafe', restaurant: 'restaurant', restaurants: 'restaurant', food: 'restaurant', bar: 'bar', bars: 'bar',
  hotel: 'hotel', hotels: 'hotel', gym: 'fitness centre', park: 'park', pharmacy: 'pharmacy', gas: 'fuel', museum: 'museum', grocery: 'supermarket', pizza: 'pizza',
};

async function overpassPlaces(query: string, word: string | undefined, center: { lat: number; lng: number }, limit: number): Promise<any[]> {
  const filter = word ? OSM_AMENITY[word] : `name~"${query.replace(/["\\]/g, '')}",i`;
  const q = `[out:json][timeout:8];nwr[${filter}]["name"](around:5000,${center.lat},${center.lng});out center tags ${limit * 2};`;
  // Overpass: richer category matching, slower and rate-limited per IP.
  const data = await cached(`ovp:${q}`, 30 * 60_000, () => getJson(OVERPASS_URL, {
    method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } as any,
  }, 9000));
  return (data?.elements || []).map((e: any) => osmPlace(e.tags || {}, e.lat ?? e.center?.lat, e.lon ?? e.center?.lon)).filter((p: any) => p.name);
}

export async function buildPlacesCard(args: any): Promise<CardResult> {
  const limit = Math.max(1, Math.min(12, Number(args?.limit) || 6));
  let places: any[] = (Array.isArray(args?.places) ? args.places : Array.isArray(args?.items) ? args.items : []).slice(0, 12).map((p: any) => ({
    name: str(p?.name || p?.label || p?.title), address: str(p?.address), category: str(p?.category || p?.cuisine), rating: Number(p?.rating) || undefined,
    reviews: Number(p?.reviews ?? p?.reviewCount) || undefined, price: str(p?.price || p?.priceLevel), phone: str(p?.phone), website: str(p?.website || p?.url),
    hours: str(p?.hours), openNow: typeof p?.openNow === 'boolean' ? p.openNow : undefined, imageUrl: str(p?.imageUrl || p?.photo), reserveUrl: str(p?.reserveUrl),
    lat: Number.isFinite(Number(p?.lat)) ? Number(p.lat) : undefined, lng: Number.isFinite(Number(p?.lng ?? p?.lon)) ? Number(p.lng ?? p.lon) : undefined,
  })).filter((p: any) => p.name);
  try {
    if (!places.length) {
      const query = str(args?.query); const near = str(args?.near || args?.location);
      if (!query || !near) return fail('places needs places[] or query + near ("pizza", "Frederick, MD").');
      places = await discoverPlaces(query, near, limit);
      if (!places.length) return fail(`No "${query}" places found near ${near}.`);
    }
    // Nominatim allows ~1 req/s: geocode only what is missing, sequentially, cached for a week.
    for (const p of places) {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) continue;
      const near = str(args?.near || args?.location);
      const g = await geocodeOnce([p.name, p.address || near].filter(Boolean).join(', '));
      if (g) { p.lat = g.lat; p.lng = g.lng; }
    }
    const located = places.filter((p) => Number.isFinite(p.lat));
    const center = located.length ? { lat: located.reduce((s, p) => s + p.lat, 0) / located.length, lng: located.reduce((s, p) => s + p.lng, 0) / located.length } : undefined;
    const text = places.map((p, i) => `${i + 1}. ${p.name}${p.address ? ` (${p.address})` : ''}${p.hours ? ` hours ${p.hours}` : ''}`).join('\n');
    return ok(`Places card shown:\n${text}`, { id: id('places'), type: 'places', title: str(args?.title) || str(args?.query), center, zoom: Number(args?.zoom) || undefined, places });
  } catch (error: any) { return fail(`Places lookup failed: ${error?.message || error}`); }
}

// ── single / hero product ──────────────────────────────────────────────────
export async function buildProductCard(
  args: any,
  enrich?: (items: any[]) => Promise<any[]>,
  search?: (query: string) => Promise<any[]>,
): Promise<CardResult> {
  let raw = args?.item || args?.product || (Array.isArray(args?.items) ? args.items[0] : null) || args;
  // A bare query (no title/url) runs the shopping search and shows the best hit.
  const query = str(args?.query);
  if (query && search && !str(raw?.title || raw?.name) && !str(raw?.productUrl || raw?.url)) {
    const found = await search(query).catch(() => [] as any[]);
    const best = (found || []).find((p: any) => p?.price && (p?.imageUrl || p?.imagePath)) || (found || [])[0];
    if (!best) return fail(`No product found for "${query}".`);
    raw = { ...best, imageUrl: best.imageUrl || best.image };
  }
  let item: any = {
    title: str(raw?.title || raw?.name), productUrl: str(raw?.productUrl || raw?.url), price: str(raw?.price), merchant: str(raw?.merchant || raw?.store),
    imageUrl: str(raw?.imageUrl || raw?.image), rating: Number(raw?.rating) || undefined, reviewCount: Number(raw?.reviewCount ?? raw?.reviews) || undefined,
    description: str(raw?.description), pros: Array.isArray(raw?.pros) ? raw.pros.map(str).filter(Boolean) : undefined,
    offers: Array.isArray(raw?.offers) ? raw.offers.map((o: any) => ({ merchant: str(o?.merchant), price: str(o?.price), url: str(o?.url) })) : undefined,
  };
  if (!item.title && !item.productUrl) return fail('product needs item {title, productUrl, price?, imageUrl?}.');
  if (enrich && item.productUrl && (!item.imageUrl || !item.price)) {
    try {
      const [enriched] = await Promise.race([enrich([item]), new Promise<any[]>((resolve) => setTimeout(() => resolve([item]), 4000))]);
      item = { ...item, ...Object.fromEntries(Object.entries(enriched || {}).filter(([k, v]) => v != null && v !== '' && !(k in item && item[k]))) };
    } catch {}
  }
  const variant = str(args?.variant) === 'hero' || args?.hero === true ? 'hero' : 'single';
  return ok(`${variant === 'hero' ? 'Top pick' : 'Product'} card shown: ${item.title}${item.price ? ` ${item.price}` : ''}${item.merchant ? ` at ${item.merchant}` : ''}.`, { id: id('product'), type: 'product', variant, badge: str(args?.badge) || undefined, item });
}

export const UI_CARD_BUILDERS: Record<string, (args: any) => Promise<CardResult>> = {
  currency: buildCurrencyCard,
  clock: buildClockCard,
  gallery: buildGalleryCard,
  images: buildGalleryCard,
  news: buildNewsCard,
  video: buildVideoCard,
  videos: buildVideoCard,
  sports: buildSportsCard,
  places: buildPlacesCard,
};
