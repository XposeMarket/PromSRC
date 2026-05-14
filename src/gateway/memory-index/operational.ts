// src/gateway/memory-index/operational.ts
// Operational memory layer: canonical records extracted from audit evidence.
// Implements Phase 1–3 of the Prometheus Memory System Plan (2026-04-10).
//
// Architecture:
//   Evidence layer  → audit/_index/memory/store.json  (unchanged)
//   Operational layer → audit/_index/memory/operational/ (this module)
//
// Record types extracted:
//   - proposal        (from proposals/state/)
//   - task_outcome    (from tasks/state/)
//   - preference      (from memory/root/*.md + chat compactions)
//   - decision        (from memory/root/*.md + chat compactions)
//   - workflow_rule   (from memory/root/*.md)
//   - conversation_summary (from chats/compactions/*.md)

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OperationalRecordType =
  | 'decision'
  | 'preference'
  | 'project_fact'
  | 'task_outcome'
  | 'proposal'
  | 'workflow_rule'
  | 'entity_fact'
  | 'conversation_summary';

export interface OperationalRecord {
  id: string;
  canonicalKey: string;
  recordType: OperationalRecordType;

  title: string;
  summary: string;
  body: string;

  createdAt: string;
  updatedAt: string;
  day: string;

  sourceRefs: Array<{ sourceType: string; sourcePath: string; confidence: number; sourceSection?: string; sourceStartLine?: number; sourceEndLine?: number }>;

  entities: {
    people: string[];
    projects: string[];
    features: string[];
    files: string[];
    tools: string[];
    aliases: string[];
  };

  projectId: string | null;
  proposalId?: string;
  taskId?: string;
  sessionIds: string[];

  status?: string;
  outcome?: string;
  owner?: string;
  subject?: string;

  confidence: number;
  durability: number;

  supersedes: string[];
  supersededBy: string[];
  relatedIds: string[];

  exactTerms: string[];
  tags: string[];
}

interface OperationalStore {
  version: number;
  updatedAt: string;
  records: Record<string, OperationalRecord>;
}

interface OperationalManifest {
  version: number;
  updatedAt: string;
  lastRunAtMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & shared utilities (self-contained — no dep on index.ts internals)
// ─────────────────────────────────────────────────────────────────────────────

const OP_VERSION = 1;
const EMBEDDING_DIM = 96;
const STOP = new Set([
  'a','an','and','are','as','at','be','by','for','from','had','has','have',
  'i','if','in','is','it','its','of','on','or','that','the','their','them',
  'they','this','to','was','we','were','what','when','where','who','why',
  'will','with','you','your',
]);

const KNOWN_PEOPLE = new Set(['raul', 'prometheus', 'codex', 'user']);
const KNOWN_TOOLS = new Set([
  'browser_open', 'browser_snapshot', 'browser_click', 'browser_type',
  'browser_run_js', 'browser_intercept_network', 'browser_element_watch',
  'memory_search', 'memory_write', 'memory_read_record',
  'edit_composite', 'declare_plan', 'write_file', 'read_file',
  'list_files', 'grep_file', 'search_files', 'find_replace_source',
  'post_to_team_chat', 'dispatch_team_agent', 'get_agent_result',
  'manage_team_goal', 'message_main_agent', 'reply_to_team',
  'write_proposal', 'read_source', 'list_source',
]);

function ensureDir(d: string): void { fs.mkdirSync(d, { recursive: true }); }
function readJson<T>(p: string, fallback: T): T {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) as T : fallback; } catch { return fallback; }
}
function writeJson(p: string, data: unknown): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}
function stem(t: string): string {
  let x = t.toLowerCase();
  if (x.endsWith('ing') && x.length > 5) x = x.slice(0, -3);
  else if (x.endsWith('ed') && x.length > 4) x = x.slice(0, -2);
  else if (x.endsWith('s') && x.length > 3) x = x.slice(0, -1);
  return x;
}
function terms(s: string): string[] {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .map(v => stem(v.trim())).filter(v => v.length > 2 && !STOP.has(v));
}
function uniqTop(arr: string[], n: number): string[] {
  const m = new Map<string, number>();
  for (const a of arr) m.set(a, (m.get(a) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
function hashToDim(token: string): number {
  const h = crypto.createHash('md5').update(token).digest();
  return ((h[0] << 8) + h[1]) % EMBEDDING_DIM;
}
function embedTerms(ts: string[]): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const t of ts) { const dim = hashToDim(t); const sign = (t.charCodeAt(0) % 2 === 0) ? 1 : -1; v[dim] += sign; }
  let normSq = 0; for (const x of v) normSq += x * x;
  const n = Math.sqrt(normSq) || 1;
  return v.map(x => Number((x / n).toFixed(6)));
}
function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0; let an = 0; let bn = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; an += a[i] * a[i]; bn += b[i] * b[i]; }
  const den = Math.sqrt(an) * Math.sqrt(bn);
  return den ? dot / den : 0;
}
function dayStr(tsMs: number): string { try { return new Date(tsMs).toISOString().slice(0, 10); } catch { return ''; } }
function lineAtOffset(text: string, offset: number): number {
  const capped = Math.max(0, Math.min(String(text || '').length, offset));
  return String(text || '').slice(0, capped).split('\n').length;
}
function opId(canonicalKey: string): string {
  return `opr_${crypto.createHash('sha1').update(canonicalKey).digest('hex').slice(0, 16)}`;
}
function slugify(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}
function shortHash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractEntities(text: string, parsedObj?: any): OperationalRecord['entities'] {
  const lower = text.toLowerCase();
  const people: string[] = [];
  const projects: string[] = [];
  const files: string[] = [];
  const tools: string[] = [];
  const features: string[] = [];
  const aliases: string[] = [];

  for (const p of KNOWN_PEOPLE) { if (lower.includes(p)) people.push(p); }

  const teamMatches = text.matchAll(/\bteam_([a-z0-9]{4,})/g);
  for (const m of teamMatches) {
    const s = `team_${m[1]}`;
    if (!projects.includes(s)) projects.push(s);
  }

  const fileMatches = text.matchAll(/`([a-zA-Z0-9_./-]+\.(ts|js|json|md|txt|py|sh|html|css))`/g);
  for (const m of fileMatches) { if (!files.includes(m[1])) files.push(m[1]); }

  for (const t of KNOWN_TOOLS) { if (lower.includes(t)) tools.push(t); }

  if (parsedObj) {
    const projId = String(parsedObj.projectId || parsedObj.project_id || '').trim();
    if (projId && !projects.includes(projId)) projects.push(projId);
    if (Array.isArray(parsedObj.affectedFiles)) {
      for (const af of parsedObj.affectedFiles) {
        const p = String(af?.path || '');
        if (p && !files.includes(p)) files.push(p);
      }
    }
  }

  return {
    people: [...new Set(people)],
    projects: [...new Set(projects)],
    features: [...new Set(features)],
    files: [...new Set(files)],
    tools: [...new Set(tools)],
    aliases: [...new Set(aliases)],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ID pattern helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractProposalIds(text: string): string[] {
  return [...new Set([...text.matchAll(/\bprop_\d+_[a-f0-9]{6,}\b/g)].map(m => m[0]))];
}

function extractTaskIds(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)].map(m => m[0].toLowerCase()))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Store paths
// ─────────────────────────────────────────────────────────────────────────────

function opPaths(workspacePath: string) {
  const root = path.join(workspacePath, 'audit', '_index', 'memory', 'operational');
  return {
    root,
    store: path.join(root, 'records.json'),
    tokenIndex: path.join(root, 'token-index.json'),
    exactLookup: path.join(root, 'exact-lookup.json'),
    embeddings: path.join(root, 'embeddings.json'),
    manifest: path.join(root, 'manifest.json'),
  };
}

type OperationalRefreshOptions = {
  force?: boolean;
  minIntervalMs?: number;
};

type OperationalRefreshState = {
  running: boolean;
  queued: boolean;
  options: OperationalRefreshOptions;
};

const operationalRefreshStates = new Map<string, OperationalRefreshState>();

function mergeOperationalRefreshOptions(
  current: OperationalRefreshOptions,
  next?: OperationalRefreshOptions,
): OperationalRefreshOptions {
  const merged: OperationalRefreshOptions = {
    force: Boolean(current.force || next?.force),
  };
  const currentMin = Number.isFinite(Number(current.minIntervalMs)) ? Number(current.minIntervalMs) : null;
  const nextMin = Number.isFinite(Number(next?.minIntervalMs)) ? Number(next?.minIntervalMs) : null;
  if (currentMin !== null && nextMin !== null) merged.minIntervalMs = Math.min(currentMin, nextMin);
  else if (currentMin !== null) merged.minIntervalMs = currentMin;
  else if (nextMin !== null) merged.minIntervalMs = nextMin;
  return merged;
}

export function scheduleOperationalIndexRefresh(
  workspacePath: string,
  opts?: OperationalRefreshOptions,
): void {
  const state = operationalRefreshStates.get(workspacePath) || {
    running: false,
    queued: false,
    options: {},
  };
  state.options = mergeOperationalRefreshOptions(state.options, opts);
  state.queued = true;
  operationalRefreshStates.set(workspacePath, state);
  if (state.running) return;

  state.running = true;
  setImmediate(() => {
    const active = operationalRefreshStates.get(workspacePath);
    if (!active) return;
    const runOpts = active.options;
    active.queued = false;
    active.options = {};
    try {
      refreshOperationalIndex(workspacePath, runOpts);
    } catch {
      // Best effort only; callers read the latest on-disk snapshot.
    } finally {
      const nextState = operationalRefreshStates.get(workspacePath);
      if (!nextState) return;
      nextState.running = false;
      operationalRefreshStates.set(workspacePath, nextState);
      if (nextState.queued) scheduleOperationalIndexRefresh(workspacePath, nextState.options);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Source parsers
// ─────────────────────────────────────────────────────────────────────────────

function parseProposalFiles(auditRoot: string): OperationalRecord[] {
  const out: OperationalRecord[] = [];
  const stateRoot = path.join(auditRoot, 'proposals', 'state');
  const statusDirs = ['approved', 'denied', 'pending', 'archive'];

  for (const statusDir of statusDirs) {
    const dir = path.join(stateRoot, statusDir);
    if (!fs.existsSync(dir)) continue;
    let files: string[];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }

    for (const fname of files) {
      const abs = path.join(dir, fname);
      let raw = ''; try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
      let parsed: any; try { parsed = JSON.parse(raw); } catch { continue; }

      const proposalId = String(parsed?.id || path.basename(fname, '.json'));
      const status = String(parsed?.status || statusDir);
      const title = String(parsed?.title || proposalId);
      const summary = String(parsed?.summary || '').trim();
      const details = String(parsed?.details || '').trim();
      const createdAt = parsed?.createdAt
        ? new Date(Number(parsed.createdAt)).toISOString()
        : new Date().toISOString();
      const updatedAt = parsed?.updatedAt
        ? new Date(Number(parsed.updatedAt)).toISOString()
        : createdAt;
      const sourcePath = `proposals/state/${statusDir}/${fname}`;

      const bodyParts = [`Proposal ${proposalId} — ${status}.`, `Title: ${title}.`];
      if (summary) bodyParts.push(`Summary: ${summary}`);
      if (parsed?.decidedAt) {
        bodyParts.push(`Decided: ${new Date(Number(parsed.decidedAt)).toISOString().slice(0, 10)}.`);
      }
      const body = bodyParts.join(' ').slice(0, 700);

      const canonicalKey = `proposal:${proposalId}`;
      const entities = extractEntities(title + ' ' + summary + ' ' + details, parsed);

      out.push({
        id: opId(canonicalKey),
        canonicalKey,
        recordType: 'proposal',
        title,
        summary: summary || title,
        body,
        createdAt,
        updatedAt,
        day: dayStr(parsed?.createdAt ? Number(parsed.createdAt) : Date.now()),
        sourceRefs: [{ sourceType: 'proposal_state', sourcePath, confidence: 1.0 }],
        entities,
        projectId: String(parsed?.projectId || '').trim() || null,
        proposalId,
        sessionIds: [],
        status,
        confidence: 1.0,
        durability: 0.88,
        supersedes: [],
        supersededBy: [],
        relatedIds: [],
        exactTerms: [
          proposalId,
          ...title.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 8),
        ],
        tags: ['proposal', statusDir, String(parsed?.type || 'unknown')],
      });
    }
  }

  return out;
}

function parseTaskFiles(auditRoot: string): OperationalRecord[] {
  const out: OperationalRecord[] = [];
  const stateDir = path.join(auditRoot, 'tasks', 'state');
  if (!fs.existsSync(stateDir)) return out;

  let files: string[];
  try { files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json')); } catch { return out; }

  for (const fname of files) {
    const abs = path.join(stateDir, fname);
    let raw = ''; try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
    let parsed: any; try { parsed = JSON.parse(raw); } catch { continue; }

    const taskId = String(parsed?.id || path.basename(fname, '.json'));
    const status = String(parsed?.status || 'unknown');
    const title = String(parsed?.title || taskId).slice(0, 120);
    const startedAt = parsed?.startedAt
      ? new Date(Number(parsed.startedAt)).toISOString()
      : new Date().toISOString();
    const sourcePath = `tasks/state/${fname}`;

    let outcome = '';
    if (Array.isArray(parsed?.plan) && parsed.plan.length > 0) {
      const lastStep = parsed.plan[parsed.plan.length - 1];
      if (lastStep?.notes) outcome = String(lastStep.notes).slice(0, 300);
    }
    if (!outcome && Array.isArray(parsed?.journal)) {
      const statusPushes = (parsed.journal as any[])
        .filter((j: any) => j?.type === 'status_push')
        .slice(-2);
      if (statusPushes.length) {
        outcome = String(statusPushes[statusPushes.length - 1]?.content || '').slice(0, 300);
      }
    }

    const prompt = String(parsed?.prompt || '').slice(0, 200);
    const bodyParts = [`Task ${taskId} — ${status}.`, `Goal: ${title}.`];
    if (outcome) bodyParts.push(`Outcome: ${outcome}`);
    const body = bodyParts.join(' ').slice(0, 700);

    const canonicalKey = `task_outcome:${taskId}`;
    const entities = extractEntities(title + ' ' + prompt + ' ' + outcome, parsed);
    const sessionIds = parsed?.sessionId ? [String(parsed.sessionId)] : [];

    out.push({
      id: opId(canonicalKey),
      canonicalKey,
      recordType: 'task_outcome',
      title,
      summary: outcome || title,
      body,
      createdAt: startedAt,
      updatedAt: parsed?.lastProgressAt
        ? new Date(Number(parsed.lastProgressAt)).toISOString()
        : startedAt,
      day: dayStr(parsed?.startedAt ? Number(parsed.startedAt) : Date.now()),
      sourceRefs: [{ sourceType: 'task_state', sourcePath, confidence: 1.0 }],
      entities,
      projectId: String(parsed?.projectId || '').trim() || null,
      taskId,
      sessionIds,
      status,
      outcome: outcome.slice(0, 200),
      confidence: 1.0,
      durability: 0.72,
      supersedes: [],
      supersededBy: [],
      relatedIds: [],
      exactTerms: [
        taskId,
        ...title.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 6),
      ],
      tags: ['task', status],
    });
  }

  return out;
}

function parseMemoryRootFiles(auditRoot: string): OperationalRecord[] {
  const out: OperationalRecord[] = [];
  const rootDir = path.join(auditRoot, 'memory', 'root');
  if (!fs.existsSync(rootDir)) return out;

  let files: string[];
  try { files = fs.readdirSync(rootDir).filter(f => f.endsWith('.md')); } catch { return out; }

  for (const fname of files) {
    const abs = path.join(rootDir, fname);
    let raw = ''; try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
    const fileBase = fname.toLowerCase().replace('.md', '');
    const st = fs.statSync(abs);
    const updatedAt = new Date(st.mtimeMs).toISOString();

    // Parse markdown sections: ## Heading\n items
    const sectionRegex = /^#{1,3}\s+(.+)$/gm;
    let sectionMatch: RegExpExecArray | null;
    const sections: Array<{ name: string; start: number; headingStart: number }> = [];
    while ((sectionMatch = sectionRegex.exec(raw)) !== null) {
      sections.push({ name: sectionMatch[1].trim(), start: sectionMatch.index + sectionMatch[0].length, headingStart: sectionMatch.index });
    }

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const end = i + 1 < sections.length ? sections[i + 1].start : raw.length;
      const content = raw.slice(sec.start, end).trim();
      if (!content) continue;

      const items = content
        .split('\n')
        .map(l => l.trim())
        .filter(l => (l.startsWith('-') || l.startsWith('*')) && l.length > 3)
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(l => l.length > 10 && l !== '(empty)');

      if (!items.length) continue;

      const sectionSlug = slugify(sec.name);
      const canonicalKey = `preference:root:${fileBase}:${sectionSlug}`;
      const title = `${fname} — ${sec.name}`;
      const body = items.join('\n').slice(0, 900);
      const entities = extractEntities(body);

      const recType: OperationalRecordType =
        sectionSlug.includes('decision') || sectionSlug.includes('key_decision')
          ? 'decision'
          : sectionSlug.includes('rule') || sectionSlug.includes('constraint') || sectionSlug.includes('workflow')
          ? 'workflow_rule'
          : 'preference';

      out.push({
        id: opId(canonicalKey),
        canonicalKey,
        recordType: recType,
        title,
        summary: items[0].slice(0, 200),
        body,
        createdAt: updatedAt,
        updatedAt,
        day: dayStr(st.mtimeMs),
        sourceRefs: [{
          sourceType: 'memory_root',
          sourcePath: `memory/root/${fname}`,
          confidence: 1.0,
          sourceSection: sec.name,
          sourceStartLine: lineAtOffset(raw, sec.headingStart),
          sourceEndLine: lineAtOffset(raw, end),
        }],
        entities,
        projectId: null,
        sessionIds: [],
        confidence: 0.95,
        durability: 1.0,
        supersedes: [],
        supersededBy: [],
        relatedIds: [],
        exactTerms: [
          ...items.flatMap(item =>
            item.toLowerCase().split(/\s+/).filter(w => w.length > 4)
          ).slice(0, 12),
          sectionSlug,
        ],
        tags: ['memory_root', fileBase, recType],
      });
    }
  }

  return out;
}

function parseChatCompactionFiles(auditRoot: string): OperationalRecord[] {
  const out: OperationalRecord[] = [];
  const compDir = path.join(auditRoot, 'chats', 'compactions');
  if (!fs.existsSync(compDir)) return out;

  let files: string[];
  // Only process .md files; skip .jsonl twins to avoid duplication
  try { files = fs.readdirSync(compDir).filter(f => f.endsWith('.md')); } catch { return out; }

  for (const fname of files) {
    const abs = path.join(compDir, fname);
    let raw = ''; try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
    const st = fs.statSync(abs);
    const sessionId = fname.replace('.md', '');
    const sourcePath = `chats/compactions/${fname}`;

    // Split into compaction blocks; take only the LAST one (most current state)
    const blocks = raw.split(/(?=###\s+\[ROLLING_COMPACTION\])/);
    const lastBlock = blocks[blocks.length - 1] || '';
    if (!lastBlock.trim()) continue;

    const tsMatch = lastBlock.match(/\[ROLLING_COMPACTION\]\s+(\d{4}-\d{2}-\d{2}T[^\n]+)/);
    const blockTs = tsMatch ? (Date.parse(tsMatch[1].trim()) || st.mtimeMs) : st.mtimeMs;

    // Extract "Decisions made:" section
    const decisionsMatch = lastBlock.match(/Decisions made:\s*\n((?:\s*[-*]\s*.+\n?)*)/i);
    if (decisionsMatch) {
      const items = decisionsMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => (l.startsWith('-') || l.startsWith('*')) && l.length > 3)
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(l => l.length > 8);

      for (const item of items.slice(0, 6)) {
        const canonicalKey = `decision:session:${sessionId}:${shortHash(item)}`;
        out.push({
          id: opId(canonicalKey),
          canonicalKey,
          recordType: 'decision',
          title: item.slice(0, 120),
          summary: item.slice(0, 300),
          body: item.slice(0, 600),
          createdAt: new Date(blockTs).toISOString(),
          updatedAt: new Date(blockTs).toISOString(),
          day: dayStr(blockTs),
          sourceRefs: [{ sourceType: 'chat_compaction', sourcePath, confidence: 0.8 }],
          entities: extractEntities(item),
          projectId: null,
          sessionIds: [sessionId],
          confidence: 0.8,
          durability: 0.76,
          supersedes: [], supersededBy: [], relatedIds: [],
          exactTerms: item.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 8),
          tags: ['decision', 'chat_compaction'],
        });
      }
    }

    // Extract "Key constraints/preferences:" section
    const prefMatch = lastBlock.match(/Key constraints(?:\/preferences)?:\s*\n((?:\s*[-*]\s*.+\n?)*)/i);
    if (prefMatch) {
      const items = prefMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => (l.startsWith('-') || l.startsWith('*')) && l.length > 3)
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(l => l.length > 8);

      for (const item of items.slice(0, 6)) {
        const canonicalKey = `preference:session:${sessionId}:${shortHash(item)}`;
        out.push({
          id: opId(canonicalKey),
          canonicalKey,
          recordType: 'preference',
          title: item.slice(0, 120),
          summary: item.slice(0, 300),
          body: item.slice(0, 600),
          createdAt: new Date(blockTs).toISOString(),
          updatedAt: new Date(blockTs).toISOString(),
          day: dayStr(blockTs),
          sourceRefs: [{ sourceType: 'chat_compaction', sourcePath, confidence: 0.8 }],
          entities: extractEntities(item),
          projectId: null,
          sessionIds: [sessionId],
          confidence: 0.8,
          durability: 0.76,
          supersedes: [], supersededBy: [], relatedIds: [],
          exactTerms: item.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 8),
          tags: ['preference', 'chat_compaction'],
        });
      }
    }

    // Whole-session conversation summary record
    const goalMatch = lastBlock.match(/Current goal:\s*([^\n]+)/i);
    if (goalMatch) {
      const goal = goalMatch[1].trim();
      const canonicalKey = `conversation_summary:${sessionId}`;
      const summaryBody = lastBlock.slice(0, 900);

      out.push({
        id: opId(canonicalKey),
        canonicalKey,
        recordType: 'conversation_summary',
        title: `Session ${sessionId.slice(0, 8)} — ${goal.slice(0, 80)}`,
        summary: goal,
        body: summaryBody,
        createdAt: new Date(blockTs).toISOString(),
        updatedAt: new Date(st.mtimeMs).toISOString(),
        day: dayStr(blockTs),
        sourceRefs: [{ sourceType: 'chat_compaction', sourcePath, confidence: 0.9 }],
        entities: extractEntities(summaryBody),
        projectId: null,
        sessionIds: [sessionId],
        confidence: 0.9,
        durability: 0.76,
        supersedes: [], supersededBy: [], relatedIds: [],
        exactTerms: uniqTop(terms(goal), 8),
        tags: ['conversation_summary', 'chat_compaction'],
      });
    }
  }

  return out;
}

function listMarkdownFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(abs);
    }
  }
  return out;
}

function parseObsidianMeta(raw: string): { meta: any; body: string } {
  const match = String(raw || '').match(/^<!--\s*PROMETHEUS_OBSIDIAN_META\s*\n([\s\S]*?)\n-->\s*/);
  if (!match) return { meta: {}, body: String(raw || '').trim() };
  try {
    return { meta: JSON.parse(match[1]), body: String(raw || '').slice(match[0].length).trim() };
  } catch {
    return { meta: {}, body: String(raw || '').slice(match[0].length).trim() };
  }
}

function obsidianRecordType(meta: any): OperationalRecordType | null {
  const tags = Array.isArray(meta?.tags) ? meta.tags.map((tag: any) => String(tag || '').toLowerCase()) : [];
  const explicit = String(meta?.memoryType || meta?.frontmatter?.['prometheus-memory-type'] || '').toLowerCase().trim();
  const marked = Boolean(meta?.obsidianMemory) || tags.some((tag: string) => tag === 'prometheus' || tag.startsWith('prometheus/'));
  if (!marked && !explicit) return null;
  const haystack = [explicit, ...tags].join(' ');
  if (/decision/.test(haystack)) return 'decision';
  if (/preference|pref/.test(haystack)) return 'preference';
  if (/workflow|rule|policy|process/.test(haystack)) return 'workflow_rule';
  if (/entity/.test(haystack)) return 'entity_fact';
  return 'project_fact';
}

function parseObsidianFiles(auditRoot: string): OperationalRecord[] {
  const out: OperationalRecord[] = [];
  const rootDir = path.join(auditRoot, 'obsidian', 'vaults');
  if (!fs.existsSync(rootDir)) return out;

  for (const abs of listMarkdownFilesRecursive(rootDir)) {
    let raw = ''; try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
    const { meta, body } = parseObsidianMeta(raw);
    const recType = obsidianRecordType(meta);
    if (!recType) continue;

    const st = fs.statSync(abs);
    const sourcePath = path.relative(auditRoot, abs).replace(/\\/g, '/');
    const title = String(meta?.title || path.basename(abs, '.md')).trim();
    const relativePath = String(meta?.relativePath || '').trim();
    const vaultId = String(meta?.vaultId || 'vault').trim();
    const vaultName = String(meta?.vaultName || 'Obsidian').trim();
    const projectId = String(meta?.projectId || meta?.frontmatter?.projectId || meta?.frontmatter?.project || '').trim() || null;
    const cleanBody = body
      .replace(/^#\s+.+$/m, '')
      .replace(/^Source:\s+.+$/m, '')
      .replace(/^Tags:\s+.+$/m, '')
      .replace(/^Links:\s+.+$/m, '')
      .replace(/^##\s+Obsidian Note\s*$/m, '')
      .trim();
    const summary = cleanBody.split(/\n{2,}/).map((part) => part.trim()).find(Boolean) || title;
    const canonicalKey = `obsidian:${recType}:${vaultId}:${shortHash(relativePath || sourcePath)}`;
    const tags = Array.isArray(meta?.tags) ? meta.tags.map((tag: any) => String(tag || '').replace(/^#/, '').trim()).filter(Boolean) : [];
    const exactTerms = uniqTop([
      ...terms(title),
      ...terms(relativePath),
      ...tags.flatMap((tag: string) => terms(tag)),
    ], 16);
    const entities = extractEntities(`${title}\n${cleanBody}`, { projectId });
    if (projectId && !entities.projects.includes(projectId)) entities.projects.push(projectId);
    const createdMs = Date.parse(String(meta?.frontmatter?.created || ''));
    const updatedMs = Number(meta?.sourceMtimeMs || st.mtimeMs);

    out.push({
      id: opId(canonicalKey),
      canonicalKey,
      recordType: recType,
      title,
      summary: summary.slice(0, 300),
      body: [`Obsidian vault: ${vaultName}.`, relativePath ? `Path: ${relativePath}.` : '', cleanBody].filter(Boolean).join('\n').slice(0, 1400),
      createdAt: new Date(Number.isFinite(createdMs) ? createdMs : st.mtimeMs).toISOString(),
      updatedAt: new Date(Number.isFinite(updatedMs) ? updatedMs : st.mtimeMs).toISOString(),
      day: dayStr(Number.isFinite(updatedMs) ? updatedMs : st.mtimeMs),
      sourceRefs: [{
        sourceType: 'obsidian_note',
        sourcePath,
        confidence: 0.95,
        sourceSection: title,
        sourceStartLine: 1,
        sourceEndLine: raw.split('\n').length,
      }],
      entities,
      projectId,
      sessionIds: [],
      subject: relativePath || title,
      confidence: 0.92,
      durability: recType === 'decision' || recType === 'workflow_rule' ? 0.9 : 0.78,
      supersedes: [],
      supersededBy: [],
      relatedIds: [],
      exactTerms,
      tags: ['obsidian', recType, ...tags].slice(0, 24),
    });
  }

  return out;
}

function parseProjectFiles(auditRoot: string): OperationalRecord[] {
  const out: OperationalRecord[] = [];
  const stateDir = path.join(auditRoot, 'projects', 'state');
  if (!fs.existsSync(stateDir)) return out;

  let files: string[];
  try { files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json')); } catch { return out; }

  for (const fname of files) {
    const abs = path.join(stateDir, fname);
    let raw = ''; try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
    let parsed: any; try { parsed = JSON.parse(raw); } catch { continue; }

    const projectId = String(parsed?.id || path.basename(fname, '.json'));
    const name = String(parsed?.name || projectId);
    const instructions = String(parsed?.instructions || '').slice(0, 300);
    const memorySnapshot = String(parsed?.memorySnapshot || '').slice(0, 300);
    const sessionCount = Array.isArray(parsed?.sessions) ? parsed.sessions.length : 0;
    const createdAt = parsed?.createdAt
      ? new Date(Number(parsed.createdAt)).toISOString()
      : new Date().toISOString();
    const updatedAt = parsed?.updatedAt
      ? new Date(Number(parsed.updatedAt)).toISOString()
      : createdAt;
    const sourcePath = `projects/state/${fname}`;

    const bodyParts = [`Project: ${name} (${projectId}).`, `Sessions: ${sessionCount}.`];
    if (instructions) bodyParts.push(`Instructions: ${instructions}`);
    if (memorySnapshot) bodyParts.push(`Memory: ${memorySnapshot}`);
    const body = bodyParts.join(' ').slice(0, 700);

    const canonicalKey = `project_fact:${projectId}`;
    const entities = extractEntities(name + ' ' + instructions + ' ' + memorySnapshot, parsed);
    if (!entities.projects.includes(projectId)) entities.projects.push(projectId);

    const sessionTitles: string[] = Array.isArray(parsed?.sessions)
      ? (parsed.sessions as any[]).slice(0, 8).map((s: any) => String(s?.title || '').toLowerCase()).filter(Boolean)
      : [];

    out.push({
      id: opId(canonicalKey),
      canonicalKey,
      recordType: 'project_fact',
      title: name,
      summary: instructions || `Project ${name}: ${sessionCount} sessions.`,
      body,
      createdAt,
      updatedAt,
      day: dayStr(parsed?.createdAt ? Number(parsed.createdAt) : Date.now()),
      sourceRefs: [{ sourceType: 'project_state', sourcePath, confidence: 1.0 }],
      entities,
      projectId,
      sessionIds: Array.isArray(parsed?.sessions)
        ? (parsed.sessions as any[]).map((s: any) => String(s?.id || '')).filter(Boolean)
        : [],
      status: 'active',
      confidence: 1.0,
      durability: 0.82,
      supersedes: [],
      supersededBy: [],
      relatedIds: [],
      exactTerms: [
        projectId,
        ...name.toLowerCase().split(/\s+/).filter(w => w.length > 2),
        ...sessionTitles.flatMap(t => t.split(/\s+/).filter(w => w.length > 3)).slice(0, 8),
      ],
      tags: ['project_fact', 'project'],
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge / dedup
// ─────────────────────────────────────────────────────────────────────────────

function mergeRecord(existing: OperationalRecord, incoming: OperationalRecord): OperationalRecord {
  const existingSources = new Set(existing.sourceRefs.map(s => s.sourcePath));
  const newRefs = incoming.sourceRefs.filter(s => !existingSources.has(s.sourcePath));
  const merged: OperationalRecord = { ...existing };

  if (incoming.updatedAt > existing.updatedAt) merged.updatedAt = incoming.updatedAt;
  if (newRefs.length) merged.sourceRefs = [...existing.sourceRefs, ...newRefs];
  if (incoming.status && incoming.updatedAt >= existing.updatedAt) merged.status = incoming.status;

  merged.sessionIds = [...new Set([...existing.sessionIds, ...incoming.sessionIds])];
  merged.entities = {
    people: [...new Set([...existing.entities.people, ...incoming.entities.people])],
    projects: [...new Set([...existing.entities.projects, ...incoming.entities.projects])],
    features: [...new Set([...existing.entities.features, ...incoming.entities.features])],
    files: [...new Set([...existing.entities.files, ...incoming.entities.files])],
    tools: [...new Set([...existing.entities.tools, ...incoming.entities.tools])],
    aliases: [...new Set([...existing.entities.aliases, ...incoming.entities.aliases])],
  };
  merged.exactTerms = [...new Set([...existing.exactTerms, ...incoming.exactTerms])].slice(0, 20);
  merged.tags = [...new Set([...existing.tags, ...incoming.tags])];

  return merged;
}

function mergeAllCandidates(candidates: OperationalRecord[]): Record<string, OperationalRecord> {
  const records: Record<string, OperationalRecord> = {};
  for (const rec of candidates) {
    const existing = records[rec.id];
    records[rec.id] = existing ? mergeRecord(existing, rec) : rec;
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Index build helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildTokenIndex(records: Record<string, OperationalRecord>): Record<string, string[]> {
  const idx: Record<string, string[]> = {};
  for (const rec of Object.values(records)) {
    const text = [rec.title, rec.summary, rec.body, ...rec.exactTerms, ...rec.tags].join(' ');
    const ts = uniqTop(terms(text), 40);
    for (const t of ts) {
      if (!idx[t]) idx[t] = [];
      if (!idx[t].includes(rec.id)) idx[t].push(rec.id);
    }
  }
  return idx;
}

function buildExactLookup(records: Record<string, OperationalRecord>): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const rec of Object.values(records)) {
    lookup[rec.canonicalKey] = rec.id;
    lookup[rec.id] = rec.id;
    if (rec.proposalId) lookup[rec.proposalId] = rec.id;
    if (rec.taskId) lookup[rec.taskId] = rec.id;
    for (const term of rec.exactTerms) {
      if (term.length > 8 && !lookup[term]) lookup[term] = rec.id;
    }
  }
  return lookup;
}

function buildEmbeddings(records: Record<string, OperationalRecord>): Record<string, number[]> {
  const emb: Record<string, number[]> = {};
  for (const rec of Object.values(records)) {
    const text = [rec.title, rec.summary, ...rec.exactTerms].join(' ');
    emb[rec.id] = embedTerms(uniqTop(terms(text), 32));
  }
  return emb;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main build / refresh
// ─────────────────────────────────────────────────────────────────────────────

export function refreshOperationalIndex(
  workspacePath: string,
  opts?: { force?: boolean; minIntervalMs?: number }
): { records: number; updated: boolean } {
  const paths = opPaths(workspacePath);
  const now = Date.now();
  const manifest = readJson<OperationalManifest>(paths.manifest, {
    version: OP_VERSION, updatedAt: '', lastRunAtMs: 0,
  });
  const minInterval = Math.max(0, Number(opts?.minIntervalMs ?? 30000));

  if (!opts?.force && now - manifest.lastRunAtMs < minInterval) {
    const store = readJson<OperationalStore>(paths.store, {
      version: OP_VERSION, updatedAt: '', records: {},
    });
    return { records: Object.keys(store.records).length, updated: false };
  }

  const auditRoot = path.join(workspacePath, 'audit');
  const candidates: OperationalRecord[] = [
    ...parseProposalFiles(auditRoot),
    ...parseTaskFiles(auditRoot),
    ...parseMemoryRootFiles(auditRoot),
    ...parseChatCompactionFiles(auditRoot),
    ...parseObsidianFiles(auditRoot),
    ...parseProjectFiles(auditRoot),
  ];

  const records = mergeAllCandidates(candidates);
  const tokenIndex = buildTokenIndex(records);
  const exactLookup = buildExactLookup(records);
  const embeddings = buildEmbeddings(records);
  const nowIso = new Date(now).toISOString();

  ensureDir(paths.root);
  writeJson(paths.store, { version: OP_VERSION, updatedAt: nowIso, records });
  writeJson(paths.tokenIndex, tokenIndex);
  writeJson(paths.exactLookup, exactLookup);
  writeJson(paths.embeddings, embeddings);
  writeJson(paths.manifest, { version: OP_VERSION, updatedAt: nowIso, lastRunAtMs: now });

  return { records: Object.keys(records).length, updated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query planner
// ─────────────────────────────────────────────────────────────────────────────

interface QueryIntent {
  type: 'exact_id' | 'preference' | 'decision' | 'proposal' | 'task' | 'project' | 'semantic';
  exactIds: string[];
  recordTypeBoost?: OperationalRecordType;
  recencyBias: boolean;
}

function classifyQuery(query: string): QueryIntent {
  const q = query.toLowerCase();
  const propIds = extractProposalIds(query);
  const taskIds = extractTaskIds(query);
  const exactIds = [...propIds, ...taskIds];

  if (exactIds.length) return { type: 'exact_id', exactIds, recencyBias: false };
  if (/prefer|preference|like\s+to|always\s+|never\s+|don.t\s+|doesn.t\s+|should not|must not|wants?/.test(q))
    return { type: 'preference', exactIds: [], recordTypeBoost: 'preference', recencyBias: false };
  if (/decid|decision|chose|agreed|settle|agreed|resolved/.test(q))
    return { type: 'decision', exactIds: [], recordTypeBoost: 'decision', recencyBias: false };
  if (/proposal|proposed/.test(q))
    return { type: 'proposal', exactIds: [], recordTypeBoost: 'proposal', recencyBias: false };
  if (/\btask\b|outcome|complet|done|result/.test(q))
    return { type: 'task', exactIds: [], recordTypeBoost: 'task_outcome', recencyBias: false };
  if (/\bproject\b|\bteam\b/.test(q))
    return { type: 'project', exactIds: [], recordTypeBoost: 'project_fact', recencyBias: false };
  if (/latest|recent|last|yesterday|today|this week/.test(q))
    return { type: 'semantic', exactIds: [], recencyBias: true };

  return { type: 'semantic', exactIds: [], recencyBias: false };
}

// ─────────────────────────────────────────────────────────────────────────────
function sharedValues(a: string[] | undefined, b: string[] | undefined, limit = 8): string[] {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return [];
  const right = new Set(b.map((value) => String(value || '').trim()).filter(Boolean));
  const out: string[] = [];
  for (const value of a) {
    const key = String(value || '').trim();
    if (!key || !right.has(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function collectEntityValues(record: OperationalRecord): string[] {
  return [
    ...(record.entities.people || []),
    ...(record.entities.projects || []),
    ...(record.entities.features || []),
    ...(record.entities.files || []),
    ...(record.entities.tools || []),
    ...(record.entities.aliases || []),
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function toOperationalHit(
  rec: OperationalRecord,
  score: number,
  whyMatched: OperationalHit['whyMatched'],
): OperationalHit {
  return {
    id: rec.id,
    canonicalKey: rec.canonicalKey,
    recordType: rec.recordType,
    title: rec.title,
    summary: rec.summary,
    body: rec.body,
    score: Number(score.toFixed(4)),
    day: rec.day,
    projectId: rec.projectId,
    status: rec.status,
    confidence: rec.confidence,
    durability: rec.durability,
    sourceRefs: rec.sourceRefs.map((s) => ({ sourcePath: s.sourcePath, sourceType: s.sourceType })),
    whyMatched,
  };
}

// Search
// ─────────────────────────────────────────────────────────────────────────────

export interface OperationalHit {
  id: string;
  canonicalKey: string;
  recordType: string;
  title: string;
  summary: string;
  body: string;
  score: number;
  day: string;
  projectId: string | null;
  status?: string;
  confidence?: number;
  durability?: number;
  sourceRefs: Array<{ sourcePath: string; sourceType: string }>;
  whyMatched: {
    exactTerms: string[];
    entities: string[];
    lexical: string[];
    recordTypeReason?: string;
    recencyReason?: string;
  };
}

function recencyWeight(day: string, now: number): number {
  const ts = Date.parse(day + 'T12:00:00Z');
  if (!ts) return 0.3;
  const days = Math.max(0, (now - ts) / 86400000);
  if (days <= 1) return 1;
  if (days >= 180) return 0.1;
  return Math.max(0.1, 1 - days / 180);
}

export function searchOperationalLayer(
  workspacePath: string,
  params: {
    query: string;
    limit?: number;
    projectId?: string;
    recencyBias?: boolean;
  }
): OperationalHit[] {
  const paths = opPaths(workspacePath);

  const store = readJson<OperationalStore>(paths.store, {
    version: OP_VERSION, updatedAt: '', records: {},
  });
  const tokenIndex = readJson<Record<string, string[]>>(paths.tokenIndex, {});
  const embeddings = readJson<Record<string, number[]>>(paths.embeddings, {});

  const q = String(params.query || '').trim();
  const limit = Math.max(1, Math.min(20, Number(params.limit || 6)));
  const filterProjectId = String(params.projectId || '').trim();
  const now = Date.now();
  const qTerms = uniqTop(terms(q), 24);
  const qEmbedding = embedTerms(qTerms);
  const intent = classifyQuery(q);

  const scores = new Map<string, { score: number; why: OperationalHit['whyMatched'] }>();

  // Pass A: exact ID lookup — highest priority
  const exactLookup = readJson<Record<string, string>>(paths.exactLookup, {});
  for (const exactId of intent.exactIds) {
    const recId = exactLookup[exactId] || exactId;
    if (store.records[recId]) {
      scores.set(recId, {
        score: 2.0,
        why: { exactTerms: [exactId], entities: [], lexical: [] },
      });
    }
  }

  // Pass B: lexical + semantic over all operational records
  const candidateIds = new Set<string>();
  for (const t of qTerms) {
    for (const rid of (tokenIndex[t] || [])) candidateIds.add(rid);
  }
  // If few candidates from token index, broaden to all records
  if (candidateIds.size < 5) {
    for (const rid of Object.keys(store.records)) candidateIds.add(rid);
  }

  for (const rid of candidateIds) {
    const rec = store.records[rid];
    if (!rec) continue;
    if (filterProjectId && rec.projectId !== filterProjectId) continue;
    if (scores.has(rid)) continue; // already set by exact pass

    const recText = [rec.title, rec.summary, rec.body, ...rec.exactTerms, ...rec.tags].join(' ');
    const recTermSet = new Set(uniqTop(terms(recText), 50));
    const matchedTerms = qTerms.filter(t => recTermSet.has(t));
    const lexScore = qTerms.length ? matchedTerms.length / qTerms.length : 0.2;

    const recEmb = embeddings[rid] ?? embedTerms(uniqTop(terms(rec.title + ' ' + rec.summary), 32));
    const semScore = cosine(qEmbedding, recEmb);

    const recency = recencyWeight(rec.day, now);
    const typeBoost = intent.recordTypeBoost && rec.recordType === intent.recordTypeBoost ? 0.4 : 0;
    const recencyW = (params.recencyBias || intent.recencyBias) ? 0.35 : 0.1;

    const score =
      lexScore * 0.9 +
      semScore * 0.7 +
      recency * recencyW +
      rec.durability * 0.2 +
      typeBoost;

    if (score <= 0.05) continue;

    scores.set(rid, {
      score,
      why: {
        exactTerms: [],
        entities: [],
        lexical: matchedTerms,
        recordTypeReason: typeBoost > 0 ? `intent:${intent.type}` : undefined,
        recencyReason: recencyW > 0.2 ? 'recency bias' : undefined,
      },
    });
  }

  return [...scores.entries()]
    .map(([rid, s]) => ({ rid, ...s }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ rid, score, why }) => toOperationalHit(store.records[rid], score, why));
}

export function getRelatedOperationalRecords(
  workspacePath: string,
  recordIdOrKey: string,
  limit = 8,
): OperationalHit[] {
  const paths = opPaths(workspacePath);
  const store = readJson<OperationalStore>(paths.store, {
    version: OP_VERSION, updatedAt: '', records: {},
  });
  const lookup = readJson<Record<string, string>>(paths.exactLookup, {});
  const resolvedId = store.records[recordIdOrKey]?.id || lookup[recordIdOrKey];
  if (!resolvedId) return [];
  const base = store.records[resolvedId];
  if (!base) return [];

  const baseEntityValues = collectEntityValues(base);
  const baseSourcePaths = base.sourceRefs.map((s) => s.sourcePath);
  const baseSourceTypes = base.sourceRefs.map((s) => s.sourceType);
  const now = Date.now();

  return Object.values(store.records)
    .filter((rec) => rec.id !== base.id)
    .map((rec) => {
      const sharedRelatedIds = sharedValues(base.relatedIds, [rec.id, rec.canonicalKey, ...rec.relatedIds], 4);
      const sharedProject = base.projectId && rec.projectId && base.projectId === rec.projectId;
      const sharedSourcePaths = sharedValues(baseSourcePaths, rec.sourceRefs.map((s) => s.sourcePath), 4);
      const sharedSourceTypes = sharedValues(baseSourceTypes, rec.sourceRefs.map((s) => s.sourceType), 3);
      const sharedTags = sharedValues(base.tags, rec.tags, 5);
      const sharedTerms = sharedValues(base.exactTerms, rec.exactTerms, 6);
      const sharedEntities = sharedValues(baseEntityValues, collectEntityValues(rec), 6);
      const sameRecordType = base.recordType === rec.recordType;
      const reciprocalRelation = rec.relatedIds.includes(base.id) || rec.relatedIds.includes(base.canonicalKey);

      let score = 0;
      if (sharedRelatedIds.length) score += 1.2;
      if (reciprocalRelation) score += 0.8;
      if (sharedProject) score += 0.7;
      if (sharedSourcePaths.length) score += 0.45 + (sharedSourcePaths.length * 0.08);
      else if (sharedSourceTypes.length) score += 0.2;
      if (sharedTags.length) score += Math.min(0.45, sharedTags.length * 0.12);
      if (sharedTerms.length) score += Math.min(0.6, sharedTerms.length * 0.14);
      if (sharedEntities.length) score += Math.min(0.7, sharedEntities.length * 0.18);
      if (sameRecordType) score += 0.12;
      score += recencyWeight(rec.day, now) * 0.06;

      return {
        rec,
        score,
        whyMatched: {
          exactTerms: sharedTerms,
          entities: sharedEntities,
          lexical: [...sharedTags, ...sharedSourcePaths].slice(0, 8),
          recordTypeReason: sameRecordType ? `related:${base.recordType}` : undefined,
          recencyReason: sharedProject ? 'shared project context' : undefined,
        } satisfies OperationalHit['whyMatched'],
      };
    })
    .filter((entry) => entry.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map(({ rec, score, whyMatched }) => toOperationalHit(rec, score, whyMatched));
}

export function getOperationalRecord(
  workspacePath: string,
  recordIdOrKey: string
): OperationalRecord | null {
  const paths = opPaths(workspacePath);
  const store = readJson<OperationalStore>(paths.store, {
    version: OP_VERSION, updatedAt: '', records: {},
  });
  if (store.records[recordIdOrKey]) return store.records[recordIdOrKey];
  const lookup = readJson<Record<string, string>>(paths.exactLookup, {});
  const resolved = lookup[recordIdOrKey];
  return resolved ? (store.records[resolved] ?? null) : null;
}
