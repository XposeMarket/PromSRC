import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { safeAuditSessionId, scrubAuditValue } from './continuity';

const MAX_FILE_READ = 512 * 1024;
const PREVIEW_FILE_READ = 24 * 1024;
const MAX_RESULTS = 100;
const MAX_CHARS = 24_000;
const MAX_CANDIDATE_SESSIONS = 80;
const SCAN_DEADLINE_MS = 650;
const SCAN_BYTE_BUDGET = 2 * 1024 * 1024;

type Budget = { deadline: number; remainingBytes: number; exhausted: boolean };
function auditRoot(): string { return path.resolve(getConfig().getWorkspacePath(), 'audit'); }
function confined(...parts: string[]): string {
  const root = auditRoot(); const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid audit artifact reference.');
  return target;
}
function limit(value: any, fallback: number, ceiling: number): number { return Math.max(1, Math.min(ceiling, Math.floor(Number(value) || fallback))); }
function readJson(filePath: string, cap = 128 * 1024): any | null {
  try { const stat = fs.statSync(filePath); if (!stat.isFile() || stat.size > cap) return null; return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}
function scrubArtifactText(value: string): string {
  try { return require('../../security/vault').scrubSecrets(value); } catch { return value; }
}
function budgetedTailLines(filePath: string, maxLines: number, budget?: Budget, byteCap = MAX_FILE_READ): any[] {
  try {
    if (budget && (budget.exhausted || Date.now() >= budget.deadline || budget.remainingBytes <= 0)) { budget.exhausted = true; return []; }
    const stat = fs.statSync(filePath); if (!stat.isFile()) return [];
    const bytes = Math.min(stat.size, byteCap, budget ? budget.remainingBytes : byteCap);
    if (budget) budget.remainingBytes -= bytes;
    const fd = fs.openSync(filePath, 'r'); const data = Buffer.alloc(bytes); fs.readSync(fd, data, 0, bytes, Math.max(0, stat.size - bytes)); fs.closeSync(fd);
    if (budget && Date.now() >= budget.deadline) budget.exhausted = true;
    return data.toString('utf8').split(/\r?\n/).slice(-maxLines * 3).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).slice(-maxLines);
  } catch { return []; }
}
function artifactRef(relative: string): string { return `audit:${Buffer.from(relative, 'utf8').toString('base64url')}`; }
function rawArtifactRef(sessionId: string, observationId: string, rawRef: string): string { return `auditraw:${Buffer.from(JSON.stringify({ sessionId, observationId, rawRef }), 'utf8').toString('base64url')}`; }
function decodeArtifactRef(ref: any): { kind: 'normal'; relative: string } | { kind: 'raw'; sessionId: string; observationId: string; rawRef: string } {
  const value = String(ref || '');
  if (value.startsWith('auditraw:')) {
    try {
      const parsed = JSON.parse(Buffer.from(value.slice(9), 'base64url').toString('utf8'));
      const sessionId = safeAuditSessionId(parsed.sessionId); const observationId = String(parsed.observationId || ''); const rawRef = String(parsed.rawRef || '');
      if (!/^[a-zA-Z0-9._-]{1,220}$/.test(observationId) || rawRef !== `tool-observation-raw:${sessionId}/${observationId}.txt`) throw new Error('bad raw ref');
      return { kind: 'raw', sessionId, observationId, rawRef };
    } catch { throw new Error('Invalid audit raw artifact reference.'); }
  }
  if (!value.startsWith('audit:')) throw new Error('Invalid audit artifact reference.');
  let relative = ''; try { relative = Buffer.from(value.slice(6), 'base64url').toString('utf8'); } catch { throw new Error('Invalid audit artifact reference.'); }
  if (!/^(chats\/(continuity|transcripts|compactions|tool-observations)\/[a-zA-Z0-9._-]+\.(jsonl|md|txt))$/.test(relative) || relative.includes('..')) throw new Error('Invalid audit artifact reference.');
  return { kind: 'normal', relative };
}
function mirrorProvenance(): Record<string, any> {
  const index = readJson(confined('_index', 'global.json'));
  const generatedAt = typeof index?.generatedAt === 'string' ? index.generatedAt : null;
  const generatedMs = generatedAt ? Date.parse(generatedAt) : NaN;
  const expectedIntervalMs = Number(index?.freshness?.expectedIntervalMs) || null;
  const ageMs = Number.isFinite(generatedMs) ? Math.max(0, Date.now() - generatedMs) : null;
  const stale = ageMs == null || (expectedIntervalMs != null && ageMs > expectedIntervalMs * 2) || index?.freshness?.status === 'error';
  return { source: 'workspace/audit only', mirror: { available: !!index, generatedAt, status: index?.freshness?.status || 'unavailable', expectedIntervalMs, ageMs, stale, materializerErrors: Number(index?.materializer?.errors || 0), artifactRole: index?.artifactRole || null, sourceOfTruth: index?.sourceOfTruth === true, provenance: index?.provenance || null }, continuityJournal: { immediate: true, note: 'redacted bounded journal; timestamp is reported per session/event' } };
}
function sessionMetadata(sessionId: string): any {
  const previews = readJson(confined('_index', 'sessions-preview.json'));
  const item = Array.isArray(previews) ? previews.find((entry: any) => entry?.id === sessionId) : null;
  if (!item) return { available: false, reason: 'not_materialized_or_not_previewed' };
  return scrubAuditValue({ available: true, title: item.title, channel: item.channel, lastActiveAt: item.lastActiveAt, messageCount: item.messageCount ?? item.historyLength, goalStatus: item.goalStatus, mtimeMs: item.mtimeMs });
}
function recentSessionIds(): string[] {
  const ids = new Map<string, number>();
  const previews = readJson(confined('_index', 'sessions-preview.json'));
  if (Array.isArray(previews)) for (const item of previews) if (/^[a-zA-Z0-9._-]{1,180}$/.test(String(item?.id || ''))) ids.set(item.id, Math.max(Number(item.lastActiveAt || 0), Number(item.mtimeMs || 0)));
  for (const item of budgetedTailLines(confined('chats', 'continuity', '_recent.jsonl'), 300, undefined, 128 * 1024)) if (/^[a-zA-Z0-9._-]{1,180}$/.test(String(item?.sessionId || ''))) ids.set(item.sessionId, Math.max(ids.get(item.sessionId) || 0, Number(item.timestamp || 0)));
  return [...ids.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATE_SESSIONS).map(([id]) => id);
}
function rawRefForObserved(sessionId: string, event: any): { state: string; artifactRef?: string } | undefined {
  const rawRef = String(event?.resultRawRef || ''); const observationId = String(event?.id || event?.observationId || '');
  if (!rawRef) return undefined;
  if (!/^[a-zA-Z0-9._-]{1,220}$/.test(observationId) || rawRef !== `tool-observation-raw:${sessionId}/${observationId}.txt`) return { state: 'unavailable_invalid_observation_ref' };
  const filePath = confined('chats', 'tool-observations', 'raw', sessionId, `${observationId}.txt`);
  return fs.existsSync(filePath) ? { state: 'available', artifactRef: rawArtifactRef(sessionId, observationId, rawRef) } : { state: 'unavailable_pending_materialization' };
}
function eventsForSession(sessionId: string, max = 80, budget?: Budget, preview = false): any[] {
  const safe = safeAuditSessionId(sessionId); const bases = [['chats', 'continuity', `${safe}.jsonl`], ['chats', 'transcripts', `${safe}.jsonl`], ['chats', 'compactions', `${safe}.jsonl`], ['chats', 'tool-observations', `${safe}.jsonl`]] as const;
  const events: any[] = [];
  for (const parts of bases) {
    const rel = parts.join('/');
    for (const raw of budgetedTailLines(confined(...parts), max, budget, preview ? PREVIEW_FILE_READ : MAX_FILE_READ)) {
      const event: any = { ...scrubAuditValue(raw), evidenceRef: artifactRef(rel) };
      if ((event.type === 'tool_observation' || event.toolName) && parts[1] === 'tool-observations') event.rawResult = rawRefForObserved(safe, raw) || { state: 'not_recorded' };
      events.push(event);
    }
  }
  return events.sort((a, b) => Number(a.timestamp || a.createdAt || 0) - Number(b.timestamp || b.createdAt || 0)).slice(-max);
}
function compactEvent(event: any): any {
  return scrubAuditValue({ timestamp: event.timestamp || event.createdAt, type: event.type || (event.toolName ? 'tool_observation' : event.role ? 'message' : 'artifact'), role: event.role, messageKind: event.messageKind, toolName: event.toolName, status: event.status, content: event.content, toolLog: event.toolLog, resultPreview: event.resultPreview, argsPreview: event.argsPreview, pathsTouched: event.pathsTouched, goal: event.goal, currentIteration: event.currentIteration, restartCheckpoint: event.restartCheckpoint, turnPlans: event.turnPlans, rawResult: event.rawResult, evidenceRef: event.evidenceRef });
}
function candidate(sessionId: string, budget: Budget): any {
  const events = eventsForSession(sessionId, 24, budget, true); const last = events[events.length - 1]; const lastAssistant = [...events].reverse().find((event) => event.role === 'assistant'); const lastTool = [...events].reverse().find((event) => event.type === 'tool_observation' || event.toolName); const reasons: string[] = []; let score = 0;
  if (lastTool && (!lastAssistant || Number(lastTool.timestamp || lastTool.createdAt || 0) > Number(lastAssistant.timestamp || 0))) { score += 45; reasons.push('tool evidence is newer than the last assistant response'); }
  if (lastTool?.status === 'error') { score += 25; reasons.push('latest recorded tool failed'); }
  if (/restart|interrupted|crash/i.test(JSON.stringify(events.slice(-8)))) { score += 35; reasons.push('restart/interruption evidence is present'); }
  if (events.some((event) => event.type === 'goal_state' && /restarting|active/.test(String(event.status || '')))) { score += 25; reasons.push('active or restarting goal evidence is present'); }
  return { sessionId, session: sessionMetadata(sessionId), confidence: score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low', score, reasons, freshness: Number(last?.timestamp || last?.createdAt || 0) || null, lastEvent: last ? compactEvent(last) : null, evidenceRefs: [...new Set(events.slice(-8).map((event) => event.evidenceRef).filter(Boolean))] };
}
function requestState(sessionId: string): any {
  const candidates = ['chats/requests', 'requests/state'];
  for (const dir of candidates) {
    const root = confined(...dir.split('/')); if (!fs.existsSync(root)) continue;
    const names = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).slice(0, 40);
    const records = names.map((entry) => readJson(path.join(root, entry.name), 64 * 1024)).filter(Boolean).filter((record: any) => String(record.sessionId || record.ownerSessionId || '') === sessionId).slice(0, 12).map((record: any) => scrubAuditValue({ id: record.id, kind: record.kind || record.type, status: record.status, approvalStatus: record.approvalStatus, question: record.question, updatedAt: record.updatedAt }));
    return { inspected: true, available: true, records };
  }
  return { inspected: false, available: false, reason: 'audit_request_mirror_unavailable' };
}
function validateRawIssued(ref: { kind: 'raw'; sessionId: string; observationId: string; rawRef: string }): string {
  const observations = budgetedTailLines(confined('chats', 'tool-observations', `${ref.sessionId}.jsonl`), 400, undefined, MAX_FILE_READ);
  if (!observations.some((item: any) => item?.id === ref.observationId && item?.resultRawRef === ref.rawRef)) throw new Error('Raw artifact reference was not issued from an observed materialized result.');
  return confined('chats', 'tool-observations', 'raw', ref.sessionId, `${ref.observationId}.txt`);
}

export function executePrometheusAuditOps(_ownerSessionId: string, args: any): Record<string, any> {
  const action = String(args?.action || '').trim().toLowerCase(); const max = limit(args?.limit, 30, MAX_RESULTS); if (!['recent_sessions', 'search', 'session_timeline', 'recovery_candidates', 'recovery_brief', 'read_artifact'].includes(action)) throw new Error('Unsupported prometheus_audit_ops action.');
  const provenance = mirrorProvenance();
  if (action === 'recent_sessions') {
    const budget: Budget = { deadline: Date.now() + SCAN_DEADLINE_MS, remainingBytes: SCAN_BYTE_BUDGET, exhausted: false }; const sessions = recentSessionIds().slice(0, max).map((id) => candidate(id, budget)).sort((a, b) => Number(b.freshness || 0) - Number(a.freshness || 0));
    return { sessions, partial: budget.exhausted, budget: { exhausted: budget.exhausted, remainingBytes: budget.remainingBytes }, provenance };
  }
  if (action === 'search') {
    const query = String(args?.query || '').trim().toLowerCase(); if (!query) throw new Error('query is required.'); const hits: any[] = []; const budget: Budget = { deadline: Date.now() + SCAN_DEADLINE_MS, remainingBytes: SCAN_BYTE_BUDGET, exhausted: false };
    searchSessions: for (const id of recentSessionIds()) { for (const event of eventsForSession(id, Math.min(max, 24), budget, true)) { const compact = compactEvent(event); if (JSON.stringify(compact).toLowerCase().includes(query)) hits.push({ sessionId: id, ...compact }); if (hits.length >= max) break searchSessions; } if (budget.exhausted) break; }
    return { query, hits, rawResultsExcluded: true, partial: budget.exhausted, budget: { exhausted: budget.exhausted, remainingBytes: budget.remainingBytes }, provenance };
  }
  if (action === 'session_timeline') { const sessionId = safeAuditSessionId(args?.session_id); const events = eventsForSession(sessionId, max); return { sessionId, session: sessionMetadata(sessionId), events: events.map(compactEvent), freshness: events[events.length - 1]?.timestamp || events[events.length - 1]?.createdAt || null, rawResultsExcluded: true, provenance }; }
  if (action === 'recovery_candidates') { const budget: Budget = { deadline: Date.now() + SCAN_DEADLINE_MS, remainingBytes: SCAN_BYTE_BUDGET, exhausted: false }; const candidates: any[] = []; for (const id of recentSessionIds()) { if (budget.exhausted) break; const item = candidate(id, budget); if (item.score > 0) candidates.push(item); if (candidates.length >= max) break; } candidates.sort((a, b) => b.score - a.score || Number(b.freshness || 0) - Number(a.freshness || 0)); return { candidates, partial: budget.exhausted, budget: { exhausted: budget.exhausted, remainingBytes: budget.remainingBytes }, note: 'Candidates are evidence only; verify live Goal/request state before any mutation.', provenance }; }
  if (action === 'recovery_brief') {
    const sessionId = safeAuditSessionId(args?.session_id); const events = eventsForSession(sessionId, 80); const messages = events.filter((event) => event.role); const tools = events.filter((event) => event.type === 'tool_observation' || event.toolName); const goal = [...events].reverse().find((event) => event.type === 'goal_state'); const plans = Array.isArray(goal?.turnPlans) ? goal.turnPlans : []; const currentPlan = plans[plans.length - 1] || null; const activeStep = currentPlan?.steps?.[Number(currentPlan?.activeIndex)] || currentPlan?.steps?.find((step: any) => step.status === 'in_progress') || null;
    return { sessionId, session: sessionMetadata(sessionId), objectiveOrRequest: goal?.goal || messages.find((event) => event.role === 'user')?.content || null, lastUserInstruction: [...messages].reverse().find((event) => event.role === 'user')?.content || null, goalState: goal ? scrubAuditValue({ available: true, objective: goal.goal, status: goal.status, currentIteration: goal.currentIteration, currentPlan, activeStep, restartCheckpoint: goal.restartCheckpoint }) : { available: false, reason: 'no_goal_state_in_audit' }, requestState: requestState(sessionId), lastSuccessfulTool: [...tools].reverse().find((event) => event.status === 'ok') ? compactEvent([...tools].reverse().find((event) => event.status === 'ok')) : null, lastFailedTool: [...tools].reverse().find((event) => event.status === 'error') ? compactEvent([...tools].reverse().find((event) => event.status === 'error')) : null, pathsTouched: [...new Set(tools.flatMap((event) => Array.isArray(event.pathsTouched) ? event.pathsTouched : []))].slice(-20), lastAssistantResponse: [...messages].reverse().find((event) => event.role === 'assistant')?.content || null, freshness: events[events.length - 1]?.timestamp || events[events.length - 1]?.createdAt || null, continuityTimestamp: [...events].reverse().find((event) => event.evidenceRef === artifactRef(`chats/continuity/${sessionId}.jsonl`))?.timestamp || null, evidenceRefs: [...new Set(events.slice(-20).map((event) => event.evidenceRef).filter(Boolean))], safeSuggestedChecks: ['Inspect the current session with prometheus_thread_ops read/status.', 'Inspect existing approved work with prometheus_request_ops before recover.', 'Verify live Goal/request state before any mutation; do not duplicate a recovery.'], provenance };
  }
  const decoded = decodeArtifactRef(args?.artifact_ref); const filePath = decoded.kind === 'raw' ? validateRawIssued(decoded) : confined(...decoded.relative.split('/')); const offset = Math.max(0, Math.floor(Number(args?.offset) || 0)); const chars = limit(args?.max_chars, 8000, MAX_CHARS); const stat = fs.statSync(filePath); if (!stat.isFile()) throw new Error(decoded.kind === 'raw' ? 'Raw audit artifact is unavailable pending materialization.' : 'Audit artifact not found.'); const fd = fs.openSync(filePath, 'r'); const bytes = Math.min(chars, Math.max(0, stat.size - offset)); const data = Buffer.alloc(bytes); fs.readSync(fd, data, 0, bytes, offset); fs.closeSync(fd);
  return { artifactRef: args.artifact_ref, kind: decoded.kind, offset, nextOffset: offset + bytes < stat.size ? offset + bytes : null, size: stat.size, content: scrubArtifactText(data.toString('utf8')), provenance };
}
