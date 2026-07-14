import fs from 'fs';
import path from 'path';

export type RuntimeActorKind = 'main' | 'manager' | 'agent' | 'ephemeral_worker' | 'voice';
export type RuntimeActorSurface =
  | 'interactive'
  | 'direct_chat'
  | 'background_dispatch'
  | 'team_dispatch'
  | 'team_room'
  | 'scheduled_run'
  | 'proposal_execution'
  | 'heartbeat';

export interface RuntimeActorContext {
  kind: RuntimeActorKind;
  surface: RuntimeActorSurface;
  displayName?: string;
  agentId?: string;
  teamId?: string;
  teamName?: string;
  identityRoot?: string;
  memoryRoot?: string;
  executionRoot?: string;
  allowedWorkPaths?: string[];
}

const actors = new Map<string, RuntimeActorContext>();

function cleanPath(value?: string): string | undefined {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : undefined;
}

export function setRuntimeActorContext(sessionId: string, actor: RuntimeActorContext): RuntimeActorContext {
  const id = String(sessionId || '').trim();
  const normalized: RuntimeActorContext = {
    ...actor,
    agentId: String(actor.agentId || '').trim() || undefined,
    teamId: String(actor.teamId || '').trim() || undefined,
    displayName: String(actor.displayName || '').trim() || undefined,
    teamName: String(actor.teamName || '').trim() || undefined,
    identityRoot: cleanPath(actor.identityRoot),
    memoryRoot: cleanPath(actor.memoryRoot || actor.identityRoot),
    executionRoot: cleanPath(actor.executionRoot),
    allowedWorkPaths: Array.from(new Set((actor.allowedWorkPaths || []).map((p) => cleanPath(p)).filter(Boolean) as string[])),
  };
  if (id) actors.set(id, normalized);
  ensureRuntimeActorMemory(normalized);
  return normalized;
}

export function getRuntimeActorContext(sessionId: string): RuntimeActorContext | null {
  return actors.get(String(sessionId || '').trim()) || null;
}

export function clearRuntimeActorContext(sessionId: string): void {
  actors.delete(String(sessionId || '').trim());
}

export function isDistinctRuntimeActor(actor: RuntimeActorContext | null | undefined): boolean {
  return actor?.kind === 'manager' || actor?.kind === 'agent' || actor?.kind === 'ephemeral_worker';
}

export function getRuntimeActorMemoryPath(actor: RuntimeActorContext | null | undefined): string | null {
  if (!actor || (actor.kind !== 'agent' && actor.kind !== 'manager')) return null;
  const root = cleanPath(actor.memoryRoot || actor.identityRoot);
  return root ? path.join(root, 'MEMORY.md') : null;
}

export function ensureRuntimeActorMemory(actor: RuntimeActorContext | null | undefined): string | null {
  const filePath = getRuntimeActorMemoryPath(actor);
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const label = actor?.displayName || actor?.agentId || (actor?.kind === 'manager' ? 'Manager' : 'Agent');
    fs.writeFileSync(filePath, [
      `# MEMORY.md - ${label}`,
      '',
      'Durable personal memory for this agent.',
      '',
      'Store role-specific lessons, decisions, corrections, preferences, and open threads that should survive future runs.',
      'Do not copy main-user memory or shared team truth here; shared team facts belong in the team memory system.',
    ].join('\n'), 'utf-8');
  }
  return filePath;
}

export function loadRuntimeActorMemoryContext(sessionId: string, maxChars = 6000): string {
  const actor = getRuntimeActorContext(sessionId);
  const filePath = ensureRuntimeActorMemory(actor);
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return '';
    if (content.length <= maxChars) return content;
    return `${content.slice(0, Math.max(0, maxChars - 28)).trimEnd()}\n...[personal memory truncated]`;
  } catch {
    return '';
  }
}

export function buildRuntimeActorRoleContract(actor: RuntimeActorContext | null | undefined): string {
  if (!actor) return '';
  const name = actor.displayName || actor.agentId || (actor.kind === 'manager' ? 'Manager' : 'Agent');
  if (actor.kind === 'manager') {
    return [
      `You are ${name}, the manager agent for ${actor.teamName || actor.teamId || 'this managed team'}.`,
      'You are a distinct agent operating inside Prometheus, not Prom and not the main user chat.',
      'You own team coordination, verification, shared team memory, and escalation to the main Prometheus agent.',
    ].join(' ');
  }
  if (actor.kind === 'agent') {
    const team = actor.teamName || actor.teamId;
    return team
      ? `You are ${name}, a distinct member of ${team} operating inside Prometheus. You are not Prom or the main chat. Follow your AGENT.md identity and the current team assignment.`
      : `You are ${name}, a distinct standalone agent operating inside Prometheus. You are not Prom or the main chat. Follow your AGENT.md identity and own the current assignment.`;
  }
  if (actor.kind === 'ephemeral_worker') {
    return 'You are a temporary worker operating inside Prometheus, not Prom or the main chat. Own the assigned task without inventing a persistent identity.';
  }
  if (actor.kind === 'voice') return 'You are Prom speaking through the voice interface.';
  return 'You are Prom, the primary user-facing agent operating inside Prometheus.';
}
