import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type DiagnosticClassification = 'agent'|'task'|'team'|'schedule'|'provider'|'configuration'|'dependency'|'workspace'|'application_defect'|'unknown';
export interface DiagnosticPacket {
  schemaVersion: 1; id: string; status: 'open'|'resolved'|'escalated'; createdAt: string; updatedAt: string;
  classification: DiagnosticClassification; severity: 'low'|'medium'|'high'|'critical'; confidence: 'low'|'medium'|'high';
  observedBehavior: string; expectedBehavior: string; minimalReproduction: string[]; affectedSubsystem: string;
  evidence: Array<{ kind: string; ref: string; observedAt?: string; freshness: 'current'|'stale'|'unknown'; provenance: 'live_tool'|'canonical'|'mirror'; redacted: true }>;
  attemptedRecoveries: Array<{ action: string; at: string; outcome: string }>;
  operationalRecoveryExhausted: boolean; unresolvedUncertainty: string[]; sanitizedSummary: string;
  proposalId?: string;
}

function root(workspacePath: string): string { return path.join(workspacePath, 'diagnostics', 'incidents'); }
function safeText(value: any, max = 4000): string {
  return String(value || '').replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|secret|api[_-]?key|token|cookie)\s*[:=]\s*\S+/gi, '$1=[REDACTED]').slice(0, max);
}
function packetPath(workspacePath: string, id: string): string | null {
  if (!/^diag_[a-z0-9_-]+$/i.test(id)) return null;
  return path.join(root(workspacePath), `${id}.json`);
}
export function createDiagnosticPacket(workspacePath: string, input: any): DiagnosticPacket {
  const now = new Date().toISOString();
  const packet: DiagnosticPacket = {
    schemaVersion: 1, id: `diag_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, status: 'open', createdAt: now, updatedAt: now,
    classification: (['agent','task','team','schedule','provider','configuration','dependency','workspace','application_defect'].includes(String(input.classification)) ? input.classification : 'unknown'),
    severity: (['low','medium','high','critical'].includes(String(input.severity)) ? input.severity : 'medium'),
    confidence: (['low','medium','high'].includes(String(input.confidence)) ? input.confidence : 'medium'),
    observedBehavior: safeText(input.observedBehavior || input.observed_behavior), expectedBehavior: safeText(input.expectedBehavior || input.expected_behavior),
    minimalReproduction: (Array.isArray(input.minimalReproduction || input.minimal_reproduction) ? (input.minimalReproduction || input.minimal_reproduction) : []).slice(0, 20).map((v: any) => safeText(v, 1000)),
    affectedSubsystem: safeText(input.affectedSubsystem || input.affected_subsystem, 300),
    evidence: (Array.isArray(input.evidence) ? input.evidence : []).slice(0, 40).map((e: any) => ({ kind: safeText(e.kind, 80), ref: safeText(e.ref, 500), observedAt: e.observedAt ? safeText(e.observedAt, 80) : undefined, freshness: ['current','stale'].includes(e.freshness) ? e.freshness : 'unknown', provenance: ['live_tool','canonical','mirror'].includes(e.provenance) ? e.provenance : 'mirror', redacted: true })),
    attemptedRecoveries: (Array.isArray(input.attemptedRecoveries || input.attempted_recoveries) ? (input.attemptedRecoveries || input.attempted_recoveries) : []).slice(0, 30).map((r: any) => ({ action: safeText(r.action, 500), at: safeText(r.at || now, 80), outcome: safeText(r.outcome, 1000) })),
    operationalRecoveryExhausted: input.operationalRecoveryExhausted === true || input.operational_recovery_exhausted === true,
    unresolvedUncertainty: (Array.isArray(input.unresolvedUncertainty || input.unresolved_uncertainty) ? (input.unresolvedUncertainty || input.unresolved_uncertainty) : []).slice(0, 20).map((v: any) => safeText(v, 500)),
    sanitizedSummary: safeText(input.sanitizedSummary || input.sanitized_summary, 4000),
  };
  if (!packet.observedBehavior || !packet.expectedBehavior || !packet.sanitizedSummary) throw new Error('observed_behavior, expected_behavior, and sanitized_summary are required.');
  fs.mkdirSync(root(workspacePath), { recursive: true });
  fs.writeFileSync(packetPath(workspacePath, packet.id)!, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  return packet;
}
export function getDiagnosticPacket(workspacePath: string, id: string): DiagnosticPacket | null {
  const file = packetPath(workspacePath, id); if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
export function listDiagnosticPackets(workspacePath: string, limit = 20): DiagnosticPacket[] {
  if (!fs.existsSync(root(workspacePath))) return [];
  return fs.readdirSync(root(workspacePath)).filter((f) => f.endsWith('.json')).map((f) => getDiagnosticPacket(workspacePath, path.basename(f, '.json'))).filter(Boolean).sort((a: any,b: any) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(1, Math.min(100, limit))) as DiagnosticPacket[];
}
export function updateDiagnosticPacketStatus(workspacePath: string, id: string, status: 'resolved'|'escalated', proposalId?: string): DiagnosticPacket | null {
  const packet = getDiagnosticPacket(workspacePath, id); if (!packet) return null;
  packet.status = status; packet.updatedAt = new Date().toISOString(); if (proposalId) packet.proposalId = safeText(proposalId, 120);
  fs.writeFileSync(packetPath(workspacePath, id)!, `${JSON.stringify(packet, null, 2)}\n`, 'utf8'); return packet;
}
