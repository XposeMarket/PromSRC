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
  return {
    id: stableId(['brain', sourceRef, label, prompt]),
    label,
    prompt,
    sourceType: 'brain',
    sourceRef,
    kind: cleanText(card.kind, 40) || 'continue',
    confidence: 0.7,
    freshnessAt: now.toISOString(),
    metadata: {
      body: cleanText(card.body, 180),
      title: cleanText(card.title, 100),
    },
  };
}

function scoreRecommendation(rec: Recommendation, nowMs: number): number {
  const freshnessMs = Date.parse(rec.freshnessAt) || nowMs;
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
  const seen = new Set<string>();
  return candidates
    .filter((rec) => {
      if (!rec || !cleanText(rec.label) || !cleanText(rec.prompt)) return false;
      if (rec.expiresAt && Date.parse(rec.expiresAt) <= nowMs) return false;
      const key = dedupeKey(rec);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => scoreRecommendation(b, nowMs) - scoreRecommendation(a, nowMs))
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
