/**
 * Bounded, presentation-safe continuity for one runtime turn.
 *
 * This is deliberately separate from transcript messages and from the raw
 * provider thinking stream. It is the small handoff Prometheus can carry from
 * one turn to the next: what was being attempted, what was learned, what was
 * decided, what completed, and what still needs verification.
 */

export type TurnContextPacketStatus = 'completed' | 'aborted' | 'failed';

export interface TurnContextPacket {
  version: 1;
  id: string;
  turnId: string;
  sessionId: string;
  status: TurnContextPacketStatus;
  request: string;
  reasoningSummary?: string;
  findings: string[];
  decisions: string[];
  completedActions: string[];
  toolState?: string;
  progressState?: string;
  uncertainties: string[];
  pendingTasks: string[];
  continueFromHere: string;
  abortReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TurnContextPacketInput {
  id?: string;
  turnId: string;
  sessionId: string;
  status: TurnContextPacketStatus;
  request: string;
  reasoningSummary?: string;
  findings?: Array<unknown>;
  decisions?: Array<unknown>;
  completedActions?: Array<unknown>;
  toolState?: string;
  progressState?: string;
  uncertainties?: Array<unknown>;
  pendingTasks?: Array<unknown>;
  continueFromHere?: string;
  abortReason?: string;
  createdAt?: number;
  updatedAt?: number;
}

export const WORKING_CONTEXT_PACKET_LIMIT = 5;
export const WORKING_CONTEXT_PACKET_MAX_CHARS = 16_000;
export const WORKING_CONTEXT_PROMPT_MAX_CHARS = 9_000;

const CONTINUITY_COMMAND_RE = /(?:\r?\n|&&|\|\||[|<>]|(?:^|\s)(?:add-content|set-content|out-file|convertto-json|invoke-[a-z]+|powershell(?:\.exe)?|pwsh|cmd(?:\.exe)?|bash|zsh|sh|node|npm|npx|python(?:\.exe)?|git|cargo|go|dotnet|pytest|tsc)\b|-command\b|@\s*['"])/i;

function compactText(value: unknown, maxChars: number): string {
  const text = String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 18)).trimEnd()}...[truncated]`;
}

function compactList(values: Array<unknown> | undefined, maxItems = 8, maxChars = 360): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(values) ? values : []) {
    const item = compactText(value, maxChars);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

// Redact only lines that actually look like a raw shell command. This used to
// test the WHOLE multi-line block, and since every tool summary contains a
// newline (and usually the word "git"), the entire tool state was replaced
// with "[shell command omitted]" and resumed turns lost everything they did.
const SHELL_LINE_RE = /^(?:\$\s|PS [A-Z]:|>\s)|(?:^|;\s*)(?:git|npm|npx|node|powershell|pwsh|cmd|bash|python)\s+-{0,2}[a-z]|\|\s*(?:Select|%|ForEach|Where|Out-)|\$[A-Za-z_]+\s*=|Get-(?:Content|ChildItem|Process)|Invoke-WebRequest|@'|'@/i;

function compactActivityText(value: unknown, maxChars: number): string {
  const text = compactText(value, maxChars * 2);
  if (!text) return text;
  const out: string[] = [];
  let inHereString = false;
  for (const line of text.split('\n')) {
    if (inHereString) {
      if (/^\s*['"]@/.test(line)) inHereString = false;
      continue;
    }
    if (!SHELL_LINE_RE.test(line) && !/(?:Add|Set)-Content|Out-File|-Command\b|@['"]\s*$/i.test(line)) {
      out.push(line);
      continue;
    }
    if (/@['"]\s*$/.test(line)) inHereString = true;
    const marker = line.search(CONTINUITY_COMMAND_RE);
    const prefix = marker > 0 ? line.slice(0, marker).replace(/[\s:|=(-]+$/, '').trim() : '';
    out.push(prefix ? `${prefix}: [shell command omitted]` : '[shell command omitted]');
  }
  return compactText(out.join('\n'), maxChars);
}

function compactActivityList(values: Array<unknown> | undefined, maxItems = 8, maxChars = 360): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(values) ? values : []) {
    const item = compactActivityText(value, maxChars);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function normalizeReasoningSummary(value: unknown, maxChars = 3_200): string {
  return compactText(value, maxChars);
}

export function normalizeTurnContextPacket(input: any): TurnContextPacket | null {
  if (!input || typeof input !== 'object') return null;
  const sessionId = compactText(input.sessionId, 240);
  const turnId = compactText(input.turnId, 240);
  const request = compactText(input.request, 1_200) || '[No text request; inspect the recorded runtime state and attachments.]';
  if (!sessionId || !turnId) return null;
  const rawStatus = String(input.status || '').trim().toLowerCase();
  const status: TurnContextPacketStatus = rawStatus === 'aborted'
    ? 'aborted'
    : rawStatus === 'failed'
      ? 'failed'
      : 'completed';
  const now = Date.now();
  const createdAt = Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : now;
  const updatedAt = Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : createdAt;
  const packet: TurnContextPacket = {
    version: 1,
    id: compactText(input.id, 240) || `turn_context_${turnId}`,
    turnId,
    sessionId,
    status,
    request,
    reasoningSummary: normalizeReasoningSummary(input.reasoningSummary),
    findings: compactActivityList(input.findings),
    decisions: compactActivityList(input.decisions),
    // Keep the NEWEST steps (the tail is what a resume needs), with room for results.
    completedActions: compactActivityList(Array.isArray(input.completedActions) ? input.completedActions.slice(-24) : [], 24, 300),
    toolState: compactActivityText(input.toolState, 2_400),
    progressState: compactActivityText(input.progressState, 1_800),
    uncertainties: compactActivityList(input.uncertainties),
    pendingTasks: compactActivityList(input.pendingTasks),
    continueFromHere: compactText(input.continueFromHere, 900)
      || 'Continue from the recorded state; verify any action that was in flight before taking it again.',
    abortReason: compactText(input.abortReason, 260),
    createdAt,
    updatedAt,
  };
  const serializedLength = JSON.stringify(packet).length;
  if (serializedLength <= WORKING_CONTEXT_PACKET_MAX_CHARS) return packet;
  packet.reasoningSummary = normalizeReasoningSummary(packet.reasoningSummary, 2_200);
  packet.toolState = compactText(packet.toolState, 1_400);
  packet.progressState = compactText(packet.progressState, 1_000);
  packet.findings = compactActivityList(packet.findings, 5, 240);
  packet.decisions = compactActivityList(packet.decisions, 5, 240);
  packet.completedActions = compactActivityList(packet.completedActions.slice(-14), 14, 220);
  packet.uncertainties = compactActivityList(packet.uncertainties, 5, 240);
  packet.pendingTasks = compactActivityList(packet.pendingTasks, 5, 240);
  return packet;
}

export function buildTurnContextPacket(input: TurnContextPacketInput): TurnContextPacket {
  const now = Date.now();
  const packet = normalizeTurnContextPacket({
    ...input,
    id: input.id || `turn_context_${input.turnId}`,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  });
  if (!packet) throw new Error('Cannot build a turn context packet without session, turn, and request identifiers.');
  return packet;
}

function mergeList(left: string[], right: string[], maxItems = 8): string[] {
  return compactList([...left, ...right], maxItems);
}

export function mergeTurnContextPackets(existing: TurnContextPacket, incoming: TurnContextPacket): TurnContextPacket {
  const merged = buildTurnContextPacket({
    ...incoming,
    id: existing.id,
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    request: incoming.request || existing.request,
    reasoningSummary: incoming.reasoningSummary || existing.reasoningSummary,
    findings: mergeList(existing.findings, incoming.findings),
    decisions: mergeList(existing.decisions, incoming.decisions),
    completedActions: compactList([...existing.completedActions, ...incoming.completedActions].slice(-24), 24, 300),
    toolState: incoming.toolState || existing.toolState,
    progressState: incoming.progressState || existing.progressState,
    uncertainties: mergeList(existing.uncertainties, incoming.uncertainties),
    pendingTasks: mergeList(existing.pendingTasks, incoming.pendingTasks),
    continueFromHere: incoming.continueFromHere || existing.continueFromHere,
    abortReason: incoming.abortReason || existing.abortReason,
  });
  return merged;
}

function formatList(label: string, values: string[]): string {
  return values.length ? `${label}:\n${values.map((value) => `- ${value}`).join('\n')}` : '';
}

export function formatTurnContextPacketForPrompt(packet: TurnContextPacket): string {
  return [
    `[TURN_CONTEXT status=${packet.status} turn=${packet.turnId}]`,
    `Request: ${packet.request}`,
    packet.reasoningSummary ? `Reasoning/decision summary:\n${packet.reasoningSummary}` : '',
    formatList('Findings', packet.findings),
    formatList('Decisions', packet.decisions),
    formatList('Completed actions', packet.completedActions),
    packet.toolState ? `Tool state:\n${packet.toolState}` : '',
    packet.progressState ? `Progress state:\n${packet.progressState}` : '',
    formatList('Uncertainties', packet.uncertainties),
    formatList('Pending tasks', packet.pendingTasks),
    packet.abortReason ? `Abort reason: ${packet.abortReason}` : '',
    `Continue from here: ${packet.continueFromHere}`,
    '[/TURN_CONTEXT]',
  ].filter(Boolean).join('\n');
}

export function formatTurnContextPacketsForPrompt(
  packets: TurnContextPacket[],
  maxChars = WORKING_CONTEXT_PROMPT_MAX_CHARS,
): string {
  const normalized = (Array.isArray(packets) ? packets : [])
    .map(normalizeTurnContextPacket)
    .filter((packet): packet is TurnContextPacket => !!packet)
    .slice(-WORKING_CONTEXT_PACKET_LIMIT)
    .reverse();
  if (!normalized.length) return '';
  const header = '[WORKING_CONTEXT_PACKETS newest->oldest]';
  const footer = '[/WORKING_CONTEXT_PACKETS]';
  // The newest packet is the one a resumed/aborted turn depends on, so it always
  // goes in whole; older packets only fill the remaining budget. Previously a
  // hard cut at maxChars could chop the newest packet's completed actions.
  const parts = normalized.map(formatTurnContextPacketForPrompt);
  const kept: string[] = [parts[0]];
  let used = header.length + footer.length + parts[0].length + 4;
  for (const part of parts.slice(1)) {
    if (used + part.length + 2 > maxChars) break;
    kept.push(part);
    used += part.length + 2;
  }
  return `${header}\n${kept.join('\n\n')}\n${footer}`;
}

export function shouldPersistTurnContext(input: {
  status: TurnContextPacketStatus;
  reasoningSummary?: string;
  toolCount?: number;
  hasFileChanges?: boolean;
  hasArtifacts?: boolean;
}): boolean {
  // A provider may emit a reasoning summary for an ordinary answer. Do not
  // turn every chat reply into durable working memory; retain summaries when
  // the turn also has durable work/evidence, or when it ended abnormally.
  return input.status !== 'completed'
    || Number(input.toolCount || 0) > 0
    || input.hasFileChanges === true
    || input.hasArtifacts === true;
}
