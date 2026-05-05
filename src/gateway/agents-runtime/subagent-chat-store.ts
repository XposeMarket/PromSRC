import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { stripInternalToolNotes } from '../comms/reply-processor';

export type SubagentChatRole = 'user' | 'agent' | 'system';

export interface SubagentChatMessage {
  id: string;
  agentId: string;
  role: SubagentChatRole;
  content: string;
  ts: number;
  metadata?: Record<string, any>;
}

const MAX_MESSAGES_PER_AGENT = 500;

function sanitizeAgentId(agentId: string): string {
  return String(agentId || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'agent';
}

function chatDir(): string {
  return path.join(getConfig().getWorkspacePath(), '.prometheus', 'agent-chats');
}

function chatPath(agentId: string): string {
  return path.join(chatDir(), `${sanitizeAgentId(agentId)}.json`);
}

function newMessageId(): string {
  return `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getSubagentChatHistory(agentId: string, limit = 100): SubagentChatMessage[] {
  try {
    const file = chatPath(agentId);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
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
    metadata: message.metadata,
  };
  const messages = getSubagentChatHistory(agentId, MAX_MESSAGES_PER_AGENT);
  messages.push(saved);
  const trimmed = messages.slice(-MAX_MESSAGES_PER_AGENT);
  fs.mkdirSync(chatDir(), { recursive: true });
  fs.writeFileSync(chatPath(agentId), JSON.stringify({ agentId, messages: trimmed }, null, 2), 'utf-8');
  return saved;
}

export function formatSubagentChatContext(messages: SubagentChatMessage[], agentName: string, maxMessages = 20): string {
  const recent = messages.slice(-Math.max(1, maxMessages));
  if (recent.length === 0) return '';
  return recent.map(m => {
    const label = m.role === 'user' ? 'User' : m.role === 'agent' ? agentName : 'System';
    return `${label}: ${m.content}`;
  }).join('\n\n');
}
