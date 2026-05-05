import fs from 'fs';
import path from 'path';
import type { ToolResult } from '../types.js';
import { getConfig } from '../config/config.js';
import { parseProviderModelRef } from '../agents/model-routing.js';
import {
  backgroundJoin,
  backgroundSpawn,
} from '../gateway/tasks/task-runner.js';

type BackgroundJoinLike = {
  state?: string;
  result?: string;
  error?: string;
  timedOut?: boolean;
} | null;

type Severity = 'critical' | 'high' | 'medium' | 'low';
type Priority = 'now' | 'next' | 'later';

type SpecialistStrength = {
  title: string;
  evidence: string;
  impact: string;
};

type SpecialistFinding = {
  severity: Severity;
  priority: Priority;
  category: string;
  title: string;
  why_it_matters: string;
  evidence: string;
  recommendation: string;
  impact: string;
};

type SpecialistOpportunity = {
  title: string;
  channel: string;
  rationale: string;
  test: string;
  priority: Priority;
};

type SpecialistEvidence = {
  kind: string;
  label: string;
  url: string;
  detail: string;
};

type SpecialistQuery = {
  query: string;
  outcome: string;
  notes: string;
};

type SpecialistPageReview = {
  url: string;
  purpose: string;
  notes: string;
};

type BusinessSnapshot = {
  brand: string;
  company_name: string;
  what_it_is: string;
  offers: string[];
  target_customers: string[];
  pricing_signals: string[];
  trust_signals: string[];
  cta_paths: string[];
  contact_points: string[];
  location_signals: string[];
  notable_pages: string[];
};

type SpecialistPayload = {
  specialty: string;
  specialty_label: string;
  status: 'ok' | 'partial' | 'failed';
  summary: string;
  score: number;
  sub_scores: Record<string, number>;
  business_snapshot: BusinessSnapshot;
  strengths: SpecialistStrength[];
  findings: SpecialistFinding[];
  opportunities: SpecialistOpportunity[];
  evidence: SpecialistEvidence[];
  queries: SpecialistQuery[];
  pages_reviewed: SpecialistPageReview[];
  sales_angles: string[];
  marketing_angles: string[];
  limitations: string[];
  background_state: string;
  timed_out: boolean;
};

type SpecialistSpec = {
  id: string;
  label: string;
  timeoutMs: number;
  buildPrompt: (url: string) => string;
};

type DeployAnalysisArtifact = {
  type: string;
  title: string;
  path?: string;
  status?: string;
  summary?: string;
};

const ANALYSIS_JSON_START = 'ANALYSIS_JSON_START';
const ANALYSIS_JSON_END = 'ANALYSIS_JSON_END';

const severityWeight: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const priorityWeight: Record<Priority, number> = {
  now: 3,
  next: 2,
  later: 1,
};

let _workspacePath = '';
let _broadcastFn: ((data: object) => void) | null = null;

export function injectAnalysisTeamDeps(deps: {
  workspacePath: string;
  broadcast?: (data: object) => void;
}): void {
  _workspacePath = deps.workspacePath;
  _broadcastFn = deps.broadcast ?? null;
}

function slugifyUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase() || 'site';
}

function getDomain(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
}

function safeString(value: any, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

function toStringList(value: any, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const str = safeString(item);
    if (!str) continue;
    const key = str.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(str);
    if (out.length >= limit) break;
  }
  return out;
}

function clampScore(value: any): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10));
}

function normalizePriority(value: any): Priority {
  const raw = safeString(value).toLowerCase();
  if (raw === 'now' || raw === 'critical' || raw === 'urgent' || raw === 'high') return 'now';
  if (raw === 'later' || raw === 'low') return 'later';
  return 'next';
}

function normalizeSeverity(value: any): Severity {
  const raw = safeString(value).toLowerCase();
  if (raw === 'critical') return 'critical';
  if (raw === 'high') return 'high';
  if (raw === 'low') return 'low';
  return 'medium';
}

function normalizeSubScores(value: any): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const cleanedKey = safeString(key).replace(/[^a-z0-9_ -]/gi, '').trim();
    if (!cleanedKey) continue;
    out[cleanedKey] = clampScore(raw);
  }
  return out;
}

function normalizeBusinessSnapshot(value: any): BusinessSnapshot {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    brand: safeString(raw.brand),
    company_name: safeString(raw.company_name || raw.company || raw.name),
    what_it_is: safeString(raw.what_it_is || raw.description || raw.summary),
    offers: toStringList(raw.offers, 8),
    target_customers: toStringList(raw.target_customers || raw.icp || raw.audience, 8),
    pricing_signals: toStringList(raw.pricing_signals, 8),
    trust_signals: toStringList(raw.trust_signals, 8),
    cta_paths: toStringList(raw.cta_paths, 8),
    contact_points: toStringList(raw.contact_points, 8),
    location_signals: toStringList(raw.location_signals, 8),
    notable_pages: toStringList(raw.notable_pages || raw.pages, 10),
  };
}

function normalizeStrengths(value: any): SpecialistStrength[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 5)
    .map((item) => {
      const raw = item && typeof item === 'object' ? item : {};
      return {
        title: safeString(raw.title),
        evidence: safeString(raw.evidence),
        impact: safeString(raw.impact),
      };
    })
    .filter((item) => item.title || item.evidence);
}

function normalizeFindings(value: any): SpecialistFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 6)
    .map((item) => {
      const raw = item && typeof item === 'object' ? item : {};
      return {
        severity: normalizeSeverity(raw.severity),
        priority: normalizePriority(raw.priority),
        category: safeString(raw.category),
        title: safeString(raw.title),
        why_it_matters: safeString(raw.why_it_matters || raw.why),
        evidence: safeString(raw.evidence),
        recommendation: safeString(raw.recommendation || raw.fix),
        impact: safeString(raw.impact),
      };
    })
    .filter((item) => item.title || item.recommendation || item.evidence);
}

function normalizeOpportunities(value: any): SpecialistOpportunity[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 6)
    .map((item) => {
      const raw = item && typeof item === 'object' ? item : {};
      return {
        title: safeString(raw.title),
        channel: safeString(raw.channel),
        rationale: safeString(raw.rationale),
        test: safeString(raw.test || raw.action),
        priority: normalizePriority(raw.priority),
      };
    })
    .filter((item) => item.title || item.test);
}

function normalizeEvidence(value: any): SpecialistEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((item) => {
      const raw = item && typeof item === 'object' ? item : {};
      return {
        kind: safeString(raw.kind || raw.type, 'note'),
        label: safeString(raw.label || raw.title),
        url: safeString(raw.url),
        detail: safeString(raw.detail || raw.notes),
      };
    })
    .filter((item) => item.label || item.url || item.detail);
}

function normalizeQueries(value: any): SpecialistQuery[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((item) => {
      const raw = item && typeof item === 'object' ? item : {};
      return {
        query: safeString(raw.query),
        outcome: safeString(raw.outcome),
        notes: safeString(raw.notes),
      };
    })
    .filter((item) => item.query || item.outcome);
}

function normalizePagesReviewed(value: any): SpecialistPageReview[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((item) => {
      const raw = item && typeof item === 'object' ? item : {};
      return {
        url: safeString(raw.url),
        purpose: safeString(raw.purpose),
        notes: safeString(raw.notes),
      };
    })
    .filter((item) => item.url || item.notes);
}

function trimText(value: any, max = 1000): string {
  const text = safeString(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function stripToolSummary(text: string): string {
  const marker = '\n\n---\n**Tool calls made:**';
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(0, idx).trim() : text.trim();
}

function extractJsonBlock(text: string): any | null {
  const body = stripToolSummary(String(text || ''));
  const start = body.indexOf(ANALYSIS_JSON_START);
  const end = body.indexOf(ANALYSIS_JSON_END);
  const marked = start >= 0 && end > start
    ? body.slice(start + ANALYSIS_JSON_START.length, end).trim()
    : '';
  const candidates = [marked, body];

  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        } catch {
          // continue
        }
      }
    }
  }

  return null;
}

function normalizeSpecialistPayload(spec: SpecialistSpec, join: BackgroundJoinLike): SpecialistPayload {
  const rawText = trimText(join?.result || join?.error || '');
  const parsed = extractJsonBlock(join?.result || '');
  const state = safeString(join?.state || 'unknown');
  const timedOut = join?.timedOut === true;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      specialty: spec.id,
      specialty_label: spec.label,
      status: state === 'completed' ? 'partial' : 'failed',
      summary: `${spec.label} did not return a structured payload.`,
      score: 0,
      sub_scores: {},
      business_snapshot: normalizeBusinessSnapshot({}),
      strengths: [],
      findings: [
        {
          severity: 'high',
          priority: 'next',
          category: 'tooling',
          title: `${spec.label} could not complete normally`,
          why_it_matters: 'This leaves a gap in the audit and reduces confidence in the final GTM readout.',
          evidence: rawText || `Background state: ${state}${timedOut ? ' (timed out)' : ''}`,
          recommendation: 'Rerun this specialist after resolving the model or tool issue that interrupted it.',
          impact: 'Missing evidence for this audit area can hide real risks or opportunities.',
        },
      ],
      opportunities: [],
      evidence: rawText ? [{ kind: 'tooling', label: `${spec.label} execution note`, url: '', detail: rawText }] : [],
      queries: [],
      pages_reviewed: [],
      sales_angles: [],
      marketing_angles: [],
      limitations: [
        `Specialist state: ${state}${timedOut ? ' (timed out)' : ''}`,
        rawText ? `Execution output: ${rawText}` : 'No structured specialist output was captured.',
      ],
      background_state: state,
      timed_out: timedOut,
    };
  }

  const payload = parsed as Record<string, any>;
  const normalized: SpecialistPayload = {
    specialty: safeString(payload.specialty, spec.id) || spec.id,
    specialty_label: safeString(payload.specialty_label, spec.label) || spec.label,
    status: state === 'completed' ? 'ok' : 'partial',
    summary: safeString(payload.summary, `${spec.label} completed without a summary.`),
    score: clampScore(payload.score),
    sub_scores: normalizeSubScores(payload.sub_scores),
    business_snapshot: normalizeBusinessSnapshot(payload.business_snapshot),
    strengths: normalizeStrengths(payload.strengths),
    findings: normalizeFindings(payload.findings),
    opportunities: normalizeOpportunities(payload.opportunities),
    evidence: normalizeEvidence(payload.evidence),
    queries: normalizeQueries(payload.queries),
    pages_reviewed: normalizePagesReviewed(payload.pages_reviewed),
    sales_angles: toStringList(payload.sales_angles, 8),
    marketing_angles: toStringList(payload.marketing_angles, 8),
    limitations: toStringList(payload.limitations, 8),
    background_state: state,
    timed_out: timedOut,
  };

  if (!normalized.findings.length && normalized.status !== 'ok') {
    normalized.findings.push({
      severity: 'medium',
      priority: 'next',
      category: 'tooling',
      title: `${normalized.specialty_label} completed with an incomplete state`,
      why_it_matters: 'Partial execution may have limited the depth of evidence gathered.',
      evidence: rawText || `Background state: ${state}${timedOut ? ' (timed out)' : ''}`,
      recommendation: 'Treat this section as directional and rerun it if the final strategy depends on deeper evidence.',
      impact: 'Recommendations from this specialist may be less complete than intended.',
    });
  }

  return normalized;
}

function appendUnique(list: string[], value: string): void {
  const clean = safeString(value);
  if (!clean) return;
  const key = clean.toLowerCase();
  if (list.some((item) => item.toLowerCase() === key)) return;
  list.push(clean);
}

function mergeBusinessSnapshots(payloads: SpecialistPayload[]): BusinessSnapshot {
  const merged: BusinessSnapshot = normalizeBusinessSnapshot({});

  for (const payload of payloads) {
    const snap = payload.business_snapshot;

    if (!merged.brand) merged.brand = snap.brand;
    if (!merged.company_name) merged.company_name = snap.company_name;
    if (!merged.what_it_is) merged.what_it_is = snap.what_it_is;

    for (const item of snap.offers) appendUnique(merged.offers, item);
    for (const item of snap.target_customers) appendUnique(merged.target_customers, item);
    for (const item of snap.pricing_signals) appendUnique(merged.pricing_signals, item);
    for (const item of snap.trust_signals) appendUnique(merged.trust_signals, item);
    for (const item of snap.cta_paths) appendUnique(merged.cta_paths, item);
    for (const item of snap.contact_points) appendUnique(merged.contact_points, item);
    for (const item of snap.location_signals) appendUnique(merged.location_signals, item);
    for (const item of snap.notable_pages) appendUnique(merged.notable_pages, item);
  }

  return merged;
}

function averageScores(values: Array<number | undefined>): number {
  const clean = values.filter((value) => Number.isFinite(value)) as number[];
  if (!clean.length) return 0;
  return Math.round((clean.reduce((sum, value) => sum + value, 0) / clean.length) * 10) / 10;
}

function pickScore(payloads: SpecialistPayload[], specialty: string): number {
  return payloads.find((payload) => payload.specialty === specialty)?.score ?? 0;
}

function buildScorecard(payloads: SpecialistPayload[]) {
  const business = pickScore(payloads, 'business_intelligence');
  const seo = pickScore(payloads, 'seo_discovery');
  const social = pickScore(payloads, 'social_reputation');
  const browser = pickScore(payloads, 'browser_funnel');
  const cro = pickScore(payloads, 'cro_messaging');
  const technical = pickScore(payloads, 'technical_auditor');
  const competitive = pickScore(payloads, 'competitive_positioning');

  return {
    brand_clarity: averageScores([business, cro]),
    offer_strength: averageScores([business, cro, competitive]),
    trust_credibility: averageScores([cro, social, browser]),
    conversion_readiness: averageScores([browser, cro]),
    seo_discoverability: averageScores([seo, technical]),
    social_presence: averageScores([social]),
    competitive_positioning: averageScores([competitive, business]),
    sales_readiness: averageScores([business, cro, competitive]),
    overall_gtm_health: averageScores(payloads.map((payload) => payload.score)),
  };
}

function collectTopFindings(payloads: SpecialistPayload[]) {
  return payloads
    .flatMap((payload) =>
      payload.findings.map((finding) => ({
        ...finding,
        specialty: payload.specialty,
        specialty_label: payload.specialty_label,
        specialist_score: payload.score,
      })),
    )
    .sort((a, b) => {
      const severityDelta = severityWeight[b.severity] - severityWeight[a.severity];
      if (severityDelta !== 0) return severityDelta;
      const priorityDelta = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return a.specialist_score - b.specialist_score;
    })
    .slice(0, 12);
}

function collectTopStrengths(payloads: SpecialistPayload[]) {
  return payloads
    .flatMap((payload) =>
      payload.strengths.map((strength) => ({
        ...strength,
        specialty: payload.specialty,
        specialty_label: payload.specialty_label,
        specialist_score: payload.score,
      })),
    )
    .sort((a, b) => b.specialist_score - a.specialist_score)
    .slice(0, 10);
}

function collectPriorityActions(payloads: SpecialistPayload[]) {
  const actions = [
    ...payloads.flatMap((payload) =>
      payload.findings.map((finding) => ({
        title: finding.title,
        priority: finding.priority,
        severity: finding.severity,
        owner: payload.specialty_label,
        rationale: finding.why_it_matters,
        action: finding.recommendation,
        impact: finding.impact,
        source_type: 'finding',
      })),
    ),
    ...payloads.flatMap((payload) =>
      payload.opportunities.map((opportunity) => ({
        title: opportunity.title,
        priority: opportunity.priority,
        severity: 'medium' as Severity,
        owner: payload.specialty_label,
        rationale: opportunity.rationale,
        action: opportunity.test || opportunity.rationale,
        impact: opportunity.channel,
        source_type: 'opportunity',
      })),
    ),
  ];

  return actions
    .sort((a, b) => {
      const priorityDelta = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return severityWeight[b.severity] - severityWeight[a.severity];
    })
    .slice(0, 12);
}

function collectPlaybook(payloads: SpecialistPayload[], specialties: string[]) {
  return payloads
    .filter((payload) => specialties.includes(payload.specialty))
    .flatMap((payload) => {
      const lines = [
        ...payload.marketing_angles.map((angle) => ({
          type: 'angle',
          specialty: payload.specialty_label,
          text: angle,
        })),
        ...payload.sales_angles.map((angle) => ({
          type: 'angle',
          specialty: payload.specialty_label,
          text: angle,
        })),
        ...payload.opportunities.map((item) => ({
          type: 'opportunity',
          specialty: payload.specialty_label,
          title: item.title,
          priority: item.priority,
          channel: item.channel,
          text: item.test || item.rationale,
        })),
      ];
      return lines;
    })
    .slice(0, 12);
}

function buildExecutiveSummary(
  url: string,
  snapshot: BusinessSnapshot,
  topFindings: ReturnType<typeof collectTopFindings>,
  topStrengths: ReturnType<typeof collectTopStrengths>,
  scorecard: ReturnType<typeof buildScorecard>,
): string {
  const parts: string[] = [];
  const offer = snapshot.what_it_is || (snapshot.offers.length ? snapshot.offers[0] : '');
  const audience = snapshot.target_customers.length ? snapshot.target_customers[0] : '';

  if (offer && audience) {
    parts.push(`The site appears to position itself as ${offer} for ${audience}.`);
  } else if (offer) {
    parts.push(`The site appears to position itself as ${offer}.`);
  } else {
    parts.push(`The business positioning on ${url} is not fully clear from the public site signals alone.`);
  }

  if (topStrengths[0]) {
    parts.push(`The strongest visible signal is ${topStrengths[0].title.toLowerCase()} from ${topStrengths[0].specialty_label}.`);
  }

  if (topFindings[0]) {
    parts.push(`The biggest GTM risk is ${topFindings[0].title.toLowerCase()}, which ${topFindings[0].specialty_label} flagged as ${topFindings[0].severity}.`);
  }

  parts.push(
    `Overall GTM health scored ${scorecard.overall_gtm_health}/10, with conversion readiness at ${scorecard.conversion_readiness}/10 and SEO discoverability at ${scorecard.seo_discoverability}/10.`,
  );

  return parts.join(' ');
}

function buildCompactBundle(bundle: any): any {
  return {
    run_id: bundle.run_id,
    analyzed_at: bundle.analyzed_at,
    url: bundle.url,
    domain: bundle.domain,
    artifact_path: bundle.artifact_path,
    debug_path: bundle.debug_path,
    business_snapshot: bundle.business_snapshot,
    scorecard: bundle.scorecard,
    executive_summary: bundle.executive_summary,
    specialist_overview: bundle.specialist_overview,
    top_strengths: bundle.top_strengths,
    top_findings: bundle.top_findings,
    priority_actions: bundle.priority_actions,
    marketing_playbook: bundle.marketing_playbook,
    sales_playbook: bundle.sales_playbook,
    specialists: bundle.specialists,
    limitations: bundle.limitations,
  };
}

function resolveAnalysisModelOverride(): { provider?: string; model?: string; source: string } {
  try {
    const cfg = getConfig().getConfig() as any;
    const defaults = cfg?.agent_model_defaults || {};
    const candidates = [
      ['subagent_analyst', defaults.subagent_analyst],
      ['subagent_researcher', defaults.subagent_researcher],
      ['background_task', defaults.background_task],
      ['manager', defaults.manager],
      ['main_chat', defaults.main_chat],
    ] as Array<[string, any]>;

    for (const [key, ref] of candidates) {
      const raw = safeString(ref);
      if (!raw) continue;
      const parsed = parseProviderModelRef(raw);
      if (parsed) {
        return {
          provider: parsed.providerId,
          model: parsed.model,
          source: `agent_model_defaults.${key}`,
        };
      }
      return {
        model: raw,
        source: `agent_model_defaults.${key}`,
      };
    }
  } catch {
    // Fall back to normal background routing.
  }

  return { source: 'background_agent_default' };
}

function buildJsonContract(specialty: string, label: string): string {
  return [
    `Return only one JSON object between ${ANALYSIS_JSON_START} and ${ANALYSIS_JSON_END}.`,
    'Do not write files. Do not ask follow-up questions. Use only evidence you actually observed.',
    'Keep it concise: max 5 findings, 5 strengths, 5 opportunities, 8 evidence items, 8 queries/pages.',
    'If something is unclear, say so in limitations instead of guessing.',
    'Use this exact schema:',
    JSON.stringify(
      {
        specialty,
        specialty_label: label,
        summary: '1-3 sentence summary',
        score: 0,
        sub_scores: {
          clarity: 0,
          trust: 0,
          discoverability: 0,
          conversion: 0,
        },
        business_snapshot: {
          brand: '',
          company_name: '',
          what_it_is: '',
          offers: [],
          target_customers: [],
          pricing_signals: [],
          trust_signals: [],
          cta_paths: [],
          contact_points: [],
          location_signals: [],
          notable_pages: [],
        },
        strengths: [
          { title: '', evidence: '', impact: '' },
        ],
        findings: [
          {
            severity: 'high',
            priority: 'now',
            category: '',
            title: '',
            why_it_matters: '',
            evidence: '',
            recommendation: '',
            impact: '',
          },
        ],
        opportunities: [
          { title: '', channel: '', rationale: '', test: '', priority: 'next' },
        ],
        evidence: [
          { kind: 'page', label: '', url: '', detail: '' },
        ],
        queries: [
          { query: '', outcome: '', notes: '' },
        ],
        pages_reviewed: [
          { url: '', purpose: '', notes: '' },
        ],
        sales_angles: [''],
        marketing_angles: [''],
        limitations: [''],
      },
      null,
      2,
    ),
  ].join('\n');
}

function buildSpecialistSpecs(): SpecialistSpec[] {
  return [
    {
      id: 'business_intelligence',
      label: 'Business Intelligence',
      timeoutMs: 90_000,
      buildPrompt: (url: string) => [
        `You are the Business Intelligence specialist for a full GTM website audit of ${url}.`,
        'Goal: determine what the company is, what it offers, who it serves, what business facts are visible, and how clear the value proposition is.',
        'Use web_fetch on the homepage first, then fetch up to 2 additional internal pages such as about, services, pricing, features, or contact if they are obvious.',
        'Run branded and business-identification web_search queries for the company/domain, services, location, and pricing/review signals.',
        'Capture real business details only: offer, ICP, trust signals, contact points, pricing signals, CTA paths, and overall positioning clarity.',
        buildJsonContract('business_intelligence', 'Business Intelligence'),
        ANALYSIS_JSON_START,
        '{...}',
        ANALYSIS_JSON_END,
      ].join('\n\n'),
    },
    {
      id: 'seo_discovery',
      label: 'SEO Discovery',
      timeoutMs: 90_000,
      buildPrompt: (url: string) => {
        const domain = getDomain(url);
        return [
          `You are the SEO Discovery specialist for ${url}.`,
          'Goal: audit discoverability, search intent coverage, branded presence, and query gaps that affect organic growth.',
          `Use web_fetch on ${url}. Then run web_search for branded, non-branded, and problem-intent queries including:`,
          `- site:${domain}`,
          `- ${domain}`,
          `- ${domain} reviews`,
          '- core category or service terms inferred from the site',
          '- comparison or alternative intent if the offer suggests it',
          'Record whether the site appears, what outranks it, and what content or keyword gaps seem obvious.',
          buildJsonContract('seo_discovery', 'SEO Discovery'),
          ANALYSIS_JSON_START,
          '{...}',
          ANALYSIS_JSON_END,
        ].join('\n\n');
      },
    },
    {
      id: 'social_reputation',
      label: 'Social Reputation',
      timeoutMs: 90_000,
      buildPrompt: (url: string) => {
        const domain = getDomain(url);
        return [
          `You are the Social Reputation specialist for ${url}.`,
          'Goal: understand social discoverability, public discussion, sentiment, proof, and trust signals around the business.',
          'Use web_fetch on the site to infer brand name and offer, then run web_search queries for brand mentions and related pain-point queries.',
          `You must check discussion-style searches including site:reddit.com ${domain}, site:reddit.com [brand], site:x.com [brand], and related query combinations that potential buyers might search.`,
          'Look for praise, complaints, missing presence, UGC, testimonials, objections, or credibility gaps.',
          buildJsonContract('social_reputation', 'Social Reputation'),
          ANALYSIS_JSON_START,
          '{...}',
          ANALYSIS_JSON_END,
        ].join('\n\n');
      },
    },
    {
      id: 'browser_funnel',
      label: 'Browser Funnel Audit',
      timeoutMs: 110_000,
      buildPrompt: (url: string) => [
        `You are the Browser Funnel Audit specialist for ${url}.`,
        'Goal: browse the site like a real prospect, click through the core navigation, inspect CTA paths, and confirm usability, polish, and friction.',
        'Use browser_open on the homepage, then browser_snapshot. Browse intentionally: header nav, primary CTA, footer links, contact/demo/signup/book/login flows if present, and one secondary content page if useful.',
        'Use browser_click, browser_wait, browser_snapshot, browser_get_page_text, and browser_snapshot_delta as needed. Stop before external auth or payment steps.',
        'Record what worked, what was confusing, what broke, what felt polished, and what the conversion journey looked like.',
        'You are the only browser-heavy specialist. Do not spend time on search strategy beyond what is needed to understand the on-site funnel.',
        buildJsonContract('browser_funnel', 'Browser Funnel Audit'),
        ANALYSIS_JSON_START,
        '{...}',
        ANALYSIS_JSON_END,
      ].join('\n\n'),
    },
    {
      id: 'cro_messaging',
      label: 'CRO and Messaging',
      timeoutMs: 90_000,
      buildPrompt: (url: string) => [
        `You are the CRO and Messaging specialist for ${url}.`,
        'Goal: critique clarity, persuasion, professionalism, UX polish, trust, copywriting, CTA quality, and sales psychology.',
        'Use web_fetch on the homepage and up to 2 relevant internal pages. Focus on hero copy, proof, objections, CTA framing, friction, ROI communication, urgency, and whether the site sounds valuable instead of just descriptive.',
        'Call out what is good, what is weak, and what should be rewritten or restructured to lift conversion.',
        buildJsonContract('cro_messaging', 'CRO and Messaging'),
        ANALYSIS_JSON_START,
        '{...}',
        ANALYSIS_JSON_END,
      ].join('\n\n'),
    },
    {
      id: 'technical_auditor',
      label: 'Technical Auditor',
      timeoutMs: 90_000,
      buildPrompt: (url: string) => [
        `You are the Technical Auditor for ${url}.`,
        'Goal: inspect technical SEO, crawlability, metadata, basic performance signals, and fetchability issues that could hurt growth.',
        'Use web_fetch first. Check titles, meta description, headings, canonical, robots, Open Graph, schema, internal links, viewport, obvious asset bloat signals, and any rendering/fetch issues.',
        'You can run a small number of supporting web_search queries if needed, but stay focused on technical growth blockers.',
        buildJsonContract('technical_auditor', 'Technical Auditor'),
        ANALYSIS_JSON_START,
        '{...}',
        ANALYSIS_JSON_END,
      ].join('\n\n'),
    },
    {
      id: 'competitive_positioning',
      label: 'Competitive Positioning',
      timeoutMs: 90_000,
      buildPrompt: (url: string) => [
        `You are the Competitive Positioning specialist for ${url}.`,
        'Goal: infer likely competitors, differentiation gaps, messaging whitespace, and how this site could win more of the market conversation.',
        'Use web_fetch to identify the offer and target market. Then run web_search for category terms, alternatives, comparisons, and competitors that appear to outrank or out-position the site.',
        'Explain what this business seems to emphasize, what competitors likely emphasize better, and what positioning or offer angles could improve marketing and sales performance.',
        buildJsonContract('competitive_positioning', 'Competitive Positioning'),
        ANALYSIS_JSON_START,
        '{...}',
        ANALYSIS_JSON_END,
      ].join('\n\n'),
    },
  ];
}

function buildEntitySummary(bundle: any): string {
  const topActions = Array.isArray(bundle?.priority_actions)
    ? bundle.priority_actions.slice(0, 3).map((item: any) => safeString(item?.title || item?.action)).filter(Boolean)
    : [];
  const actionLines = topActions.length
    ? topActions.map((item: string) => `- ${item}`).join('\n')
    : '- Review the JSON bundle for next actions';

  return [
    '',
    '## Deploy Analysis',
    `*${new Date().toISOString().slice(0, 10)}*`,
    safeString(bundle?.executive_summary),
    '',
    `Overall GTM health: ${safeString(bundle?.scorecard?.overall_gtm_health, '0')}/10`,
    'Top priorities:',
    actionLines,
    bundle?.artifact_path ? `Bundle: ${bundle.artifact_path}` : '',
    '',
  ].filter(Boolean).join('\n');
}

async function runSpecialists(
  url: string,
  teamId: string,
  modelOverride?: string,
  providerOverride?: string,
): Promise<Array<{ spec: SpecialistSpec; join: BackgroundJoinLike; payload: SpecialistPayload }>> {
  const specs = buildSpecialistSpecs();
  const spawns = specs.map((spec) => ({
    spec,
    status: backgroundSpawn({
      prompt: spec.buildPrompt(url),
      joinPolicy: 'wait_all',
      timeoutMs: spec.timeoutMs,
      tags: ['deploy_analysis', spec.id, teamId],
      modelOverride,
      providerOverride,
    }),
  }));

  const joins = await Promise.all(
    spawns.map(async ({ spec, status }) => {
      try {
        const join = await backgroundJoin({
          backgroundId: status.id,
          joinPolicy: 'wait_all',
          timeoutMs: spec.timeoutMs,
        });
        const payload = normalizeSpecialistPayload(spec, join);
        _broadcastFn?.({
          type: 'analysis_specialist_complete',
          url,
          teamId,
          specialty: spec.id,
          score: payload.score,
          status: payload.status,
        });
        return { spec, join, payload };
      } catch (err: any) {
        const join: BackgroundJoinLike = {
          state: 'failed',
          error: safeString(err?.message || err || 'backgroundJoin failed'),
        };
        const payload = normalizeSpecialistPayload(spec, join);
        _broadcastFn?.({
          type: 'analysis_specialist_complete',
          url,
          teamId,
          specialty: spec.id,
          score: payload.score,
          status: payload.status,
        });
        return { spec, join, payload };
      }
    }),
  );

  return joins;
}

export const deployAnalysisTeamTool = {
  name: 'deploy_analysis_team',
  schema: {
    url: 'The full URL to analyze (must include https://)',
    save_to_entity: 'Optional: entity slug to save report summary to',
  },
  description:
    'Run a full multi-specialist go-to-market website analysis for a URL. ' +
    'This deploys background specialists for business profiling, SEO discovery, social reputation, browser funnel testing, CRO and messaging critique, technical auditing, and competitive positioning. ' +
    'It returns a structured GTM intelligence bundle for the main agent to compile into an inline interactive HTML dashboard plus a written marketing, sales, and website improvement plan. ' +
    'This tool is collector-first, not file-first: do not call present_file after it returns. ' +
    'The final response should use a single inline html block with download controls and then a natural-language breakdown.',
  jsonSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Full URL to analyze including https://' },
      save_to_entity: {
        type: 'string',
        description: 'Optional: entity slug to append a short deploy-analysis summary to.',
      },
    },
    additionalProperties: false,
  },

  execute: async (args: any): Promise<ToolResult> => {
    const url = safeString(args?.url);
    if (!url || !/^https?:\/\//i.test(url)) {
      return { success: false, error: 'url is required and must start with http:// or https://' };
    }

    if (!_workspacePath) {
      return { success: false, error: 'deploy_analysis_team: workspacePath not injected. Check server boot.' };
    }

    const runId = `analysis_${Date.now().toString(36)}`;
    const slug = slugifyUrl(url);
    const debugPath = path.join(_workspacePath, '.prometheus', 'analysis', runId);
    fs.mkdirSync(debugPath, { recursive: true });

    const modelRouting = resolveAnalysisModelOverride();
    console.log(`[deploy-analysis-team] Starting ${url} with ${modelRouting.source}`);
    _broadcastFn?.({
      type: 'analysis_started',
      url,
      teamId: runId,
      mode: 'gtm_collector',
      modelSource: modelRouting.source,
    });

    const specialists = await runSpecialists(url, runId, modelRouting.model, modelRouting.provider);
    const payloads = specialists.map((item) => item.payload);
    const businessSnapshot = mergeBusinessSnapshots(payloads);
    const scorecard = buildScorecard(payloads);
    const topFindings = collectTopFindings(payloads);
    const topStrengths = collectTopStrengths(payloads);
    const priorityActions = collectPriorityActions(payloads);
    const marketingPlaybook = collectPlaybook(payloads, [
      'seo_discovery',
      'social_reputation',
      'technical_auditor',
      'competitive_positioning',
    ]);
    const salesPlaybook = collectPlaybook(payloads, [
      'business_intelligence',
      'browser_funnel',
      'cro_messaging',
      'competitive_positioning',
    ]);
    const limitations = payloads.flatMap((payload) => payload.limitations).filter(Boolean).slice(0, 16);
    const specialistOverview = payloads.map((payload) => ({
      specialty: payload.specialty,
      specialty_label: payload.specialty_label,
      status: payload.status,
      score: payload.score,
      summary: payload.summary,
    }));
    const executiveSummary = buildExecutiveSummary(url, businessSnapshot, topFindings, topStrengths, scorecard);

    const bundle: any = {
      run_id: runId,
      analyzed_at: new Date().toISOString(),
      report_type: 'deploy_analysis_gtm_bundle',
      url,
      domain: getDomain(url),
      business_snapshot: businessSnapshot,
      scorecard,
      executive_summary: executiveSummary,
      specialist_overview: specialistOverview,
      top_strengths: topStrengths,
      top_findings: topFindings,
      priority_actions: priorityActions,
      marketing_playbook: marketingPlaybook,
      sales_playbook: salesPlaybook,
      specialists: payloads,
      limitations,
      model_routing: modelRouting,
      debug_path: debugPath,
    };

    fs.writeFileSync(
      path.join(debugPath, 'specialists.json'),
      JSON.stringify(
        specialists.map((item) => ({
          specialty: item.spec.id,
          label: item.spec.label,
          join: item.join,
          payload: item.payload,
        })),
        null,
        2,
      ),
      'utf-8',
    );

    const bundlePath = path.join(
      _workspacePath,
      `site-analysis-${slug}-bundle-${Date.now().toString(36)}.json`,
    );
    bundle['artifact_path'] = bundlePath;
    fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf-8');

    const artifact: DeployAnalysisArtifact = {
      type: 'report',
      title: 'Deploy Analysis Bundle',
      path: bundlePath,
      status: 'ok',
      summary: 'Structured GTM analysis bundle used to build the inline dashboard and written growth plan.',
    };

    if (args?.save_to_entity) {
      try {
        const entityPath = path.join(_workspacePath, 'entities', 'clients', `${args.save_to_entity}.md`);
        if (fs.existsSync(entityPath)) {
          fs.appendFileSync(entityPath, buildEntitySummary(bundle), 'utf-8');
        }
      } catch {
        // Best-effort only.
      }
    }

    _broadcastFn?.({
      type: 'analysis_complete',
      url,
      teamId: runId,
      artifactPath: bundlePath,
      score: scorecard.overall_gtm_health,
    });

    const compactBundle = buildCompactBundle(bundle);
    const instructions = [
      `DEPLOY_ANALYSIS_TEAM_COMPLETE for ${url}`,
      '',
      'Do not call present_file. This tool already returned the analysis bundle you need.',
      'Your next response must do the following in order:',
      '1. Output exactly one inline fenced ```html dashboard that visualizes this bundle.',
      '2. The dashboard must include scorecards, strengths, findings, marketing playbook, sales playbook, and priority actions.',
      '3. The dashboard must include download controls that let the user save either the dashboard HTML itself or the embedded JSON bundle.',
      '4. After the HTML block, write a natural-language executive rundown, then a full breakdown of what is good, what is wrong, and a prioritized plan to improve the site.',
      '5. Include specific marketing strategy and sales tactic recommendations, not just UX notes.',
      '',
      `Artifact bundle saved at: ${bundlePath}`,
      '',
      'DEPLOY_ANALYSIS_BUNDLE_START',
      JSON.stringify(compactBundle, null, 2),
      'DEPLOY_ANALYSIS_BUNDLE_END',
    ].join('\n');

    return {
      success: true,
      stdout: instructions,
      data: bundle,
      artifacts: [artifact],
    };
  },
};
