// End-of-turn source pills: every page the agent successfully fetched this turn
// (web_fetch single/batch, including X posts) becomes a compact `sources`
// artifact with layout "pills", rendered under the reply on desktop + mobile.
// Built only from tool args/results, so it works for every model/provider.
import type { SourceItem, SourcesArtifact } from './rich-artifacts';

const FETCH_TOOLS = new Set(['web_fetch', 'web_fetch_batch']);
const MAX_PILLS = 12;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function asObj(v: unknown): any {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return {};
}

function tweetTitle(data: any): string | undefined {
  const t = Array.isArray(data?.tweets) ? data.tweets[0] : null;
  if (!t?.text) return undefined;
  const text = String(t.text).replace(/\s+/g, ' ').trim();
  return `${t.handle || t.author || 'X'}: ${text.length > 90 ? `${text.slice(0, 87)}...` : text}`;
}

function itemFrom(url: string, data: any): SourceItem | null {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) return null;
  const host = hostOf(clean);
  if (!host) return null;
  const title = String(tweetTitle(data) || data?.title || data?.preview?.title || '').trim();
  return {
    url: String(data?.final_url || clean),
    title: title || host,
    publisher: String(data?.publisher || data?.preview?.publisher || host),
    ...(data?.published_at ? { publishedAt: String(data.published_at) } : {}),
  };
}

/** Failed rows in a batch result are printed as `[n] ERROR <url>`. */
function failedBatchUrls(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(/^\[\d+\] ERROR (\S+)/gm)) out.add(m[1]);
  return out;
}

export function collectFetchedSources(allToolResults: any[]): SourceItem[] {
  const items: SourceItem[] = [];
  const seen = new Set<string>();
  const push = (item: SourceItem | null) => {
    if (!item) return;
    const key = item.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const r of Array.isArray(allToolResults) ? allToolResults : []) {
    const name = String(r?.name || '');
    if (!FETCH_TOOLS.has(name)) continue;
    const args = asObj(r?.args);
    const data = r?.data || r?.extra?.data || {};
    const batchUrls: string[] = Array.isArray(args.urls) ? args.urls.map((u: any) => String(u || '').trim()).filter(Boolean) : [];
    if (batchUrls.length) {
      const failed = failedBatchUrls(String(r?.result || ''));
      const rows: any[] = Array.isArray(data?.results) ? data.results : [];
      for (const url of batchUrls) {
        const row = rows.find((x) => x?.url === url);
        if (row ? row.status !== 'ok' : failed.has(url)) continue;
        push(itemFrom(url, row?.data || {}));
      }
      continue;
    }
    if (r?.error) continue;
    push(itemFrom(String(args.url || ''), data));
  }
  return items.slice(0, MAX_PILLS);
}

export function buildTurnSourcesArtifact(allToolResults: any[], existing: Array<{ type?: string; items?: any[] }> = []): SourcesArtifact | null {
  const shown = new Set<string>();
  for (const a of existing) {
    if (a?.type !== 'sources') continue;
    for (const it of a.items || []) if (it?.url) shown.add(String(it.url));
  }
  const items = collectFetchedSources(allToolResults).filter((it) => !shown.has(it.url));
  if (!items.length) return null;
  return {
    id: `turn-sources-${Date.now().toString(36)}`,
    type: 'sources',
    layout: 'pills',
    title: 'Sources',
    items,
  };
}
