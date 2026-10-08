/**
 * video-pending-approvals.ts
 *
 * Persisted store for paid video_project runs that returned needsApproval.
 * Records live at <workspace>/video-projects/_pending-approvals.json and are
 * cleared when the run is approved/started (clearVideoApprovalsForProject) or
 * dismissed (clearVideoApproval). The Needs-you collector reads them through
 * listVideoApprovalsAcrossWorkspaces().
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface VideoPendingApproval {
  id: string;
  workspacePath: string;
  sessionId: string;
  projectId: string;
  /** Which video_project action to re-run with approved:true on Approve. */
  action: 'run' | 'generate';
  /** Original args (minus approved) so the approved retry matches the quoted request. */
  args: Record<string, any>;
  runId?: string;
  shotIds?: string[];
  quotedUsd: number;
  summary: string;
  createdAt: number;
}

const knownWorkspaces = new Set<string>();

function storeFile(workspacePath: string): string {
  return path.join(workspacePath, 'video-projects', '_pending-approvals.json');
}

function readApprovals(workspacePath: string): VideoPendingApproval[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(workspacePath), 'utf8'));
    return Array.isArray(raw?.approvals) ? raw.approvals : [];
  } catch {
    return [];
  }
}

function writeApprovals(workspacePath: string, list: VideoPendingApproval[]): void {
  const file = storeFile(workspacePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ approvals: list }, null, 2));
  fs.renameSync(tmp, file);
}

export function recordVideoApproval(input: Omit<VideoPendingApproval, 'id' | 'createdAt'>): VideoPendingApproval {
  if (!input.workspacePath || !input.sessionId || !input.projectId) {
    throw new Error('recordVideoApproval requires workspacePath, sessionId and projectId.');
  }
  knownWorkspaces.add(path.resolve(input.workspacePath));
  // One pending quote per project+action: a re-quote replaces the older one.
  const kept = readApprovals(input.workspacePath).filter((a) => !(a.projectId === input.projectId && a.action === input.action));
  const record: VideoPendingApproval = {
    ...input,
    quotedUsd: Number(input.quotedUsd) || 0,
    shotIds: Array.isArray(input.shotIds) ? input.shotIds.map(String) : undefined,
    id: `vpa_${randomUUID().slice(0, 12)}`,
    createdAt: Date.now(),
  };
  writeApprovals(input.workspacePath, [...kept, record]);
  return record;
}

export function listVideoApprovals(workspacePath: string): VideoPendingApproval[] {
  return readApprovals(workspacePath);
}

export function getVideoApproval(workspacePath: string, id: string): VideoPendingApproval | undefined {
  return readApprovals(workspacePath).find((a) => a.id === id);
}

/** Called when a run is approved/started for the project: the quote is no longer pending. */
export function clearVideoApprovalsForProject(workspacePath: string, projectId: string): number {
  const list = readApprovals(workspacePath);
  const kept = list.filter((a) => a.projectId !== projectId);
  if (kept.length !== list.length) writeApprovals(workspacePath, kept);
  return list.length - kept.length;
}

/** Dismiss (or consume after approval) a single pending quote. */
export function clearVideoApproval(workspacePath: string, id: string): boolean {
  const list = readApprovals(workspacePath);
  const kept = list.filter((a) => a.id !== id);
  if (kept.length === list.length) return false;
  writeApprovals(workspacePath, kept);
  return true;
}

/** Union of every workspace that has recorded quotes this process knows about, plus extras (e.g. the configured workspace). */
export function listVideoApprovalsAcrossWorkspaces(extraWorkspaces: string[] = []): VideoPendingApproval[] {
  const seen = new Set<string>();
  const out: VideoPendingApproval[] = [];
  for (const ws of [...knownWorkspaces, ...extraWorkspaces.map((w) => path.resolve(w))]) {
    if (!ws || seen.has(ws)) continue;
    seen.add(ws);
    knownWorkspaces.add(ws);
    out.push(...readApprovals(ws));
  }
  return out;
}

/** Test helper. */
export function resetVideoApprovalKnownWorkspacesForTests(): void {
  knownWorkspaces.clear();
}
