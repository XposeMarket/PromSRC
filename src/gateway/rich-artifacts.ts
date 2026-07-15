import crypto from 'crypto';

// Rich Chat Artifacts — a parallel, additive rich-result layer for the main chat.
//
// This is intentionally separate from approvals, file changes, Canvas/workspace,
// and generated media. Those systems have their own render dispatch and must not
// be entangled here. Rich artifacts are structured, frontend-rendered result
// cards attached to an assistant message via `message.richArtifacts[]`.
//
// The product carousel is the seed: it is migrated into a `products` artifact
// while `message.productCarousel` is kept as a compatibility alias for sessions
// persisted before this lane existed.

export type RichArtifactType =
  | 'products'
  | 'agent_work'
  | 'sources'
  | 'stocks'
  | 'weather'
  | 'comparison'
  | 'chart'
  | 'run_result'
  | 'map'
  | 'email_composer'
  | 'prediction_market'
  | 'thread_links'
  | 'visual'
  // Declared for forward-compatibility; renderers not implemented yet.
  | 'jobs'
  | 'places'
  | 'sports';

export interface RichArtifactAction {
  id?: string;
  label: string;
  /** Semantic kind used by the frontend to style/handle the action. */
  kind?: 'primary' | 'secondary' | 'link';
  /** External URL to open, when the action is a link. */
  href?: string;
  /** Internal navigation target (e.g. "tasks", "schedules", "teams"). */
  route?: string;
}

export interface BaseRichArtifact {
  id: string;
  type: RichArtifactType;
  title?: string;
  subtitle?: string;
  source?: string;
  createdAt?: string;
  actions?: RichArtifactAction[];
}

// ─── products ────────────────────────────────────────────────────────────────

export interface ProductArtifactItem {
  title: string;
  price?: string;
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
  listPrice?: string;
  availability?: string;
  seller?: string;
  sku?: string;
  asin?: string;
  confidence?: number;
}

export interface ProductArtifact extends BaseRichArtifact {
  type: 'products';
  items: ProductArtifactItem[];
}

// ─── agent_work ──────────────────────────────────────────────────────────────

export interface AgentWorkSummaryRow {
  icon?: string;
  title: string;
  subtitle?: string;
}

/** Optional linkage that makes a row clickable/expandable in the UI. */
export interface AgentWorkLink {
  /** Background task id — enables the inline detail drawer + resume/pause/delete/message actions. */
  taskId?: string;
  /** Scheduled job id — enables linking to the job. */
  jobId?: string;
  /** Agent id this row belongs to. */
  agentId?: string;
  /** Proposal id — enables showing the proposal summary on expand. */
  proposalId?: string;
}

export interface AgentWorkPriority extends AgentWorkLink {
  title: string;
  subtitle?: string;
  status?: 'ready' | 'running' | 'blocked' | 'done' | string;
}

export interface AgentWorkTeam extends AgentWorkLink {
  name: string;
  detail?: string;
  icon?: string;
  status?: 'active' | 'idle' | string;
}

export interface AgentWorkActiveItem extends AgentWorkLink {
  id?: string;
  title: string;
  status?: string;
  progressLabel?: string;
  href?: string;
}

export interface AgentWorkArtifact extends BaseRichArtifact {
  type: 'agent_work';
  mode?: 'snapshot' | 'running' | 'team_update' | 'priority_list';
  greeting?: string;
  summaryRows?: AgentWorkSummaryRow[];
  priorities?: AgentWorkPriority[];
  teams?: AgentWorkTeam[];
  activeWork?: AgentWorkActiveItem[];
}

// ─── sources ─────────────────────────────────────────────────────────────────

export interface SourceItem {
  title: string;
  publisher?: string;
  url: string;
  imageUrl?: string;
  imagePath?: string;
  snippet?: string;
  publishedAt?: string;
  badge?: string;
}

export interface SourcesArtifact extends BaseRichArtifact {
  type: 'sources';
  layout?: 'cards' | 'list';
  items: SourceItem[];
}

// ─── stocks / crypto ───────────────────────────────────────────────────────────

export interface MarketItem {
  symbol: string;
  name?: string;
  kind?: 'equity' | 'crypto';
  price?: number;
  currency?: string;
  changeAbs?: number;
  changePct?: number;
  marketCap?: number;
  sparkline?: number[];
  logoUrl?: string;
  source?: string;
  asOf?: string;
}

export interface StocksArtifact extends BaseRichArtifact {
  type: 'stocks';
  items: MarketItem[];
}

// ─── weather ───────────────────────────────────────────────────────────────

export interface WeatherDaily {
  day: string;
  high?: number;
  low?: number;
  code?: number;
  icon?: string;
  condition?: string;
}

export interface WeatherHourly {
  time: string;
  temp?: number;
}

export interface WeatherArtifact extends BaseRichArtifact {
  type: 'weather';
  location: string;
  unit?: 'F' | 'C';
  current?: { temp?: number; condition?: string; icon?: string; code?: number };
  daily?: WeatherDaily[];
  hourly?: WeatherHourly[];
}

// ─── comparison (table) ──────────────────────────────────────────────────────

export interface ComparisonColumn {
  key: string;
  label: string;
}

export interface ComparisonArtifact extends BaseRichArtifact {
  type: 'comparison';
  columns: ComparisonColumn[];
  rows: Array<Record<string, any>>;
  /** Optional row label key (first/sticky column). Defaults to first column. */
  labelKey?: string;
  /** Optional column key to visually highlight as the "winner". */
  highlightColumn?: string;
}

// ─── chart (line/bar/area) ───────────────────────────────────────────────────

export interface ChartSeries {
  label?: string;
  color?: string;
  points: Array<{ x: number | string; y: number }>;
}

export interface ChartArtifact extends BaseRichArtifact {
  type: 'chart';
  chartType?: 'line' | 'bar' | 'area';
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
  unit?: string;
}

// ─── visual (model-authored chart / Mermaid / SVG / HTML) ───────────────────

export type VisualArtifactRenderer = 'chart' | 'mermaid' | 'svg' | 'html';

export interface VisualArtifact extends BaseRichArtifact {
  type: 'visual';
  renderer: VisualArtifactRenderer;
  version: number;
  ordinal: number;
  source: string;
  sourceHash: string;
  state?: Record<string, unknown>;
  stateUpdatedAt?: number;
  parentVersion?: number;
}

// ─── run_result (finished task output) ───────────────────────────────────────

export interface RunResultFile {
  path: string;
  label?: string;
}

export interface RunResultLink {
  label: string;
  href: string;
}

export interface RunResultArtifact extends BaseRichArtifact {
  type: 'run_result';
  /** Background task id — enables Rerun + live status. */
  taskId?: string;
  status?: string;
  summary?: string;
  files?: RunResultFile[];
  links?: RunResultLink[];
}

// ─── thread_links (Prometheus peer-session navigation) ─────────────────────

export interface ThreadLinkArtifactItem {
  sessionId: string;
  title: string;
  label?: string;
  subtitle?: string;
  status?: string;
}

export interface ThreadLinksArtifact extends BaseRichArtifact {
  type: 'thread_links';
  items: ThreadLinkArtifactItem[];
}

// ─── map (places) ────────────────────────────────────────────────────────────

export interface MapMarker {
  lat?: number;
  lng?: number;
  label: string;
  address?: string;
  url?: string;
  category?: string;
  rating?: number;
  id?: string;
}

export interface MapArtifact extends BaseRichArtifact {
  type: 'map';
  center?: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarker[];
}

// ─── prediction_market (Polymarket) ──────────────────────────────────────────

export interface PredictionOutcome {
  label: string;
  price?: number; // 0–1 implied probability
}

export interface PredictionMarketItem {
  question: string;
  slug?: string;
  url?: string;
  icon?: string;
  volume?: number;
  endDate?: string;
  outcomes: PredictionOutcome[];
}

export interface PredictionMarketArtifact extends BaseRichArtifact {
  type: 'prediction_market';
  items: PredictionMarketItem[];
}

// ─── email_composer (Gmail drafts + sent receipts) ───────────────────────────

export interface EmailAttachmentArtifactItem {
  id?: string;
  name: string;
  path?: string;
  mimeType?: string;
  size?: number;
}

export interface EmailComposerArtifact extends BaseRichArtifact {
  type: 'email_composer';
  provider: 'gmail' | 'email';
  mode?: 'draft' | 'sent';
  status?: 'draft' | 'sending' | 'sent' | 'failed';
  accountEmail?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  htmlBody?: string;
  attachments?: EmailAttachmentArtifactItem[];
  messageId?: string;
  threadId?: string;
  createdAt?: string;
  sentAt?: string;
  error?: string;
}

export type RichArtifact =
  | ProductArtifact
  | AgentWorkArtifact
  | SourcesArtifact
  | StocksArtifact
  | WeatherArtifact
  | ComparisonArtifact
  | ChartArtifact
  | RunResultArtifact
  | ThreadLinksArtifact
  | MapArtifact
  | EmailComposerArtifact
  | PredictionMarketArtifact
  | VisualArtifact;

export function extractVisualArtifactsFromMarkdown(
  markdown: unknown,
  existingArtifacts: RichArtifact[] = [],
  options: { reuseIdentityOnChange?: boolean } = {},
): VisualArtifact[] {
  const text = String(markdown || '');
  if (!text) return [];
  const existing = (Array.isArray(existingArtifacts) ? existingArtifacts : [])
    .filter((artifact): artifact is VisualArtifact => artifact?.type === 'visual');
  const out: VisualArtifact[] = [];
  const fence = /```(chart|svg|html|mermaid)\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let ordinal = 0;
  while ((match = fence.exec(text)) !== null) {
    const renderer = String(match[1] || '').toLowerCase() as VisualArtifactRenderer;
    const source = String(match[2] || '').trim();
    if (!source) continue;
    const sourceHash = crypto.createHash('sha256').update(`${renderer}\0${source}`).digest('hex');
    const exactPrior = existing.find((artifact) => (
      artifact.ordinal === ordinal
      && artifact.renderer === renderer
      && artifact.sourceHash === sourceHash
    ));
    const revisionPrior = options.reuseIdentityOnChange
      ? existing.find((artifact) => artifact.ordinal === ordinal && artifact.renderer === renderer)
      : undefined;
    const prior = exactPrior || revisionPrior;
    out.push(prior ? {
      ...prior,
      source,
      sourceHash,
      ordinal,
      version: exactPrior ? Math.max(1, Number(prior.version) || 1) : Math.max(1, Number(prior.version) || 1) + 1,
      parentVersion: exactPrior ? prior.parentVersion : Math.max(1, Number(prior.version) || 1),
    } : {
      id: `visual_${crypto.randomUUID()}`,
      type: 'visual',
      renderer,
      version: 1,
      ordinal,
      source,
      sourceHash,
      state: {},
      createdAt: new Date().toISOString(),
    });
    ordinal += 1;
  }
  return out;
}

// ─── collection ──────────────────────────────────────────────────────────────

/**
 * Scan tool results for `richArtifacts` emitted via the standard `extra`/`data`
 * channels. Mirrors `collectProductCarousel` in chat.router.ts but aggregates an
 * array across all tool results rather than returning the first match.
 */
export function collectRichArtifacts(allToolResults: any[]): RichArtifact[] {
  const out: RichArtifact[] = [];
  const seen = new Set<string>();
  for (const result of (Array.isArray(allToolResults) ? allToolResults : [])) {
    const sources = [result?.extra, result?.data, result].filter(
      (s) => s && typeof s === 'object',
    );
    for (const source of sources) {
      const arr = (source as any)?.richArtifacts;
      if (!Array.isArray(arr)) continue;
      for (const art of arr) {
        if (!art || typeof art !== 'object' || !art.type) continue;
        const key = String(art.id || `${art.type}:${out.length}`);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(art as RichArtifact);
      }
    }
  }
  return out;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const nested = firstString(obj.url, obj.src, obj.href, obj.contentUrl, obj.thumbnailUrl);
      if (nested) return nested;
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') continue;
    const match = value.trim().toLowerCase().match(/([0-9]+(?:\.[0-9]+)?)\s*([km])?/);
    if (!match) continue;
    const multiplier = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
    const parsed = Number(match[1]) * multiplier;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function httpUrl(...values: unknown[]): string | undefined {
  const raw = firstString(...values);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function publisherFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    const label = (host.split('.')[0] || host).replace(/[-_]+/g, ' ').trim();
    return label.replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return undefined;
  }
}

/** Normalize common provider, browser, connector, snake_case, and model aliases. */
export function normalizeSourceArtifactItems(rawItems: unknown[]): SourceItem[] {
  const out: SourceItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, any>;
    const url = httpUrl(item.url, item.link, item.href, item.canonicalUrl, item.canonical_url);
    const title = firstString(item.title, item.name, item.headline, item.label, item.text, url);
    if (!title && !url) continue;
    const key = `${url || ''}|${String(title || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: String(title || url || 'Source'),
      publisher: firstString(item.publisher, item.siteName, item.site_name, item.source, item.domain) || publisherFromUrl(url),
      url: url || '',
      imageUrl: httpUrl(item.imageUrl, item.image_url, item.thumbnailUrl, item.thumbnail_url, item.thumbnail, item.ogImage, item.og_image, item.image, item.images, item.media),
      imagePath: firstString(item.imagePath, item.image_path, item.thumbnailPath, item.thumbnail_path),
      snippet: firstString(item.snippet, item.description, item.summary, item.excerpt, item.content),
      publishedAt: firstString(item.publishedAt, item.published_at, item.publishedDate, item.published_date, item.datePublished, item.date),
      badge: firstString(item.badge, item.tag, item.category),
    });
  }
  return out;
}

export function normalizeProductArtifactItems(rawItems: unknown[]): ProductArtifactItem[] {
  const out: ProductArtifactItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, any>;
    const productUrl = httpUrl(item.productUrl, item.product_url, item.url, item.link, item.href);
    const title = firstString(item.title, item.name, item.productName, item.product_name, item.label);
    if (!productUrl || !title) continue;
    const key = `${productUrl.replace(/[?#].*$/, '')}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rating = firstNumber(item.rating, item.ratingValue, item.rating_value, item.stars);
    const reviews = firstNumber(item.reviews, item.reviewCount, item.review_count, item.ratingCount, item.rating_count, item.ratings);
    const confidence = firstNumber(item.confidence);
    out.push({
      title,
      price: firstString(item.price, item.salePrice, item.sale_price, item.currentPrice, item.current_price, item.offerPrice),
      description: firstString(item.description, item.snippet, item.summary, item.subtitle),
      rating: rating != null ? Math.max(0, Math.min(5, rating)) : undefined,
      reviews,
      reviewCount: reviews,
      tag: firstString(item.tag, item.badge, item.labelBadge, item.label_badge),
      badge: firstString(item.badge, item.tag, item.labelBadge, item.label_badge),
      imageUrl: httpUrl(item.imageUrl, item.image_url, item.thumbnailUrl, item.thumbnail_url, item.thumbnail, item.primaryImage, item.primary_image, item.image, item.images, item.media),
      imagePath: firstString(item.imagePath, item.image_path, item.thumbnailPath, item.thumbnail_path),
      productUrl,
      merchant: firstString(item.merchant, item.store, item.seller, item.retailer, item.source) || publisherFromUrl(productUrl),
      listPrice: firstString(item.listPrice, item.list_price, item.originalPrice, item.original_price, item.msrp),
      availability: firstString(item.availability, item.stockStatus, item.stock_status),
      seller: firstString(item.seller, item.soldBy, item.sold_by),
      sku: firstString(item.sku, item.productId, item.product_id, item.itemId, item.item_id),
      asin: firstString(item.asin, item.ASIN),
      confidence: confidence != null ? Math.max(0, Math.min(1, confidence)) : undefined,
    });
  }
  return out;
}

export function isUsableProductArtifactItem(item: ProductArtifactItem): boolean {
  const hasIdentity = !!item.title?.trim() && /^https?:\/\//i.test(String(item.productUrl || ''));
  const hasVisual = !!String(item.imagePath || item.imageUrl || '').trim();
  const hasProductMetadata = !!String(item.price || item.description || item.sku || item.asin || '').trim()
    || item.rating != null || item.reviews != null || item.reviewCount != null;
  return hasIdentity && hasVisual && hasProductMetadata;
}

/** Build a `products` rich artifact from the legacy productCarousel shape. */
export function productCarouselToArtifact(
  carousel: { title?: string; source?: string; items?: any[] } | null | undefined,
): ProductArtifact | null {
  const items = normalizeProductArtifactItems(Array.isArray(carousel?.items) ? carousel!.items : []);
  if (!items.length) return null;
  return {
    id: `products-${Date.now()}`,
    type: 'products',
    title: carousel?.title || undefined,
    source: carousel?.source || undefined,
    items,
  };
}
