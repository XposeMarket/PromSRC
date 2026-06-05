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
  | MapArtifact
  | EmailComposerArtifact
  | PredictionMarketArtifact;

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

/** Build a `products` rich artifact from the legacy productCarousel shape. */
export function productCarouselToArtifact(
  carousel: { title?: string; source?: string; items?: any[] } | null | undefined,
): ProductArtifact | null {
  const items = Array.isArray(carousel?.items) ? carousel!.items : [];
  if (!items.length) return null;
  return {
    id: `products-${Date.now()}`,
    type: 'products',
    title: carousel?.title || undefined,
    source: carousel?.source || undefined,
    items: items as ProductArtifactItem[],
  };
}
