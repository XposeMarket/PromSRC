import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { stripInternalToolNotes } from '../comms/reply-processor';
import { appendDurableCommentaryContext, buildDurableCommentaryContext } from '../context/commentary-context';

export type SubagentChatRole = 'user' | 'agent' | 'system';

export interface SubagentChatMessage {
  id: string;
  agentId: string;
  role: SubagentChatRole;
  content: string;
  ts: number;
  /** Durable, model-safe activity fields copied from the runtime turn. */
  commentaryContext?: string;
  visibleReasoningSummary?: string;
  processEntries?: Array<Record<string, any>>;
  liveTraceEntries?: Array<Record<string, any>>;
  metadata?: Record<string, any>;
}

export interface SubagentChatContextState {
  latestContextSummary?: string;
  contextSummaryUpdatedAt?: number;
}

interface SubagentChatFile {
  agentId?: string;
  messages?: SubagentChatMessage[];
  latestContextSummary?: string;
  contextSummaryUpdatedAt?: number;
}

const MAX_MESSAGES_PER_AGENT = 500;

function sanitizeAgentId(agentId: string): string {
  return String(agentId || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'agent';
}

function chatDir(): string {
  return path.join(getConfig().getConfigDir(), 'agent-chats');
}

function legacyChatDir(): string {
  return path.join(getConfig().getWorkspacePath(), '.prometheus', 'agent-chats');
}

function chatPath(agentId: string, dir = chatDir()): string {
  return path.join(dir, `${sanitizeAgentId(agentId)}.json`);
}

function newMessageId(): string {
  return `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readChatFile(file: string): SubagentChatFile {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readMessagesFile(file: string): SubagentChatMessage[] {
  const parsed = readChatFile(file);
  return Array.isArray(parsed.messages) ? parsed.messages : [];
}

function normalizeDurableFields(message: any): SubagentChatMessage {
  const metadata = message?.metadata && typeof message.metadata === 'object' ? message.metadata : {};
  const processEntries = Array.isArray(message?.processEntries)
    ? message.processEntries
    : Array.isArray(metadata.processEntries) ? metadata.processEntries : undefined;
  const liveTraceEntries = Array.isArray(message?.liveTraceEntries)
    ? message.liveTraceEntries
    : Array.isArray(metadata.liveTraceEntries) ? metadata.liveTraceEntries : undefined;
  const visibleReasoningSummary = typeof message?.visibleReasoningSummary === 'string'
    ? message.visibleReasoningSummary
    : typeof metadata.visibleReasoningSummary === 'string' ? metadata.visibleReasoningSummary : undefined;
  const commentaryContext = typeof message?.commentaryContext === 'string'
    ? message.commentaryContext
    : typeof metadata.commentaryContext === 'string'
      ? metadata.commentaryContext
      : buildDurableCommentaryContext({ processEntries, liveTraceEntries, visibleReasoningSummary });
  return {
    id: String(message?.id || newMessageId()),
    agentId: String(message?.agentId || ''),
    role: message?.role === 'agent' || message?.role === 'system' ? message.role : 'user',
    content: String(message?.content || ''),
    ts: Number(message?.ts || Date.now()) || Date.now(),
    ...(commentaryContext ? { commentaryContext: commentaryContext.slice(0, 6_000) } : {}),
    ...(typeof visibleReasoningSummary === 'string' && visibleReasoningSummary.trim()
      ? { visibleReasoningSummary: visibleReasoningSummary.slice(0, 2_400) }
      : {}),
    ...(Array.isArray(processEntries) && processEntries.length ? { processEntries: processEntries.slice(-320) } : {}),
    ...(Array.isArray(liveTraceEntries) && liveTraceEntries.length ? { liveTraceEntries: liveTraceEntries.slice(-320) } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

function writeChatFile(agentId: string, messages: SubagentChatMessage[], state: SubagentChatContextState = {}): void {
  fs.mkdirSync(chatDir(), { recursive: true });
  fs.writeFileSync(chatPath(agentId), JSON.stringify({
    agentId,
    messages: messages.slice(-MAX_MESSAGES_PER_AGENT),
    ...(state.latestContextSummary ? { latestContextSummary: state.latestContextSummary.slice(0, 12_000) } : {}),
    ...(state.contextSummaryUpdatedAt ? { contextSummaryUpdatedAt: state.contextSummaryUpdatedAt } : {}),
  }, null, 2), 'utf-8');
}

function normalizeMessageContentForDedupe(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function getSubagentChatHistory(agentId: string, limit = 100): SubagentChatMessage[] {
  try {
    const file = chatPath(agentId);
    const legacyFile = chatPath(agentId, legacyChatDir());
    const primaryMessages = readMessagesFile(file);
    const legacyMessages = legacyFile !== file ? readMessagesFile(legacyFile) : [];
    const seen = new Set<string>();
    const messagesNear = new Map<string, number>();
    const messages = [...legacyMessages, ...primaryMessages]
      .filter((msg: any) => msg && typeof msg === 'object')
      .map((msg: any) => normalizeDurableFields({ ...msg, agentId: String(msg?.agentId || agentId) }))
      .filter((msg: any) => {
        // Task-attached recovery conversations belong in Runs, not the Home thread.
        return msg?.metadata?.source !== 'task_recovery';
      })
      .sort((a: any, b: any) => Number(a?.ts || 0) - Number(b?.ts || 0))
      .filter((msg: any) => {
        const key = String(msg.id || `${msg.role}:${msg.ts}:${msg.content}`).slice(0, 500);
        if (seen.has(key)) return false;
        seen.add(key);
        const contentKey = `${msg.role}:${normalizeMessageContentForDedupe(msg.content)}`;
        const duplicate = messagesNear.has(contentKey)
          && Math.abs(Number(msg.ts || 0) - Number(messagesNear.get(contentKey) || 0)) < 30_000;
        if (duplicate) return false;
        messagesNear.set(contentKey, Number(msg.ts || 0));
        return true;
      });
    const persistable = messages.filter((msg: any) => msg?.metadata?.source !== 'task_recovery');
    if ((!fs.existsSync(file) || legacyMessages.length) && persistable.length) {
      const state = getSubagentChatContextState(agentId);
      writeChatFile(agentId, persistable, state);
    }
    return messages.slice(-Math.max(1, limit));
  } catch {
    return [];
  }
}

export function appendSubagentChatMessage(
  agentId: string,
  message: Omit<SubagentChatMessage, 'id' | 'agentId' | 'ts'> & { id?: string; ts?: number },
): SubagentChatMessage {
  const saved: SubagentChatMessage = {
    id: message.id || newMessageId(),
    agentId,
    role: message.role,
    content: message.role === 'agent'
      ? stripInternalToolNotes(message.content) || '[Internal tool observation omitted.]'
      : String(message.content || ''),
    ts: message.ts || Date.now(),
    ...(message.commentaryContext ? { commentaryContext: String(message.commentaryContext).slice(0, 6_000) } : {}),
    ...(message.visibleReasoningSummary ? { visibleReasoningSummary: String(message.visibleReasoningSummary).slice(0, 2_400) } : {}),
    ...(Array.isArray(message.processEntries) ? { processEntries: message.processEntries.slice(-320) } : {}),
    ...(Array.isArray(message.liveTraceEntries) ? { liveTraceEntries: message.liveTraceEntries.slice(-320) } : {}),
    metadata: message.metadata,
  };
  const normalizedSaved = normalizeDurableFields(saved);
  const messages = getSubagentChatHistory(agentId, MAX_MESSAGES_PER_AGENT);
  messages.push(normalizedSaved);
  const seen = new Set<string>();
  const near = new Map<string, number>();
  const trimmed = messages
    .filter((msg: any) => msg?.metadata?.source !== 'task_recovery')
    .filter((msg: any) => {
      const key = String(msg.id || `${msg.role}:${msg.ts}:${msg.content}`).slice(0, 500);
      if (seen.has(key)) return false;
      seen.add(key);
      const contentKey = `${msg.role}:${normalizeMessageContentForDedupe(msg.content)}`;
      const ts = Number(msg.ts || 0);
      if (near.has(contentKey) && Math.abs(ts - Number(near.get(contentKey) || 0)) < 30_000) return false;
      near.set(contentKey, ts);
      return true;
    })
    .slice(-MAX_MESSAGES_PER_AGENT);
  writeChatFile(agentId, trimmed, getSubagentChatContextState(agentId));
  return normalizedSaved;
}

export function getSubagentChatContextState(agentId: string): SubagentChatContextState {
  try {
    const primary = readChatFile(chatPath(agentId));
    const legacy = readChatFile(chatPath(agentId, legacyChatDir()));
    const primaryAt = Number(primary.contextSummaryUpdatedAt || 0);
    const legacyAt = Number(legacy.contextSummaryUpdatedAt || 0);
    const selected = legacyAt > primaryAt ? legacy : primary;
    return {
      latestContextSummary: typeof selected.latestContextSummary === 'string' ? selected.latestContextSummary : undefined,
      contextSummaryUpdatedAt: Number(selected.contextSummaryUpdatedAt || 0) || undefined,
    };
  } catch {
    return {};
  }
}

export function setSubagentChatContextState(
  agentId: string,
  state: SubagentChatContextState,
  activeMessages?: Array<Record<string, any>>,
): void {
  // When a session has compacted, callers can provide its active raw tail.
  // Persisting that tail here keeps a later channel/session rebuild from
  // replaying the pre-compaction transcript beside the retained summary.
  const messages = Array.isArray(activeMessages)
    ? activeMessages
      .filter((message) => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'agent' || message.role === 'system'))
      .map((message) => normalizeDurableFields({
        ...message,
        agentId,
        role: message.role === 'assistant' ? 'agent' : message.role,
        ts: Number(message.ts || message.timestamp || Date.now()) || Date.now(),
      }))
    : getSubagentChatHistory(agentId, MAX_MESSAGES_PER_AGENT);
  writeChatFile(agentId, messages, {
    latestContextSummary: String(state.latestContextSummary || '').trim() || undefined,
    contextSummaryUpdatedAt: Number(state.contextSummaryUpdatedAt || 0) || undefined,
  });
}

export function formatSubagentChatContext(messages: SubagentChatMessage[], agentName: string, maxMessages = 20): string {
  const recent = messages.slice(-Math.max(1, maxMessages));
  if (recent.length === 0) return '';
  return recent.map(m => {
    const label = m.role === 'user' ? 'User' : m.role === 'agent' ? agentName : 'System';
    const content = m.role === 'agent'
      ? appendDurableCommentaryContext(m.content, m)
      : m.content;
    return `${label}: ${content}`;
  }).join('\n\n');
}
