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
const RECOVERY_VISIBLE_STATUSES = new Set(['needs_assistance', 'stalled', 'paused', 'awaiting_user_input']);

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

function readMessagesFile(file: string): SubagentChatMessage[] {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed?.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

function isVisibleRecoveryTask(task: any, agentId: string): boolean {
  if (String(task?.subagentProfile || '').trim() !== agentId || task?.teamSubagent) return false;
  const status = String(task?.status || '').trim();
  if (!RECOVERY_VISIBLE_STATUSES.has(status)) return false;
  return status !== 'paused' || String(task?.pauseReason || '') !== 'user_pause';
}

function visibleRecoveryTaskIds(agentId: string): Set<string> {
  const ids = new Set<string>();
  try {
    const tasksDir = path.join(getConfig().getConfigDir(), 'tasks');
    if (!fs.existsSync(tasksDir)) return ids;
    const files = fs.readdirSync(tasksDir)
      .filter((file) => file.endsWith('.json') && file !== '_index.json');
    for (const file of files) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(tasksDir, file), 'utf-8'));
        if (isVisibleRecoveryTask(task, agentId)) ids.add(String(task?.id || file.replace(/\.json$/i, '')));
      } catch {
        // Ignore malformed task records while loading chat history.
      }
    }
  } catch {
    return ids;
  }
  return ids;
}

function normalizeMessageContentForDedupe(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function recoverTaskRecoveryMessages(agentId: string): SubagentChatMessage[] {
  try {
    const tasksDir = path.join(getConfig().getConfigDir(), 'tasks');
    if (!fs.existsSync(tasksDir)) return [];
    const messages: SubagentChatMessage[] = [];
    const files = fs.readdirSync(tasksDir)
      .filter((file) => file.endsWith('.json') && file !== '_index.json');
    for (const file of files) {
      let task: any;
      try {
        task = JSON.parse(fs.readFileSync(path.join(tasksDir, file), 'utf-8'));
      } catch {
        continue;
      }
      if (!isVisibleRecoveryTask(task, agentId)) continue;
      const turns = Array.isArray(task?.recoveryConversation) ? task.recoveryConversation : [];
      if (!turns.length) continue;
      const taskId = String(task?.id || file.replace(/\.json$/i, ''));
      const fallbackTs = Number(task?.lastProgressAt || task?.updatedAt || task?.createdAt || Date.now()) || Date.now();
      turns.forEach((turn: any, index: number) => {
        const role = turn?.role === 'user' ? 'user' : turn?.role === 'assistant' ? 'agent' : null;
        const content = String(turn?.content || '').trim();
        if (!role || !content) return;
        const ts = Number(turn?.timestamp || fallbackTs + index) || fallbackTs + index;
        messages.push({
          id: `recovery_${taskId}_${index}_${role}`,
          agentId,
          role,
          content,
          ts,
          metadata: {
            source: 'task_recovery',
            taskId,
            recoverySource: turn?.source || 'system',
            recoveredFromTask: true,
          },
        });
      });
    }
    return messages;
  } catch {
    return [];
  }
}

export function getSubagentChatHistory(agentId: string, limit = 100): SubagentChatMessage[] {
  try {
    const file = chatPath(agentId);
    const legacyFile = chatPath(agentId, legacyChatDir());
    const primaryMessages = readMessagesFile(file);
    const legacyMessages = legacyFile !== file ? readMessagesFile(legacyFile) : [];
    const recoveryMessages = recoverTaskRecoveryMessages(agentId);
    const activeRecoveryIds = visibleRecoveryTaskIds(agentId);
    const seen = new Set<string>();
    const messagesNear = new Map<string, number>();
    const messages = [...recoveryMessages, ...legacyMessages, ...primaryMessages]
      .filter((msg: any) => msg && typeof msg === 'object')
      .filter((msg: any) => {
        if (msg?.metadata?.source !== 'task_recovery') return true;
        const taskId = String(msg?.metadata?.taskId || '').trim();
        return !!taskId && activeRecoveryIds.has(taskId);
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
      fs.mkdirSync(chatDir(), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ agentId, messages: persistable.slice(-MAX_MESSAGES_PER_AGENT) }, null, 2), 'utf-8');
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
    metadata: message.metadata,
  };
  const messages = getSubagentChatHistory(agentId, MAX_MESSAGES_PER_AGENT);
  messages.push(saved);
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
