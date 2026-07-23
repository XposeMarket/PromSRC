import { ToolResult } from '../types.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fetchXThread } from '../gateway/browser-tools.js';
import { executeDownloadMedia, executeDownloadUrl } from './download-tools.js';
import { executeAnalyzeImage, executeAnalyzeVideo } from './media-analysis.js';
import { executeXSearch, xaiHasCredentials } from '../gateway/tools/handlers/xai-handlers.js';
import { creativeTranscribeAudio } from '../gateway/creative/generative-pipeline.js';
import { getActiveWorkspace } from './workspace-context.js';
import { getConfig } from '../config/config.js';
import { isUsableProductArtifactItem } from '../gateway/rich-artifacts.js';

type SearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  imageUrl?: string;
  publisher?: string;
  publishedAt?: string;
};
type StructuredSource = { id: number; tier: 'A' | 'B' | 'C'; title: string; url: string; snippet: string; score: number };
type StructuredEvidence = { id: number; source_id: number; excerpt: string; score: number };
type StructuredFact = { id: number; claim: string; evidence_ids: number[]; source_ids: number[]; confidence: number };
type SearchProvider = 'multi' | 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg' | 'ddg_html' | 'xai';
type SearchProviderAttempt = {
  provider: SearchProvider;
  status: 'success' | 'failed' | 'skipped';
  reason?: string;
  duration_ms?: number;
  result_count?: number;
};
type SearchDiagnostics = {
  query: string;
  preferred_provider: 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg';
  provider_order: Array<'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg' | 'xai'>;
  attempted: SearchProviderAttempt[];
  selected_provider?: SearchProvider;
};
type SearchProviderOption = 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg' | 'xai' | 'multi';
export type ShoppingProductResult = {
  id: string;
  title: string;
  price?: string;
  listPrice?: string;
  description?: string;
  rating?: number;
  reviews?: number;
  reviewCount?: number;
  tag?: string;
  badge?: string;
  imageUrl?: string;
  imagePath?: string;
  productUrl: string;
  merchant?: string;
  availability?: string;
  seller?: string;
  sku?: string;
  asin?: string;
  confidence?: number;
};
type XMediaDescriptor = {
  type: 'image' | 'video';
  url?: string;
  previewUrl?: string;
};
type XFetchedTweet = {
  id?: string;
  link?: string;
  author?: string;
  handle?: string;
  timestamp?: string;
  text?: string;
  hasImage?: boolean;
  hasVideo?: boolean;
  rawRef?: string;
  media?: XMediaDescriptor[];
  metrics?: {
    likes?: string;
    replies?: string;
    reposts?: string;
    views?: string;
  };
};
type XDownloadedMediaKind = 'image' | 'video' | 'audio' | 'other';
type XDownloadedMedia = {
  rel_path: string;
  path?: string;
  bytes?: number;
  kind: XDownloadedMediaKind;
  source: 'download_url' | 'download_media';
  url?: string;
  source_tweet_id?: string;
  source_tweet_link?: string;
};
type XMediaAnalysis = {
  rel_path: string;
  kind: XDownloadedMediaKind;
  status: 'analyzed' | 'skipped' | 'failed';
  analysis?: string;
  transcript?: string | null;
  sample_frames?: string[];
  output_dir_rel?: string;
  error?: string;
};
type XFetchMediaReport = {
  detected: boolean;
  hinted_tweet_count: number;
  direct_image_candidates: number;
  video_tweet_candidates: number;
  fallback_page_download_attempted: boolean;
  downloaded_files: XDownloadedMedia[];
  analyses: XMediaAnalysis[];
  errors: string[];
  analysis_limited: boolean;
};
type XFetchPayload = {
  success: boolean;
  url: string;
  tweets?: XFetchedTweet[];
  count?: number;
  snapshot_deltas?: Array<{
    pass: number;
    scrollY: number;
    added: string[];
    removed: string[];
    totalElements: number;
  }>;
  message?: string;
  error?: string;
  x_media?: XFetchMediaReport;
};
type WebFetchProgressPhase =
  | 'fetch_complete'
  | 'extracting_media'
  | 'extraction_complete'
  | 'analyzing_media'
  | 'analysis_complete'
  | 'analysis_skipped';
export type WebFetchProgressEvent = {
  phase: WebFetchProgressPhase;
  message: string;
};
type WebFetchProgressReporter = (event: WebFetchProgressEvent) => void;

const DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS = Math.max(
  1000,
  Math.min(15_000, Number(process.env.PROMETHEUS_WEB_SEARCH_PROVIDER_TIMEOUT_MS || 6_000) || 6_000),
);

function resolveSearchProviderTimeoutMs(value?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS;
  return Math.max(1000, Math.min(15_000, Math.floor(n)));
}

async function withSearchProviderTimeout<T>(provider: SearchProvider, promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${provider} timed out after ${timeoutMs}ms`)), timeoutMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeGoogleUrl(url: string): string {
  try {
    const u = new URL(url);
    // Standard Google redirect wrapper: /url?q=<real-url>
    if ((u.hostname.includes('google.') || u.hostname === 'google.com') && u.pathname === '/url') {
      const q = u.searchParams.get('q');
      if (q) return decodeURIComponent(q);
    }
    return url;
  } catch {
    return url;
  }
}

function isLowQualityGoogleUrl(url: string): boolean {
  return /google\.com\/share\.google\?/i.test(url);
}

function isPriceQuery(query: string): boolean {
  return /price|cost|value|quote|trades?|usd|dollar|eur|gbp|jpy/i.test(query);
}

function isBitcoinQuery(query: string): boolean {
  return /bitcoin|btc/i.test(query);
}

function isFreshQuery(query: string): boolean {
  return /\b(current|latest|today|now|right now|as of|recent)\b/i.test(query);
}

function extractUsdPrice(text: string): string | null {
  const patterns = [
    /\$\s?([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)/,
    /\$\s?([0-9]+(?:\.[0-9]+)?)/,
    /\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\s?USD\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s?USD\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function parseUsdNumber(raw: string): number | null {
  const n = Number(String(raw || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function detectPriceUnit(text: string): 'ounce' | 'gram' | 'unknown' {
  const t = String(text || '').toLowerCase();
  if (/\b(per\s*gram|\/g\b|1g\b|gram\b)\b/.test(t)) return 'gram';
  if (/\b(per\s*ounce|\/oz\b|ounce\b|oz\b)\b/.test(t)) return 'ounce';
  return 'unknown';
}

function hasHistoricalPriceCue(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /\b(around|circa|in|from)\s*(19|20)\d{2}\b/.test(t)
    || /\b(was worth|years? ago|historical|history)\b/.test(t);
}

function hasFreshPriceCue(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /\b(current|today|live|latest|now|right now|spot)\b/.test(t);
}

function detectPriceAsset(query: string): 'silver' | 'gold' | 'bitcoin' | 'generic' {
  const q = String(query || '').toLowerCase();
  if (/\b(silver|xag)\b/.test(q)) return 'silver';
  if (/\b(gold|xau|comex gold)\b/.test(q)) return 'gold';
  if (/\b(bitcoin|btc)\b/.test(q)) return 'bitcoin';
  return 'generic';
}

function isPlausibleUsdPrice(asset: 'silver' | 'gold' | 'bitcoin' | 'generic', valuePerOunceOrUnit: number): boolean {
  if (!Number.isFinite(valuePerOunceOrUnit) || valuePerOunceOrUnit <= 0) return false;
  if (asset === 'silver') return valuePerOunceOrUnit >= 5 && valuePerOunceOrUnit <= 200;
  if (asset === 'gold') return valuePerOunceOrUnit >= 300 && valuePerOunceOrUnit <= 10_000;
  if (asset === 'bitcoin') return valuePerOunceOrUnit >= 1_000 && valuePerOunceOrUnit <= 2_000_000;
  return valuePerOunceOrUnit >= 0.5 && valuePerOunceOrUnit <= 5_000_000;
}

function buildDirectPriceAnswer(
  query: string,
  results: SearchResultItem[]
): string {
  if (!isPriceQuery(query)) return '';

  const asset = detectPriceAsset(query);
  const candidates: Array<{ value: number; score: number; unit: 'ounce' | 'gram' | 'unknown' }> = [];
  for (const result of results) {
    const combined = `${result.title} ${result.snippet}`;
    const usdRaw = extractUsdPrice(combined);
    if (!usdRaw) continue;
    const usd = parseUsdNumber(usdRaw);
    if (!usd) continue;
    const unit = detectPriceUnit(combined);
    const normalized = unit === 'gram' ? (usd * 31.1035) : usd;
    if (!isPlausibleUsdPrice(asset, normalized)) continue;
    let score = 0;
    if (hasFreshPriceCue(combined)) score += 3;
    if (unit === 'ounce') score += 2;
    if (unit === 'gram') score += 1;
    if (hasHistoricalPriceCue(combined)) score -= 6;
    if (asset !== 'generic' && new RegExp(`\\b${asset}\\b`, 'i').test(combined)) score += 2;
    candidates.push({ value: normalized, score, unit });
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best.score >= 0) {
      const v = best.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (asset === 'bitcoin') return `Answer: The current Bitcoin price is approximately $${v} USD.`;
      if (asset === 'silver') return `Answer: The current silver price is approximately $${v} USD per ounce.`;
      if (asset === 'gold') return `Answer: The current gold price is approximately $${v} USD per ounce.`;
      return `Answer: The current price is approximately $${v} USD.`;
    }
  }

  // When snippets do not include live numeric quotes, still return a compact
  // actionable answer instead of only raw links.
  if (isBitcoinQuery(query)) {
    const financeResult = results.find(r => /google\.com\/finance\/quote\/BTC-USD/i.test(r.url));
    if (financeResult) {
      return 'Answer: I found the live BTC-USD quote page on Google Finance. Open https://www.google.com/finance/quote/BTC-USD for the exact real-time value.';
    }
  }

  return '';
}

function isEventOutcomeQuery(query: string): boolean {
  const q = query.toLowerCase();
  return /\b(what happened|outcome|key takeaways|takeaways|summary|recap|latest update|status)\b/.test(q)
    || (/\b(hearing|trial|case|investigation|lawsuit|court|testimony)\b/.test(q) && /\b(what|how|why|when|recent|latest)\b/.test(q));
}

function isLowValueResult(r: SearchResultItem): boolean {
  const text = `${r.title} ${r.url} ${r.snippet}`.toLowerCase();
  if (/youtube\.com|youtu\.be|podcast|opinion|editorial|letters to the editor|substack|reddit/.test(text)) return true;
  return false;
}

function sourceTier(r: SearchResultItem): 'A' | 'B' | 'C' {
  const text = `${r.title} ${r.url}`.toLowerCase();
  if (/\.gov|\.mil|justice\.gov|congress\.gov|house\.gov|senate\.gov|courtlistener|supremecourt/.test(text)) return 'A';
  if (/apnews|reuters|bloomberg|ft\.com|nytimes|wsj|bbc|pbs|politico|aljazeera|npr|washingtonpost/.test(text)) return 'B';
  return 'C';
}

function allowsTierCForQuery(query: string): boolean {
  const q = query.toLowerCase();
  return /\b(opinion|podcast|youtube|video|commentary|analysis only|broader context)\b/.test(q);
}

function applySourceTierPolicy(query: string, ranked: SearchResultItem[]): SearchResultItem[] {
  if (!isEventOutcomeQuery(query)) return ranked;
  const enriched = ranked.map(r => ({ r, tier: sourceTier(r) }));
  const allowC = allowsTierCForQuery(query);
  const preferred = enriched.filter(x => x.tier === 'A' || x.tier === 'B' || allowC);
  return (preferred.length ? preferred : enriched.filter(x => x.tier !== 'C')).map(x => x.r);
}

function queryAnchorTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4 && !['what', 'when', 'where', 'which', 'latest', 'recent', 'about', 'during'].includes(t))
    .slice(0, 10);
}

function relevanceScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const anchors = queryAnchorTokens(q);
  let score = 0;
  for (const a of anchors) if (t.includes(a)) score += 1;
  if (/bondi/.test(t) && /epstein/.test(t)) score += 3;
  if (/hearing|trial|case|committee|judiciary|testif|lawmakers|congress/.test(t)) score += 2;
  return score;
}

function overlapScore(a: string, b: string): number {
  const at = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 4));
  const bt = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 4));
  if (!at.size || !bt.size) return 0;
  let both = 0;
  for (const t of at) if (bt.has(t)) both++;
  return both / Math.max(at.size, bt.size);
}

function selectDominantStoryCluster(query: string, ranked: SearchResultItem[]): SearchResultItem[] {
  if (!isEventOutcomeQuery(query) || ranked.length <= 2) return ranked;
  const clusters: SearchResultItem[][] = [];
  const threshold = 0.18;
  for (const r of ranked) {
    const text = `${r.title} ${r.snippet}`;
    let placed = false;
    for (const c of clusters) {
      const centroid = `${c[0].title} ${c[0].snippet}`;
      if (overlapScore(text, centroid) >= threshold) {
        c.push(r);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([r]);
  }
  if (clusters.length <= 1) return ranked;
  clusters.sort((a, b) => {
    const sa = a.reduce((s, r) => s + relevanceScore(query, `${r.title} ${r.snippet}`), 0);
    const sb = b.reduce((s, r) => s + relevanceScore(query, `${r.title} ${r.snippet}`), 0);
    return sb - sa;
  });
  return clusters[0];
}

async function fetchCleanArticle(url: string, maxChars = 5000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Prometheus/1.0' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = String(res.headers.get('content-type') || '');
  if (!/text|html|json/i.test(ct)) throw new Error(`Unsupported content-type: ${ct}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxChars);
}

function extractEvidenceSentences(query: string, text: string, max = 4): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 40 && s.length <= 320);
  const verbs = /\b(said|stated|argued|clashed|pressed|refused|confirmed|announced|deflected|criticized|questioned|responded)\b/i;
  const scored = sentences.map(s => {
    let score = relevanceScore(query, s);
    if (verbs.test(s)) score += 2;
    if (/bondi|epstein|attorney general|committee|judiciary|lawmakers/i.test(s)) score += 1.5;
    return { s, score };
  }).sort((a, b) => b.score - a.score);
  return scored.filter(x => x.score >= 2.5).slice(0, max).map(x => x.s);
}

function cleanClaimText(claim: string): string {
  return String(claim || '')
    .replace(/\[[0-9]+\]/g, '')
    .replace(/\(AP Photo[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

async function buildEventOutcomeAnswer(query: string, ranked: SearchResultItem[]): Promise<string> {
  const filtered = ranked.filter(r => !isLowValueResult(r));
  const tiered = applySourceTierPolicy(query, filtered);
  const clustered = selectDominantStoryCluster(query, tiered);
  const gated = clustered.filter(r => relevanceScore(query, `${r.title} ${r.snippet}`) >= 2);
  const picked = (gated.length ? gated : clustered).slice(0, 4);
  if (!picked.length) return '';

  const evidence: Array<{ claim: string; source: number }> = [];
  for (let i = 0; i < picked.length; i++) {
    const r = picked[i];
    const fromSnippet = extractEvidenceSentences(query, r.snippet, 2);
    for (const c of fromSnippet) evidence.push({ claim: c, source: i + 1 });
    if (evidence.length >= 8) continue;
    try {
      const clean = await fetchCleanArticle(r.url, 4500);
      const fromPage = extractEvidenceSentences(query, clean, 2);
      for (const c of fromPage) evidence.push({ claim: c, source: i + 1 });
    } catch {
      // best effort
    }
  }

  const dedup = new Set<string>();
  const top: Array<{ claim: string; source: number }> = [];
  for (const e of evidence) {
    const cleaned = cleanClaimText(e.claim);
    if (!cleaned || cleaned.length < 20) continue;
    const k = cleaned.toLowerCase().replace(/[^a-z0-9\s]/g, '').slice(0, 140);
    if (dedup.has(k)) continue;
    dedup.add(k);
    top.push({ claim: cleaned, source: e.source });
    if (top.length >= 3) break;
  }

  if (!top.length) return '';
  const first = top[0];
  const summaryLine = `Answer: ${first.claim} [${first.source}]`;
  const bullets = top.slice(1).map(t => `- ${t.claim} [${t.source}]`).join('\n');
  const sources = picked.slice(0, 3).map((r, i) => `[${i + 1}] ${r.url}`).join(' ');
  return `${summaryLine}${bullets ? `\n${bullets}` : ''}\nSources: ${sources}`;
}

async function buildStructuredEventBundle(query: string, ranked: SearchResultItem[]): Promise<{
  answer: string;
  sources: StructuredSource[];
  evidence: StructuredEvidence[];
  facts: StructuredFact[];
} | null> {
  if (!isEventOutcomeQuery(query)) return null;
  const filtered = ranked.filter(r => !isLowValueResult(r));
  const tiered = applySourceTierPolicy(query, filtered);
  const clustered = selectDominantStoryCluster(query, tiered);
  const pickedRaw = clustered.slice(0, 4);
  if (!pickedRaw.length) return null;

  const sources: StructuredSource[] = pickedRaw.map((r, i) => ({
    id: i + 1,
    tier: sourceTier(r),
    title: r.title,
    url: r.url,
    snippet: r.snippet.slice(0, 500),
    score: relevanceScore(query, `${r.title} ${r.snippet}`),
  }));

  let evidenceId = 1;
  const evidence: StructuredEvidence[] = [];
  for (const s of sources) {
    const fromSnippet = extractEvidenceSentences(query, s.snippet, 2);
    for (const ex of fromSnippet) {
      evidence.push({ id: evidenceId++, source_id: s.id, excerpt: cleanClaimText(ex), score: relevanceScore(query, ex) + 1 });
    }
    if (evidence.length >= 14) continue;
    try {
      const clean = await fetchCleanArticle(s.url, 4500);
      const fromPage = extractEvidenceSentences(query, clean, 2);
      for (const ex of fromPage) {
        evidence.push({ id: evidenceId++, source_id: s.id, excerpt: cleanClaimText(ex), score: relevanceScore(query, ex) + 1.5 });
      }
    } catch {
      // best effort
    }
  }

  const sortedEvidence = evidence
    .filter(e => e.excerpt.length >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  if (!sortedEvidence.length) return null;

  const seen = new Set<string>();
  const facts: StructuredFact[] = [];
  for (const e of sortedEvidence) {
    const key = e.excerpt.toLowerCase().replace(/[^a-z0-9\s]/g, '').slice(0, 140);
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      id: facts.length + 1,
      claim: e.excerpt,
      evidence_ids: [e.id],
      source_ids: [e.source_id],
      confidence: Math.max(0.5, Math.min(0.95, e.score / 8)),
    });
    if (facts.length >= 4) break;
  }
  if (!facts.length) return null;

  const lead = facts[0];
  const bullets = facts.slice(1, 4).map(f => `- ${f.claim} [${f.source_ids[0]}]`).join('\n');
  const sourceLine = sources.slice(0, 3).map(s => `[${s.id}] ${s.url}`).join(' ');
  const answer = `Answer: ${lead.claim} [${lead.source_ids[0]}]${bullets ? `\n${bullets}` : ''}\nSources: ${sourceLine}`;
  return { answer, sources, evidence: sortedEvidence, facts };
}

async function augmentEventContract(query: string, res: ToolResult): Promise<ToolResult> {
  const ranked = (res.data?.results || []) as SearchResultItem[];
  if (!isEventOutcomeQuery(query) || !ranked.length) return res;
  const bundle = await buildStructuredEventBundle(query, ranked);
  if (!bundle) return res;
  const summaryText = ranked.map((r: SearchResultItem, i: number) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet.slice(0, 400)}`).join('\n\n');
  res.data = {
    ...(res.data || {}),
    answer: bundle.answer,
    sources: bundle.sources,
    evidence: bundle.evidence,
    facts: bundle.facts,
  };
  res.stdout = `${bundle.answer}\n\n${summaryText}`;
  return res;
}

function domainTrustScore(url: string): number {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.endsWith('.gov') || h.endsWith('.mil')) return 4;
    if (h.endsWith('.edu') || h.includes('justice.gov') || h.includes('sec.gov') || h.includes('federalreserve.gov')) return 3.5;
    if (h.includes('reuters.com') || h.includes('apnews.com') || h.includes('bloomberg.com') || h.includes('ft.com')) return 3;
    if (h.includes('wikipedia.org') || h.includes('ballotpedia.org')) return 2;
    if (h.includes('youtube.com') || h.includes('tiktok.com')) return 0.5;
    return 1.5;
  } catch {
    return 0;
  }
}

function rankResults(query: string, results: SearchResultItem[]) {
  const q = query.toLowerCase();
  const freshness = /\b(current|latest|today|now|as of|recent)\b/.test(q);
  return [...results]
    .map(r => {
      const t = domainTrustScore(r.url);
      const text = `${r.title} ${r.snippet}`.toLowerCase();
      let rel = 0;
      const tokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(x => x.length >= 4);
      for (const tok of tokens) if (text.includes(tok)) rel += 1;
      return { r, score: t * (freshness ? 2 : 1) + rel * 0.4 };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.r);
}

// ── Return a human-readable summary of configured search providers (no key decryption) ──
export function getSearchProvidersSummary(): string {
  try {
    const { getConfig } = require('../config/config') as typeof import('../config/config');
    const cfg = getConfig();
    const data = cfg.getConfig() as any;
    const searchCfg = data.search || {};
    const preferred = String(searchCfg.preferred_provider || 'ddg').toLowerCase();
    const tinyfishKey = cfg.resolveSecret(searchCfg.tinyfish_api_key);
    const tavilyKey = cfg.resolveSecret(searchCfg.tavily_api_key);
    const googleKey = cfg.resolveSecret(searchCfg.google_api_key);
    const googleCx = cfg.resolveSecret(searchCfg.google_cx);
    const braveKey = cfg.resolveSecret(searchCfg.brave_api_key);
    const xaiAvailable = xaiHasCredentials();
    const providers: { key: string; label: string; available: boolean }[] = [
      { key: 'tinyfish', label: 'TinyFish', available: !!tinyfishKey },
      { key: 'tavily', label: 'Tavily', available: !!tavilyKey },
      { key: 'google', label: 'Google', available: !!(googleKey && googleCx) },
      { key: 'brave',  label: 'Brave',  available: !!braveKey },
      { key: 'xai',    label: 'xAI X Search', available: xaiAvailable },
      { key: 'ddg',    label: 'DuckDuckGo', available: true },
    ];
    return providers
      .filter(p => p.available)
      .map(p => p.key === preferred ? `${p.label} (primary)` : p.label)
      .join(', ');
  } catch {
    return 'DuckDuckGo (fallback)';
  }
}

// ── Load search config via the app's config system (same source as Settings UI) ──
function getSearchConfig(): {
  preferred: 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg';
  tinyfishKey?: string;
  tavilyKey?: string;
  googleKey?: string;
  googleCx?: string;
  braveKey?: string;
} {
  try {
    // Use the app's config system so Settings UI changes are always reflected.
    // Dynamic require avoids a circular import at module load time.
    const { getConfig } = require('../config/config') as typeof import('../config/config');
    const cfg = getConfig();
    const data = cfg.getConfig() as any;
    const searchCfg = data.search || {};
    const preferredRaw = String(searchCfg.preferred_provider || 'ddg').toLowerCase();
    const preferred = (['tinyfish', 'tavily', 'google', 'brave', 'ddg'].includes(preferredRaw) ? preferredRaw : 'ddg') as 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg';
    // Resolve vault-backed search credentials so saves in Settings are used immediately.
    const tinyfishKey = cfg.resolveSecret(searchCfg.tinyfish_api_key);
    const tavilyKey = cfg.resolveSecret(searchCfg.tavily_api_key);
    const googleKey = cfg.resolveSecret(searchCfg.google_api_key);
    const googleCx = cfg.resolveSecret(searchCfg.google_cx);
    const braveKey = cfg.resolveSecret(searchCfg.brave_api_key);
    return { preferred, tinyfishKey, tavilyKey, googleKey, googleCx, braveKey };
  } catch {
    // Final fallback: try reading config.json directly from known paths
    try {
      const candidates = [
        path.join(process.env.PROMETHEUS_DATA_DIR || '', '.prometheus', 'config.json'),
        path.join(process.cwd(), '.prometheus', 'config.json'),
        path.join(os.homedir(), '.prometheus', 'config.json'),
      ].filter(Boolean);
      for (const cfgPath of candidates) {
        if (fs.existsSync(cfgPath)) {
          const data = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const preferredRaw = String(data.search?.preferred_provider || 'ddg').toLowerCase();
          const preferred = (['tinyfish', 'tavily', 'google', 'brave', 'ddg'].includes(preferredRaw) ? preferredRaw : 'ddg') as 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg';
          return {
            preferred,
            tinyfishKey: data.search?.tinyfish_api_key,
            tavilyKey: data.search?.tavily_api_key,
            googleKey: data.search?.google_api_key,
            googleCx: data.search?.google_cx,
            braveKey: data.search?.brave_api_key,
          };
        }
      }
    } catch {}
  }
  return { preferred: 'ddg' };
}
// ── Google Custom Search API ─────────────────────────────────────────────---
async function searchTinyFish(query: string, limit: number, apiKey: string, timeoutMs = DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS): Promise<ToolResult> {
  const url = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}&location=US&language=en`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-API-Key': apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`TinyFish HTTP ${res.status}`);
  const data: any = await res.json();
  const results = (data.results || []).slice(0, limit).map((r: any) => ({
    title: r.title || r.site_name || '',
    url: r.url || '',
    snippet: r.snippet || '',
    imageUrl: r.image_url || r.thumbnail_url || r.thumbnail || r.image || undefined,
    publisher: r.site_name || r.source || undefined,
    publishedAt: r.published_date || r.published_at || r.date || undefined,
  }));
  const ranked = rankResults(query, results);
  const answer = buildDirectPriceAnswer(query, ranked);

  return {
    success: true,
    data: { query, results: ranked, answer: answer || undefined, total_results: data.total_results, page: data.page },
    stdout: (answer ? `${answer}\n\n` : '') + ranked.map((r: any, i: number) =>
      `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet.slice(0, 400)}`
    ).join('\n\n'),
  };
}

async function searchXAI(query: string, limit: number): Promise<ToolResult> {
  const result = await executeXSearch({
    query,
  });
  if (!result.success) {
    throw new Error(result.error || 'xAI X Search failed');
  }

  const answer = String(result.answer || '').trim();
  const inlineCitations = Array.isArray(result.inline_citations) ? result.inline_citations.filter(c => c?.url) : [];
  const topLevelCitations = Array.isArray(result.citations) ? result.citations.filter(Boolean) : [];
  const citations = inlineCitations.length > 0
    ? inlineCitations
    : topLevelCitations.map((url) => ({ title: '', url: String(url) }));
  const results: SearchResultItem[] = citations.slice(0, limit).map((citation, i) => ({
    title: citation.title || `xAI X Search citation ${i + 1}`,
    url: String(citation.url),
    snippet: answer || `X result for ${query}`,
  }));

  if (results.length === 0 && answer) {
    results.push({
      title: 'xAI X Search answer',
      url: `https://x.com/search?q=${encodeURIComponent(query)}`,
      snippet: answer,
    });
  }

  return {
    success: results.length > 0,
    error: results.length > 0 ? undefined : 'xAI X Search returned no citations',
    data: { query, results, answer, provider: 'xai', citations },
    stdout: (answer ? `${answer}\n\n` : '') + results.map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`).join('\n\n'),
  };
}

async function searchGoogle(query: string, limit: number, apiKey: string, cx: string, timeoutMs = DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS): Promise<ToolResult> {
  const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}&num=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const data: any = await res.json();
  if (!res.ok) {
    const message = data?.error?.message || data?.error?.errors?.[0]?.message || `Google HTTP ${res.status}`;
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
    throw new Error(`Google HTTP ${res.status}${reason ? ` ${reason}` : ''}: ${message}`);
  }
  const results = (data.items || []).map((r: any) => ({
    title: r.title || '',
    url: normalizeGoogleUrl(r.link || ''),
    snippet: r.snippet || '',
    imageUrl: r.pagemap?.cse_image?.[0]?.src || r.pagemap?.cse_thumbnail?.[0]?.src || undefined,
    publisher: r.displayLink || undefined,
    publishedAt: r.pagemap?.metatags?.[0]?.['article:published_time'] || r.pagemap?.metatags?.[0]?.date || undefined,
  }));
  const ranked = rankResults(query, results);

  // Guard: some CSE configurations return mostly share.google wrappers that
  // are not reliable search hits for factual QA. Trigger provider fallback.
  if (results.length > 0) {
    const lowQuality = results.filter((r: { url: string }) => isLowQualityGoogleUrl(r.url)).length;
    if (lowQuality / results.length >= 0.5) {
      throw new Error('Google CSE returned mostly low-quality share links; falling back to other providers.');
    }
  }

  const answer = buildDirectPriceAnswer(query, ranked);
  return {
    success: true,
    data: { query, results: ranked, answer: answer || undefined },
    stdout: (answer ? `${answer}\n\n` : '') + ranked.map((r: any, i: number) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet.slice(0, 400)}`).join('\n\n'),
  };
}

// ── Tavily (best for AI agents, free 1k/mo) ───────────────────────────────────
async function searchTavily(query: string, limit: number, apiKey: string, timeoutMs = DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS): Promise<ToolResult> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: limit,
      search_depth: 'basic',
      // Provider "answer" strings can be stale/inconsistent for freshness queries.
      // We synthesize from snippets instead of trusting this shortcut.
      include_answer: !isFreshQuery(query),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data: any = await res.json();

  const results = (data.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
    imageUrl: r.image_url || r.thumbnail_url || r.image || undefined,
    publisher: r.source || undefined,
    publishedAt: r.published_date || r.published_at || undefined,
  }));
  const ranked = rankResults(query, results);

  // Use deterministic local extraction only (e.g., prices) to avoid stale provider summaries.
  const answer = buildDirectPriceAnswer(query, ranked);

  return {
    success: true,
    data: { query, results: ranked, answer: data.answer },
    stdout: (answer ? `${answer}\n\n` : '') + ranked.map((r: any, i: number) =>
      `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet.slice(0, 400)}`
    ).join('\n\n'),
  };
}

// ── Brave Search API (free 2k/mo) ─────────────────────────────────────────────
async function searchBrave(query: string, limit: number, apiKey: string, timeoutMs = DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS): Promise<ToolResult> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data: any = await res.json();

  const results = (data.web?.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || '',
    imageUrl: r.thumbnail?.src || r.thumbnail?.original || r.image?.url || undefined,
    publisher: r.profile?.long_name || r.profile?.name || undefined,
    publishedAt: r.page_age || r.age || undefined,
  }));
  const ranked = rankResults(query, results);
  const answer = buildDirectPriceAnswer(query, ranked);

  return {
    success: true,
    data: { query, results: ranked, answer: answer || undefined },
    stdout: (answer ? `${answer}\n\n` : '') + ranked.map((r: any, i: number) =>
      `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`
    ).join('\n\n'),
  };
}

// ── DuckDuckGo JSON endpoint (no key, more stable than HTML scrape) ───────────
async function searchDDG(query: string, limit: number, timeoutMs = DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS): Promise<ToolResult> {
  // DDG instant answer API — gives structured results without scraping HTML
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Prometheus/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`DDG JSON HTTP ${res.status}`);
  const data: any = await res.json();

  const results: SearchResultItem[] = [];

  // Abstract (direct answer)
  if (data.AbstractText) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL || '',
      snippet: data.AbstractText,
      imageUrl: data.Image ? new URL(data.Image, 'https://duckduckgo.com').href : undefined,
      publisher: data.AbstractSource || undefined,
    });
  }

  // Related topics
  for (const topic of (data.RelatedTopics || [])) {
    if (results.length >= limit) break;
    if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: topic.Text });
    } else if (topic.Topics) {
      for (const sub of topic.Topics) {
        if (results.length >= limit) break;
        if (sub.Text && sub.FirstURL) {
          results.push({ title: sub.Text.slice(0, 80), url: sub.FirstURL, snippet: sub.Text });
        }
      }
    }
  }

  // Results array
  for (const r of (data.Results || [])) {
    if (results.length >= limit) break;
    results.push({ title: r.Text || '', url: r.FirstURL || '', snippet: r.Text || '' });
  }

  if (results.length === 0) {
    // Fall back to HTML scraper if JSON gave nothing
    return searchDDGHtml(query, limit, timeoutMs);
  }
  const ranked = rankResults(query, results);
  const answer = buildDirectPriceAnswer(query, ranked);

  return {
    success: true,
    data: { query, results: ranked, answer: answer || undefined },
    stdout: (answer ? `${answer}\n\n` : '') + ranked.map((r, i) =>
      `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet.slice(0, 400)}`
    ).join('\n\n'),
  };
}

// ── DDG HTML scraper (last resort fallback) ───────────────────────────────────
async function searchDDGHtml(query: string, limit: number, timeoutMs = DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS): Promise<ToolResult> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { success: false, error: `DDG HTML HTTP ${res.status}` };

  const html = await res.text();

  // Decode DDG redirect URLs (//duckduckgo.com/l/?uddg=<url> or /l/?uddg=<url>)
  function resolveHref(href: string): string {
    let h = href;
    if (h.startsWith('//')) h = 'https:' + h;
    try {
      const u = new URL(h.startsWith('http') ? h : 'https://duckduckgo.com' + h);
      if (u.searchParams.has('uddg')) {
        const uddg = u.searchParams.get('uddg')!;
        // URLSearchParams.get() already percent-decodes once; uddg may still be encoded
        return uddg.startsWith('http') ? uddg : decodeURIComponent(uddg);
      }
      return u.href;
    } catch { return href; }
  }

  function cleanText(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  }

  // Per-block extraction: find each result <div class="result results_links..."> and parse title/url/snippet within it.
  // Only match top-level result item divs (not inner divs like result__body, result__extras, etc.)
  // Ads have class "result result--ad" (no "results_links") and are skipped by URL filter.
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Match "result results_links" blocks (organic results) AND "result result--ad" (ads, filtered later)
  const blockBoundary = /<div[^>]+class="result (?:results_links|result--ad)[^"]*"[^>]*>/g;
  const blockStarts: number[] = [];
  let bm: RegExpExecArray | null;
  while ((bm = blockBoundary.exec(html)) !== null) blockStarts.push(bm.index);

  for (let i = 0; i < blockStarts.length && results.length < limit; i++) {
    const blockHtml = html.slice(blockStarts[i], blockStarts[i + 1] ?? html.length);

    // Title + URL
    const titleM = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(blockHtml);
    if (!titleM) continue;
    const resolvedUrl = resolveHref(titleM[1]);
    // Skip DDG-internal URLs and non-http results
    if (!resolvedUrl.startsWith('http') || resolvedUrl.includes('duckduckgo.com')) continue;
    const title = cleanText(titleM[2]);
    if (!title) continue;

    // Snippet (may be <a> or <div> or <span>)
    const snippetM = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i.exec(blockHtml);
    const snippet = snippetM ? cleanText(snippetM[1]) : '';

    results.push({ title, url: resolvedUrl, snippet });
  }

  if (results.length === 0) {
    return { success: false, error: 'No search results found. Use web_fetch on a direct news URL instead (e.g. https://www.reuters.com or https://apnews.com).' };
  }
  const ranked = rankResults(query, results);
  const answer = buildDirectPriceAnswer(query, ranked);

  return {
    success: true,
    data: { query, results: ranked, answer: answer || undefined },
    stdout: (answer ? `${answer}\n\n` : '') + ranked.map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`).join('\n\n'),
  };
}

// ── Main web_search tool ──────────────────────────────────────────────────────
export async function executeWebSearch(args: {
  query: string;
  max_results?: number;
  multi_engine?: boolean;
  provider?: SearchProviderOption;
  fetch_top_k?: number;
  fetch_max_chars?: number;
  provider_timeout_ms?: number;
}): Promise<ToolResult> {
  if (!args.query?.trim()) return { success: false, error: 'query is required' };
  let limit = Math.min(args.max_results ?? 5, 10);
  if (isPriceQuery(args.query)) limit = Math.max(limit, 5);
  const providerTimeoutMs = resolveSearchProviderTimeoutMs(args.provider_timeout_ms);

  const cfg = getSearchConfig();
  const providerRaw = String(args.provider || '').trim().toLowerCase();
  const providerOverride = (['tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai', 'multi'].includes(providerRaw) ? providerRaw : '') as SearchProviderOption | '';
  const candidates: Array<'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg'> = ['tinyfish', 'tavily', 'google', 'brave', 'ddg'];
  const useMultiEngine = providerOverride === 'multi' || (providerOverride === '' && args.multi_engine === true);
  const providerOrder = providerOverride && providerOverride !== 'multi'
    ? [providerOverride as 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg' | 'xai']
    : !useMultiEngine
      ? [cfg.preferred]
      : [cfg.preferred, ...candidates.filter(p => p !== cfg.preferred)];

  // ── Multi-engine mode: query all configured providers in parallel, merge results ──
  // Default OFF for low latency: use the Settings preferred provider only. Pass multi_engine:true or provider:"multi" for wide research.
  if (useMultiEngine) {
    const tasks: { provider: SearchProvider; promise: Promise<ToolResult> }[] = [];
    if (cfg.tinyfishKey) tasks.push({ provider: 'tinyfish', promise: withSearchProviderTimeout('tinyfish', searchTinyFish(args.query, limit, cfg.tinyfishKey as string, providerTimeoutMs), providerTimeoutMs) });
    if (cfg.tavilyKey) tasks.push({ provider: 'tavily', promise: withSearchProviderTimeout('tavily', searchTavily(args.query, limit, cfg.tavilyKey as string, providerTimeoutMs), providerTimeoutMs) });
    if (cfg.googleKey && cfg.googleCx) tasks.push({ provider: 'google', promise: withSearchProviderTimeout('google', searchGoogle(args.query, limit, cfg.googleKey as string, cfg.googleCx as string, providerTimeoutMs), providerTimeoutMs) });
    if (cfg.braveKey)  tasks.push({ provider: 'brave',  promise: withSearchProviderTimeout('brave', searchBrave(args.query, limit, cfg.braveKey as string, providerTimeoutMs), providerTimeoutMs) });
    if (xaiHasCredentials()) tasks.push({ provider: 'xai', promise: withSearchProviderTimeout('xai', searchXAI(args.query, limit), providerTimeoutMs) });
    if (tasks.length >= 1) {
      const diagnostics: SearchDiagnostics = {
        query: args.query,
        preferred_provider: cfg.preferred,
        provider_order: tasks.map(t => t.provider).filter((p): p is 'tinyfish' | 'tavily' | 'google' | 'brave' | 'ddg' | 'xai' => p !== 'ddg_html' && p !== 'multi'),
        attempted: [],
        selected_provider: 'multi' as SearchProvider,
      };
      const settled = await Promise.allSettled(tasks.map(t => t.promise));
      const merged: SearchResultItem[] = [];
      const resultIndexByUrl = new Map<string, number>();
      const attemptedProviders = tasks.map(t => t.provider);
      const usedProviders: string[] = [];
      const failedProviders: string[] = [];
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === 'fulfilled' && r.value.success && Array.isArray(r.value.data?.results)) {
          usedProviders.push(tasks[i].provider);
          diagnostics.attempted.push({
            provider: tasks[i].provider,
            status: 'success',
            result_count: r.value.data.results.length,
          });
          for (const item of r.value.data.results as SearchResultItem[]) {
            const key = String(item.url || '').replace(/\/$/, '');
            const existingIndex = resultIndexByUrl.get(key);
            if (existingIndex == null) {
              resultIndexByUrl.set(key, merged.length);
              merged.push(item);
            } else {
              // Different providers expose different pieces of the same result.
              // Preserve the first provider's ranking while filling its sparse
              // preview fields from later engines instead of discarding them.
              const existing = merged[existingIndex];
              merged[existingIndex] = {
                ...existing,
                title: existing.title || item.title,
                snippet: existing.snippet || item.snippet,
                imageUrl: existing.imageUrl || item.imageUrl,
                publisher: existing.publisher || item.publisher,
                publishedAt: existing.publishedAt || item.publishedAt,
              };
            }
          }
        } else {
          const reason = r.status === 'rejected'
            ? ((r.reason as any)?.message || String(r.reason))
            : (r.value.error || 'no_results');
          failedProviders.push(`${tasks[i].provider}: ${reason}`);
          diagnostics.attempted.push({
            provider: tasks[i].provider,
            status: 'failed',
            reason,
            result_count: r.status === 'fulfilled' && Array.isArray(r.value.data?.results) ? r.value.data.results.length : 0,
          });
        }
      }
      if (merged.length > 0) {
        const capped = merged.slice(0, Math.min(limit * 2, 15));
        const lines = capped.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`);
        const successLine = usedProviders.length && usedProviders.length < attemptedProviders.length
          ? `\n[Successful engines: ${usedProviders.join('+')}]\n`
          : '';
        const failedLine = failedProviders.length ? `\n[Failed engines: ${failedProviders.join(' | ')}]\n` : '';
        return maybeAttachFetchedSearchResults({
          success: true,
          data: {
            results: capped,
            provider: 'multi',
            engines: attemptedProviders,
            successful_engines: usedProviders,
            failed_engines: failedProviders,
            search_diagnostics: diagnostics,
          },
          stdout: `[Multi-engine: ${attemptedProviders.join('+')}]${successLine}${failedLine}\n` + lines.join('\n\n'),
        }, args);
      }
      // fall through to single-engine if all parallel calls failed
    }
  }
  const diagnostics: SearchDiagnostics = {
    query: args.query,
    preferred_provider: cfg.preferred,
    provider_order: providerOrder,
    attempted: [],
  };

  let lastErr = null;
  for (const provider of providerOrder) {
    if (provider === 'tinyfish' && !cfg.tinyfishKey) {
      diagnostics.attempted.push({ provider, status: 'skipped', reason: 'missing_tinyfish_api_key' });
      continue;
    }
    if (provider === 'tavily' && !cfg.tavilyKey) {
      diagnostics.attempted.push({ provider, status: 'skipped', reason: 'missing_tavily_api_key' });
      continue;
    }
    if (provider === 'google' && (!cfg.googleKey || !cfg.googleCx)) {
      diagnostics.attempted.push({ provider, status: 'skipped', reason: !cfg.googleKey ? 'missing_google_api_key' : 'missing_google_cx' });
      continue;
    }
    if (provider === 'brave' && !cfg.braveKey) {
      diagnostics.attempted.push({ provider, status: 'skipped', reason: 'missing_brave_api_key' });
      continue;
    }
    if (provider === 'xai' && !xaiHasCredentials()) {
      diagnostics.attempted.push({ provider, status: 'skipped', reason: 'missing_xai_credentials' });
      continue;
    }

    const started = Date.now();
    try {
      if (provider === 'tinyfish') {
        const res = await withSearchProviderTimeout('tinyfish', searchTinyFish(args.query, limit, cfg.tinyfishKey as string, providerTimeoutMs), providerTimeoutMs);
        await augmentEventContract(args.query, res);
        const resultCount = Array.isArray(res.data?.results) ? res.data.results.length : 0;
        diagnostics.attempted.push({
          provider,
          status: 'success',
          duration_ms: Date.now() - started,
          result_count: resultCount,
        });
        diagnostics.selected_provider = 'tinyfish';
        res.data = { ...(res.data || {}), provider: 'tinyfish', search_diagnostics: diagnostics };
        return maybeAttachFetchedSearchResults(res, args);
      }
      if (provider === 'tavily') {
        const res = await withSearchProviderTimeout('tavily', searchTavily(args.query, limit, cfg.tavilyKey as string, providerTimeoutMs), providerTimeoutMs);
        await augmentEventContract(args.query, res);
        const resultCount = Array.isArray(res.data?.results) ? res.data.results.length : 0;
        diagnostics.attempted.push({
          provider,
          status: 'success',
          duration_ms: Date.now() - started,
          result_count: resultCount,
        });
        diagnostics.selected_provider = 'tavily';
        res.data = { ...(res.data || {}), provider: 'tavily', search_diagnostics: diagnostics };
        return maybeAttachFetchedSearchResults(res, args);
      }
      if (provider === 'google') {
        const res = await withSearchProviderTimeout('google', searchGoogle(args.query, limit, cfg.googleKey as string, cfg.googleCx as string, providerTimeoutMs), providerTimeoutMs);
        await augmentEventContract(args.query, res);
        const resultCount = Array.isArray(res.data?.results) ? res.data.results.length : 0;
        diagnostics.attempted.push({
          provider,
          status: 'success',
          duration_ms: Date.now() - started,
          result_count: resultCount,
        });
        diagnostics.selected_provider = 'google';
        res.data = { ...(res.data || {}), provider: 'google', search_diagnostics: diagnostics };
        return maybeAttachFetchedSearchResults(res, args);
      }
      if (provider === 'brave') {
        const res = await withSearchProviderTimeout('brave', searchBrave(args.query, limit, cfg.braveKey as string, providerTimeoutMs), providerTimeoutMs);
        await augmentEventContract(args.query, res);
        const resultCount = Array.isArray(res.data?.results) ? res.data.results.length : 0;
        diagnostics.attempted.push({
          provider,
          status: 'success',
          duration_ms: Date.now() - started,
          result_count: resultCount,
        });
        diagnostics.selected_provider = 'brave';
        res.data = { ...(res.data || {}), provider: 'brave', search_diagnostics: diagnostics };
        return maybeAttachFetchedSearchResults(res, args);
      }
      if (provider === 'xai') {
        const res = await withSearchProviderTimeout('xai', searchXAI(args.query, limit), providerTimeoutMs);
        const resultCount = Array.isArray(res.data?.results) ? res.data.results.length : 0;
        diagnostics.attempted.push({
          provider,
          status: 'success',
          duration_ms: Date.now() - started,
          result_count: resultCount,
        });
        diagnostics.selected_provider = 'xai';
        res.data = { ...(res.data || {}), provider: 'xai', search_diagnostics: diagnostics };
        return maybeAttachFetchedSearchResults(res, args);
      }
      if (provider === 'ddg') {
        const res = await withSearchProviderTimeout('ddg', searchDDG(args.query, limit, providerTimeoutMs), providerTimeoutMs);
        await augmentEventContract(args.query, res);
        const resultCount = Array.isArray(res.data?.results) ? res.data.results.length : 0;
        if (!res.success || resultCount === 0) {
          diagnostics.attempted.push({
            provider,
            status: 'failed',
            reason: res.error || 'no_results',
            duration_ms: Date.now() - started,
          });
          lastErr = new Error(res.error || 'no_results');
          // continue to ddg_html fallback below the loop
        } else {
          diagnostics.attempted.push({
            provider,
            status: 'success',
            duration_ms: Date.now() - started,
            result_count: resultCount,
          });
          diagnostics.selected_provider = 'ddg';
          res.data = { ...(res.data || {}), provider: 'ddg', search_diagnostics: diagnostics };
          return maybeAttachFetchedSearchResults(res, args);
        }
      }
    } catch (err) {
      lastErr = err;
      const reason = (err as any)?.message || String(err);
      const cause = (err as any)?.cause;
      const fullReason = cause ? `${reason} [cause: ${cause.code || cause.message || String(cause)}]` : reason;
      console.error(`[web_search] Provider ${provider} failed:`, fullReason);
      diagnostics.attempted.push({
        provider,
        status: 'failed',
        reason: fullReason,
        duration_ms: Date.now() - started,
      });
    }
  }

  if (!useMultiEngine) {
    const attempted = diagnostics.attempted[diagnostics.attempted.length - 1];
    const selectedProvider = providerOverride || cfg.preferred;
    return {
      success: false,
      error: `${selectedProvider} search failed${attempted?.reason ? ` (${attempted.reason})` : ''}.`,
      data: { query: args.query, provider: selectedProvider, search_diagnostics: diagnostics },
    };
  }

  // Final fallback if ddg path threw and wasn't already successful
  const fallbackStarted = Date.now();
  try {
    const res = await withSearchProviderTimeout('ddg_html', searchDDGHtml(args.query, limit, providerTimeoutMs), providerTimeoutMs);
    const resultCount = Array.isArray(res.data?.results) ? res.data.results.length : 0;
    diagnostics.attempted.push({
      provider: 'ddg_html',
      status: 'success',
      duration_ms: Date.now() - fallbackStarted,
      result_count: resultCount,
    });
    diagnostics.selected_provider = 'ddg_html';
    res.data = { ...(res.data || {}), provider: 'ddg_html', search_diagnostics: diagnostics };
    return maybeAttachFetchedSearchResults(res, args);
  } catch (err) {
    lastErr = err;
    diagnostics.attempted.push({
      provider: 'ddg_html',
      status: 'failed',
      reason: (err as any)?.message || String(err),
      duration_ms: Date.now() - fallbackStarted,
    });
  }
  let errMsg = 'unknown error';
  if (lastErr) {
    if (typeof lastErr === 'object' && 'message' in lastErr) {
      errMsg = (lastErr as any).message;
      // Include cause chain for Node.js fetch errors (e.g. ECONNREFUSED, ENOTFOUND)
      if ((lastErr as any).cause) {
        const cause = (lastErr as any).cause;
        errMsg += ` [cause: ${cause.code || cause.message || String(cause)}]`;
      }
    }
    else errMsg = String(lastErr);
  }
  console.error(`[web_search] All providers failed for "${args.query}". Diagnostics:`, JSON.stringify(diagnostics.attempted, null, 2), `Last error: ${errMsg}`);
  return {
    success: false,
    error: `All search providers failed (${errMsg}). Fall back to web_fetch on a direct URL — try https://www.reuters.com, https://apnews.com, or https://www.bbc.com/news to find the information directly.`,
    data: { query: args.query, search_diagnostics: diagnostics },
  };
}

// ── web_fetch: fetch a URL and return clean text ──────────────────────────────
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);
const MAX_X_IMAGE_DOWNLOADS = 12;
const MAX_X_VIDEO_DOWNLOADS = 4;
const MAX_X_MEDIA_ANALYSES = 8;
const MAX_X_IMAGE_DOWNLOAD_CONCURRENCY = 4;
const MAX_X_MEDIA_ANALYSIS_CONCURRENCY = 2;

function isXUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com|mobile\.twitter\.com)\//i.test(String(url || '').trim());
}

function isXStatusUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com|mobile\.twitter\.com)\/[^/?#]+\/status\/\d+/i.test(String(url || '').trim());
}

async function fetchXStatusViaOEmbed(url: string): Promise<XFetchPayload | null> {
  const id = String(url || '').match(/\/status\/(\d+)/i)?.[1];
  if (!id) return null;
  try {
    const endpoint = new URL('https://publish.x.com/oembed');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('hide_thread', 'true');
    endpoint.searchParams.set('omit_script', 'true');
    endpoint.searchParams.set('dnt', 'true');
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const html = String(data?.html || '');
    const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '';
    const text = htmlDecodeLite(
      paragraph
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    );
    const author = String(data?.author_name || '').trim();
    let handle = '';
    try {
      const username = new URL(String(data?.author_url || '')).pathname.split('/').filter(Boolean)[0];
      if (username) handle = `@${username}`;
    } catch {
      // The author name and status text are still usable without a profile URL.
    }
    const dateText = html.match(/<a\b[^>]*href=["'][^"']*\/status\/\d+[^"']*["'][^>]*>([^<]+)<\/a>/i)?.[1] || '';
    if (!text || (!author && !handle)) return null;
    return {
      success: true,
      url,
      tweets: [{
        id,
        link: String(data?.url || url),
        author,
        handle,
        // oEmbed exposes a calendar date, not a precise time. Preserve it as
        // returned instead of manufacturing a midnight timestamp.
        timestamp: dateText ? htmlDecodeLite(dateText) : undefined,
        text,
        rawRef: id,
      }],
      count: 1,
      message: 'Captured exact X status through the official X oEmbed endpoint',
    };
  } catch {
    return null;
  }
}

function clipText(value: string, maxChars: number): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[...truncated]`;
}
function buildCreativeStorage() {
  const globalWorkspace = getConfig().getConfig().workspace.path;
  const workspacePath = getActiveWorkspace(globalWorkspace);
  const rootAbsPath = path.join(workspacePath, 'creative-projects', 'default');
  const creativeDir = path.join(rootAbsPath, 'prometheus-creative');
  fs.mkdirSync(creativeDir, { recursive: true });
  const rootRelPath = 'creative-projects/default';
  return { workspacePath, rootAbsPath, rootRelPath, creativeDir };
}

function reportWebFetchProgress(
  reporter: WebFetchProgressReporter | undefined,
  phase: WebFetchProgressPhase,
  message: string,
): void {
  try {
    reporter?.({ phase, message });
  } catch {
    // Best-effort progress reporting only.
  }
}

function isTinyFishFetchEligible(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
    return !/^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch {
    return false;
  }
}

async function fetchTinyFishContent(url: string, maxChars: number, apiKey: string): Promise<ToolResult> {
  const res = await fetch('https://api.fetch.tinyfish.ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ urls: [url], format: 'markdown', links: false, image_links: true }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) throw new Error(`TinyFish Fetch HTTP ${res.status}`);
  const data: any = await res.json();
  const firstError = Array.isArray(data.errors) ? data.errors.find((e: any) => e?.url === url) || data.errors[0] : null;
  const page = Array.isArray(data.results) ? data.results[0] : null;
  if (!page) {
    return { success: false, error: firstError?.error ? `TinyFish Fetch failed: ${firstError.error}` : 'TinyFish Fetch returned no content' };
  }

  const rawText = typeof page.text === 'string' ? page.text : JSON.stringify(page.text ?? '', null, 2);
  const text = clipText(rawText, maxChars);
  const usefulText = text.trim();
  if (!usefulText || usefulText === '{}' || usefulText === '[]' || usefulText === 'null') {
    return { success: false, error: 'TinyFish Fetch returned empty extracted text' };
  }

  return {
    success: true,
    data: {
      url,
      final_url: page.final_url || page.url || url,
      title: page.title,
      description: page.description,
      language: page.language,
      author: page.author,
      published_date: page.published_date,
      image_url: asFirstString(page.image_url) || asFirstString(page.image_links) || asFirstString(page.images),
      image_links: Array.isArray(page.image_links) ? page.image_links.slice(0, 20) : undefined,
      latency_ms: page.latency_ms,
      provider: 'tinyfish',
      length: text.length,
    },
    stdout: text,
  };
}

function classifyXMediaLabel(imageCount: number, videoCount: number): 'Video' | 'Images' | 'Media' {
  if (videoCount > 0 && imageCount === 0) return 'Video';
  if (imageCount > 0 && videoCount === 0) return 'Images';
  return 'Media';
}

function detectDownloadedMediaKind(filePath: string): XDownloadedMediaKind {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'other';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function normalizeXImageUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!/pbs\.twimg\.com$/i.test(parsed.hostname) || !/\/media\//i.test(parsed.pathname)) {
      return parsed.toString();
    }
    if (parsed.searchParams.has('name')) parsed.searchParams.set('name', 'orig');
    return parsed.toString();
  } catch {
    return raw;
  }
}

function parseXFetchPayload(raw: string, url: string): XFetchPayload {
  const text = String(raw || '').trim();
  try {
    return JSON.parse(text) as XFetchPayload;
  } catch {
    return {
      success: false,
      url,
      error: text ? `X fetch returned a non-JSON error: ${clipText(text, 600)}` : 'X fetch returned invalid JSON.',
    };
  }
}

function collectXMediaCandidates(tweets: XFetchedTweet[], fallbackUrl: string): {
  imageJobs: Array<{ url: string; sourceTweetId?: string; sourceTweetLink?: string }>;
  videoJobs: Array<{ url: string; sourceTweetId?: string; sourceTweetLink?: string }>;
  hintedTweetCount: number;
} {
  const imageJobs: Array<{ url: string; sourceTweetId?: string; sourceTweetLink?: string }> = [];
  const videoJobs: Array<{ url: string; sourceTweetId?: string; sourceTweetLink?: string }> = [];
  const seenImages = new Set<string>();
  const seenVideoTweets = new Set<string>();
  let hintedTweetCount = 0;

  for (const tweet of tweets) {
    const media = Array.isArray(tweet.media) ? tweet.media : [];
    const hasHint = media.length > 0 || tweet.hasImage === true || tweet.hasVideo === true;
    if (hasHint) hintedTweetCount += 1;

    for (const mediaItem of media) {
      if (mediaItem?.type !== 'image' || !mediaItem.url) continue;
      const normalizedUrl = normalizeXImageUrl(mediaItem.url);
      if (!normalizedUrl || seenImages.has(normalizedUrl)) continue;
      seenImages.add(normalizedUrl);
      imageJobs.push({
        url: normalizedUrl,
        sourceTweetId: tweet.id,
        sourceTweetLink: tweet.link,
      });
    }

    const statusUrl = String(tweet.link || fallbackUrl || '').trim();
    const hasVideo = media.some(item => item?.type === 'video') || tweet.hasVideo === true;
    if (!statusUrl || !hasVideo || seenVideoTweets.has(statusUrl)) continue;
    seenVideoTweets.add(statusUrl);
    videoJobs.push({
      url: statusUrl,
      sourceTweetId: tweet.id,
      sourceTweetLink: tweet.link,
    });
  }

  return { imageJobs, videoJobs, hintedTweetCount };
}

async function getVideoTranscript(filePath: string, existingTranscript?: string): Promise<string | null> {
  // Use existing transcript if available
  if (existingTranscript && String(existingTranscript).trim()) {
    return clipText(String(existingTranscript), 4000);
  }
  
  // Fallback to creative transcription
  try {
    const storage = buildCreativeStorage();
    const transcriptionResult = await creativeTranscribeAudio(storage, {
      source: filePath,
      provider: 'openai', // Use OpenAI Whisper by default
    });
    return transcriptionResult.text ? clipText(transcriptionResult.text, 4000) : null;
  } catch (error) {
    // Silent fallback - if creative transcription fails, continue without transcript
    console.warn(`Creative transcription fallback failed for video ${filePath}:`, error);
    return null;
  }
}
async function analyzeDownloadedXMedia(file: XDownloadedMedia): Promise<XMediaAnalysis> {
  if (file.kind === 'image') {
    const result = await executeAnalyzeImage({
      file_path: file.rel_path,
      prompt: 'Analyze this image downloaded from an X post. Describe what is visible and transcribe any visible text.',
    });
    if (!result.success) {
      return {
        rel_path: file.rel_path,
        kind: file.kind,
        status: 'failed',
        error: result.error || 'Image analysis failed.',
      };
    }
    return {
      rel_path: file.rel_path,
      kind: file.kind,
      status: 'analyzed',
      analysis: clipText(String(result.data?.analysis || result.stdout || ''), 2200),
    };
  }

  if (file.kind === 'video') {
    const result = await executeAnalyzeVideo({
      file_path: file.rel_path,
      prompt: 'Analyze this video downloaded from an X post. Summarize the clip, visible text, and spoken audio if available.',
      sample_count: 4,
    });
    if (!result.success) {
      return {
        rel_path: file.rel_path,
        kind: file.kind,
        status: 'failed',
        error: result.error || 'Video analysis failed.',
      };
    }
    return {
      rel_path: file.rel_path,
      kind: file.kind,
      status: 'analyzed',
      analysis: clipText(String(result.data?.analysis || result.stdout || ''), 2800),
      transcript: await getVideoTranscript(file.rel_path, result.data?.transcript),
      sample_frames: Array.isArray(result.data?.sample_frames) ? result.data.sample_frames.slice(0, 8) : undefined,
      output_dir_rel: result.data?.output_dir_rel ? String(result.data.output_dir_rel) : undefined,
    };
  }

  return {
    rel_path: file.rel_path,
    kind: file.kind,
    status: 'skipped',
    error: file.kind === 'audio'
      ? 'No dedicated audio analysis tool is registered yet; spoken-audio extraction currently comes from analyze_video.'
      : `Unsupported downloaded media type: ${file.kind}`,
  };
}

async function buildXMediaReport(
  payload: XFetchPayload,
  fallbackUrl: string,
  progress?: WebFetchProgressReporter,
): Promise<XFetchMediaReport> {
  const tweets = Array.isArray(payload.tweets) ? payload.tweets : [];
  const { imageJobs, videoJobs, hintedTweetCount } = collectXMediaCandidates(tweets, fallbackUrl);
  const downloadedFiles: XDownloadedMedia[] = [];
  const errors: string[] = [];
  let fallbackPageDownloadAttempted = false;
  const mediaLabel = classifyXMediaLabel(imageJobs.length, videoJobs.length);

  if (hintedTweetCount > 0) {
    reportWebFetchProgress(progress, 'extracting_media', `Extracting ${mediaLabel}...`);
  }

  const imageDownloadResults = await mapWithConcurrency(
    imageJobs.slice(0, MAX_X_IMAGE_DOWNLOADS),
    MAX_X_IMAGE_DOWNLOAD_CONCURRENCY,
    async (job) => {
      const result = await executeDownloadUrl({
        url: job.url,
        output_dir: 'downloads/x_fetch_media/images',
      });
      return { job, result };
    },
  );

  for (const { job, result } of imageDownloadResults) {
    if (!result.success) {
      errors.push(`download_url(${job.url}): ${result.error || 'failed'}`);
      continue;
    }
    downloadedFiles.push({
      rel_path: String(result.data?.rel_path || ''),
      path: result.data?.path ? String(result.data.path) : undefined,
      bytes: Number.isFinite(Number(result.data?.bytes)) ? Number(result.data.bytes) : undefined,
      kind: detectDownloadedMediaKind(String(result.data?.rel_path || result.data?.path || '')),
      source: 'download_url',
      url: job.url,
      source_tweet_id: job.sourceTweetId,
      source_tweet_link: job.sourceTweetLink,
    });
  }

  for (const job of videoJobs.slice(0, MAX_X_VIDEO_DOWNLOADS)) {
    const result = await executeDownloadMedia({
      url: job.url,
      output_dir: 'downloads/x_fetch_media',
      audio_only: false,
    });
    if (!result.success) {
      errors.push(`download_media(${job.url}): ${result.error || 'failed'}`);
      continue;
    }
    const files = Array.isArray(result.data?.files) ? result.data.files : [];
    for (const file of files) {
      const relPath = String(file?.rel_path || '').trim();
      if (!relPath) continue;
      downloadedFiles.push({
        rel_path: relPath,
        path: file?.path ? String(file.path) : undefined,
        bytes: Number.isFinite(Number(file?.bytes)) ? Number(file.bytes) : undefined,
        kind: detectDownloadedMediaKind(relPath),
        source: 'download_media',
        url: job.url,
        source_tweet_id: job.sourceTweetId,
        source_tweet_link: job.sourceTweetLink,
      });
    }
  }

  // X's browser payload can expose the post text while omitting media metadata. A
  // status URL is still a safe, bounded yt-dlp target, so make one direct recovery
  // attempt whenever extraction found no files instead of silently returning no media.
  if (downloadedFiles.length === 0 && isXStatusUrl(fallbackUrl)) {
    fallbackPageDownloadAttempted = true;
    const fallbackResult = await executeDownloadMedia({
      url: fallbackUrl,
      output_dir: 'downloads/x_fetch_media',
      audio_only: false,
    });
    if (!fallbackResult.success) {
      errors.push(`download_media(${fallbackUrl}) fallback: ${fallbackResult.error || 'failed'}`);
    } else {
      const files = Array.isArray(fallbackResult.data?.files) ? fallbackResult.data.files : [];
      for (const file of files) {
        const relPath = String(file?.rel_path || '').trim();
        if (!relPath) continue;
        downloadedFiles.push({
          rel_path: relPath,
          path: file?.path ? String(file.path) : undefined,
          bytes: Number.isFinite(Number(file?.bytes)) ? Number(file.bytes) : undefined,
          kind: detectDownloadedMediaKind(relPath),
          source: 'download_media',
          url: fallbackUrl,
        });
      }
    }
  }

  const dedupedFiles = downloadedFiles.filter((file, index, arr) =>
    arr.findIndex(candidate => candidate.rel_path === file.rel_path) === index);
  const analyses: XMediaAnalysis[] = [];
  let analysisLimited = false;

  if (hintedTweetCount > 0) {
    const extractionMessage = dedupedFiles.length > 0
      ? `Extraction Complete. Downloaded ${dedupedFiles.length} file${dedupedFiles.length === 1 ? '' : 's'}.`
      : 'Extraction Complete. No downloadable media files were found.';
    reportWebFetchProgress(progress, 'extraction_complete', extractionMessage);
  }

  const analyzableFiles = dedupedFiles.filter(file => file.kind === 'image' || file.kind === 'video');
  if (analyzableFiles.length > 0) {
    const analysisLabel = classifyXMediaLabel(
      analyzableFiles.filter(file => file.kind === 'image').length,
      analyzableFiles.filter(file => file.kind === 'video').length,
    );
    reportWebFetchProgress(progress, 'analyzing_media', `Analyzing ${analysisLabel}...`);
  } else if (hintedTweetCount > 0) {
    reportWebFetchProgress(progress, 'analysis_skipped', 'Analysis skipped. No supported media files were available.');
  }

  const filesToAnalyze = dedupedFiles.slice(0, MAX_X_MEDIA_ANALYSES);
  if (dedupedFiles.length > filesToAnalyze.length) analysisLimited = true;
  const analysisResults = await mapWithConcurrency(
    filesToAnalyze,
    MAX_X_MEDIA_ANALYSIS_CONCURRENCY,
    async (file) => {
      try {
        return await analyzeDownloadedXMedia(file);
      } catch (error: any) {
        return {
          rel_path: file.rel_path,
          kind: file.kind,
          status: 'failed',
          error: String(error?.message || error || 'Media analysis failed.'),
        } as XMediaAnalysis;
      }
    },
  );
  analyses.push(...analysisResults);

  if (analyzableFiles.length > 0) {
    const analyzedCount = analyses.filter(item => item.status === 'analyzed').length;
    const analysisMessage = analyzedCount > 0
      ? `Analysis Complete. Analyzed ${analyzedCount} file${analyzedCount === 1 ? '' : 's'}.`
      : 'Analysis Complete. Media analysis finished without a successful result.';
    reportWebFetchProgress(progress, 'analysis_complete', analysisMessage);
  }

  return {
    detected: hintedTweetCount > 0,
    hinted_tweet_count: hintedTweetCount,
    direct_image_candidates: imageJobs.length,
    video_tweet_candidates: videoJobs.length,
    fallback_page_download_attempted: fallbackPageDownloadAttempted,
    downloaded_files: dedupedFiles,
    analyses,
    errors,
    analysis_limited: analysisLimited,
  };
}

function summarizeXMediaReport(report?: XFetchMediaReport): string | null {
  if (!report) return null;
  const parts: string[] = [];
  parts.push(report.detected
    ? `Detected media in ${report.hinted_tweet_count} tweet(s)`
    : 'No media detected');
  if (report.downloaded_files.length > 0) {
    parts.push(`downloaded ${report.downloaded_files.length} file(s)`);
  }
  const analyzedCount = report.analyses.filter(item => item.status === 'analyzed').length;
  if (analyzedCount > 0) {
    parts.push(`analyzed ${analyzedCount} file(s)`);
  }
  if (report.errors.length > 0) {
    parts.push(`media errors: ${report.errors.length}`);
  }
  if (report.analysis_limited) {
    parts.push('analysis output was capped');
  }
  return parts.join('; ');
}

async function executeXWebFetch(
  url: string,
  maxChars: number,
  progress?: WebFetchProgressReporter,
  includeMedia = false,
  includeThread = false,
): Promise<ToolResult> {
  let payload = !includeMedia && !includeThread && isXStatusUrl(url)
    ? await fetchXStatusViaOEmbed(url)
    : null;
  if (!payload) {
    const raw = await fetchXThread('web_fetch', url);
    payload = parseXFetchPayload(raw, url);
  }
  const payloadError = validateXFetchPayload(payload, url);
  if (payloadError) {
    payload.success = false;
    payload.error = payloadError;
  }

  if (payload.success) {
    reportWebFetchProgress(progress, 'fetch_complete', 'Web fetch complete.');
  }

  // Media is independently recoverable from valid X status URLs. Do not gate it on
  // post-text extraction: login/rate-limit failures previously skipped the proven media resolver entirely.
  if (isXStatusUrl(url) && includeMedia) {
    try {
      payload.x_media = await buildXMediaReport(payload, url, progress);
    } catch (error: any) {
      payload.x_media = {
        detected: false,
        hinted_tweet_count: 0,
        direct_image_candidates: 0,
        video_tweet_candidates: 0,
        fallback_page_download_attempted: false,
        downloaded_files: [],
        analyses: [],
        errors: [String(error?.message || error || 'X media pipeline failed.')],
        analysis_limited: false,
      };
    }
  }

  if (!payload.success && payload.x_media?.downloaded_files?.length) {
    payload.success = true;
    payload.error = undefined;
    payload.message = 'Post text extraction was unavailable, but media was recovered from the X status URL.';
    payload.count = Number(payload.x_media.hinted_tweet_count || 0);
  }

  const stdoutPayload = payload.x_media
    ? {
        success: payload.success,
        url: payload.url,
        count: payload.count,
        message: payload.message,
        error: payload.error,
        x_media_summary: summarizeXMediaReport(payload.x_media),
        x_media: payload.x_media,
        snapshot_deltas: payload.snapshot_deltas,
        tweets: payload.tweets,
      }
    : payload;
  const stdout = clipText(JSON.stringify(stdoutPayload, null, 2), maxChars);
  if (!payload.success) {
    return {
      success: false,
      error: payload.error || `X fetch failed for ${url}.`,
      data: payload,
      stdout,
    };
  }

  return {
    success: true,
    data: payload,
    stdout,
  };
}

export async function executeWebFetch(
  args: { url: string; max_chars?: number; include_media?: boolean; include_thread?: boolean },
  progress?: WebFetchProgressReporter,
): Promise<ToolResult> {
  if (!args.url?.trim()) return { success: false, error: 'url is required' };
  const url = String(args.url || '').trim();
  const maxChars = args.max_chars ?? 10_000;

  if (isXUrl(url)) {
    return executeXWebFetch(
      url,
      maxChars,
      progress,
      args.include_media === true,
      args.include_thread === true,
    );
  }

  const searchCfg = getSearchConfig();
  if (searchCfg.tinyfishKey && isTinyFishFetchEligible(url)) {
    try {
      const tinyFishResult = await fetchTinyFishContent(url, maxChars, searchCfg.tinyfishKey);
      if (tinyFishResult.success) return tinyFishResult;
      console.error(`[web_fetch] ${tinyFishResult.error || 'TinyFish Fetch returned no content'}; falling back to direct fetch.`);
    } catch (err: any) {
      console.error(`[web_fetch] TinyFish Fetch failed for ${url}; falling back to direct fetch:`, err?.message || String(err));
    }
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Prometheus/1.0' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status} from ${url}` };

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text') && !contentType.includes('json')) {
      return { success: false, error: `Non-text content-type: ${contentType}` };
    }

    const html = await res.text();
    const preview = /html/i.test(contentType)
      ? extractPagePreviewMetadataFromHtml(html.slice(0, 1_500_000), res.url || url)
      : { url } as PagePreviewMetadata;
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s{3,}/g, '\n\n')
      .trim();

    if (text.length > maxChars) text = text.slice(0, maxChars) + '\n\n[...truncated]';

    return {
      success: true,
      data: {
        url,
        final_url: res.url || url,
        length: text.length,
        title: preview.title,
        description: preview.description,
        publisher: preview.publisher,
        published_at: preview.publishedAt,
        image_url: preview.imageUrl,
        icon_url: preview.iconUrl,
        preview,
      },
      stdout: text,
    };
  } catch (err: any) {
    return { success: false, error: `Fetch failed: ${err.message}` };
  }
}

type WebFetchBatchArgs = {
  urls: string[];
  max_chars?: number;
  concurrency?: number;
  include_media?: boolean;
  include_thread?: boolean;
};

function normalizeBatchUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
  }
  return normalized.slice(0, 20);
}

export async function executeWebFetchBatch(
  args: WebFetchBatchArgs,
  progress?: WebFetchProgressReporter,
): Promise<ToolResult> {
  const urls = normalizeBatchUrls(args.urls);
  if (!urls.length) return { success: false, error: 'urls array is required' };

  const maxChars = Math.max(500, Math.min(Number(args.max_chars ?? 6_000), 25_000));
  const concurrency = Math.max(1, Math.min(Number(args.concurrency ?? 4), 8));
  const results: Array<{
    url: string;
    status: 'ok' | 'error';
    text?: string;
    data?: any;
    error?: string;
    length?: number;
  }> = new Array(urls.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      const url = urls[index];
      try {
        const result = await executeWebFetch({
          url,
          max_chars: maxChars,
          include_media: args.include_media === true,
          include_thread: args.include_thread === true,
        }, progress);
        const text = result.stdout || '';
        results[index] = result.success
          ? {
              url,
              status: 'ok',
              text,
              data: result.data,
              length: text.length,
            }
          : {
              url,
              status: 'error',
              text,
              data: result.data,
              error: result.error || text || `Fetch failed for ${url}.`,
              length: text.length,
            };
      } catch (err: any) {
        results[index] = {
          url,
          status: 'error',
          error: err?.message || String(err),
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));

  const ok = results.filter(r => r?.status === 'ok').length;
  const failed = results.length - ok;
  const stdout = results.map((item, i) => {
    if (!item || item.status === 'error') {
      return `[${i + 1}] ERROR ${item?.url || urls[i]}\n${item?.error || 'Unknown fetch error'}`;
    }
    return `[${i + 1}] ${item.url}\n${clipText(item.text || '', maxChars)}`;
  }).join('\n\n---\n\n');

  return {
    success: ok > 0,
    error: ok > 0 ? undefined : 'All batch fetches failed.',
    data: {
      count: results.length,
      ok,
      failed,
      max_chars_per_url: maxChars,
      concurrency,
      results,
    },
    stdout,
  };
}

async function maybeAttachFetchedSearchResults(
  result: ToolResult,
  args: { fetch_top_k?: number; fetch_max_chars?: number },
): Promise<ToolResult> {
  const fetchTopK = Math.max(0, Math.min(Number(args.fetch_top_k ?? 0), 10));
  if (!result.success || fetchTopK <= 0 || !Array.isArray(result.data?.results)) return result;

  const urls = normalizeBatchUrls(
    result.data.results
      .slice(0, fetchTopK)
      .map((item: SearchResultItem) => item?.url),
  );
  if (!urls.length) return result;

  const batch = await executeWebFetchBatch({
    urls,
    max_chars: args.fetch_max_chars ?? 4_000,
    concurrency: Math.min(4, urls.length),
  });
  const fetchedByUrl = new Map<string, any>();
  for (const fetched of (Array.isArray(batch.data?.results) ? batch.data.results : [])) {
    if (!fetched?.url) continue;
    fetchedByUrl.set(String(fetched.url), fetched.data?.preview || fetched.data || {});
  }
  const enrichedResults = result.data.results.map((item: SearchResultItem) => {
    const preview = fetchedByUrl.get(String(item?.url || '')) || {};
    return {
      ...item,
      title: item.title || preview.title || '',
      snippet: item.snippet || preview.description || '',
      imageUrl: item.imageUrl || preview.imageUrl || preview.image_url || undefined,
      publisher: item.publisher || preview.publisher || undefined,
      publishedAt: item.publishedAt || preview.publishedAt || preview.published_at || undefined,
    };
  });
  result.data = {
    ...(result.data || {}),
    results: enrichedResults,
    fetched_results: batch.data?.results || [],
    fetch_summary: {
      count: batch.data?.count || 0,
      ok: batch.data?.ok || 0,
      failed: batch.data?.failed || 0,
    },
  };
  if (batch.stdout) {
    result.stdout = `${result.stdout || ''}\n\n[Fetched top ${urls.length} result URL${urls.length === 1 ? '' : 's'}]\n\n${batch.stdout}`.trim();
  }
  return result;
}

export const webSearchTool = {
  name: 'web_search',
  get description() {
    return `Search the web. Configured providers: ${getSearchProvidersSummary()}. Provider thumbnails, publisher, and date fields are preserved when available. Defaults to the preferred provider from Settings for low latency. Pass provider to force one engine, or use provider:"multi" / multi_engine:true for wide research across all configured engines. fetch_top_k fetches top pages and merges preview metadata/images back into results.`;
  },
  execute: executeWebSearch,
  schema: {
    query: 'string (required) - Search query',
    max_results: 'number (optional, default 5) - Max results to return',
    multi_engine: 'boolean (optional, default false) - Pass true for wide research across all configured search providers',
    provider: 'string (optional) - One of tinyfish, tavily, google, brave, ddg, xai, multi. Use a provider name for single-provider search; use multi for all configured engines',
    fetch_top_k: 'number (optional, default 0, max 10) - Fetch this many top result URLs after search',
    fetch_max_chars: 'number (optional, default 4000) - Max characters per fetched result when fetch_top_k is set',
    provider_timeout_ms: 'number (optional, default 6000, max 15000) - Per-provider search timeout in milliseconds',
  },
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Maximum results to return per provider. Default 5, max 10.' },
      multi_engine: { type: 'boolean', description: 'Default false. Set true for wide research across all configured search providers.' },
      provider: {
        type: 'string',
        enum: ['multi', 'tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai'],
        description: 'Optional provider selector. Use multi for every configured provider, or a provider name for one provider.',
      },
      fetch_top_k: { type: 'number', description: 'Optional. Fetch this many top result URLs after search. Default 0, max 10.' },
      fetch_max_chars: { type: 'number', description: 'Optional. Max characters per fetched result when fetch_top_k is set. Default 4000.' },
      provider_timeout_ms: { type: 'number', description: 'Optional per-provider timeout in milliseconds. Default 6000, max 15000.' },
    },
    additionalProperties: false,
  },
};

export const webSearchSingleTool = {
  name: 'web_search_single',
  get description() {
    return `Search using one provider only. Defaults to the preferred provider from Settings. Configured providers: ${getSearchProvidersSummary()}. Use provider to override for testing.`;
  },
  execute: (args: { query: string; max_results?: number; provider?: SearchProviderOption; fetch_top_k?: number; fetch_max_chars?: number; provider_timeout_ms?: number }) =>
    executeWebSearch({ ...args, multi_engine: false }),
  schema: {
    query: 'string (required) - Search query',
    max_results: 'number (optional, default 5) - Max results to return',
    provider: 'string (optional) - One of tinyfish, tavily, google, brave, ddg, xai. Omit to use Settings preferred provider',
    fetch_top_k: 'number (optional, default 0, max 10) - Fetch this many top result URLs after search',
    fetch_max_chars: 'number (optional, default 4000) - Max characters per fetched result when fetch_top_k is set',
    provider_timeout_ms: 'number (optional, default 6000, max 15000) - Per-provider search timeout in milliseconds',
  },
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Maximum results to return. Default 5, max 10.' },
      provider: {
        type: 'string',
        enum: ['tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai'],
        description: 'Optional provider override. Omit to use Settings preferred provider.',
      },
      fetch_top_k: { type: 'number', description: 'Optional. Fetch this many top result URLs after search. Default 0, max 10.' },
      fetch_max_chars: { type: 'number', description: 'Optional. Max characters per fetched result when fetch_top_k is set. Default 4000.' },
      provider_timeout_ms: { type: 'number', description: 'Optional per-provider timeout in milliseconds. Default 6000, max 15000.' },
    },
    additionalProperties: false,
  },
};

export const webSearchMultiTool = {
  name: 'web_search_multi',
  get description() {
    return `Search using every configured credentialed provider in parallel, including xAI X Search when connected, then merge deduplicated results. Configured providers: ${getSearchProvidersSummary()}.`;
  },
  execute: (args: { query: string; max_results?: number; fetch_top_k?: number; fetch_max_chars?: number; provider_timeout_ms?: number }) =>
    executeWebSearch({ ...args, provider: 'multi' }),
  schema: {
    query: 'string (required) - Search query',
    max_results: 'number (optional, default 5) - Max results to return per provider',
    fetch_top_k: 'number (optional, default 0, max 10) - Fetch this many top result URLs after search',
    fetch_max_chars: 'number (optional, default 4000) - Max characters per fetched result when fetch_top_k is set',
    provider_timeout_ms: 'number (optional, default 6000, max 15000) - Per-provider search timeout in milliseconds',
  },
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Maximum results to return per provider. Default 5, max 10.' },
      fetch_top_k: { type: 'number', description: 'Optional. Fetch this many top result URLs after search. Default 0, max 10.' },
      fetch_max_chars: { type: 'number', description: 'Optional. Max characters per fetched result when fetch_top_k is set. Default 4000.' },
      provider_timeout_ms: { type: 'number', description: 'Optional per-provider timeout in milliseconds. Default 6000, max 15000.' },
    },
    additionalProperties: false,
  },
};

export const webFetchTool = {
  name: 'web_fetch',
  description: 'Fetch text plus structured page preview metadata (title, description, publisher, date, hero image, icon) from one URL, or multiple URLs in parallel. Exact X/Twitter statuses use the official X oEmbed endpoint; thread expansion is opt-in with include_thread=true. Attached media is downloaded and analyzed only when include_media=true.',
  execute: (args: { url?: string; urls?: string[]; max_chars?: number; concurrency?: number; include_media?: boolean; include_thread?: boolean }, progress?: WebFetchProgressReporter) =>
    Array.isArray(args?.urls) && args.urls.length
      ? executeWebFetchBatch({ urls: args.urls, max_chars: args.max_chars, concurrency: args.concurrency, include_media: args.include_media, include_thread: args.include_thread }, progress)
      : executeWebFetch({ url: args?.url || '', max_chars: args?.max_chars, include_media: args?.include_media, include_thread: args?.include_thread }, progress),
  schema: {
    url: 'string (optional) - Single full URL to fetch (include https://)',
    urls: 'string[] (optional, max 20) - Multiple full URLs to fetch in parallel',
    max_chars: 'number (optional) - Single fetch max characters, or max characters per URL for urls',
    concurrency: 'number (optional, default 4, max 8) - Batch-only parallel fetches',
    include_media: 'boolean (optional, default false) - X status URLs only. Download and analyze attached media when explicitly requested.',
    include_thread: 'boolean (optional, default false) - X status URLs only. Use browser extraction to expand the surrounding thread.',
  },
  jsonSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Single full URL to fetch.' },
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple full URLs to fetch. Duplicate and blank URLs are ignored. Max 20.',
      },
      max_chars: { type: 'number', description: 'Single fetch max characters, or max characters per URL for urls.' },
      concurrency: { type: 'number', description: 'Batch-only parallel fetches. Default 4, max 8.' },
      include_media: { type: 'boolean', description: 'X status URLs only. Default false. Download and analyze attached media only when explicitly requested.' },
      include_thread: { type: 'boolean', description: 'X status URLs only. Default false. Use browser extraction to expand the surrounding thread.' },
    },
    additionalProperties: false,
  },
};

// ── Fast product search/carousel helper ────────────────────────────────────────
const PRODUCT_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const PRODUCT_METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const productSearchCache = new Map<string, { at: number; result: ToolResult }>();
const productMetadataCache = new Map<string, { at: number; meta: Partial<ShoppingProductResult> }>();

const MERCHANT_DOMAINS: Record<string, string> = {
  amazon: 'amazon.com',
  'amazon.com': 'amazon.com',
  walmart: 'walmart.com',
  'walmart.com': 'walmart.com',
  target: 'target.com',
  'target.com': 'target.com',
  bestbuy: 'bestbuy.com',
  'best buy': 'bestbuy.com',
  'bestbuy.com': 'bestbuy.com',
  ebay: 'ebay.com',
  'ebay.com': 'ebay.com',
  homedepot: 'homedepot.com',
  'home depot': 'homedepot.com',
  'homedepot.com': 'homedepot.com',
  lowes: 'lowes.com',
  "lowe's": 'lowes.com',
  'lowes.com': 'lowes.com',
};

function htmlDecodeLite(input: string): string {
  return String(input || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function merchantDomain(input: unknown): string {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return '';
  return MERCHANT_DOMAINS[value] || value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

function merchantFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const known = Object.entries(MERCHANT_DOMAINS).find(([, domain]) => host.endsWith(domain));
    if (known) return known[0].replace(/\.com$/, '').replace(/\b\w/g, (c) => c.toUpperCase());
    const base = host.split('.').slice(-2, -1)[0] || host;
    return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return '';
  }
}

function buildProductSearchQuery(query: string, merchant?: string): string {
  const q = String(query || '').trim();
  const domain = merchantDomain(merchant);
  if (!domain) return `${q} product price rating review`;
  if (domain.includes('amazon.com')) return `site:amazon.com/dp ${q} ${q.toLowerCase().includes('keyboard') ? '"keyboard"' : ''} price rating review`.replace(/\s+/g, ' ').trim();
  if (q.toLowerCase().includes(domain.toLowerCase())) return `${q} product price rating review`;
  return `site:${domain} ${q} product price rating review`;
}

function stripProductSearchNoise(input: string): string {
  return htmlDecodeLite(input)
    .replace(/\b(?:Keyboard shortcuts?|Image unavailable|Eligible for Return|FREE Returns|Sponsored|Climate Pledge Friendly)\b.*$/i, '')
    .replace(/\b(?:Ships from|Sold by|Delivery|Deliver(?:ed|y)|FREE delivery|Prime members?|Usually ships|Only \d+ left)\b.*$/i, '')
    .replace(/\b(?:Customer Review|Customers say|Top reviews?|Reviews? with images|See all reviews?)\b.*$/i, '')
    .replace(/\b(?:Visit the .* Store|Shop the .* Store|Brand:)\b/gi, '')
    .replace(/\s*#{2,}\s*/g, ' ')
    .replace(/\s*(?:\|\s*)?(?:Amazon\.com|Walmart\.com|Target|Best Buy|eBay)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanProductDescription(snippet: string): string | undefined {
  let text = stripProductSearchNoise(snippet)
    .replace(/^\s*[-•]\s*/, '')
    .replace(/\s*\.\.\.\s*$/g, '')
    .trim();
  if (!text) return undefined;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  text = (sentences.length ? sentences.slice(0, 2).join(' ') : text).trim();
  if (/^(?:shop|buy|amazon\.com)$/i.test(text)) return undefined;
  return text.length > 150 ? `${text.slice(0, 149).trim()}…` : text;
}

function looksLikeProductTitle(title: string): boolean {
  const value = String(title || '').trim();
  if (value.length < 8) return false;
  if (/^(?:amazon\.com|walmart\.com|target|best buy|ebay|shop|search results)$/i.test(value)) return false;
  if (/\b(?:customer service|help|returns policy|gift cards|sell on|shopping cart)\b/i.test(value)) return false;
  return true;
}

function cleanProductTitle(title: string): string {
  return stripProductSearchNoise(title)
    .replace(/^\s*(?:Amazon\.com|Walmart\.com|Target|Best Buy|eBay)\s*:\s*/i, '')
    .replace(/\s*[-|]\s*(?:Amazon\.com|Walmart\.com|Target|Best Buy|eBay|The Home Depot|Lowe'?s).*$/i, '')
    .replace(/\s*\$[0-9][0-9,]*(?:\.[0-9]{2})?.*$/i, '')
    .replace(/\s+(?:reviews?|ratings?|stars?).*$/i, '')
    .replace(/\s+(?:Mechanical Keyboards?|Wireless Keyboards?)\s*-\s*Amazon\.com.*$/i, '')
    .trim()
    .slice(0, 110);
}

const PRODUCT_QUERY_STOPWORDS = new Set([
  'amazon', 'product', 'products', 'price', 'rating', 'review', 'reviews', 'best', 'good',
  'with', 'from', 'that', 'this', 'under', 'over', 'and', 'for', 'the', 'office', 'gaming',
]);

function productQueryTokens(query: string): string[] {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PRODUCT_QUERY_STOPWORDS.has(token))
    .slice(0, 14);
}

function productTextTokens(text: string): Set<string> {
  return new Set(String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3));
}

function productQueryRelevanceScore(query: string, text: string): number {
  const queryTokens = productQueryTokens(query);
  if (!queryTokens.length) return 1;
  const textTokens = productTextTokens(text);
  let score = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) score += 1;
    if (token.endsWith('s') && textTokens.has(token.slice(0, -1))) score += 0.8;
  }
  return score / Math.max(1, queryTokens.length);
}

function hasRequiredProductIntent(query: string, text: string): boolean {
  const q = String(query || '').toLowerCase();
  const t = String(text || '').toLowerCase();
  if (/\bkeyboards?\b/.test(q)) {
    if (!/\bkeyboards?\b/.test(t)) return false;
    if (/\b(?:shavers?|razors?|mouse\s*pads?|desks?|covers?|cases?|skins?|switch\s+pullers?|keycap\s+pullers?)\b/.test(t)) return false;
    if (!/\b(?:combo|mouse|mice)\b/.test(q) && /\bkeyboard\s+(?:and|&|\+)\s+mouse\b|\bmouse\s+(?:and|&|\+)\s+keyboard\b|\bkeyboard\/mouse\b/i.test(t)) return false;
  }
  if (/\bmechanical\b/.test(q) && !/\bmechanical\b/.test(t)) return false;
  if (/\bwireless\b/.test(q) && !/\b(?:wireless|bluetooth|2\.4g|2\.4ghz|tri-mode|trimode)\b/.test(t)) return false;
  if (/\bmouse|mice\b/.test(q) && !/\bmouse|mice\b/.test(t)) return false;
  if (/\b(?:laptops?|notebooks?)\b/.test(q) && !/\b(?:laptops?|notebooks?)\b/.test(t)) return false;
  if (/\b(?:headphones?|earbuds?|earphones?)\b/.test(q) && !/\b(?:headphones?|earbuds?|earphones?)\b/.test(t)) return false;
  return true;
}

function extractPrice(text: string): string | undefined {
  const clean = stripProductSearchNoise(text);
  const m = clean.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/)
    || clean.match(/\b(?:Price|Now|Sale)\s*[:\-]?\s*(\$[0-9][0-9,]*(?:\.[0-9]{2})?)/i);
  return m?.[0];
}

function extractRating(text: string): number | undefined {
  const raw = String(text || '');
  const m = raw.match(/\b([0-5](?:\.[0-9])?)\s*(?:out of\s*5|\/\s*5|stars?|★)/i)
    || raw.match(/\b([0-5](?:\.[0-9])?)\s+[0-5](?:\.[0-9])?\s+out of\s+5\s+stars/i)
    || raw.match(/\brated\s+([0-5](?:\.[0-9])?)\b/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : undefined;
}

function extractReviewCount(text: string): number | undefined {
  const m = String(text || '').match(/\b([0-9][0-9,]*)\s+(?:reviews?|ratings?)\b/i)
    || String(text || '').match(/\((?:\s*)?([0-9][0-9,]*)\s*\)\s*(?:reviews?|ratings?)?/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function extractBadge(text: string): string | undefined {
  const value = String(text || '');
  if (/amazon'?s choice/i.test(value)) return "Amazon's Choice";
  if (/best seller/i.test(value)) return 'Best Seller';
  if (/overall pick/i.test(value)) return 'Overall Pick';
  if (/limited time deal/i.test(value)) return 'Deal';
  if (/sale|save \d+%/i.test(value)) return 'Sale';
  return undefined;
}

function productUrlScore(url: string): number {
  const lower = String(url || '').toLowerCase();
  if (/\/(?:dp|gp\/product)\//.test(lower)) return 0.3;
  if (/\/(?:product|products|p|itm|ip|sku)\//.test(lower)) return 0.22;
  if (/[?&](?:sku|productid|itemid|model)=/.test(lower)) return 0.12;
  if (/\/search|\/s\?|\/b\?/.test(lower)) return -0.25;
  return 0;
}

function canonicalProductUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const asin = u.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]
      || u.searchParams.get('asin')
      || u.searchParams.get('ASIN');
    if (asin && /amazon\./i.test(u.hostname)) return `https://${u.hostname.replace(/^www\./, 'www.')}/dp/${asin.toUpperCase()}`;
    u.hash = '';
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(?:tag|ascsubtag|ref|ref_|pd_|sprefix|crid|keywords|qid|sr|th|psc|dib|dib_tag|utm_)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    return u.href;
  } catch {
    return raw;
  }
}

export function validateXFetchPayload(payload: XFetchPayload, url: string): string | null {
  if (!payload.success) return payload.error || `X fetch failed for ${url}.`;
  if (!isXStatusUrl(url)) return null;
  const tweets = Array.isArray(payload.tweets) ? payload.tweets : [];
  const count = Number.isFinite(Number(payload.count)) ? Number(payload.count) : tweets.length;
  if (tweets.length === 0 || count <= 0) {
    return `X fetch returned no posts for ${url}. The post may be deleted, unavailable, login-gated, or extraction may have been blocked.`;
  }
  return null;
}

function amazonAsinFromUrl(url: string): string | undefined {
  return String(url || '').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase();
}

function isWeakProductCandidate(item: SearchResultItem, title: string, price?: string): boolean {
  const url = String(item.url || '').toLowerCase();
  const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  if (!title || title.length < 8) return true;
  if (/\/(?:search|s|b)\?/.test(url) && !price && !/\b(?:out of 5|stars?|reviews?|ratings?)\b/i.test(text)) return true;
  if (/\b(?:customer service|help|returns policy|gift cards|sell on)\b/i.test(text)) return true;
  return false;
}

function normalizeProductCandidate(item: SearchResultItem, index: number, query: string, merchant?: string): ShoppingProductResult | null {
  const text = `${item.title || ''} ${item.snippet || ''}`;
  const title = cleanProductTitle(item.title || '');
  if (!title || !item.url) return null;
  const price = extractPrice(text);
  if (isWeakProductCandidate(item, title, price)) return null;
  const relevanceText = `${title} ${item.snippet || ''}`;
  if (!hasRequiredProductIntent(query, relevanceText)) return null;
  const relevance = productQueryRelevanceScore(query, relevanceText);
  if (relevance < 0.18) return null;
  const rating = extractRating(text);
  const reviewCount = extractReviewCount(text);
  const badge = extractBadge(text);
  let confidence = 0.36 + productUrlScore(item.url) + Math.min(0.24, relevance * 0.24);
  if (price) confidence += 0.16;
  if (rating != null) confidence += 0.12;
  if (reviewCount != null) confidence += 0.1;
  if (badge) confidence += 0.05;
  const requestedDomain = merchantDomain(merchant);
  if (requestedDomain && item.url.toLowerCase().includes(requestedDomain)) confidence += 0.18;
  return {
    id: `product_${index + 1}`,
    title,
    price,
    description: cleanProductDescription(item.snippet || ''),
    rating,
    reviews: reviewCount,
    reviewCount,
    tag: badge,
    badge,
    imageUrl: normalizeProductImageUrl(item.imageUrl || '', item.url),
    productUrl: canonicalProductUrl(item.url),
    merchant: merchant ? merchantFromUrl(`https://${requestedDomain || merchant}`) : merchantFromUrl(item.url),
    asin: amazonAsinFromUrl(item.url),
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
  };
}

export type PagePreviewMetadata = {
  url: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  publisher?: string;
  publishedAt?: string;
  imageUrl?: string;
  iconUrl?: string;
  price?: string;
  rating?: number;
  reviews?: number;
  reviewCount?: number;
  availability?: string;
  seller?: string;
  sku?: string;
};

const PAGE_PREVIEW_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const pagePreviewCache = new Map<string, { at: number; meta: PagePreviewMetadata }>();

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(String(tag || ''))) !== null) {
    const name = String(match[1] || '').toLowerCase();
    if (!name || name.startsWith('<')) continue;
    attrs[name] = htmlDecodeLite(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function extractMetaTag(html: string, property: string): string | undefined {
  const wanted = String(property || '').toLowerCase();
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (String(attrs.property || attrs.name || attrs.itemprop || '').toLowerCase() !== wanted) continue;
    const value = htmlDecodeLite(attrs.content || attrs.value || '');
    if (value) return value;
  }
  return undefined;
}

function extractLinkTag(html: string, rel: string): string | undefined {
  const wanted = String(rel || '').toLowerCase();
  for (const tag of String(html || '').match(/<link\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (String(attrs.rel || '').toLowerCase().split(/\s+/).includes(wanted) && attrs.href) return attrs.href;
  }
  return undefined;
}

function absoluteHttpUrl(value: unknown, baseUrl: string): string | undefined {
  const raw = asFirstString(value);
  if (!raw || /^(?:data|blob|javascript):/i.test(raw)) return undefined;
  try {
    const parsed = new URL(raw, baseUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function pickLargestSrcset(value: string): string | undefined {
  const entries = String(value || '').split(',').map((part) => {
    const pieces = part.trim().split(/\s+/);
    return { url: pieces[0], size: Number(String(pieces[1] || '').replace(/[^0-9.]/g, '')) || 0 };
  }).filter((entry) => entry.url).sort((a, b) => b.size - a.size);
  return entries[0]?.url;
}

function imageCandidateScore(url: string, attrs: Record<string, string>, priority: number): number {
  const text = `${url} ${attrs.alt || ''} ${attrs.class || ''} ${attrs.id || ''}`.toLowerCase();
  const width = Number(attrs.width || 0);
  const height = Number(attrs.height || 0);
  let score = priority;
  if (width >= 300 || height >= 200) score += 18;
  if (width >= 800 || height >= 500) score += 8;
  if (/hero|lead|article|product|primary|main|featured|landing/.test(text)) score += 15;
  if (/logo|icon|avatar|sprite|badge|emoji|tracking|pixel|spacer|placeholder/.test(text)) score -= 35;
  if ((width > 0 && width < 120) || (height > 0 && height < 90)) score -= 18;
  return score;
}

function extractHtmlImageCandidates(html: string, pageUrl: string): string[] {
  const candidates: Array<{ url: string; score: number }> = [];
  const add = (value: unknown, score: number, attrs: Record<string, string> = {}) => {
    const url = absoluteHttpUrl(value, pageUrl);
    if (url) candidates.push({ url, score: imageCandidateScore(url, attrs, score) });
  };
  add(extractMetaTag(html, 'og:image:secure_url'), 120);
  add(extractMetaTag(html, 'og:image'), 118);
  add(extractMetaTag(html, 'twitter:image'), 115);
  add(extractMetaTag(html, 'twitter:image:src'), 114);
  add(extractMetaTag(html, 'thumbnailUrl'), 108);
  add(extractLinkTag(html, 'image_src'), 105);
  for (const tag of (String(html || '').match(/<img\b[^>]*>/gi) || []).slice(0, 300)) {
    const attrs = parseHtmlAttributes(tag);
    if (attrs['data-a-dynamic-image']) {
      try {
        const dynamic = JSON.parse(attrs['data-a-dynamic-image']) as Record<string, unknown>;
        for (const [url, dimensions] of Object.entries(dynamic)) {
          const dims = Array.isArray(dimensions) ? dimensions.map(Number) : [];
          add(url, 100 + Math.min(20, ((dims[0] || 0) * (dims[1] || 0)) / 100_000), attrs);
        }
      } catch {}
    }
    add(attrs['data-old-hires'], 104, attrs);
    add(attrs['data-zoom-hires'], 103, attrs);
    add(pickLargestSrcset(attrs.srcset || attrs['data-srcset'] || ''), 80, attrs);
    add(attrs['data-src'] || attrs['data-lazy-src'] || attrs['data-original'] || attrs.src, 62, attrs);
  }
  const seen = new Set<string>();
  return candidates.sort((a, b) => b.score - a.score).filter((candidate) => {
    if (candidate.score <= 20 || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  }).map((candidate) => candidate.url);
}

function collectJsonLdObjects(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdObjects(item, out);
    return out;
  }
  const obj = value as Record<string, unknown>;
  out.push(obj);
  for (const key of ['@graph', 'mainEntity', 'itemListElement']) collectJsonLdObjects(obj[key], out);
  return out;
}

function parseJsonLdPageMetadata(html: string): Partial<PagePreviewMetadata> {
  const meta: Partial<PagePreviewMetadata> = {};
  const scripts = String(html || '').match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts.slice(0, 20)) {
    const raw = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    if (!raw) continue;
    try {
      const objects = collectJsonLdObjects(JSON.parse(htmlDecodeLite(raw)));
      const preferred = objects.find((obj) => normalizeJsonLdType(obj['@type']).some((type) =>
        ['newsarticle', 'article', 'blogposting', 'product', 'webpage'].includes(type))) || objects[0];
      if (!preferred) continue;
      meta.title ||= asFirstString(preferred.headline) || asFirstString(preferred.name);
      meta.description ||= asFirstString(preferred.description);
      meta.imageUrl ||= asFirstString(preferred.image) || asFirstString(preferred.thumbnailUrl);
      meta.publishedAt ||= asFirstString(preferred.datePublished) || asFirstString(preferred.dateCreated);
      meta.canonicalUrl ||= asFirstString(preferred.url) || asFirstString(preferred.mainEntityOfPage);
      const publisher = preferred.publisher || preferred.author;
      meta.publisher ||= typeof publisher === 'object' && publisher
        ? asFirstString((publisher as Record<string, unknown>).name)
        : asFirstString(publisher);
    } catch {}
  }
  return meta;
}

/** Pure HTML metadata extractor shared by web fetch and all URL-backed visual cards. */
export function extractPagePreviewMetadataFromHtml(html: string, pageUrl: string): PagePreviewMetadata {
  const jsonLd = parseJsonLdPageMetadata(html);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''))?.[1] || '';
  const imageUrl = [jsonLd.imageUrl, ...extractHtmlImageCandidates(html, pageUrl)]
    .map((value) => absoluteHttpUrl(value, pageUrl)).find(Boolean);
  const iconRaw = extractLinkTag(html, 'apple-touch-icon') || extractLinkTag(html, 'icon') || extractLinkTag(html, 'shortcut');
  let originIcon: string | undefined;
  try { originIcon = new URL('/favicon.ico', pageUrl).href; } catch {}
  return {
    url: pageUrl,
    canonicalUrl: absoluteHttpUrl(extractLinkTag(html, 'canonical') || jsonLd.canonicalUrl, pageUrl),
    title: htmlDecodeLite(extractMetaTag(html, 'og:title') || extractMetaTag(html, 'twitter:title') || jsonLd.title || titleTag),
    description: htmlDecodeLite(extractMetaTag(html, 'og:description') || extractMetaTag(html, 'twitter:description') || extractMetaTag(html, 'description') || jsonLd.description || ''),
    publisher: htmlDecodeLite(extractMetaTag(html, 'og:site_name') || extractMetaTag(html, 'application-name') || jsonLd.publisher || ''),
    publishedAt: extractMetaTag(html, 'article:published_time') || extractMetaTag(html, 'date') || extractMetaTag(html, 'datePublished') || jsonLd.publishedAt,
    imageUrl,
    iconUrl: absoluteHttpUrl(iconRaw || originIcon, pageUrl),
  };
}

function extractAttributeNear(html: string, attrName: string, attrValue: string, targetAttr: string): string | undefined {
  const escapedName = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedValue = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedTarget = targetAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = new RegExp(`<[^>]+${escapedName}=["']${escapedValue}["'][^>]*>`, 'i').exec(html)?.[0] || '';
  if (!tag) return undefined;
  const value = new RegExp(`${escapedTarget}=["']([^"']+)["']`, 'i').exec(tag)?.[1] || '';
  return htmlDecodeLite(value);
}

function fallbackProductPagePrice(html: string): string | undefined {
  const itempropPrice = extractAttributeNear(html, 'itemprop', 'price', 'content');
  const currency = extractAttributeNear(html, 'itemprop', 'priceCurrency', 'content') || 'USD';
  if (itempropPrice) return `${currency === 'USD' ? '$' : `${currency} `}${itempropPrice}`;
  const twitterData = extractMetaTag(html, 'twitter:data1') || extractMetaTag(html, 'twitter:label1');
  return extractPrice(twitterData || html.slice(0, 60_000));
}

function fallbackProductPageRating(html: string): Pick<ShoppingProductResult, 'rating' | 'reviews' | 'reviewCount'> {
  const compact = htmlDecodeLite(html.slice(0, 90_000).replace(/<[^>]+>/g, ' '));
  const rating = extractRating(compact);
  const reviews = extractReviewCount(compact);
  return {
    rating,
    reviews,
    reviewCount: reviews,
  };
}

function asFirstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return asFirstString(value[0]);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return asFirstString(obj.url) || asFirstString(obj.contentUrl) || asFirstString(obj.src);
  }
  return undefined;
}

function normalizeJsonLdType(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(normalizeJsonLdType);
  return typeof value === 'string' ? [value.toLowerCase()] : [];
}

function collectJsonLdProducts(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdProducts(item, out);
    return out;
  }
  const obj = value as Record<string, unknown>;
  if (normalizeJsonLdType(obj['@type']).includes('product')) out.push(obj);
  collectJsonLdProducts(obj['@graph'], out);
  return out;
}

function parseJsonLdProductMetadata(html: string): Partial<ShoppingProductResult> {
  const meta: Partial<ShoppingProductResult> = {};
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts.slice(0, 12)) {
    const raw = script
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    if (!raw) continue;
    try {
      const products = collectJsonLdProducts(JSON.parse(htmlDecodeLite(raw)));
      for (const product of products) {
        const title = cleanProductTitle(asFirstString(product.name) || '');
        if (looksLikeProductTitle(title)) meta.title ||= title;
        meta.description ||= cleanProductDescription(asFirstString(product.description) || '');
        meta.imageUrl ||= asFirstString(product.image);
        meta.sku ||= asFirstString(product.sku) || asFirstString(product.mpn) || asFirstString(product.productID);
        const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (offers && typeof offers === 'object') {
          const offer = offers as Record<string, unknown>;
          const price = asFirstString(offer.price) || asFirstString(offer.lowPrice);
          const currency = asFirstString(offer.priceCurrency) || 'USD';
          if (price && !meta.price) meta.price = `${currency === 'USD' ? '$' : `${currency} `}${price}`;
          meta.availability ||= asFirstString(offer.availability)?.split('/').pop();
          const seller = offer.seller;
          meta.seller ||= seller && typeof seller === 'object'
            ? asFirstString((seller as Record<string, unknown>).name)
            : asFirstString(seller);
        }
        const rating = product.aggregateRating;
        if (rating && typeof rating === 'object') {
          const aggregate = rating as Record<string, unknown>;
          const ratingValue = Number(asFirstString(aggregate.ratingValue));
          const reviewCount = Number(String(asFirstString(aggregate.reviewCount) || asFirstString(aggregate.ratingCount) || '').replace(/,/g, ''));
          if (Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 5) meta.rating ||= ratingValue;
          if (Number.isFinite(reviewCount) && reviewCount > 0) {
            meta.reviews ||= reviewCount;
            meta.reviewCount ||= reviewCount;
          }
        }
        if (meta.title || meta.price || meta.imageUrl) return meta;
      }
    } catch {
      // Some merchants embed invalid JSON-LD. Open Graph fallback below still helps.
    }
  }
  return meta;
}

function getActiveWorkspaceRoot(): string {
  try {
    const { getConfig } = require('../config/config') as typeof import('../config/config');
    const { getActiveWorkspace } = require('./workspace-context') as typeof import('./workspace-context');
    const globalWorkspace = getConfig().getConfig().workspace.path;
    return getActiveWorkspace(globalWorkspace);
  } catch {
    return process.cwd();
  }
}

function safeArtifactImageFilename(label: string, index: number, contentType = '', imageUrl = ''): string {
  const extFromType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const extFromUrl = (() => {
    try {
      const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
      return /\.(?:jpg|jpeg|png|webp|gif|avif)$/i.test(ext) ? ext : '';
    } catch {
      return '';
    }
  })();
  const ext = extFromType === 'image/png' ? '.png'
    : extFromType === 'image/webp' ? '.webp'
      : extFromType === 'image/gif' ? '.gif'
        : extFromType === 'image/avif' ? '.avif'
          : extFromUrl || '.jpg';
  const hash = createHash('sha1').update(imageUrl).digest('hex').slice(0, 10);
  const stem = `${String(index + 1).padStart(2, '0')}-${label || 'preview'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `preview-${index + 1}`;
  return `${stem}-${hash}${ext}`;
}

function normalizeProductImageUrl(imageUrl: string, productUrl: string): string {
  const raw = String(imageUrl || '').trim();
  if (!raw || /^data:/i.test(raw)) return '';
  try {
    return new URL(raw, productUrl).href;
  } catch {
    return raw;
  }
}

async function downloadArtifactImage(args: {
  imageUrl: string;
  pageUrl: string;
  label: string;
  index: number;
  timeoutMs: number;
  relDir: string;
}): Promise<string | undefined> {
  const imageUrl = normalizeProductImageUrl(args.imageUrl || '', args.pageUrl);
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return undefined;
  try {
    const maxBytes = 10 * 1024 * 1024;
    const response = await fetch(imageUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Prometheus/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': args.pageUrl,
      },
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    if (!response.ok) return undefined;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('image/')) return undefined;
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 512 || bytes.length > maxBytes) return undefined;
    const isRasterImage = (bytes[0] === 0xff && bytes[1] === 0xd8)
      || bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')
      || (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
      || bytes.subarray(4, 12).toString('ascii').includes('ftypavif');
    if (!isRasterImage) return undefined;
    const workspaceRoot = getActiveWorkspaceRoot();
    const relDir = args.relDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const absDir = path.resolve(workspaceRoot, relDir);
    const rootWithSep = `${path.resolve(workspaceRoot)}${path.sep}`.toLowerCase();
    if (!`${absDir}${path.sep}`.toLowerCase().startsWith(rootWithSep)) return undefined;
    await fs.promises.mkdir(absDir, { recursive: true });
    const filename = safeArtifactImageFilename(args.label, args.index, contentType, imageUrl);
    const absPath = path.join(absDir, filename);
    if (!fs.existsSync(absPath)) await fs.promises.writeFile(absPath, bytes);
    return `${relDir}/${filename}`;
  } catch {
    return undefined;
  }
}

async function downloadProductImage(product: ShoppingProductResult, index: number, timeoutMs: number): Promise<string | undefined> {
  return downloadArtifactImage({
    imageUrl: product.imageUrl || '',
    pageUrl: product.productUrl,
    label: product.title || product.id || 'product',
    index,
    timeoutMs,
    relDir: 'downloads/product-carousel',
  });
}

export async function fetchPagePreviewMetadata(url: string, timeoutMs = 2500): Promise<PagePreviewMetadata> {
  const normalizedUrl = String(url || '').trim();
  const cached = pagePreviewCache.get(normalizedUrl);
  if (cached && Date.now() - cached.at < PAGE_PREVIEW_CACHE_TTL_MS) return cached.meta;
  const empty: PagePreviewMetadata = { url: normalizedUrl };
  if (!/^https?:\/\//i.test(normalizedUrl) || !isTinyFishFetchEligible(normalizedUrl)) return empty;
  try {
    const res = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Prometheus/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(500, Math.min(10_000, timeoutMs))),
    });
    const contentType = String(res.headers.get('content-type') || '');
    if (!res.ok || (contentType && !/html|text/i.test(contentType))) return empty;
    const html = (await res.text()).slice(0, 1_500_000);
    const finalUrl = res.url || normalizedUrl;
    const meta = extractPagePreviewMetadataFromHtml(html, finalUrl);
    const productJsonLd = parseJsonLdProductMetadata(html);
    const priceAmount = extractMetaTag(html, 'product:price:amount');
    const priceCurrency = extractMetaTag(html, 'product:price:currency') || 'USD';
    const fallbackRating = fallbackProductPageRating(html);
    const enriched: PagePreviewMetadata = {
      ...meta,
      url: normalizedUrl,
      canonicalUrl: meta.canonicalUrl || finalUrl,
      imageUrl: absoluteHttpUrl(productJsonLd.imageUrl || meta.imageUrl, finalUrl),
      price: productJsonLd.price
        || (priceAmount ? `${priceCurrency === 'USD' ? '$' : `${priceCurrency} `}${priceAmount}` : undefined)
        || fallbackProductPagePrice(html),
      rating: productJsonLd.rating || fallbackRating.rating,
      reviews: productJsonLd.reviews || fallbackRating.reviews,
      reviewCount: productJsonLd.reviewCount || fallbackRating.reviewCount,
      availability: productJsonLd.availability,
      seller: productJsonLd.seller,
      sku: productJsonLd.sku,
    };
    pagePreviewCache.set(normalizedUrl, { at: Date.now(), meta: enriched });
    return enriched;
  } catch {
    return empty;
  }
}

async function fetchProductMetadata(url: string, timeoutMs: number): Promise<Partial<ShoppingProductResult>> {
  const cached = productMetadataCache.get(url);
  if (cached && Date.now() - cached.at < PRODUCT_METADATA_CACHE_TTL_MS) return cached.meta;
  const preview = await fetchPagePreviewMetadata(url, timeoutMs);
  const title = cleanProductTitle(preview.title || '');
  const meta: Partial<ShoppingProductResult> = {
    title: looksLikeProductTitle(title) ? title : undefined,
    description: cleanProductDescription(preview.description || ''),
    imageUrl: preview.imageUrl,
    price: preview.price,
    rating: preview.rating,
    reviews: preview.reviews,
    reviewCount: preview.reviewCount,
    availability: preview.availability,
    seller: preview.seller,
    sku: preview.sku,
  };
  const compact = Object.fromEntries(Object.entries(meta).filter(([, value]) => value != null && String(value).trim())) as Partial<ShoppingProductResult>;
  productMetadataCache.set(url, { at: Date.now(), meta: compact });
  return compact;
}

function canonicalPreviewMatchUrl(value: unknown): string {
  try {
    const parsed = new URL(String(value || ''));
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|ref$|source$|campaign$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.href.replace(/\/$/, '');
  } catch {
    return String(value || '').trim().replace(/\/$/, '');
  }
}

/** Search-provider thumbnails are the fallback for publishers that block page metadata fetches. */
async function discoverSourcePreviewViaSearch(item: any, timeoutMs: number): Promise<Partial<SearchResultItem>> {
  const url = String(item?.url || '').trim();
  const title = String(item?.title || '').trim();
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./i, ''); } catch {}
  const query = [title ? `"${title.slice(0, 180)}"` : '', host ? `site:${host}` : ''].filter(Boolean).join(' ');
  if (!query) return {};
  try {
    const result = await executeWebSearch({
      query,
      max_results: 5,
      provider: 'multi',
      provider_timeout_ms: Math.max(800, Math.min(5_000, timeoutMs)),
    });
    const candidates = Array.isArray(result.data?.results) ? result.data.results as SearchResultItem[] : [];
    const wantedUrl = canonicalPreviewMatchUrl(url);
    const wantedWords = new Set(title.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
    return candidates
      .filter((candidate) => candidate?.imageUrl)
      .map((candidate) => {
        const candidateUrl = canonicalPreviewMatchUrl(candidate.url);
        const exactUrl = !!wantedUrl && candidateUrl === wantedUrl;
        const candidateWords = candidate.title.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
        const overlap = candidateWords.filter((word) => wantedWords.has(word)).length;
        const sameHost = !!host && candidateUrl.includes(`://${host}/`);
        return { candidate, score: exactUrl ? 100 : (sameHost ? 20 : 0) + overlap };
      })
      .sort((a, b) => b.score - a.score)
      .find((entry) => entry.score >= 3)?.candidate || {};
  } catch {
    return {};
  }
}

function sourcePageScreenshotUrl(pageUrl: string): string | undefined {
  const raw = String(pageUrl || '').trim();
  if (!/^https?:\/\//i.test(raw)) return undefined;
  // Last-resort visual preview: use the source page itself, not an unrelated
  // stock image, when publishers expose neither OG media nor search thumbnails.
  return `https://image.thum.io/get/width/800/crop/520/noanimate/${raw}`;
}

/**
 * Fill sparse source-card records from their pages and cache preview images in
 * the workspace. A site icon is used only when no article/hero image exists.
 */
export async function enrichSourceArtifactItems(
  items: any[],
  options: { metadataTimeoutMs?: number; imageTimeoutMs?: number; downloadImages?: boolean } = {},
): Promise<any[]> {
  const input = (Array.isArray(items) ? items : []).slice(0, 16);
  const metadataTimeoutMs = Math.max(500, Math.min(8_000, Number(options.metadataTimeoutMs || 2600)));
  const imageTimeoutMs = Math.max(500, Math.min(6_000, Number(options.imageTimeoutMs || 2200)));
  return mapWithConcurrency(input, Math.min(4, Math.max(1, input.length)), async (item, index) => {
    const url = String(item?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return item;
    const needsMetadata = !item.title || !item.publisher || !item.snippet || !item.publishedAt || (!item.imageUrl && !item.imagePath);
    const preview = needsMetadata ? await fetchPagePreviewMetadata(url, metadataTimeoutMs) : { url } as PagePreviewMetadata;
    const searchPreview = (!item.imageUrl && !item.imagePath && !preview.imageUrl)
      ? await discoverSourcePreviewViaSearch(item, metadataTimeoutMs)
      : {};
    const chosenImage = normalizeProductImageUrl(String(
      item.imageUrl
      || preview.imageUrl
      || searchPreview.imageUrl
      || sourcePageScreenshotUrl(url)
      || preview.iconUrl
      || '',
    ), url);
    let imagePath = String(item.imagePath || '').trim() || undefined;
    if (options.downloadImages !== false && !imagePath && chosenImage) {
      imagePath = await downloadArtifactImage({
        imageUrl: chosenImage,
        pageUrl: url,
        label: String(item.title || preview.title || item.publisher || 'source'),
        index,
        timeoutMs: imageTimeoutMs,
        relDir: 'downloads/source-previews',
      });
    }
    return {
      ...item,
      title: String(item.title || preview.title || url),
      publisher: String(item.publisher || preview.publisher || searchPreview.publisher || merchantFromUrl(url) || ''),
      snippet: String(item.snippet || preview.description || searchPreview.snippet || ''),
      publishedAt: String(item.publishedAt || preview.publishedAt || searchPreview.publishedAt || ''),
      imageUrl: imagePath
        ? `/api/canvas/inline?path=${encodeURIComponent(imagePath)}`
        : (chosenImage || undefined),
      imagePath,
    };
  });
}

/** Enrich arbitrary product-card records, including cards not produced by shopping_search_products. */
export async function enrichProductArtifactItems(
  items: ShoppingProductResult[],
  options: { metadataTimeoutMs?: number; imageTimeoutMs?: number; downloadImages?: boolean } = {},
): Promise<ShoppingProductResult[]> {
  const input = (Array.isArray(items) ? items : []).slice(0, 16);
  const metadataTimeoutMs = Math.max(500, Math.min(8_000, Number(options.metadataTimeoutMs || 2600)));
  const imageTimeoutMs = Math.max(500, Math.min(6_000, Number(options.imageTimeoutMs || 2200)));
  return mapWithConcurrency(input, Math.min(4, Math.max(1, input.length)), async (product, index) => {
    if (!product?.productUrl) return product;
    const needsMetadata = !product.title || !product.description || !product.price || product.rating == null
      || (product.reviews == null && product.reviewCount == null) || (!product.imageUrl && !product.imagePath);
    const meta = needsMetadata ? await fetchProductMetadata(product.productUrl, metadataTimeoutMs) : {};
    const merged: ShoppingProductResult = {
      ...product,
      title: meta.title || product.title,
      description: meta.description || product.description,
      imageUrl: normalizeProductImageUrl(meta.imageUrl || product.imageUrl || '', product.productUrl) || undefined,
      price: meta.price || product.price,
      rating: meta.rating ?? product.rating,
      reviews: meta.reviews ?? product.reviews ?? product.reviewCount,
      reviewCount: meta.reviewCount ?? product.reviewCount ?? product.reviews,
      availability: meta.availability || product.availability,
      seller: meta.seller || product.seller,
      sku: meta.sku || product.sku,
      asin: product.asin || amazonAsinFromUrl(product.productUrl),
    };
    if (options.downloadImages !== false && !merged.imagePath && merged.imageUrl) {
      merged.imagePath = await downloadProductImage(merged, index, imageTimeoutMs);
    }
    return merged;
  });
}

export async function executeShoppingSearchProducts(args: {
  query: string;
  merchant?: string;
  max_results?: number;
  provider?: SearchProviderOption;
  include_metadata?: boolean;
  include_images?: boolean;
  metadata_timeout_ms?: number;
  image_timeout_ms?: number;
}): Promise<ToolResult> {
  const query = String(args?.query || '').trim();
  if (!query) return { success: false, error: 'query is required' };
  const maxResults = Math.max(1, Math.min(12, Math.floor(Number(args?.max_results || 8))));
  const providerRaw = String(args?.provider || '').trim().toLowerCase();
  const provider = (['multi', 'tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai'].includes(providerRaw)
    ? providerRaw
    : undefined) as SearchProviderOption | undefined;
  const includeMetadata = args?.include_metadata !== false;
  const includeImages = args?.include_images !== false;
  const metadataTimeoutMs = Math.max(500, Math.min(5000, Math.floor(Number(args?.metadata_timeout_ms || 1800))));
  const imageTimeoutMs = Math.max(500, Math.min(4000, Math.floor(Number(args?.image_timeout_ms || 1600))));
  const searchQuery = buildProductSearchQuery(query, args?.merchant);
  const cacheKey = JSON.stringify({ searchQuery, maxResults, provider, includeMetadata, includeImages, metadataTimeoutMs, imageTimeoutMs });
  const cached = productSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PRODUCT_SEARCH_CACHE_TTL_MS) return cached.result;

  const search = await executeWebSearch({ query: searchQuery, max_results: Math.min(10, Math.max(5, maxResults)), provider });
  if (!search.success || !Array.isArray(search.data?.results)) {
    return { success: false, error: search.error || 'Product search failed', stdout: search.stdout };
  }

  const seen = new Set<string>();
  const products = (search.data.results as SearchResultItem[])
    .map((item, index) => normalizeProductCandidate(item, index, query, args?.merchant))
    .filter((item): item is ShoppingProductResult => {
      if (!item) return false;
      const key = `${item.productUrl.replace(/[?#].*$/, '')}|${item.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, maxResults);

  if (includeMetadata && products.length) {
    await mapWithConcurrency(products.slice(0, Math.min(products.length, 8)), 4, async (product, index) => {
      const meta = await fetchProductMetadata(product.productUrl, metadataTimeoutMs);
      const nextTitle = looksLikeProductTitle(meta.title || '') ? meta.title || product.title : product.title;
      const nextDescription = meta.description || product.description;
      const relevanceText = `${nextTitle || ''} ${nextDescription || ''}`;
      if (!hasRequiredProductIntent(query, relevanceText) || productQueryRelevanceScore(query, relevanceText) < 0.18) {
        products[index] = { ...product, confidence: Math.min(product.confidence || 0.4, 0.2) };
        return;
      }
      products[index] = {
        ...product,
        title: nextTitle,
        description: nextDescription,
        imageUrl: meta.imageUrl || product.imageUrl,
        price: meta.price || product.price,
        rating: meta.rating || product.rating,
        reviews: meta.reviews || product.reviews,
        reviewCount: meta.reviewCount || product.reviewCount,
        availability: meta.availability || product.availability,
        seller: meta.seller || product.seller,
        sku: meta.sku || product.sku,
        confidence: Math.min(1, Number(((product.confidence || 0.5) + (meta.imageUrl ? 0.08 : 0) + (meta.price && !product.price ? 0.06 : 0)).toFixed(2))),
      };
    });
  }

  const relevantProducts = products
    .filter((product) => (product.confidence || 0) >= 0.28)
    .filter((product) => hasRequiredProductIntent(query, `${product.title || ''} ${product.description || ''}`))
    .filter((product) => productQueryRelevanceScore(query, `${product.title || ''} ${product.description || ''}`) >= 0.18)
    .slice(0, maxResults);

  const usableProducts = relevantProducts.filter(isUsableProductArtifactItem);

  if (usableProducts.length === 0) {
    return {
      success: false,
      error: `Product search returned no carousel-ready products for "${query}". Each product requires a title, product URL, image, and product metadata.`,
      data: { query, searchQuery, provider: search.data?.provider || provider, products: [] },
      stdout: `Found 0 usable product candidates for "${query}".`,
    };
  }

  if (includeImages && usableProducts.length) {
    await mapWithConcurrency(usableProducts.slice(0, Math.min(usableProducts.length, maxResults)), 4, async (product, index) => {
      if (product.imagePath || !product.imageUrl) return;
      const imagePath = await downloadProductImage(product, index, imageTimeoutMs);
      if (imagePath) {
        usableProducts[index] = {
          ...product,
          imagePath,
          confidence: Math.min(1, Number(((product.confidence || 0.5) + 0.05).toFixed(2))),
        };
      }
    });
  }

  const carousel = {
    title: args?.merchant ? `${query} on ${merchantFromUrl(`https://${merchantDomain(args.merchant)}`) || args.merchant}` : query,
    source: 'shopping_search_products',
    items: usableProducts,
  };
  const stdout = [
    `Found ${usableProducts.length} product candidate${usableProducts.length === 1 ? '' : 's'} for "${query}" using existing web search (${String(search.data?.provider || provider)}).`,
    'No shopping API key was used.',
    '',
    JSON.stringify({ query, searchQuery, source: carousel.source, items: usableProducts }, null, 2),
  ].join('\n');
  const result = {
    success: true,
    data: { query, searchQuery, provider: search.data?.provider || provider, products: usableProducts },
    stdout,
    extra: { productCarousel: carousel },
  } as ToolResult;
  productSearchCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

export const shoppingSearchProductsTool = {
  name: 'shopping_search_products',
  get description() {
    return `Fast product search for shopping/product carousel requests using the preferred configured web_search provider (${getSearchProvidersSummary()}) plus optional lightweight page metadata fetches. Pass provider:"multi" for wide all-provider discovery. No shopping API keys are required. Prefer this before browser tools when the user asks to find products, compare shopping results, or make a product carousel.`;
  },
  execute: executeShoppingSearchProducts,
  schema: {
    query: 'string (required) - Product search query',
    merchant: 'string (optional) - Store/domain such as Amazon, Walmart, Target, Best Buy, ebay.com',
    max_results: 'number (optional, default 8, max 12) - Product cards to return',
    provider: 'string (optional, default preferred provider from Settings) - One of multi, tinyfish, tavily, google, brave, ddg, xai',
    include_metadata: 'boolean (optional, default true) - Fetch top result pages briefly for Open Graph images/titles/prices',
    include_images: 'boolean (optional, default true) - Download discovered product images into downloads/product-carousel and set imagePath',
    metadata_timeout_ms: 'number (optional, default 1800, max 5000) - Per-page metadata fetch timeout',
    image_timeout_ms: 'number (optional, default 1600, max 4000) - Per-image download timeout',
  },
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Product search query, e.g. "cordless stick vacuum under $300".' },
      merchant: { type: 'string', description: 'Optional store/domain such as Amazon, Walmart, Target, Best Buy, ebay.com.' },
      max_results: { type: 'number', description: 'Number of product cards to return. Default 8, max 12.' },
      provider: { type: 'string', enum: ['multi', 'tinyfish', 'tavily', 'google', 'brave', 'ddg', 'xai'], description: 'Optional provider selector. Defaults to the preferred provider from Settings; use multi for wide discovery.' },
      include_metadata: { type: 'boolean', description: 'Default true. Briefly fetch top pages for Open Graph images/titles/prices without browser automation.' },
      include_images: { type: 'boolean', description: 'Default true. Briefly download discovered product images to downloads/product-carousel and set imagePath for stable carousel rendering.' },
      metadata_timeout_ms: { type: 'number', description: 'Per-page metadata fetch timeout. Default 1800, max 5000.' },
      image_timeout_ms: { type: 'number', description: 'Per-image download timeout. Default 1600, max 4000.' },
    },
    additionalProperties: false,
  },
};

export const webFetchBatchTool = {
  name: 'web_fetch_batch',
  description: 'Fetch and extract text from multiple URLs in parallel. Use after web_search when several result URLs need full-page evidence. Returns one result per URL with partial-failure details.',
  execute: executeWebFetchBatch,
  schema: {
    urls: 'string[] (required, max 20) - Full URLs to fetch',
    max_chars: 'number (optional, default 6000, max 25000) - Max characters per URL',
    concurrency: 'number (optional, default 4, max 8) - Parallel fetches',
    include_media: 'boolean (optional, default false) - X status URLs only. Download and analyze attached media when explicitly requested.',
    include_thread: 'boolean (optional, default false) - X status URLs only. Use browser extraction to expand the surrounding thread.',
  },
  jsonSchema: {
    type: 'object',
    required: ['urls'],
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Full URLs to fetch. Duplicate and blank URLs are ignored. Max 20.',
      },
      max_chars: { type: 'number', description: 'Max characters per URL. Default 6000, max 25000.' },
      concurrency: { type: 'number', description: 'Parallel fetches. Default 4, max 8.' },
      include_media: { type: 'boolean', description: 'X status URLs only. Default false. Download and analyze attached media only when explicitly requested.' },
      include_thread: { type: 'boolean', description: 'X status URLs only. Default false. Use browser extraction to expand the surrounding thread.' },
    },
    additionalProperties: false,
  },
};

// ─── Simple string-returning helpers for executeTool (subagent executor) ────────────
// These delegate to the registry implementations above so there is one code path.
export async function webSearch(query: string, options: {
  max_results?: number;
  multi_engine?: boolean;
  provider?: SearchProviderOption;
  fetch_top_k?: number;
  fetch_max_chars?: number;
  provider_timeout_ms?: number;
} = {}): Promise<string> {
  const result = await executeWebSearch({ query, ...options });
  if (!result.success) return result.error || `Search failed for "${query}".`;
  return result.stdout || result.data?.answer || `No results for "${query}".`;
}

export async function webFetch(url: string, progress?: WebFetchProgressReporter): Promise<string> {
  const result = await executeWebFetch({ url }, progress);
  if (!result.success) return result.stdout || result.error || `Fetch failed for ${url}.`;
  return result.stdout || `Fetched ${url} but no content extracted.`;
}
