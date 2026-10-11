/**
 * learning/turn-recorder.ts
 *
 * Learning loop, stage 1 (capture). Runs once per finished interactive turn,
 * with no LLM call. It persists:
 *
 *   Brain/learning/turns/<date>.jsonl   one line per turn: which skills the router
 *                                       OFFERED (and the trigger evidence that
 *                                       matched), which were actually READ, which
 *                                       were found by hand via skill_list, plus
 *                                       per-skill usage labels (read / not_read / miss)
 *                                       and lightweight outcome signals.
 *   Brain/learning/candidates.jsonl     deduped candidates (user corrections and
 *                                       explicit "always/never/from now on"
 *                                       instructions) for the later judge/gate.
 *
 * The offered side never used to be persisted (the routing report lived only in
 * an in-memory map), so trigger precision could not be measured. These logs are
 * the data source for skill-trigger tuning; nothing here mutates skills or memory.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scrubContextText } from '../../runtime/context-receipt';
import type { SkillRoutingReport } from '../../runtime/skill-routing-resolver';

export interface LearningToolResult {
  name: string;
  args?: unknown;
  result?: string;
  error?: boolean;
}

export interface LearningTurnInput {
  workspacePath: string;
  sessionId: string;
  executionMode: string;
  request: string;
  finalResponse: string;
  toolResults: LearningToolResult[];
  routing?: SkillRoutingReport;
  gatewayTurnId?: string;
  now?: Date;
}

export type SkillLabel = 'hit' | 'false_positive' | 'miss' | 'read' | 'not_read';
export type Relevance = 'relevant' | 'irrelevant' | 'unknown';

export interface LearningTurnRecord {
  v: 1 | 2;
  turnId?: string;
  gatewayTurnId?: string;
  excluded?: Array<{ id: string; reason: string }>;
  ts: string;
  sessionId: string;
  executionMode: string;
  requestHash: string;
  requestExcerpt: string;
  routingMatched: boolean;
  offered: Array<{ id: string; reason: string; score: number; confidence: string; terms: string[]; usage?: 'read' | 'not_read'; relevance?: 'unknown' }>;
  read: string[];
  listedQueries: string[];
  labels: Array<{ skillId: string; label: SkillLabel; terms: string[] }>;
  discoveryRecommended: boolean;
  toolCount: number;
  toolErrors: string[];
  signals: string[];
  candidateIds: string[];
}

export interface LearningCandidate {
  id: string;
  ts: string;
  kind: 'user_correction' | 'explicit_instruction';
  status: 'new';
  sessionId: string;
  text: string;
  evidence: string;
}

const CORRECTION_RE = /\b(that'?s wrong|not what i (asked|meant|said)|you missed|you forgot|should have|i told you|i already (said|told)|don'?t do that|stop doing|why did you|again\?|not quite|instead of)\b/i;
const INSTRUCTION_RE = /\b(from now on|next time|always|never|remember (to|that)|make sure (to|you)|going forward|every time)\b/i;

export function sha(text: string): string {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function learningDir(workspacePath: string): string {
  return path.join(workspacePath, 'Brain', 'learning');
}

function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function argsOf(tr: LearningToolResult): Record<string, any> {
  const a = tr.args;
  if (a && typeof a === 'object') return a as Record<string, any>;
  if (typeof a === 'string') { try { return JSON.parse(a); } catch { return {}; } }
  return {};
}

/** Pure: compute the per-turn record (no I/O except none). Exported for tests. */
export function buildLearningTurnRecord(input: LearningTurnInput): { record: LearningTurnRecord; candidates: LearningCandidate[] } {
  const now = input.now || new Date();
  const request = String(input.request || '');
  const requestHash = sha(request);
  const tools = Array.isArray(input.toolResults) ? input.toolResults : [];
  // A routing report from an earlier turn in the same session must not be
  // attributed to this one.
  const routingMatched = !!input.routing && input.routing.messageHash === requestHash;
  const routing = routingMatched ? input.routing! : undefined;

  const offered = (routing?.candidates || []).slice(0, 100).map((c) => ({
    id: String(c.id),
    reason: safeExcerpt(c.reason, 240),
    score: Number(c.score) || 0,
    confidence: String(c.confidence),
    terms: Array.from(new Set([...(c.matchedTriggers || []), ...(c.promptSignalEvidence || [])].map(t => safeExcerpt(String(t), 160)))).slice(0, 12),
  }));

  const read = Array.from(new Set(tools
    .filter((t) => String(t.name) === 'skill_read' && !t.error)
    .map((t) => String(argsOf(t).id || argsOf(t).skill_id || '').trim())
    .filter(Boolean)));
  const listedQueries = tools
    .filter((t) => String(t.name) === 'skill_list')
    .map((t) => safeExcerpt(String(argsOf(t).query || ''), 240))
    .filter(Boolean)
    .slice(0, 6);

  const offeredIds = new Set(offered.map((o) => o.id.toLowerCase()));
  const readIds = new Set(read.map((r) => r.toLowerCase()));
  const labels: LearningTurnRecord['labels'] = [];
  for (const o of offered) {
    labels.push({ skillId: o.id, label: readIds.has(o.id.toLowerCase()) ? 'read' : 'not_read', terms: o.terms });
  }
  for (const r of read) {
    if (!offeredIds.has(r.toLowerCase())) labels.push({ skillId: r, label: 'miss', terms: [] });
  }

  const toolErrors = tools.filter((t) => t.error).map((t) => String(t.name)).slice(0, 20);
  const signals: string[] = [];
  const candidates: LearningCandidate[] = [];
  const excerpt = safeExcerpt(request, 400);
  if (CORRECTION_RE.test(request)) signals.push('user_correction');
  if (INSTRUCTION_RE.test(request)) signals.push('explicit_instruction');
  if (toolErrors.length) signals.push('tool_errors');
  for (const kind of ['user_correction', 'explicit_instruction'] as const) {
    if (!signals.includes(kind)) continue;
    candidates.push({
      id: `lc_${sha(`${kind}:${excerpt.toLowerCase()}`).slice(0, 16)}`,
      ts: now.toISOString(),
      kind,
      status: 'new',
      sessionId: input.sessionId,
      text: excerpt,
      evidence: `session ${input.sessionId} @ ${now.toISOString()}`,
    });
  }

  return {
    record: {
      v: 2,
      turnId: `lt_${crypto.randomBytes(16).toString('hex')}`,
      gatewayTurnId: input.gatewayTurnId ? safeExcerpt(input.gatewayTurnId, 160) : undefined,
      excluded: (routing?.excluded || []).slice(0, 100).map(c => ({ id: String(c.id).slice(0, 128), reason: safeExcerpt(c.reason, 240) })),
      ts: now.toISOString(),
      sessionId: input.sessionId,
      executionMode: input.executionMode,
      requestHash,
      requestExcerpt: excerpt.slice(0, 240),
      routingMatched,
      offered: offered.map(o => ({ ...o, usage: readIds.has(o.id.toLowerCase()) ? 'read' : 'not_read', relevance: 'unknown' })),
      read,
      listedQueries,
      labels,
      discoveryRecommended: !!routing?.discoveryRecommended,
      toolCount: tools.length,
      toolErrors,
      signals,
      candidateIds: candidates.map((c) => c.id),
    },
    candidates,
  };
}

function readCandidateIds(file: string): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync(file)) return ids;
  for (const line of boundedLines(file)) {
    const m = /"id":"(lc_[a-f0-9]+)"/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** Persist one turn. Never throws; learning capture must not break a turn. */
export function recordLearningTurn(input: LearningTurnInput): LearningTurnRecord | null {
  try {
    const workspacePath = String(input.workspacePath || '').trim();
    const sessionId = String(input.sessionId || '').trim();
    if (!workspacePath || !sessionId || sessionId.startsWith('brain_')) return null;
    if (!String(input.request || '').trim()) return null;
    const { record, candidates } = buildLearningTurnRecord(input);
    const dir = learningDir(workspacePath);
    fs.mkdirSync(path.join(dir, 'turns'), { recursive: true });
    boundedAppend(path.join(dir, 'turns', `${dayOf(new Date(record.ts))}.jsonl`), record);
    if (candidates.length) {
      const file = path.join(dir, 'candidates.jsonl');
      const seen = readCandidateIds(file);
      const fresh = candidates.filter((c) => !seen.has(c.id));
      for (const candidate of fresh) boundedAppend(file, candidate);
    }
    return record;
  } catch (err: any) {
    console.warn('[LearningRecorder] failed to record turn:', err?.message || err);
    return null;
  }
}

/** Redact common credential forms BEFORE truncation; hashes link to the original request. */
export function safeExcerpt(text: string, max = 240): string {
  return scrubContextText(String(text || '')).replace(/\b(?:bearer\s+)[\w.\-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[credential redacted]')
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,})\b/g, '[redacted]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[redacted]@')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 10000;
export interface EvidenceScanBudget { remainingBytes: number; deadline: number; partial: boolean }
function boundedLines(file: string, budget?: EvidenceScanBudget): string[] {
  try {
    if (budget && (Date.now() >= budget.deadline || budget.remainingBytes <= 0)) { budget.partial = true; return []; }
    const size = fs.statSync(file).size;
    if (size > MAX_FILE_BYTES || !fs.lstatSync(file).isFile()) { if (budget) budget.partial = true; return []; }
    if (budget && size > budget.remainingBytes) { budget.partial = true; return []; }
    if (budget) budget.remainingBytes -= size;
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.length <= 65536).slice(-MAX_RECORDS);
  } catch { return []; }
}
function boundedAppend(file: string, value: unknown): void {
  const line = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(line) > 65536) throw new Error('Evidence record too large');
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.statSync(file).size + Buffer.byteLength(line) > MAX_FILE_BYTES)) throw new Error('Evidence storage capacity reached');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line, 'utf8');
}
function windowDays(days: number): number { return Number.isFinite(days) ? Math.max(1, Math.min(90, Math.floor(days))) : 30; }
export interface RoutingReview { turnId: string; requestHash: string; skillId: string; relevance: Relevance; reason: string; ts: string; reviewerSource?: 'user' | 'agent'; reviewerId?: string; reviewedEvidence?: string }
export interface RoutingEvidence extends LearningTurnRecord { turnId: string; reviews: RoutingReview[]; legacyProxy: boolean }
function validReview(r: any): r is RoutingReview {
  return !!r && /^lt_[a-f0-9]{32}$/.test(r.turnId) && /^[a-f0-9]{64}$/.test(r.requestHash)
    && typeof r.skillId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(r.skillId)
    && ['relevant', 'irrelevant', 'unknown'].includes(r.relevance) && typeof r.reason === 'string'
    && r.reason.trim().length > 0 && r.reason.length <= 500 && typeof r.ts === 'string' && Number.isFinite(Date.parse(r.ts))
    && (r.reviewerSource === undefined || ['user', 'agent'].includes(r.reviewerSource))
    && (r.reviewerId === undefined || (typeof r.reviewerId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.reviewerId)))
    && (r.reviewedEvidence === undefined || (typeof r.reviewedEvidence === 'string' && r.reviewedEvidence.trim().length > 0 && r.reviewedEvidence.length <= 1000))
    && (r.reviewerSource !== 'agent' || (typeof r.reviewerId === 'string' && typeof r.reviewedEvidence === 'string'));
}
export type RoutingEvidenceResult = RoutingEvidence[] & { scan: { partial: boolean; remainingBytes: number; maxBytes: number; deadlineMs: number } };
export function getSkillRoutingEvidence(workspacePath: string, options: { days?: number; skillId?: string; turnId?: string; relevance?: Relevance; limit?: number } = {}, now = new Date()): RoutingEvidenceResult {
  const budget: EvidenceScanBudget = { remainingBytes: 8 * 1024 * 1024, deadline: Date.now() + 150, partial: false };
  const reviews = new Map<string, RoutingReview>();
  for (const line of boundedLines(path.join(learningDir(workspacePath), 'routing-feedback.jsonl'), budget)) {
    if (Date.now() >= budget.deadline) { budget.partial = true; break; }
    try { const r = JSON.parse(line); if (validReview(r)) reviews.set(`${r.turnId}:${r.skillId}`, r); } catch {}
  }
  const records: RoutingEvidence[] = [];
  const seen = new Set<string>();
  for (let d = 0; d < windowDays(options.days ?? 30) && records.length < MAX_RECORDS; d++) {
    if (Date.now() >= budget.deadline || budget.remainingBytes <= 0) { budget.partial = true; break; }
    for (const line of boundedLines(path.join(learningDir(workspacePath), 'turns', `${dayOf(new Date(now.getTime() - d * 86400000))}.jsonl`), budget)) {
      if (Date.now() >= budget.deadline) { budget.partial = true; break; }
      try {
        const r = JSON.parse(line);
        if (!r || ![1, 2].includes(r.v) || typeof r.ts !== 'string' || !Number.isFinite(Date.parse(r.ts)) || typeof r.sessionId !== 'string'
          || typeof r.requestExcerpt !== 'string' || r.requestExcerpt.length > 400 || (Array.isArray(r.read) && r.read.length > 200)
          || !/^[a-f0-9]{64}$/.test(r.requestHash) || !Array.isArray(r.offered) || r.offered.length > 100 || !Array.isArray(r.read)
          || !r.offered.every((s: any) => s && typeof s.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s.id) && Array.isArray(s.terms) && s.terms.length <= 12 && s.terms.every((t: any) => typeof t === 'string' && t.length <= 160))) continue;
        const turnId = r.v === 2 ? r.turnId : `lt_${sha(`${r.sessionId}:${r.ts}:${r.requestHash}`).slice(0, 32)}`;
        if (!/^lt_[a-f0-9]{32}$/.test(turnId) || seen.has(turnId)) continue;
        if (options.turnId && options.turnId !== turnId) continue;
        const attached = r.offered.map((s: any) => reviews.get(`${turnId}:${s.id}`)).filter((v: any) => v && v.requestHash === r.requestHash);
        const offered: LearningTurnRecord['offered'] = r.offered.map((s: any) => ({ id: s.id, score: Number.isFinite(s.score) ? s.score : 0, confidence: safeExcerpt(s.confidence, 20), reason: safeExcerpt(s.reason), terms: s.terms.map((t: string) => safeExcerpt(t, 160)), usage: r.read.includes(s.id) ? 'read' : 'not_read', relevance: 'unknown' }));
        const evidence: RoutingEvidence = { v: r.v, ts: r.ts, sessionId: safeExcerpt(r.sessionId, 128), executionMode: safeExcerpt(r.executionMode, 64),
          requestHash: r.requestHash, routingMatched: r.routingMatched === true, offered, read: r.read.filter((id: any) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)),
          labels: [], discoveryRecommended: r.discoveryRecommended === true, toolCount: Number.isFinite(r.toolCount) ? r.toolCount : 0, toolErrors: [], signals: [], candidateIds: [],
          requestExcerpt: safeExcerpt(r.requestExcerpt), turnId,
          gatewayTurnId: typeof r.gatewayTurnId === 'string' ? safeExcerpt(r.gatewayTurnId, 160) : undefined,
          reviews: attached.map((v: RoutingReview) => ({ ...v, reason: safeExcerpt(v.reason, 500), reviewedEvidence: v.reviewedEvidence ? safeExcerpt(v.reviewedEvidence, 1000) : undefined })),
          excluded: Array.isArray(r.excluded) ? r.excluded.slice(0, 100).filter((v: any) => v && typeof v.id === 'string').map((v: any) => ({ id: v.id.slice(0, 128), reason: safeExcerpt(v.reason) })) : [],
          listedQueries: Array.isArray(r.listedQueries) ? r.listedQueries.slice(0, 6).map((v: string) => safeExcerpt(v)) : [], legacyProxy: r.v === 1 };
        if (options.skillId && !offered.some((s: any) => s.id === options.skillId)) continue;
        if (options.relevance && !offered.some((s: any) => (!options.skillId || s.id === options.skillId) && (attached.find((v: RoutingReview) => v.skillId === s.id)?.relevance || 'unknown') === options.relevance)) continue;
        seen.add(turnId);
        records.push(evidence);
        if (records.length >= MAX_RECORDS) break;
      } catch {}
    }
  }
  const result = records.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, Math.max(1, Math.min(MAX_RECORDS, Number.isFinite(options.limit) ? Math.floor(options.limit!) : 100))) as RoutingEvidenceResult;
  result.scan = { partial: budget.partial, remainingBytes: budget.remainingBytes, maxBytes: 8 * 1024 * 1024, deadlineMs: 150 };
  return result;
}
/** Validation and persistence share one path for API and regression callers. Workspace never comes from the body. */
export function submitSkillRoutingFeedback(workspacePath: string, body: unknown): RoutingReview {
  const b = body as any;
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['turnId', 'requestHash', 'skillId', 'relevance', 'reason', 'reviewerSource', 'reviewerId', 'reviewedEvidence'].includes(k))) throw new Error('Invalid feedback fields');
  const r: RoutingReview = { ...b, ts: new Date().toISOString() };
  if (!validReview(r)) throw new Error('Invalid feedback: turnId, requestHash, skillId, relevance and bounded reason required');
  const result = getSkillRoutingEvidence(workspacePath, { days: 90, turnId: r.turnId, limit: 1 });
  const turn = result[0];
  if (!turn && result.scan.partial) throw new Error('Evidence scan incomplete; feedback cannot be validated within the bounded scan');
  if (!turn || !turn.routingMatched || turn.requestHash !== r.requestHash || !turn.offered.some(s => s.id === r.skillId)) throw new Error('Feedback does not identify a matched offered skill in this workspace');
  r.reason = safeExcerpt(r.reason, 500);
  r.reviewerSource = r.reviewerSource || 'user';
  if (r.reviewedEvidence) r.reviewedEvidence = safeExcerpt(r.reviewedEvidence, 1000);
  boundedAppend(path.join(learningDir(workspacePath), 'routing-feedback.jsonl'), r);
  return r;
}
export interface RoutingCounts { offered: number; reads: number; notRead: number; hits: number; falsePositives: number; misses: number; relevant: number; irrelevant: number; unknown: number; reviewed: number; readRate: number | null; precision: number | null }
export interface SkillRoutingStats { days: number; turns: number; scan: RoutingEvidenceResult['scan']; turnsWithRouting: number; skills: Array<RoutingCounts & { skillId: string }>; terms: Array<RoutingCounts & { skillId: string; term: string }> }
export function computeSkillRoutingStats(workspacePath: string, days = 30, now = new Date()): SkillRoutingStats {
  const records = getSkillRoutingEvidence(workspacePath, { days, limit: MAX_RECORDS }, now);
  const skills = new Map<string, RoutingCounts & { skillId: string }>();
  const terms = new Map<string, RoutingCounts & { skillId: string; term: string }>();
  const fresh = (): RoutingCounts => ({ offered: 0, reads: 0, notRead: 0, hits: 0, falsePositives: 0, misses: 0, relevant: 0, irrelevant: 0, unknown: 0, reviewed: 0, readRate: null, precision: null });
  const add = (s: RoutingCounts, read: boolean, relevance: Relevance) => {
    s.offered++; if (read) s.reads++; else s.notRead++;
    s[relevance]++; s.reviewed = s.relevant + s.irrelevant;
    s.hits = s.relevant; s.falsePositives = s.irrelevant;
    s.readRate = s.reads / s.offered; s.precision = s.reviewed ? s.relevant / s.reviewed : null;
  };
  for (const r of records) {
    for (const o of r.offered) {
      const s = skills.get(o.id) || { ...fresh(), skillId: o.id };
      const relevance = r.reviews.find(v => v.skillId === o.id)?.relevance || 'unknown';
      const read = r.read.some(v => typeof v === 'string' && v.toLowerCase() === o.id.toLowerCase());
      add(s, read, relevance); skills.set(o.id, s);
      for (const term of new Set(o.terms)) {
        const key = `${o.id}\u0000${term}`;
        const t = terms.get(key) || { ...fresh(), skillId: o.id, term }; add(t, read, relevance); terms.set(key, t);
      }
    }
    for (const id of r.read) if (typeof id === 'string' && !r.offered.some(o => o.id.toLowerCase() === id.toLowerCase())) {
      const s = skills.get(id) || { ...fresh(), skillId: id }; s.misses++; skills.set(id, s);
    }
  }
  return { days: windowDays(days), turns: records.length, scan: records.scan, turnsWithRouting: records.filter(r => r.routingMatched).length,
    skills: [...skills.values()].sort((a, b) => b.offered - a.offered), terms: [...terms.values()].sort((a, b) => b.irrelevant - a.irrelevant).slice(0, 200) };
}
