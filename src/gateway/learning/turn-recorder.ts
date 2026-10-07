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
 *                                       per-skill labels (hit / false_positive / miss)
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
  now?: Date;
}

export type SkillLabel = 'hit' | 'false_positive' | 'miss';

export interface LearningTurnRecord {
  v: 1;
  ts: string;
  sessionId: string;
  executionMode: string;
  requestHash: string;
  requestExcerpt: string;
  routingMatched: boolean;
  offered: Array<{ id: string; reason: string; score: number; confidence: string; terms: string[] }>;
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

  const offered = (routing?.candidates || []).map((c) => ({
    id: String(c.id),
    reason: String(c.reason),
    score: Number(c.score) || 0,
    confidence: String(c.confidence),
    terms: Array.from(new Set([...(c.matchedTriggers || []), ...(c.promptSignalEvidence || [])].map(String))).slice(0, 12),
  }));

  const read = Array.from(new Set(tools
    .filter((t) => String(t.name) === 'skill_read' && !t.error)
    .map((t) => String(argsOf(t).id || argsOf(t).skill_id || '').trim())
    .filter(Boolean)));
  const listedQueries = tools
    .filter((t) => String(t.name) === 'skill_list')
    .map((t) => String(argsOf(t).query || '').trim())
    .filter(Boolean)
    .slice(0, 6);

  const offeredIds = new Set(offered.map((o) => o.id.toLowerCase()));
  const readIds = new Set(read.map((r) => r.toLowerCase()));
  const labels: LearningTurnRecord['labels'] = [];
  for (const o of offered) {
    labels.push({ skillId: o.id, label: readIds.has(o.id.toLowerCase()) ? 'hit' : 'false_positive', terms: o.terms });
  }
  for (const r of read) {
    if (!offeredIds.has(r.toLowerCase())) labels.push({ skillId: r, label: 'miss', terms: [] });
  }

  const toolErrors = tools.filter((t) => t.error).map((t) => String(t.name)).slice(0, 20);
  const signals: string[] = [];
  const candidates: LearningCandidate[] = [];
  const excerpt = request.replace(/\s+/g, ' ').trim().slice(0, 400);
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
      v: 1,
      ts: now.toISOString(),
      sessionId: input.sessionId,
      executionMode: input.executionMode,
      requestHash,
      requestExcerpt: excerpt.slice(0, 240),
      routingMatched,
      offered,
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
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
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
    fs.appendFileSync(path.join(dir, 'turns', `${dayOf(new Date(record.ts))}.jsonl`), JSON.stringify(record) + '\n', 'utf-8');
    if (candidates.length) {
      const file = path.join(dir, 'candidates.jsonl');
      const seen = readCandidateIds(file);
      const fresh = candidates.filter((c) => !seen.has(c.id));
      if (fresh.length) fs.appendFileSync(file, fresh.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf-8');
    }
    return record;
  } catch (err: any) {
    console.warn('[LearningRecorder] failed to record turn:', err?.message || err);
    return null;
  }
}

export interface SkillRoutingStats {
  days: number;
  turns: number;
  turnsWithRouting: number;
  skills: Array<{ skillId: string; offered: number; hits: number; falsePositives: number; misses: number; precision: number | null }>;
  terms: Array<{ skillId: string; term: string; offered: number; hits: number; precision: number }>;
}

/** Rolling precision per skill and per trigger term over the last N days. */
export function computeSkillRoutingStats(workspacePath: string, days = 30, now = new Date()): SkillRoutingStats {
  const dir = path.join(learningDir(workspacePath), 'turns');
  const perSkill = new Map<string, { offered: number; hits: number; fp: number; misses: number }>();
  const perTerm = new Map<string, { skillId: string; term: string; offered: number; hits: number }>();
  let turns = 0;
  let withRouting = 0;
  for (let d = 0; d < days; d += 1) {
    const file = path.join(dir, `${dayOf(new Date(now.getTime() - d * 86_400_000))}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let rec: LearningTurnRecord;
      try { rec = JSON.parse(line); } catch { continue; }
      turns += 1;
      if (rec.routingMatched) withRouting += 1;
      for (const l of rec.labels || []) {
        const s = perSkill.get(l.skillId) || { offered: 0, hits: 0, fp: 0, misses: 0 };
        if (l.label === 'miss') s.misses += 1;
        else {
          s.offered += 1;
          if (l.label === 'hit') s.hits += 1; else s.fp += 1;
          for (const term of l.terms || []) {
            const key = `${l.skillId}\u0000${term}`;
            const t = perTerm.get(key) || { skillId: l.skillId, term, offered: 0, hits: 0 };
            t.offered += 1;
            if (l.label === 'hit') t.hits += 1;
            perTerm.set(key, t);
          }
        }
        perSkill.set(l.skillId, s);
      }
    }
  }
  return {
    days,
    turns,
    turnsWithRouting: withRouting,
    skills: [...perSkill.entries()]
      .map(([skillId, s]) => ({ skillId, offered: s.offered, hits: s.hits, falsePositives: s.fp, misses: s.misses, precision: s.offered ? +(s.hits / s.offered).toFixed(3) : null }))
      .sort((a, b) => (b.falsePositives + b.misses) - (a.falsePositives + a.misses)),
    terms: [...perTerm.values()]
      .map((t) => ({ ...t, precision: +(t.hits / t.offered).toFixed(3) }))
      .sort((a, b) => (b.offered - b.hits) - (a.offered - a.hits))
      .slice(0, 200),
  };
}
