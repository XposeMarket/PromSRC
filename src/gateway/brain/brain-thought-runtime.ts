import fs from 'fs';
import path from 'path';
import type { ActivityEvent, ActivityPackage } from './activity-package.js';
import { retrieveMemoryAtoms } from '../memory-index/memory-atoms.js';
import { appendBusinessCandidates, normalizeBusinessCandidate, readBusinessCandidates } from '../business/business-candidates.js';

const MAX_ACTIVITY_INDEX_CHARS = 18_000;
const MAX_CONTEXT_RESULT_CHARS = 12_000;
const MAX_ACTIVITY_RESULT_CHARS = 24_000;
const STOP_WORDS = new Set(['a','an','and','are','as','at','be','but','by','for','from','had','has','have','he','her','his','i','if','in','is','it','its','me','my','of','on','or','our','she','so','that','the','their','them','then','they','this','to','was','we','were','what','when','where','which','who','will','with','you','your']);

export type BrainThoughtContextSource = 'user' | 'memory' | 'notes' | 'soul';

export interface BrainThoughtRunRegistration {
  sessionId: string;
  workspacePath: string;
  dateStr: string;
  thoughtNumber: number;
  windowStart: string;
  windowEnd: string;
  activityPackage: ActivityPackage;
  thoughtFile: string;
  capsuleFile: string;
  activeWorkFile: string;
  businessCandidatesFile: string;
}

interface BrainThoughtRunState extends BrainThoughtRunRegistration {
  submitted: boolean;
}

const runs = new Map<string, BrainThoughtRunState>();

function cleanText(value: unknown, max = 600): string {
  const text = String(value ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 18))}...[truncated]`;
}

function queryTerms(value: unknown): string[] {
  return Array.from(new Set(String(value ?? '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._:/-]{2,}/g) || []))
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 24);
}

function requireRun(sessionId: string): BrainThoughtRunState {
  const run = runs.get(String(sessionId || '').trim());
  if (!run) throw new Error('Brain Thought tool is only available inside an active Thought run.');
  return run;
}

function safeWorkspacePath(workspacePath: string, relativePath: string): string {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes Thought workspace: ${relativePath}`);
  return target;
}

function sourceFile(run: BrainThoughtRunState, source: BrainThoughtContextSource): string {
  if (source === 'user') return safeWorkspacePath(run.workspacePath, 'USER.md');
  if (source === 'memory') return safeWorkspacePath(run.workspacePath, 'MEMORY.md');
  if (source === 'soul') return safeWorkspacePath(run.workspacePath, 'SOUL.md');
  return safeWorkspacePath(run.workspacePath, path.join('memory', `${run.dateStr}-intraday-notes.md`));
}

function chunkText(raw: string, source: BrainThoughtContextSource): Array<{ source: BrainThoughtContextSource; startLine: number; endLine: number; text: string }> {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const out: Array<{ source: BrainThoughtContextSource; startLine: number; endLine: number; text: string }> = [];
  const chunkSize = source === 'memory' ? 18 : 14;
  const overlap = 3;
  for (let start = 0; start < lines.length; start += Math.max(1, chunkSize - overlap)) {
    const slice = lines.slice(start, start + chunkSize);
    if (!slice.some((line) => line.trim())) continue;
    out.push({ source, startLine: start + 1, endLine: Math.min(lines.length, start + slice.length), text: slice.join('\n').trim() });
  }
  return out;
}

function scoreChunk(text: string, terms: string[]): number {
  if (!terms.length) return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += term.length >= 8 ? 4 : term.length >= 5 ? 3 : 2;
    const matches = haystack.split(term).length - 1;
    score += Math.min(3, matches - 1);
  }
  return score;
}

function eventGroupKey(event: ActivityEvent): string {
  const entity = event.entity || {};
  for (const key of ['sessionId','taskId','threadId','teamId','agentId','scheduleId','runId','fileId']) {
    if (entity[key]) return `${key}:${entity[key]}`;
  }
  const [prefix] = String(event.type || 'activity').split('.');
  return prefix || 'activity';
}

function eventSignalScore(event: ActivityEvent): number {
  const text = `${event.type} ${event.summary}`.toLowerCase();
  let score = 0;
  if (/user|message|chat/.test(text)) score += 5;
  if (/error|fail|abort|blocked|stalled|correction/.test(text)) score += 6;
  if (/file|edit|write|commit|task|run|schedule/.test(text)) score += 3;
  return score;
}

export function buildBrainThoughtActivityIndex(activityPackage: ActivityPackage, maxChars = MAX_ACTIVITY_INDEX_CHARS): string {
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of activityPackage.eventLedger.inline || []) {
    const key = eventGroupKey(event);
    const list = groups.get(key) || [];
    list.push(event);
    groups.set(key, list);
  }
  const ranked = [...groups.entries()].map(([key, events]) => ({
    key,
    events: [...events].sort((a, b) => a.timestampMs - b.timestampMs),
    score: events.reduce((sum, event) => sum + eventSignalScore(event), 0),
  })).sort((a, b) => b.score - a.score || b.events.length - a.events.length || a.key.localeCompare(b.key));

  const lines: string[] = [
    'DIRECT ACTIVITY INDEX (canonical runtime stores; compact initial view)',
    `packageId: ${activityPackage.packageId}`,
    `window: ${activityPackage.window.start} -> ${activityPackage.window.end} ${activityPackage.window.boundary}`,
    `completeness: ${activityPackage.completeness.status}`,
    `events: ${activityPackage.eventLedger.totalEvents} total; ${activityPackage.eventLedger.inline.length} inline; ${activityPackage.eventLedger.omittedFromInline} continuation-only`,
    `counts: ${JSON.stringify(activityPackage.counts || {})}`,
  ];
  if (activityPackage.completeness.omissions?.length) {
    lines.push(`omissions: ${activityPackage.completeness.omissions.map((v) => cleanText(v, 220)).join(' | ')}`);
  }
  lines.push('source coverage:');
  for (const source of activityPackage.sourceCoverage || []) {
    lines.push(`- ${source.source}: ${source.status}; events=${source.eventsIncluded}; scanned=${source.recordsScanned}${source.limitations?.length ? `; limits=${source.limitations.map((v) => cleanText(v, 140)).join(' | ')}` : ''}`);
  }
  if (activityPackage.unresolvedWork?.length) {
    lines.push('unresolved work:');
    for (const item of activityPackage.unresolvedWork.slice(0, 40)) {
      lines.push(`- ${item.id} [${item.kind}/${item.status}] ${cleanText(item.summary, 360)}`);
    }
  }
  lines.push('activity groups:');
  for (const group of ranked) {
    const first = group.events[0];
    const last = group.events[group.events.length - 1];
    lines.push(`- ${group.key}: ${group.events.length} event(s), ${first?.timestamp || '?'} -> ${last?.timestamp || '?'}`);
    const representative = [...group.events]
      .sort((a, b) => eventSignalScore(b) - eventSignalScore(a) || b.timestampMs - a.timestampMs)
      .slice(0, 3)
      .sort((a, b) => a.timestampMs - b.timestampMs);
    for (const event of representative) lines.push(`  - ${event.id} ${event.timestamp} ${cleanText(event.summary, 420)}`);
    if (lines.join('\n').length >= maxChars) break;
  }
  if (activityPackage.eventLedger.continuations?.length) {
    lines.push('exact continuation evidence (use brain_activity_read only when needed):');
    for (const continuation of activityPackage.eventLedger.continuations) {
      lines.push(`- ${continuation.path} (${continuation.eventCount} events; sha256=${continuation.sha256.slice(0, 12)}...)`);
    }
  }
  lines.push('Use brain_activity_read to drill into exact events. Do not reconstruct this window by searching audit mirrors.');
  const rendered = lines.join('\n');
  return rendered.length <= maxChars ? rendered : `${rendered.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n...[activity index truncated; use brain_activity_read for exact evidence]`;
}

export function registerBrainThoughtRun(input: BrainThoughtRunRegistration): void {
  runs.set(input.sessionId, { ...input, submitted: false });
}

export function clearBrainThoughtRun(sessionId: string): void {
  runs.delete(String(sessionId || '').trim());
}

export function isBrainThoughtRunActive(sessionId: string): boolean {
  return runs.has(String(sessionId || '').trim());
}

export function searchBrainThoughtContext(sessionId: string, args: any): string {
  const run = requireRun(sessionId);
  const query = String(args?.query || '').trim();
  if (!query) throw new Error('brain_context_search requires query.');
  const requested = Array.isArray(args?.sources) ? args.sources.map((v: unknown) => String(v)) : ['user','memory','notes'];
  const sources = requested.filter((v: string): v is BrainThoughtContextSource => ['user','memory','notes','soul'].includes(v));
  const uniqueSources = Array.from(new Set(sources.length ? sources : ['user','memory','notes'])) as BrainThoughtContextSource[];
  const limit = Math.max(1, Math.min(12, Number(args?.limit || 8)));
  const terms = queryTerms(query);
  const matches: Array<{ source: BrainThoughtContextSource; startLine: number; endLine: number; text: string; score: number }> = [];

  for (const source of uniqueSources) {
    if (source === 'memory') {
      const memory = retrieveMemoryAtoms(run.workspacePath, query, { maxAtoms: limit, maxChars: 9_000 });
      for (const hit of memory.selected) {
        matches.push({
          source,
          startLine: hit.atom.sourceStartLine,
          endLine: hit.atom.sourceEndLine,
          score: Math.max(1, Math.round(hit.score * 100)),
          text: `atom=${hit.atom.id} | kind=${hit.atom.kind} | section=${hit.atom.sourceSection} | relation=${hit.relation}${hit.relationReason ? `:${hit.relationReason}` : ''}\n${hit.atom.rawText}`,
        });
      }
      continue;
    }
    const file = sourceFile(run, source);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    for (const chunk of chunkText(raw, source)) {
      const score = scoreChunk(chunk.text, terms);
      if (score > 0) matches.push({ ...chunk, score });
    }
  }

  const selected = matches
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.startLine - b.startLine)
    .slice(0, limit);
  if (!selected.length) return `No matching durable context found for: ${query}`;
  const blocks: string[] = [`Durable context matches for: ${query}`];
  for (const item of selected) {
    blocks.push(`\n[${item.source}:${item.startLine}-${item.endLine} score=${item.score}]\n${item.text}`);
    if (blocks.join('\n').length >= MAX_CONTEXT_RESULT_CHARS) break;
  }
  const rendered = blocks.join('\n');
  return rendered.length <= MAX_CONTEXT_RESULT_CHARS ? rendered : `${rendered.slice(0, MAX_CONTEXT_RESULT_CHARS)}\n...[context results truncated]`;
}

function loadContinuation(run: BrainThoughtRunState, continuationPath: string): ActivityEvent[] {
  const allowed = (run.activityPackage.eventLedger.continuations || []).find((entry) => entry.path === continuationPath);
  if (!allowed) throw new Error('Requested continuation is not part of this Thought Activity Package.');
  const full = safeWorkspacePath(run.workspacePath, continuationPath);
  if (!fs.existsSync(full)) throw new Error(`Continuation is unavailable: ${continuationPath}`);
  const events: ActivityEvent[] = [];
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object') events.push(parsed as ActivityEvent);
  }
  return events;
}

export function readBrainThoughtActivity(sessionId: string, args: any): string {
  const run = requireRun(sessionId);
  let events = [...(run.activityPackage.eventLedger.inline || [])];
  const continuationPath = String(args?.continuation_path || '').trim();
  if (continuationPath) events = loadContinuation(run, continuationPath);
  const ids = new Set((Array.isArray(args?.event_ids) ? args.event_ids : []).map((v: unknown) => String(v)));
  const terms = queryTerms(args?.query);
  if (ids.size) events = events.filter((event) => ids.has(event.id));
  if (terms.length) events = events.filter((event) => {
    const text = `${event.type} ${event.summary} ${JSON.stringify(event.entity || {})} ${JSON.stringify(event.details || {})}`.toLowerCase();
    return terms.some((term) => text.includes(term));
  });
  const limit = Math.max(1, Math.min(80, Number(args?.limit || 30)));
  const selected = events.sort((a, b) => a.timestampMs - b.timestampMs).slice(0, limit);
  const returned: ActivityEvent[] = [];
  let truncated = selected.length < events.length;
  for (const event of selected) {
    const candidate = [...returned, event];
    const preview = JSON.stringify({ packageId: run.activityPackage.packageId, matchedTotal: events.length, events: candidate });
    if (preview.length > MAX_ACTIVITY_RESULT_CHARS) { truncated = true; break; }
    returned.push(event);
  }
  const payload = {
    packageId: run.activityPackage.packageId,
    completeness: run.activityPackage.completeness,
    sourceCoverage: args?.include_coverage === true ? run.activityPackage.sourceCoverage : undefined,
    unresolvedWork: args?.include_unresolved === true ? run.activityPackage.unresolvedWork : undefined,
    matchedTotal: events.length,
    returned: returned.length,
    truncated,
    events: returned,
  };
  const rendered = JSON.stringify(payload, null, 2);
  if (rendered.length <= MAX_ACTIVITY_RESULT_CHARS) return rendered;
  // Coverage/unresolved metadata can itself be large. Preserve valid JSON and the exact events first.
  return JSON.stringify({ packageId: run.activityPackage.packageId, matchedTotal: events.length, returned: returned.length, truncated: true, events: returned }, null, 2);
}

const CAPSULE_KIND = new Set(['active_work','decision','correction','blocker','time_sensitive','opportunity']);
const CAPSULE_PRIORITY = new Set(['critical','high','normal','low']);
const CAPSULE_STATUS = new Set(['active','in_progress','blocked','dormant','resolved']);
const CAPSULE_SURFACE = new Set(['main_chat','coding','business','other']);

function validatePulseCards(cards: any[]): void {
  if (!Array.isArray(cards) || cards.length !== 3) throw new Error('brain_thought_submit requires exactly 3 pulse_cards.');
  for (const [index, card] of cards.entries()) {
    if (!card || typeof card !== 'object') throw new Error(`pulse_cards[${index}] must be an object.`);
    const keys = Object.keys(card).sort();
    if (keys.join(',') !== 'body,prompt,title') throw new Error(`pulse_cards[${index}] may contain only title, body, and prompt.`);
    const title = String(card.title || '').trim();
    const body = String(card.body || '').trim();
    const prompt = String(card.prompt || '').trim();
    if (!title || title.length > 52) throw new Error(`pulse_cards[${index}].title must be 1-52 characters.`);
    if (!body || body.length > 90) throw new Error(`pulse_cards[${index}].body must be 1-90 characters.`);
    if (!prompt) throw new Error(`pulse_cards[${index}].prompt is required.`);
  }
}

function validateCapsules(capsules: any[]): void {
  if (!Array.isArray(capsules)) throw new Error('capsules must be an array.');
  for (const [index, item] of capsules.entries()) {
    if (!item || typeof item !== 'object') throw new Error(`capsules[${index}] must be an object.`);
    for (const field of ['id','threadKey','createdAt','expiresAt','summary','nextUsefulAction','lastValidatedAt']) {
      if (!String(item[field] || '').trim()) throw new Error(`capsules[${index}].${field} is required.`);
    }
    if (!CAPSULE_KIND.has(String(item.kind))) throw new Error(`capsules[${index}].kind is invalid.`);
    if (!CAPSULE_PRIORITY.has(String(item.priority))) throw new Error(`capsules[${index}].priority is invalid.`);
    if (!CAPSULE_STATUS.has(String(item.status))) throw new Error(`capsules[${index}].status is invalid.`);
    if (!Array.isArray(item.facts) || !Array.isArray(item.evidence) || !Array.isArray(item.supersedes)) throw new Error(`capsules[${index}] facts/evidence/supersedes must be arrays.`);
    if (!item.relevance || typeof item.relevance !== 'object') throw new Error(`capsules[${index}].relevance is required.`);
    for (const key of ['projects','triggers','surfaces']) if (!Array.isArray(item.relevance[key])) throw new Error(`capsules[${index}].relevance.${key} must be an array.`);
    if (item.relevance.surfaces.some((surface: unknown) => !CAPSULE_SURFACE.has(String(surface)))) throw new Error(`capsules[${index}].relevance.surfaces contains an invalid value.`);
    if (typeof item.verificationRequired !== 'boolean') throw new Error(`capsules[${index}].verificationRequired must be boolean.`);
    if (!Number.isFinite(Date.parse(String(item.createdAt))) || !Number.isFinite(Date.parse(String(item.expiresAt))) || !Number.isFinite(Date.parse(String(item.lastValidatedAt)))) throw new Error(`capsules[${index}] contains an invalid timestamp.`);
  }
}


const ACTIVE_WORK_STATUS = new Set(['idea','drafted','in_progress','stalled','resolved']);

function validateActiveWork(items: any[]): void {
  if (!Array.isArray(items)) throw new Error('active_work must be an array.');
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object') throw new Error(`active_work[${index}] must be an object.`);
    if (!String(item.id || '').trim() || !String(item.title || '').trim()) throw new Error(`active_work[${index}] requires id and title.`);
    if (!ACTIVE_WORK_STATUS.has(String(item.status || ''))) throw new Error(`active_work[${index}].status is invalid.`);
    if (!String(item.currentState || '').trim()) throw new Error(`active_work[${index}].currentState is required.`);
    if (!Array.isArray(item.evidence) || !item.evidence.every((v: unknown) => typeof v === 'string')) throw new Error(`active_work[${index}].evidence must be a string array.`);
    if (item.research !== undefined && (!Array.isArray(item.research) || !item.research.every((v: unknown) => typeof v === 'string'))) throw new Error(`active_work[${index}].research must be a string array when provided.`);
    if (item.lastVerified && !Number.isFinite(Date.parse(String(item.lastVerified)))) throw new Error(`active_work[${index}].lastVerified must be a valid date/timestamp when provided.`);
  }
}
function markdownRows(items: any[], fields: string[]): string[] {
  if (!items?.length) return ['| - |' + fields.slice(1).map(() => ' - |').join('')];
  return items.map((item) => `| ${fields.map((field) => cleanText(item?.[field] ?? '-', 360).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
}

function upsertJsonl(filePath: string, items: any[], keyField = 'id'): void {
  if (!items.length) return;
  const existing: any[] = [];
  if (fs.existsSync(filePath)) {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { existing.push(JSON.parse(line)); } catch {}
    }
  }
  const byKey = new Map(existing.map((item) => [String(item?.[keyField] || ''), item]));
  for (const item of items) {
    const key = String(item?.[keyField] || '').trim();
    if (!key) throw new Error(`active_work item is missing ${keyField}.`);
    byKey.set(key, item);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${[...byKey.values()].map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
}

export function submitBrainThought(sessionId: string, args: any): string {
  const run = requireRun(sessionId);
  if (run.submitted) throw new Error('brain_thought_submit may be called only once per Thought run.');
  const pulseCards = Array.isArray(args?.pulse_cards) ? args.pulse_cards : [];
  const capsules = Array.isArray(args?.capsules) ? args.capsules : [];
  validatePulseCards(pulseCards);
  validateCapsules(capsules);
  const summary = String(args?.summary || '').trim();
  if (!summary) throw new Error('brain_thought_submit requires summary.');
  const verdict = args?.verdict && typeof args.verdict === 'object' ? args.verdict : {};
  const activity = Array.isArray(args?.activity_summary) ? args.activity_summary : [];
  const behavior = args?.behavior_quality && typeof args.behavior_quality === 'object' ? args.behavior_quality : {};
  const skillSignals = Array.isArray(args?.skill_workflow_signals) ? args.skill_workflow_signals : [];
  const skillMaintenance = Array.isArray(args?.skill_maintenance) ? args.skill_maintenance : [];
  const business = Array.isArray(args?.business_candidates) ? args.business_candidates : [];
  const memory = Array.isArray(args?.memory_candidates) ? args.memory_candidates : [];
  const opportunities = Array.isArray(args?.opportunity_seeds) ? args.opportunity_seeds : [];
  const improvements = Array.isArray(args?.improvement_candidates) ? args.improvement_candidates : [];
  const activeWork = Array.isArray(args?.active_work) ? args.active_work : [];
  validateActiveWork(activeWork);
  const now = new Date().toISOString();
  const normalizedBusiness = business.map((item: any, index: number) => {
    const summary = String(item?.summary || '').trim();
    if (!summary) throw new Error(`business_candidates[${index}].summary is required.`);
    if (item?.evidence !== undefined && (!Array.isArray(item.evidence) || !item.evidence.every((v: unknown) => typeof v === 'string'))) throw new Error(`business_candidates[${index}].evidence must be a string array.`);
    return normalizeBusinessCandidate({ ...item, summary, source: `thought:${run.thoughtFile}` }, run.dateStr);
  });

  const lines = [
    `# Thought ${run.thoughtNumber} - ${run.dateStr} | Window: ${run.windowStart}-${run.windowEnd}`,
    `_Generated: ${now}_`, '',
    '## Summary', summary, '',
    '## Pulse Cards', '```json', JSON.stringify(pulseCards, null, 2), '```', '',
    '## Runtime Thought Capsules', `Structured sidecar: ${run.capsuleFile}`, `Capsules captured: ${capsules.length}`, '',
    '## A. Activity Summary', ...(activity.length ? activity.map((item: unknown) => `- ${cleanText(item, 700)}`) : ['- No material activity beyond the package evidence.']), '',
    '## B. Behavior Quality',
    '**Went well:**', ...((behavior.went_well || []).map?.((item: unknown) => `- ${cleanText(item, 700)}`) || ['- none observed']), '',
    '**Stalled or struggled:**', ...((behavior.stalled || []).map?.((item: unknown) => `- ${cleanText(item, 700)}`) || ['- none observed']), '',
    '**Tool usage patterns:**', ...((behavior.tool_usage || []).map?.((item: unknown) => `- ${cleanText(item, 700)}`) || ['- none observed']), '',
    '**User corrections:**', ...((behavior.user_corrections || []).map?.((item: unknown) => `- ${cleanText(item, 700)}`) || ['- none observed']), '',
    '## C. Skill And Workflow Signals',
    '| Skill/Workflow | Signal | Possible Action | Confidence | Evidence |',
    '|---|---|---|---|---|', ...markdownRows(skillSignals, ['skill','signal','action','confidence','evidence']), '',
    '## C2. Existing Skill Maintenance',
    '**Submitted for Curator review:**', ...(skillMaintenance.length ? skillMaintenance.map((item: any) => `- ${cleanText(item?.skill || item?.id || 'candidate', 120)} | ${cleanText(item?.action || item?.decision || 'submitted/deferred', 260)} | evidence: ${cleanText(item?.evidence || '-', 320)}`) : ['- none']), '',
    '## D. Business Candidates',
    '| Candidate | Destination | Action | Confidence | Evidence |',
    '|---|---|---|---|---|', ...markdownRows(normalizedBusiness, ['summary','entityType','action','confidence','evidence']), '',
    `**Business candidate JSONL:** ${normalizedBusiness.length ? run.businessCandidatesFile : 'not needed'}`, '',
    '## E. Memory Candidates',
    '| Item | Target | Recall Trigger | Future Behavior | Staleness Risk | Confidence | Evidence |',
    '|---|---|---|---|---|---|---|', ...markdownRows(memory, ['item','target','recall_trigger','future_behavior','staleness_risk','confidence','evidence']), '',
    '## F. Opportunity Seeds',
    '| Seed | Why It Matters | Suggested Scouting Surface | Confidence | Evidence |',
    '|---|---|---|---|---|', ...markdownRows(opportunities, ['seed','why','surface','confidence','evidence']), '',
    '## G. Improvement Candidates',
    '| Issue | Proposal Type | Suggested Execution Mode | Confidence | Evidence |',
    '|---|---|---|---|---|', ...markdownRows(improvements, ['issue','proposal_type','execution_mode','confidence','evidence']), '',
    '## H. Window Verdict',
    `**Active:** ${verdict.active === true ? 'yes' : 'no'}`,
    `**Signal quality:** ${cleanText(verdict.signal_quality || 'none', 20)}`,
    `**Summary:** ${cleanText(verdict.summary || summary, 900)}`,
    ...(Array.isArray(verdict.wonderings) ? verdict.wonderings.slice(0, 3).map((item: unknown) => `- I wonder if ${cleanText(item, 500).replace(/^I wonder if\s*/i, '')}`) : []),
    '',
  ];

  const thoughtPath = safeWorkspacePath(run.workspacePath, run.thoughtFile);
  const capsulePath = safeWorkspacePath(run.workspacePath, run.capsuleFile);
  fs.mkdirSync(path.dirname(thoughtPath), { recursive: true });
  fs.mkdirSync(path.dirname(capsulePath), { recursive: true });
  fs.writeFileSync(thoughtPath, lines.join('\n'), 'utf8');
  fs.writeFileSync(capsulePath, `${JSON.stringify(capsules, null, 2)}\n`, 'utf8');

  if (normalizedBusiness.length) {
    const existingIds = new Set(readBusinessCandidates(run.workspacePath, run.dateStr).map((item: any) => item.id));
    appendBusinessCandidates(run.workspacePath, run.dateStr, normalizedBusiness.filter((item: any) => !existingIds.has(item.id)));
  }
  if (activeWork.length) upsertJsonl(safeWorkspacePath(run.workspacePath, run.activeWorkFile), activeWork);
  run.submitted = true;
  return `Thought submission accepted. Wrote ${run.thoughtFile} and ${run.capsuleFile}; ${capsules.length} capsule(s), ${normalizedBusiness.length} business candidate(s), ${activeWork.length} active-work update(s).`;
}

export function executeBrainThoughtTool(sessionId: string, name: string, args: any): string {
  if (name === 'brain_context_search') return searchBrainThoughtContext(sessionId, args);
  if (name === 'brain_activity_read') return readBrainThoughtActivity(sessionId, args);
  if (name === 'brain_thought_submit') return submitBrainThought(sessionId, args);
  throw new Error(`Unknown Brain Thought tool: ${name}`);
}

export function isBrainThoughtTool(name: string): boolean {
  return name === 'brain_context_search' || name === 'brain_activity_read' || name === 'brain_thought_submit';
}

export function getBrainThoughtToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'brain_context_search',
        description: 'Retrieve only context relevant to the current Thought from USER.md, MEMORY.md, today notes, or (when explicitly useful for behavior comparison) SOUL.md. Main user/personality files are not auto-injected into Thought.',
        parameters: { type: 'object', required: ['query'], properties: {
          query: { type: 'string', description: 'What durable context you need.' },
          sources: { type: 'array', items: { type: 'string', enum: ['user','memory','notes','soul'] }, description: 'Defaults to user, memory, notes. Request soul only when comparing intended Prometheus behavior.' },
          limit: { type: 'number', minimum: 1, maximum: 12 },
        } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'brain_activity_read',
        description: 'Drill into exact canonical evidence for this Thought window. Search the run-scoped Activity Package, request exact event IDs, or read one package-listed continuation. Never use audit-directory search to reconstruct covered activity.',
        parameters: { type: 'object', properties: {
          query: { type: 'string' },
          event_ids: { type: 'array', items: { type: 'string' } },
          continuation_path: { type: 'string', description: 'Must exactly match a continuation path listed in this run activity index.' },
          limit: { type: 'number', minimum: 1, maximum: 80 },
          include_coverage: { type: 'boolean' },
          include_unresolved: { type: 'boolean' },
        } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'brain_thought_submit',
        description: 'Submit the final structured Thought exactly once. The runtime validates the payload and writes the Thought markdown, capsule sidecar, business candidates, and Active Work updates. Do not use generic write tools for Thought artifacts.',
        parameters: { type: 'object', required: ['summary','pulse_cards','capsules','activity_summary','behavior_quality','verdict'], properties: {
          summary: { type: 'string' },
          pulse_cards: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['title','body','prompt'], properties: { title: { type: 'string', maxLength: 52 }, body: { type: 'string', maxLength: 90 }, prompt: { type: 'string' } } } },
          capsules: { type: 'array', items: { type: 'object' } },
          activity_summary: { type: 'array', items: { type: 'string' } },
          behavior_quality: { type: 'object', properties: { went_well: { type: 'array', items: { type: 'string' } }, stalled: { type: 'array', items: { type: 'string' } }, tool_usage: { type: 'array', items: { type: 'string' } }, user_corrections: { type: 'array', items: { type: 'string' } } } },
          skill_workflow_signals: { type: 'array', items: { type: 'object' } },
          skill_maintenance: { type: 'array', items: { type: 'object' } },
          business_candidates: { type: 'array', items: { type: 'object' } },
          memory_candidates: { type: 'array', items: { type: 'object' } },
          opportunity_seeds: { type: 'array', items: { type: 'object' } },
          improvement_candidates: { type: 'array', items: { type: 'object' } },
          active_work: { type: 'array', items: { type: 'object' } },
          verdict: { type: 'object', required: ['active','signal_quality','summary'], properties: { active: { type: 'boolean' }, signal_quality: { type: 'string', enum: ['high','medium','low','none'] }, summary: { type: 'string' }, wonderings: { type: 'array', maxItems: 3, items: { type: 'string' } } } },
        } },
      },
    },
  ];
}
