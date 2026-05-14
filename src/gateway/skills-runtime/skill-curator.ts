import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SkillsManager } from './skills-manager';
import { scanSkillText, type SkillSafetyScan } from './skill-safety';

export type SkillCuratorMode = 'dry-run' | 'pending' | 'auto-safe';
export type SkillCuratorSuggestionStatus = 'pending' | 'applied' | 'rejected' | 'quarantined';

export interface SkillCuratorSuggestion {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SkillCuratorSuggestionStatus;
  skillId: string;
  title: string;
  reason: string;
  evidence: string[];
  risk: 'low' | 'medium' | 'high';
  change: {
    kind: 'write_resource' | 'manifest_overlay';
    path?: string;
    content?: string;
    manifest?: Record<string, unknown>;
  };
  scan: SkillSafetyScan;
  appliedAt?: string;
  rejectedAt?: string;
}

export interface SkillCuratorRunResult {
  mode: SkillCuratorMode;
  runId: string;
  startedAt: string;
  reportPath: string;
  suggestions: SkillCuratorSuggestion[];
  applied: string[];
  quarantined: string[];
}

type CandidateRow = {
  id?: string;
  timestamp?: string;
  date?: string;
  type?: string;
  confidence?: string;
  risk?: string;
  skillId?: string;
  reason?: string;
  suggestedAction?: string;
  requestExcerpt?: string;
  finalResponseExcerpt?: string;
  toolSequence?: string[];
  evidence?: string[];
};

function curatorDir(workspacePath: string): string {
  return path.join(workspacePath, 'Brain', 'skill-curator');
}

function suggestionsPath(workspacePath: string): string {
  return path.join(curatorDir(workspacePath), 'suggestions.json');
}

function ensureCuratorDirs(workspacePath: string): void {
  for (const rel of ['runs', 'reports']) {
    fs.mkdirSync(path.join(curatorDir(workspacePath), rel), { recursive: true });
  }
}

function readJsonArray<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(filePath: string, rows: T[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as T; } catch { return null; }
      })
      .filter((row): row is T => !!row);
  } catch {
    return [];
  }
}

function recentCandidateRows(workspacePath: string, days = 14): CandidateRow[] {
  const root = path.join(workspacePath, 'Brain', 'skill-gardener');
  if (!fs.existsSync(root)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows: CandidateRow[] = [];
  for (const day of fs.readdirSync(root)) {
    const dir = path.join(root, day);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const dayTs = Date.parse(`${day}T00:00:00`);
    if (Number.isFinite(dayTs) && dayTs < cutoff) continue;
    rows.push(...readJsonl<CandidateRow>(path.join(dir, 'live-candidates.jsonl')));
  }
  return rows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

function suggestionId(seed: unknown): string {
  return `sc_${crypto.createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)}`;
}

function safeDateKey(raw?: string): string {
  const ts = Date.parse(String(raw || ''));
  const d = Number.isFinite(ts) ? new Date(ts) : new Date();
  return d.toISOString().slice(0, 10);
}

function buildResourceSuggestion(row: CandidateRow): SkillCuratorSuggestion | null {
  const skillId = String(row.skillId || '').trim();
  if (!skillId) return null;
  const dateKey = safeDateKey(row.timestamp);
  const kindLabel = row.type === 'update_existing_skill' ? 'troubleshooting note' : 'workflow example';
  const pathName = row.type === 'update_existing_skill'
    ? `references/curator-troubleshooting-${dateKey}.md`
    : `references/curator-example-${dateKey}.md`;
  const content = [
    `# Brain Curator ${kindLabel}`,
    '',
    `Source candidate: ${row.id || '(unknown)'}`,
    `Captured: ${row.timestamp || new Date().toISOString()}`,
    `Confidence: ${row.confidence || 'medium'}`,
    '',
    '## Reason',
    String(row.reason || 'Brain observed a reusable skill improvement opportunity.').trim(),
    '',
    '## Suggested Action',
    String(row.suggestedAction || 'Fold this observed workflow into the skill instructions or supporting references.').trim(),
    '',
    '## Request Excerpt',
    String(row.requestExcerpt || '').trim() || '(none recorded)',
    '',
    '## Outcome Excerpt',
    String(row.finalResponseExcerpt || '').trim() || '(none recorded)',
    '',
    '## Tool Sequence',
    ...(Array.isArray(row.toolSequence) && row.toolSequence.length ? row.toolSequence.slice(0, 60).map((name) => `- ${name}`) : ['- (none recorded)']),
    '',
  ].join('\n');
  const scan = scanSkillText(content, pathName);
  const now = new Date().toISOString();
  const risk = row.risk === 'high' ? 'high' : row.risk === 'medium' ? 'medium' : 'low';
  return {
    id: suggestionId({ skillId, type: row.type, pathName, reason: row.reason }),
    createdAt: now,
    updatedAt: now,
    status: scan.verdict === 'critical' ? 'quarantined' : 'pending',
    skillId,
    title: `Add ${kindLabel} to ${skillId}`,
    reason: String(row.reason || 'Brain observed a reusable skill improvement opportunity.').trim(),
    evidence: Array.isArray(row.evidence) && row.evidence.length
      ? row.evidence.map(String)
      : [`Brain/skill-gardener/${dateKey}/live-candidates.jsonl`],
    risk,
    change: {
      kind: 'write_resource',
      path: pathName,
      content,
    },
    scan,
  };
}
function buildTriggerSuggestion(row: CandidateRow, skillsManager: SkillsManager): SkillCuratorSuggestion | null {
  const skillId = String(row.skillId || '').trim();
  if (!skillId) return null;
  const skill = skillsManager.get(skillId);
  if (!skill) return null;
  const phrase = String(row.requestExcerpt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .slice(0, 4)
    .join(' ');
  if (!phrase) return null;
  const triggers = Array.from(new Set([...(skill.triggers || []), phrase]));
  const manifest = { ...skill.manifest, triggers };
  const scan = scanSkillText(JSON.stringify(manifest, null, 2), 'skill.json overlay');
  const now = new Date().toISOString();
  return {
    id: suggestionId({ skillId, type: 'add_trigger', phrase }),
    createdAt: now,
    updatedAt: now,
    status: scan.verdict === 'critical' ? 'quarantined' : 'pending',
    skillId,
    title: `Add trigger to ${skillId}`,
    reason: 'Brain observed skill discovery friction after skills were listed without a matching skill read.',
    evidence: Array.isArray(row.evidence) && row.evidence.length ? row.evidence.map(String) : [],
    risk: 'low',
    change: { kind: 'manifest_overlay', manifest },
    scan,
  };
}

function mergeSuggestions(existing: SkillCuratorSuggestion[], incoming: SkillCuratorSuggestion[]): SkillCuratorSuggestion[] {
  const byId = new Map<string, SkillCuratorSuggestion>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) {
    const old = byId.get(item.id);
    if (old && old.status !== 'pending' && old.status !== 'quarantined') continue;
    byId.set(item.id, old ? { ...old, ...item, createdAt: old.createdAt, status: old.status } : item);
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listSkillCuratorSuggestions(workspacePath: string): SkillCuratorSuggestion[] {
  return readJsonArray<SkillCuratorSuggestion>(suggestionsPath(workspacePath));
}

export function rejectSkillCuratorSuggestion(workspacePath: string, id: string): SkillCuratorSuggestion | null {
  const rows = listSkillCuratorSuggestions(workspacePath);
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  rows[idx] = { ...rows[idx], status: 'rejected', updatedAt: new Date().toISOString(), rejectedAt: new Date().toISOString() };
  writeJsonArray(suggestionsPath(workspacePath), rows);
  return rows[idx];
}

export function applySkillCuratorSuggestion(workspacePath: string, skillsManager: SkillsManager, id: string): SkillCuratorSuggestion | null {
  const rows = listSkillCuratorSuggestions(workspacePath);
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  const suggestion = rows[idx];
  if (suggestion.status === 'quarantined') throw new Error('Cannot apply a quarantined skill suggestion.');
  if (suggestion.change.kind === 'write_resource') {
    skillsManager.writeResource(suggestion.skillId, suggestion.change.path || '', suggestion.change.content || '', {
      type: 'doc',
      description: suggestion.title,
      change: {
        changeType: 'brain_curator_resource',
        evidence: suggestion.evidence,
        appliedBy: 'skill_curator',
        reason: suggestion.reason,
      },
    });
  } else if (suggestion.change.kind === 'manifest_overlay') {
    skillsManager.writeManifestOverlay(suggestion.skillId, suggestion.change.manifest || {}, {
      changeType: 'brain_curator_manifest',
      evidence: suggestion.evidence,
      appliedBy: 'skill_curator',
      reason: suggestion.reason,
    });
  }
  rows[idx] = { ...suggestion, status: 'applied', updatedAt: new Date().toISOString(), appliedAt: new Date().toISOString() };
  writeJsonArray(suggestionsPath(workspacePath), rows);
  return rows[idx];
}

export function runSkillCurator(params: {
  workspacePath: string;
  skillsManager: SkillsManager;
  mode: SkillCuratorMode;
}): SkillCuratorRunResult {
  ensureCuratorDirs(params.workspacePath);
  params.skillsManager.scanSkills();
  const startedAt = new Date().toISOString();
  const runId = `skill_curator_${startedAt.replace(/[:.]/g, '-')}`;
  const rows = recentCandidateRows(params.workspacePath);
  const incoming = rows
    .filter((row) => row.type !== 'no_action_but_record_episode')
    .map((row) => row.type === 'add_trigger'
      ? buildTriggerSuggestion(row, params.skillsManager)
      : buildResourceSuggestion(row))
    .filter((item): item is SkillCuratorSuggestion => !!item && !!params.skillsManager.get(item.skillId));

  const existing = listSkillCuratorSuggestions(params.workspacePath);
  const merged = mergeSuggestions(existing, incoming);
  const quarantined = incoming.filter((item) => item.status === 'quarantined').map((item) => item.id);
  const applied: string[] = [];

  if (params.mode !== 'dry-run') {
    writeJsonArray(suggestionsPath(params.workspacePath), merged);
  }

  if (params.mode === 'auto-safe') {
    for (const suggestion of merged) {
      if (suggestion.status !== 'pending' || suggestion.risk !== 'low' || suggestion.scan.verdict === 'critical') continue;
      try {
        applySkillCuratorSuggestion(params.workspacePath, params.skillsManager, suggestion.id);
        applied.push(suggestion.id);
      } catch {}
    }
  }

  const reportPath = path.join(curatorDir(params.workspacePath), 'reports', `${runId}.md`);
  const report = [
    `# Skill Curator Run - ${startedAt}`,
    '',
    `Mode: ${params.mode}`,
    `Candidates reviewed: ${rows.length}`,
    `Suggestions generated: ${incoming.length}`,
    `Applied: ${applied.length}`,
    `Quarantined: ${quarantined.length}`,
    '',
    '## Suggestions',
    ...(incoming.length ? incoming.map((s) => [
      `### ${s.title}`,
      `- ID: ${s.id}`,
      `- Skill: ${s.skillId}`,
      `- Status: ${s.status}`,
      `- Risk: ${s.risk}`,
      `- Reason: ${s.reason}`,
      `- Evidence: ${s.evidence.join(', ') || '(none)'}`,
      `- Change: ${s.change.kind}${s.change.path ? ` ${s.change.path}` : ''}`,
    ].join('\n')) : ['No new suggestions.']),
    '',
  ].join('\n');
  fs.writeFileSync(reportPath, report, 'utf-8');

  return {
    mode: params.mode,
    runId,
    startedAt,
    reportPath,
    suggestions: incoming,
    applied,
    quarantined,
  };
}
