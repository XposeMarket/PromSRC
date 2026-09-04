export type RecommendationSourceType = 'brain' | 'github' | 'task' | 'session' | 'schedule' | 'project' | 'other';

export type Recommendation = {
  id: string;
  label: string;
  prompt: string;
  sourceType: RecommendationSourceType;
  sourceRef?: string;
  kind?: string;
  confidence: number;
  freshnessAt: string;
  expiresAt?: string;
  projectId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

type BrainPulseCard = {
  title?: string;
  body?: string;
  prompt?: string;
  kind?: string;
  source?: string;
  sourcePath?: string;
  freshnessAt?: string | number | Date;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
  generatedAt?: string | number | Date;
  timestamp?: string | number | Date;
  created_at?: string | number | Date;
  updated_at?: string | number | Date;
  generated_at?: string | number | Date;
  sourceTimestamp?: string | number | Date;
  source_timestamp?: string | number | Date;
};

const SOURCE_PRIORITY: Record<RecommendationSourceType, number> = {
  github: 1,
  task: 0.95,
  schedule: 0.9,
  session: 0.82,
  project: 0.78,
  brain: 0.7,
  other: 0.6,
};

function cleanText(value: unknown, max = 180): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseTimestamp(value: unknown): number | undefined {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  const text = cleanText(value, 160);
  if (!text) return undefined;
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  const pathTimestamp = text.match(/(\d{4}-\d{2}-\d{2})[\\/_ T](\d{2})[-:](\d{2})(?:[-:](\d{2}))?/);
  if (!pathTimestamp) return undefined;
  const [, date, hours, minutes, seconds = '00'] = pathTimestamp;
  const normalized = Date.parse(`${date}T${hours}:${minutes}:${seconds}Z`);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function brainCardFreshness(card: BrainPulseCard, now: Date): { at: string; source: string } {
  const timestampFields: Array<[string, unknown]> = [
    ['freshnessAt', card.freshnessAt],
    ['updatedAt', card.updatedAt],
    ['updated_at', card.updated_at],
    ['createdAt', card.createdAt],
    ['created_at', card.created_at],
    ['generatedAt', card.generatedAt],
    ['generated_at', card.generated_at],
    ['timestamp', card.timestamp],
    ['sourceTimestamp', card.sourceTimestamp],
    ['source_timestamp', card.source_timestamp],
    ['sourcePath', card.sourcePath],
    ['source', card.source],
  ];
  for (const [source, value] of timestampFields) {
    const timestamp = parseTimestamp(value);
    if (timestamp !== undefined) return { at: new Date(timestamp).toISOString(), source };
  }
  // An absent timestamp is not evidence of freshness. Keep these cards at a
  // bounded stale age so they cannot outrank genuinely recent recommendations.
  const fallback = Math.max(0, now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { at: new Date(fallback).toISOString(), source: 'fallback:bounded-stale' };
}

function stableId(parts: unknown[]): string {
  const raw = parts.map((part) => cleanText(part, 160).toLowerCase()).filter(Boolean).join('|');
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `rec_${(hash >>> 0).toString(36)}`;
}

function actionLabelFromBrainCard(card: BrainPulseCard): string {
  const title = cleanText(card.title, 80);
  const body = cleanText(card.body, 120);
  const candidate = title || body || 'Continue recent work';
  return candidate
    .replace(/^dig into\s+/i, 'Continue ')
    .replace(/^revisit\s+/i, 'Continue ')
    .replace(/^review\s+the\s+current\s+/i, 'Review ')
    .replace(/[.:;,-]+$/g, '')
    .slice(0, 72);
}

export function recommendationFromBrainPulseCard(card: BrainPulseCard, now = new Date()): Recommendation | null {
  const label = actionLabelFromBrainCard(card);
  const prompt = cleanText(card.prompt, 700);
  if (!label || !prompt) return null;
  const sourceRef = cleanText(card.sourcePath || card.source, 240) || undefined;
  const freshness = brainCardFreshness(card, now);
  return {
    id: stableId(['brain', sourceRef, label, prompt]),
    label,
    prompt,
    sourceType: 'brain',
    sourceRef,
    kind: cleanText(card.kind, 40) || 'continue',
    confidence: 0.7,
    freshnessAt: freshness.at,
    metadata: {
      body: cleanText(card.body, 180),
      title: cleanText(card.title, 100),
      freshnessSource: freshness.source,
    },
  };
}

function scoreRecommendation(rec: Recommendation, nowMs: number): number {
  const freshnessMs = parseTimestamp(rec.freshnessAt) ?? 0;
  const ageHours = Math.max(0, (nowMs - freshnessMs) / 3_600_000);
  const freshness = Math.max(0.35, 1 - Math.min(ageHours, 168) / 224);
  return Math.max(0, Math.min(1, Number(rec.confidence || 0))) * 0.55
    + (SOURCE_PRIORITY[rec.sourceType] || SOURCE_PRIORITY.other) * 0.25
    + freshness * 0.2;
}

function dedupeKey(rec: Recommendation): string {
  return cleanText(`${rec.sourceType}:${rec.sourceRef || ''}:${rec.label}`, 400).toLowerCase();
}

export function rankRecommendations(candidates: Recommendation[], limit = 3, now = new Date()): Recommendation[] {
  const nowMs = now.getTime();
  const deduped = new Map<string, Recommendation>();
  for (const rec of candidates) {
    if (!rec || !cleanText(rec.label) || !cleanText(rec.prompt)) continue;
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= nowMs) continue;
    const key = dedupeKey(rec);
    const existing = deduped.get(key);
    if (!existing || scoreRecommendation(rec, nowMs) > scoreRecommendation(existing, nowMs)) {
      deduped.set(key, rec);
    }
  }
  return [...deduped.values()]
    .sort((a, b) => scoreRecommendation(b, nowMs) - scoreRecommendation(a, nowMs)
      || (parseTimestamp(b.freshnessAt) ?? 0) - (parseTimestamp(a.freshnessAt) ?? 0)
      || Number(b.confidence || 0) - Number(a.confidence || 0)
      || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(0, Math.min(12, Number(limit) || 3)));
}

export function buildRecommendations(options: {
  brainCards?: BrainPulseCard[];
  additional?: Recommendation[];
  limit?: number;
  now?: Date;
} = {}): Recommendation[] {
  const now = options.now || new Date();
  const brain = (Array.isArray(options.brainCards) ? options.brainCards : [])
    .map((card) => recommendationFromBrainPulseCard(card, now))
    .filter((rec): rec is Recommendation => !!rec);
  return rankRecommendations([
    ...(Array.isArray(options.additional) ? options.additional : []),
    ...brain,
  ], options.limit ?? 3, now);
}
