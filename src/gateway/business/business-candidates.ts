import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { BusinessEntityType } from './entity-store';

export type BusinessCandidateAction =
  | 'create_entity'
  | 'update_entity'
  | 'append_event'
  | 'update_business_profile'
  | 'suggest_skill';

export interface BusinessCandidate {
  id: string;
  timestamp: string;
  date: string;
  source: string;
  confidence: 'low' | 'medium' | 'high';
  action: BusinessCandidateAction;
  entityType?: BusinessEntityType;
  entityId?: string;
  displayName?: string;
  summary: string;
  evidence: string[];
  proposedFields?: Record<string, string>;
  sensitivity?: 'normal' | 'private' | 'external_action';
}

function stableId(seed: unknown): string {
  return `bc_${crypto.createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)}`;
}

export function businessCandidatesDir(workspacePath: string, date: string): string {
  return path.join(workspacePath, 'Brain', 'business-candidates', date);
}

export function businessCandidatesPath(workspacePath: string, date: string): string {
  return path.join(businessCandidatesDir(workspacePath, date), 'candidates.jsonl');
}

export function normalizeBusinessCandidate(raw: Partial<BusinessCandidate> & { summary: string }, date: string): BusinessCandidate {
  const timestamp = raw.timestamp || new Date().toISOString();
  const seed = {
    date,
    source: raw.source || '',
    action: raw.action || 'append_event',
    entityType: raw.entityType || '',
    entityId: raw.entityId || '',
    summary: raw.summary || '',
  };
  return {
    id: raw.id || stableId(seed),
    timestamp,
    date,
    source: String(raw.source || 'unknown'),
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    action: raw.action || 'append_event',
    entityType: raw.entityType,
    entityId: raw.entityId,
    displayName: raw.displayName,
    summary: String(raw.summary || '').trim(),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String).filter(Boolean).slice(0, 12) : [],
    proposedFields: raw.proposedFields && typeof raw.proposedFields === 'object' ? raw.proposedFields : undefined,
    sensitivity: raw.sensitivity === 'private' || raw.sensitivity === 'external_action' ? raw.sensitivity : 'normal',
  };
}

export function appendBusinessCandidates(workspacePath: string, date: string, rows: BusinessCandidate[]): void {
  const clean = rows.filter((row) => row.summary.trim());
  if (!clean.length) return;
  const filePath = businessCandidatesPath(workspacePath, date);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${clean.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf-8');
}

export function readBusinessCandidates(workspacePath: string, date: string): BusinessCandidate[] {
  const filePath = businessCandidatesPath(workspacePath, date);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as BusinessCandidate; } catch { return null; }
    })
    .filter((row): row is BusinessCandidate => !!row && !!row.summary);
}
