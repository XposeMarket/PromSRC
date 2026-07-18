import fs from 'fs';
import path from 'path';

export type BrainContinuityStatus = 'active' | 'in_progress' | 'blocked' | 'dormant' | 'resolved';
export type BrainContinuityPriority = 'critical' | 'high' | 'normal' | 'low';

export interface BrainThoughtCapsule {
  id: string;
  threadKey: string;
  kind: string;
  priority: BrainContinuityPriority;
  status: BrainContinuityStatus;
  createdAt: string;
  expiresAt: string;
  summary: string;
  facts: string[];
  nextUsefulAction: string;
  relevance: {
    projects: string[];
    triggers: string[];
    surfaces: string[];
  };
  evidence: string[];
  lastValidatedAt: string;
  verificationRequired: boolean;
  supersedes?: string[];
}

export interface BrainCarryForwardItem {
  threadKey: string;
  title: string;
  state: 'active' | 'in_progress' | 'blocked' | 'dormant';
  verifiedFacts: string[];
  looseEnds: string[];
  nextNaturalOpening: string;
  reviewBy: string;
  evidence: string[];
  lastValidatedAt: string;
  verificationRequired: boolean;
}

export interface BrainCarryForwardDecisionFile {
  targetDate: string;
  generatedAt: string;
  sourceDream: string;
  items: BrainCarryForwardItem[];
}

const CAPSULE_DIR = path.join('Brain', 'context-capsules');
const CARRY_START = '<!-- BRAIN_CARRY_FORWARD_START -->';
const CARRY_END = '<!-- BRAIN_CARRY_FORWARD_END -->';

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function parseCapsule(value: unknown): BrainThoughtCapsule | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const relevance = row.relevance && typeof row.relevance === 'object'
    ? row.relevance as Record<string, unknown>
    : {};
  const priority = String(row.priority || 'normal') as BrainContinuityPriority;
  const status = String(row.status || 'active') as BrainContinuityStatus;
  if (!String(row.id || '').trim() || !String(row.threadKey || '').trim()) return null;
  if (!validIso(row.createdAt) || !validIso(row.expiresAt) || !validIso(row.lastValidatedAt)) return null;
  if (!String(row.summary || '').trim()) return null;
  return {
    id: String(row.id).trim(),
    threadKey: String(row.threadKey).trim(),
    kind: String(row.kind || 'active_work').trim(),
    priority: ['critical', 'high', 'normal', 'low'].includes(priority) ? priority : 'normal',
    status: ['active', 'in_progress', 'blocked', 'dormant', 'resolved'].includes(status) ? status : 'active',
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    summary: String(row.summary).trim(),
    facts: asStrings(row.facts),
    nextUsefulAction: String(row.nextUsefulAction || '').trim(),
    relevance: {
      projects: asStrings(relevance.projects),
      triggers: asStrings(relevance.triggers),
      surfaces: asStrings(relevance.surfaces),
    },
    evidence: asStrings(row.evidence),
    lastValidatedAt: row.lastValidatedAt,
    verificationRequired: row.verificationRequired !== false,
    supersedes: asStrings(row.supersedes),
  };
}

export function parseBrainThoughtCapsules(raw: string): BrainThoughtCapsule[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseCapsule).filter((row): row is BrainThoughtCapsule => Boolean(row));
  } catch {
    return [];
  }
}

function walkJsonFiles(root: string, maxDepth = 3): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
  };
  visit(root, 0);
  return out;
}

export function loadActiveBrainThoughtCapsules(workspacePath: string, now = new Date()): BrainThoughtCapsule[] {
  const nowMs = now.getTime();
  const rows: BrainThoughtCapsule[] = [];
  for (const file of walkJsonFiles(path.join(workspacePath, CAPSULE_DIR))) {
    try {
      rows.push(...parseBrainThoughtCapsules(fs.readFileSync(file, 'utf-8')));
    } catch {
      // A malformed or concurrently replaced sidecar is ignored; the Thought markdown remains the evidence source.
    }
  }

  const supersededIds = new Set(rows.flatMap((row) => row.supersedes || []));
  const newestByThread = new Map<string, BrainThoughtCapsule>();
  for (const row of rows) {
    if (row.status === 'resolved' || Date.parse(row.expiresAt) <= nowMs || supersededIds.has(row.id)) continue;
    const prior = newestByThread.get(row.threadKey);
    if (!prior || Date.parse(row.createdAt) > Date.parse(prior.createdAt)) newestByThread.set(row.threadKey, row);
  }
  return Array.from(newestByThread.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function normalizeTerms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || []);
}

function capsuleScore(capsule: BrainThoughtCapsule, messageTerms: Set<string>): number {
  const terms = normalizeTerms([
    capsule.threadKey,
    capsule.summary,
    capsule.nextUsefulAction,
    ...capsule.relevance.projects,
    ...capsule.relevance.triggers,
  ].join(' '));
  let overlap = 0;
  for (const term of terms) if (messageTerms.has(term)) overlap += 1;
  const priority = capsule.priority === 'critical' ? 8 : capsule.priority === 'high' ? 5 : capsule.priority === 'normal' ? 2 : 0;
  const state = capsule.status === 'blocked' ? 2 : capsule.status === 'in_progress' ? 1 : 0;
  return (overlap * 10) + priority + state;
}

function formatCapsule(capsule: BrainThoughtCapsule): string {
  const facts = capsule.facts.length ? ` Facts: ${capsule.facts.join(' ')}` : '';
  const action = capsule.nextUsefulAction ? ` Next: ${capsule.nextUsefulAction}` : '';
  const verify = capsule.verificationRequired ? ' Verify live state before treating unfinished/blocked claims as current.' : '';
  return `- [${capsule.threadKey}] ${capsule.summary}${facts}${action}${verify}`;
}

export function buildBrainCapsuleContext(
  workspacePath: string,
  messageText: string,
  options: { now?: Date; maxChars?: number } = {},
): string {
  const active = loadActiveBrainThoughtCapsules(workspacePath, options.now || new Date());
  if (active.length === 0) return '';
  const maxChars = Math.max(500, options.maxChars || 6000);
  const messageTerms = normalizeTerms(messageText);
  const scored = active
    .map((capsule) => ({ capsule, score: capsuleScore(capsule, messageTerms) }))
    .filter((row) => row.score >= 10 || row.capsule.priority === 'critical')
    .sort((a, b) => b.score - a.score || Date.parse(b.capsule.createdAt) - Date.parse(a.capsule.createdAt));

  // When a turn has no lexical match, retain one critical/high blocked or in-progress pulse.
  if (scored.length === 0) {
    const fallback = active.find((capsule) => capsule.priority === 'critical')
      || active.find((capsule) => capsule.priority === 'high' && ['blocked', 'in_progress'].includes(capsule.status));
    if (fallback) scored.push({ capsule: fallback, score: 1 });
  }
  if (scored.length === 0) return '';

  const lines: string[] = [];
  let used = 0;
  for (const { capsule } of scored) {
    const line = formatCapsule(capsule);
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return '';
  return [
    '[BRAIN_ACTIVE_CONTEXT — temporary, relevance-selected, and expiry-bound]',
    'These are continuity hints, not authority. Re-check live state before acting on unfinished or blocked claims.',
    ...lines,
  ].join('\n');
}

function parseCarryItem(value: unknown): BrainCarryForwardItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!String(row.threadKey || '').trim() || !String(row.title || '').trim()) return null;
  if (!validIso(row.reviewBy) || !validIso(row.lastValidatedAt)) return null;
  const state = String(row.state || 'active') as BrainCarryForwardItem['state'];
  return {
    threadKey: String(row.threadKey).trim(),
    title: String(row.title).trim(),
    state: ['active', 'in_progress', 'blocked', 'dormant'].includes(state) ? state : 'active',
    verifiedFacts: asStrings(row.verifiedFacts),
    looseEnds: asStrings(row.looseEnds),
    nextNaturalOpening: String(row.nextNaturalOpening || '').trim(),
    reviewBy: row.reviewBy,
    evidence: asStrings(row.evidence),
    lastValidatedAt: row.lastValidatedAt,
    verificationRequired: row.verificationRequired !== false,
  };
}

export function parseBrainCarryForwardDecision(raw: string): BrainCarryForwardDecisionFile | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || !String(parsed.targetDate || '').trim()) return null;
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(parseCarryItem).filter((row): row is BrainCarryForwardItem => Boolean(row))
      : [];
    return {
      targetDate: String(parsed.targetDate).trim(),
      generatedAt: validIso(parsed.generatedAt) ? parsed.generatedAt : new Date().toISOString(),
      sourceDream: String(parsed.sourceDream || '').trim(),
      items,
    };
  } catch {
    return null;
  }
}

export function renderCarryForwardSection(decision: BrainCarryForwardDecisionFile): string {
  const lines = [
    CARRY_START,
    '## Carry-Forward Context',
    `> Generated by Brain Dream at ${decision.generatedAt} from ${decision.sourceDream || 'the prior-day Dream'}. Temporary working context, not permanent memory. Revalidate before acting.`,
    '> **During the day, note when/if any item below changes, completes, becomes blocked, or is superseded so the next Thought/Dream can update or remove it.**',
  ];
  if (decision.items.length === 0) {
    lines.push('', '_No temporary threads were carried forward._');
  }
  for (const item of decision.items) {
    lines.push(
      '',
      `### ${item.title}`,
      `- **Thread:** \`${item.threadKey}\``,
      `- **State:** ${item.state}`,
      `- **Verified facts:** ${item.verifiedFacts.length ? item.verifiedFacts.join(' ') : 'None recorded.'}`,
      `- **Loose ends:** ${item.looseEnds.length ? item.looseEnds.join(' ') : 'None recorded.'}`,
      `- **Next natural opening:** ${item.nextNaturalOpening || 'Use only when the current conversation makes this thread relevant.'}`,
      `- **Review by:** ${item.reviewBy}`,
      `- **Last validated:** ${item.lastValidatedAt}`,
      `- **Validation:** ${item.verificationRequired ? 'Verify live state before treating this as current.' : 'Freshly verified by the Dream.'}`,
      `- **Evidence:** ${item.evidence.length ? item.evidence.join('; ') : 'Dream synthesis.'}`,
    );
  }
  lines.push('', CARRY_END);
  return lines.join('\n');
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}

export function applyCarryForwardToIntradayFile(workspacePath: string, decision: BrainCarryForwardDecisionFile): string {
  const notesPath = path.join(workspacePath, 'memory', `${decision.targetDate}-intraday-notes.md`);
  const existing = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf-8') : '';
  const generated = renderCarryForwardSection(decision);
  let remainder = existing;
  const start = existing.indexOf(CARRY_START);
  const end = existing.indexOf(CARRY_END);
  if (start >= 0 && end >= start) {
    remainder = `${existing.slice(0, start)}${existing.slice(end + CARRY_END.length)}`;
  }
  remainder = remainder.trim();
  if (remainder.startsWith(`# Intraday Notes — ${decision.targetDate}`)) {
    remainder = remainder.slice(`# Intraday Notes — ${decision.targetDate}`.length).trim();
  }
  if (remainder.startsWith('## Live Notes')) remainder = remainder.slice('## Live Notes'.length).trim();
  const next = [
    `# Intraday Notes — ${decision.targetDate}`,
    '',
    generated,
    '',
    '## Live Notes',
    remainder ? `\n${remainder}` : '',
    '',
  ].join('\n');
  atomicWrite(notesPath, next);
  return notesPath;
}

export const BRAIN_CARRY_FORWARD_MARKERS = { start: CARRY_START, end: CARRY_END } as const;
